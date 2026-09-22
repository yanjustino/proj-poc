// A small, self-contained widget for one run's live state — reused by the
// Fontes tab (one per uploaded file being ingested) and the Artefatos tab
// (one per artifact being generated). Owns its own <div> and re-renders it
// on every status update; the caller just mounts `.element` and forwards
// startAndWatch/resumeAndWatch's onUpdate callback into `.update(status)`.
import { resumeAndWatch, cancelRun } from './api.js';
import { dotClass } from './status.js';
import { icon } from './icons.js';

// WORKING_MESSAGE is the friendly headline shown while a run is actually
// executing/queued (see render()'s own working/queued branch) — feedback
// from a real generation that looked frozen (no step change for a while,
// especially on the Devin backend — see elapsedLine's own comment) was that
// a bare status dot + "gerando" read as broken, not busy. This spells out
// what's actually happening instead of leaving the reader to infer it from
// a spinning icon alone.
const WORKING_MESSAGE = { working: 'Só um instante, o LLM está trabalhando nisso…', queued: 'Só um instante, você está na fila para começar…' };

export const STATE_LABEL = {
  working: 'gerando',
  queued: 'na fila',
  paused: 'aguarda aprovação',
  completed: 'concluído',
  failed: 'falhou',
  canceled: 'cancelado',
};

// onCancel: called after a paused run is canceled on the backend, instead of
// the tracker showing its own "cancelado" state — lets the host (Artefatos
// tab) drop the tracker entirely and fall back to "pronto para gerar", since
// canceling here abandons the draft rather than leaving a record of it (see
// tab-artefatos.js's onRunCancel). Left unset, the tracker shows "cancelado"
// itself — fine for a host (Fontes' ingest) that never actually pauses.
//
// onUpdate: called instead of this tracker's own local `update` for every
// resumeAndWatch push (Aprovar/Regenerar below) — Fontes/Wiki's trackers
// never pause, so they never hit this path and can leave it unset (falls
// back to the local-only `update`). Artefatos MUST pass one: real bug,
// reported in production — approving a paused run wrote the artifact to
// disk correctly, but the screen kept showing the paused composer, then on
// the next unrelated re-render fell back to "pronto para gerar" as if
// nothing had happened. Root cause was exactly this gap — Aprovar only ever
// called this widget's own `update`, which repaints `element`/`composer` in
// place but has no way to reach the host's refreshDoneState()/renderList()/
// renderDetail() (tab-artefatos.js's onRunUpdate), so the host's own
// `doneNames` never learned the artifact was written and kept rendering the
// stale "not done yet" view. Passing the host's onRunUpdate here instead
// fixes both directions: it already calls tracker.update() as its first
// line (same local repaint as before), then goes on to do the host-side
// refresh — and the same fix also makes Regenerar's new draft actually
// replace the stale preview instead of leaving the old one on screen.
// fillHeight: Artefatos mounts a working/queued tracker as the reading
// pane's ENTIRE body content (beginCustom() clears everything else out) —
// the generating card should sit in the middle of that space, not stick to
// the top like Fontes' compact per-file tracker or Wiki's inline one. Adds
// .run-tracker-fill instead of centering .run-tracker unconditionally,
// since those other two hosts mount it inline among other content, where
// stretching to fill height and centering would look broken.
export function createRunTracker({ resumeArgs = { approved: true }, onCancel, onUpdate, fillHeight = false } = {}) {
  const element = document.createElement('div');
  element.className = 'run-tracker';
  // Kept as a second, separate root (not just a child of `element`) so a
  // host with a persistent action-bar slot — the reading pane's
  // setFooter/.doc-footer, pinned below the scrollable document instead of
  // scrolling away with it — can mount it there instead of wherever
  // `element` itself ends up. A host with no such slot (Fontes' compact
  // source-card tracker) just appends both, one after the other, same as
  // before this existed.
  const composer = document.createElement('div');
  composer.className = 'run-composer';
  composer.hidden = true;
  // approveAction is Aprovar's own root, separate from `composer` — the
  // reading pane mounts it in the header toolbar (reading-pane.js's
  // setToolbarAction) instead of the footer, while Cancelar/Regenerar stay in
  // `composer` below. Same reasoning as `composer` itself: rebuilt wholesale
  // on every render(), so a host just re-mounts it once and never needs to
  // track it across renders.
  const approveAction = document.createElement('div');
  approveAction.className = 'run-approve-action';
  approveAction.hidden = true;
  let status = null;
  // Which paused-state action is in flight, if any — drives both the
  // clicked button's own "…ing" label and disabling every control in the
  // composer (typing a new comment mid-request wouldn't be reflected in the
  // request already sent).
  let busyAction = null; // null | 'approve' | 'regenerate' | 'cancel'
  // Kept across re-renders (not just read from the DOM at submit time) so a
  // stray render() mid-typing — shouldn't happen while genuinely paused
  // (nothing pushes a new status until resumed), but cheap to be correct
  // about — never wipes what the user already typed.
  let feedbackText = '';
  // tickTimer advances the elapsed-time readout once a second while a run
  // is working/queued — mhl can go a long stretch (one slow LLM call)
  // without pushing a single status update, which otherwise reads as
  // frozen (the exact complaint that led to this: "gerando" sitting still
  // with no step change and, on the Devin backend, no token count either —
  // see output/DEVIN-CLI.md, tokens_in/out stay 0 = "unavailable" for that
  // backend, not live progress). Started/stopped from ensureTicking(),
  // called at the end of every render() — self-correcting, so a status
  // update that ends the run also stops the ticker without any extra
  // bookkeeping.
  //
  // Deliberately does NOT call the full render() every second — the orbit
  // animation (see render()'s isActive branch) is a subtree of plain CSS
  // keyframe animations, which restart from frame zero every time their
  // element is torn down and recreated. render() rebuilds `element` wholesale
  // via innerHTML, so a naive render()-every-second here was tearing the
  // whole orbit down and rebuilding it every tick, before most of its own
  // animations (2.4s/2.8s/3.6s/6s/22s durations) ever completed a single
  // cycle — it visibly never got anywhere, which read as "not animating" at
  // all. Patching just the elapsed text node in place leaves the orbit's
  // DOM (and its running animations) untouched.
  let tickTimer = null;

  function tickElapsed() {
    if (!status) return;
    const seconds = elapsedSeconds(status);
    const el = element.querySelector('[data-run-elapsed]');
    if (el && seconds != null) el.textContent = formatDuration(seconds);
  }

  // activeSignature/lastActiveSignature: the OTHER source of the same
  // orbit-restart bug tickElapsed above fixes only half of. App.WatchRun
  // polls mhl_run_status every 500ms (app.go's runPollInterval) and pushes
  // *every* tick to this tracker's update() below, whether or not anything
  // actually changed — a heartbeat, not just real progress. update() used
  // to call render() unconditionally on every one of those, tearing the
  // orbit down and rebuilding it twice a second — worse than the 1s
  // self-timer tickElapsed replaced, and enough on its own to make the
  // animations look permanently stuck at frame zero. Comparing this
  // signature lets update() tell a genuine change (new token count, a state
  // transition) from a no-op heartbeat and skip the full rebuild for the
  // latter, same as a self-timer tick. step/stepIndex/stepTotal are
  // deliberately left out — mhl_run_status's step counter turned out to be
  // a static graph position (how many named steps the whole merged
  // workflow declares, e.g. Discovery's Dispatch+Gate+Done plus every
  // artifact's own Generate/Commit pair — 19 for the whole thing,
  // regardless of which one artifact is actually being generated), not
  // live progress: it sat on the exact same value for an artifact's entire
  // generation, since one Writer.generate call is one mhl step from start
  // to finish. Was shown in the meta row and read as a moving progress
  // indicator when it never moved — dropped for the same reason the ETA
  // was.
  //
  // runId/startedAt DO need to be in here, even though neither is shown
  // directly — real regression once step/stepIndex/stepTotal came out
  // above: tab-artefatos.js's generate() seeds the tracker with
  // `{runId: '', state: 'working'}` (no startedAt yet) before StartRun's
  // own response — real runId + startedAt — lands. With only state+tokens
  // in the signature, that seed and the first real push both hashed to the
  // same "working, no tokens yet" string, so the fast path fired on the
  // one push that actually mattered — elapsedSeconds() had no startedAt to
  // work from until then, and the elapsed span never got created. Keeping
  // runId/startedAt in the signature forces a real render on exactly that
  // transition.
  let lastActiveSignature = null;

  function activeSignature(s) {
    const vars = s.vars || {};
    return [s.state, s.runId, s.startedAt, vars.tokens_in, vars.tokens_out].join('|');
  }

  function ensureTicking() {
    const shouldTick = status && (status.state === 'working' || status.state === 'queued');
    if (shouldTick && !tickTimer) {
      tickTimer = setInterval(tickElapsed, 1000);
    } else if (!shouldTick && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function tokensLine(s) {
    const vars = s.vars || {};
    const tokensIn = vars.tokens_in;
    const tokensOut = vars.tokens_out;
    if (tokensIn == null && tokensOut == null) return '';
    return `<span class="run-tokens">${tokensIn ?? 0} → ${tokensOut ?? 0} tokens</span>`;
  }

  function elapsedSeconds(s) {
    if (s.state !== 'working' && s.state !== 'queued') return null;
    const startMs = s.startedAt ? Date.parse(s.startedAt) : NaN;
    if (Number.isNaN(startMs)) return null;
    return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  }

  function formatDuration(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}min ${seconds}s` : `${seconds}s`;
  }

  // doCancel is shared by the paused composer's own "Cancelar" (below) and
  // the inline one rendered directly on the working/queued status row (see
  // render()) — same abandon-this-run semantics either way, just reachable
  // earlier: previously "Cancelar" only existed once a run reached Modo
  // Buddy's pause point, so a run stuck mid-generation (the reported case)
  // had no way to stop short of force-quitting the app.
  async function doCancel(s) {
    busyAction = 'cancel';
    render();
    try {
      await cancelRun(s.runId);
      if (onCancel) {
        onCancel();
      } else {
        busyAction = null;
        status = { ...s, state: 'canceled' };
        render();
      }
    } catch (err) {
      busyAction = null;
      status = { ...s, state: 'failed', error: String(err) };
      render();
    }
  }

  function render() {
    if (!status) {
      element.innerHTML = '';
      composer.innerHTML = '';
      composer.hidden = true;
      approveAction.innerHTML = '';
      approveAction.hidden = true;
      return;
    }
    const s = status;
    const label = STATE_LABEL[s.state] || s.state;
    const busy = busyAction !== null;
    const isActive = s.state === 'working' || s.state === 'queued';
    // .run-tracker-fill must track isActive on every render, not just get
    // set once at construction — real bug this fixes: once a working run
    // paused for Modo Buddy review, tracker.element kept the fill/center
    // styling from its working phase, centering the now-tiny "aguarda
    // aprovação" status line in the pane's full height and shoving the
    // actual preview (appendPausedPreview's own content, appended as a
    // sibling right after tracker.element — see tab-artefatos.js's
    // renderDetail()) hundreds of pixels below the fold.
    element.classList.toggle('run-tracker-fill', fillHeight && isActive);
    // Reachable while working/queued only — the paused state already has
    // its own Cancelar in `composer` below, pinned to the reading pane's
    // footer instead of scrolling away with `element`.
    const cancelButtonHtml = `<button class="button tertiary small run-cancel-inline" ${busy ? 'disabled' : ''}>${busyAction === 'cancel' ? 'Cancelando…' : 'Cancelar'}</button>`;

    if (isActive) {
      const seconds = elapsedSeconds(s);

      const metaBits = [];
      // data-run-elapsed: tickElapsed() (see this file's own ensureTicking
      // comment) patches this node's text directly once a second instead of
      // going through render() again — the ETA this line used to include
      // (extrapolated from pace-so-far) was dropped: it read as a real
      // estimate mhl was giving, when it was really just a guess from this
      // widget.
      if (seconds != null) metaBits.push(`<span data-run-elapsed>${formatDuration(seconds)}</span>`);
      const tokens = tokensLine(s);
      if (tokens) metaBits.push(tokens);

      // The centered generating block is Artefatos-only (fillHeight — see
      // this file's own doc comment on that option): it's sized for being
      // the reading pane's entire content. Reported looking absurd blown up
      // inside Fontes' compact per-file card during ingest, which reuses
      // this same working/queued state for something much smaller — those
      // hosts fall through to the same plain status row every other state
      // already uses, just with the inline Cancelar added.
      if (fillHeight) {
        element.innerHTML = `
          <div class="run-generating">
            <div class="run-generating-status">
              <span class="run-generating-icon">${icon('clock', 26)}</span>
              <span class="run-generating-badge"><span class="run-generating-blink"></span>${escapeHtml((STATE_LABEL[s.state] || s.state).toUpperCase())}</span>
              <span class="run-generating-stage">${escapeHtml(WORKING_MESSAGE[s.state] || label)}</span>
              ${metaBits.length ? `<div class="run-generating-meta">${metaBits.join('<span class="run-generating-sep">/</span>')}</div>` : ''}
            </div>
          </div>
          ${cancelButtonHtml}
        `;
      } else {
        element.innerHTML = `
          <div class="run-status-row">
            <span class="status-dot ${dotClass(s.state)}"></span>
            <span class="run-label">${escapeHtml(label)}</span>
            ${metaBits.join('')}
          </div>
          ${cancelButtonHtml}
        `;
      }
      lastActiveSignature = activeSignature(s);
    } else {
      lastActiveSignature = null;
      // A failed run used to get a plain red label buried among other
      // status text — easy to miss, especially once metaBits/reasonLine
      // also render. Promoted to its own bordered banner, icon + message,
      // placed first so it's the first thing in the preview pane regardless
      // of what else this tracker renders below it.
      const errorLine = s.state === 'failed' && s.error
        ? `<div class="run-error-banner" role="alert"><span class="run-error-icon">${icon('alertCircle', 18)}</span><span class="run-error-message">${escapeHtml(s.error)}</span></div>`
        : '';
      // s.reason is pause()'s own message (e.g. "revise o conteudo de
      // 'brief' antes de gravar em artifacts/") — see
      // mhlbridge.RunStatus.Reason's doc comment for why this was silently
      // dropped before it.
      const reasonLine = s.state === 'paused' && s.reason ? `<span class="run-reason">${escapeHtml(s.reason)}</span>` : '';
      element.innerHTML = `
        ${errorLine}
        <div class="run-status-row">
          <span class="status-dot ${dotClass(s.state)}"></span>
          <span class="run-label">${label}</span>
          ${tokensLine(s)}
        </div>
        ${reasonLine}
      `;
    }

    const cancelInlineButton = element.querySelector('.run-cancel-inline');
    if (cancelInlineButton) {
      cancelInlineButton.addEventListener('click', () => doCancel(s));
    }

    ensureTicking();

    // Chat-style composer for the paused state: the feedback field sits on
    // top (like a message draft), Cancelar/Regenerar live in one row below
    // it. "Solicitar mudanças" (Regenerar) resumes the SAME paused run with
    // approved:false + feedback instead of true; Gate (see
    // discovery.mh/delivery.mh) treats that as "go back to *Generate with
    // this comment attached", not "pause again" — a real regeneration, not a
    // cosmetic note. Cancelar calls mhl_run_cancel and, when the host gave us
    // one, hands off to onCancel instead of rendering a "cancelado" state
    // here — see this file's createRunTracker doc comment for why. Lives in
    // its own root (see `composer` above `element`) so a host can pin it
    // below the scrollable document instead of letting it scroll away with
    // the rest of `element`.
    //
    // Aprovar lives in `approveAction`, a separate root the host mounts in
    // the reading pane's header toolbar instead of down here (see
    // reading-pane.js's setToolbarAction) — Modo Buddy's primary action reads
    // better next to "ver fonte"/expand than buried below a long preview.
    if (s.state !== 'paused') {
      composer.innerHTML = '';
      composer.hidden = true;
      approveAction.innerHTML = '';
      approveAction.hidden = true;
    } else {
      composer.hidden = false;
      composer.innerHTML = `
        <textarea class="run-feedback-input" placeholder="Pedir uma mudança nesta versão (opcional) — a próxima geração considera isto." ${busy ? 'disabled' : ''}>${escapeHtml(feedbackText)}</textarea>
        <div class="run-composer-actions">
          <button class="button tertiary small run-cancel" ${busy ? 'disabled' : ''}>${busyAction === 'cancel' ? 'Cancelando…' : 'Cancelar'}</button>
          <div class="run-composer-actions-right">
            <button class="button secondary small run-feedback-submit" ${busy ? 'disabled' : ''}>${busyAction === 'regenerate' ? 'Enviando…' : 'Regenerar'}</button>
          </div>
        </div>
      `;
      approveAction.hidden = false;
      approveAction.innerHTML = `<button class="button primary small run-approve" ${busy ? 'disabled' : ''}>${busyAction === 'approve' ? 'Aplicando…' : 'Aprovar'}</button>`;
    }

    const approveButton = approveAction.querySelector('.run-approve');
    if (approveButton) {
      approveButton.addEventListener('click', async () => {
        busyAction = 'approve';
        render();
        try {
          await resumeAndWatch(s.runId, resumeArgs, (next) => (onUpdate || update)(next));
        } catch (err) {
          busyAction = null;
          status = { ...s, state: 'failed', error: String(err) };
          render();
        }
      });
    }

    const feedbackInput = composer.querySelector('.run-feedback-input');
    if (feedbackInput) {
      feedbackInput.addEventListener('input', () => {
        feedbackText = feedbackInput.value;
      });
    }

    const feedbackSubmit = composer.querySelector('.run-feedback-submit');
    if (feedbackSubmit) {
      feedbackSubmit.addEventListener('click', async () => {
        const text = feedbackText.trim();
        if (!text) return;
        busyAction = 'regenerate';
        render();
        try {
          await resumeAndWatch(s.runId, { approved: false, feedback: text }, (next) => (onUpdate || update)(next));
        } catch (err) {
          busyAction = null;
          status = { ...s, state: 'failed', error: String(err) };
          render();
        }
      });
    }

    const cancelButton = composer.querySelector('.run-cancel');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => doCancel(s));
    }
  }

  function update(next) {
    // A heartbeat: still working/queued, and nothing about it actually
    // changed since the last full render (see activeSignature's own
    // comment — App.WatchRun pushes one of these every 500ms regardless of
    // real progress). Advance just the elapsed readout, exactly like
    // tickElapsed's own self-timer tick, instead of tearing the orbit's
    // running CSS animations down to rebuild the exact same markup.
    const isActive = next.state === 'working' || next.state === 'queued';
    if (isActive && lastActiveSignature !== null && activeSignature(next) === lastActiveSignature) {
      status = next;
      tickElapsed();
      return;
    }
    status = next;
    busyAction = null;
    feedbackText = '';
    render();
  }

  // dispose stops tickTimer — without this, a tracker abandoned mid-run
  // (its host unmounts, or replaces it with a fresh one for the same row)
  // would keep ticking every second forever; nothing else ever references
  // it again to clear it. The host is expected to call this whenever it
  // drops a tracker it didn't get to a terminal state.
  function dispose() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  return { element, composer, approveAction, update, dispose, get status() { return status; } };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
