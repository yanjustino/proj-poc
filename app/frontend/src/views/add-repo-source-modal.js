import { selectRepoDir, snapshotRepo, cloneRepo, discardClone } from '../api.js';
import { icon } from '../icons.js';

// openAddRepoSourceModal registers the AS-IS snapshot of a git repository:
// the Wiki action snapshot_repo (workflows/shared/wiki/repo_snapshot.mh, no
// LLM) writes up to three Markdown sources into raw/ — estrutura, stack e
// dependências, regras e decisões. Resolves { names, ingest } like the other
// source modals (ingesting stays the caller's job), or null if cancelled.
//
// Two origins, same snapshot:
//   link  — shallow clone into a temp folder (CloneRepoForSnapshot), then
//           snapshot, then the clone is discarded whatever happened;
//   local — a clone already on disk, picked with the folder dialog.
export function openAddRepoSourceModal(project) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-wide">
        <h2>Retrato de um repositório</h2>
        <div class="repo-origin-tabs" role="tablist">
          <button class="repo-origin-tab active" data-origin="link" role="tab">${icon('link', 13)} Link</button>
          <button class="repo-origin-tab" data-origin="local" role="tab">${icon('folder', 13)} Pasta local</button>
        </div>
        <div data-pane="link">
          <label for="repo-url">Link do repositório</label>
          <input id="repo-url" type="text" autocomplete="off" spellcheck="false" placeholder="https://github.com/org/repo  ou  git@github.com:org/repo.git" />
          <label for="repo-branch">Branch (opcional)</label>
          <input id="repo-branch" type="text" autocomplete="off" spellcheck="false" placeholder="Usa a branch padrão se ficar em branco" />
          <p class="modal-hint">Repositórios privados usam o acesso já configurado no git desta máquina (credential helper ou chave SSH) — não cole tokens no link. O clone é temporário e apagado logo depois do retrato.</p>
        </div>
        <div data-pane="local" hidden>
          <label>Pasta do repositório</label>
          <div class="repo-picker">
            <code data-path>Nenhuma pasta escolhida</code>
            <button class="button secondary small" data-choose>${icon('folderOpen', 14)} Escolher…</button>
          </div>
          <p class="modal-hint">Um clone que já está no seu disco. Só arquivos versionados entram; alterações não commitadas ficam de fora.</p>
        </div>
        <p class="modal-hint">Entram três fontes: <b>estrutura</b> (árvore, linguagens, pontos de entrada, commits recentes), <b>stack e dependências</b> (manifestos, Docker, CI) e <b>regras e decisões</b> (README, AGENTS.md, ADRs, lint). Nada de código-fonte linha a linha.</p>
        <div class="modal-error" data-error hidden></div>
        <div class="modal-actions">
          <button class="button secondary small" data-cancel>Cancelar</button>
          <button class="button tertiary small" data-submit="register" disabled>Apenas registrar</button>
          <button class="button primary small" data-submit="ingest" disabled>Registrar e ingerir</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    let busy = false;
    let origin = 'link';
    let localPath = '';
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    const tabs = [...backdrop.querySelectorAll('[data-origin]')];
    const panes = [...backdrop.querySelectorAll('[data-pane]')];
    const urlInput = backdrop.querySelector('#repo-url');
    const branchInput = backdrop.querySelector('#repo-branch');
    const pathEl = backdrop.querySelector('[data-path]');
    const chooseButton = backdrop.querySelector('[data-choose]');
    const errorEl = backdrop.querySelector('[data-error]');
    const cancelButton = backdrop.querySelector('[data-cancel]');
    const submitButtons = [...backdrop.querySelectorAll('[data-submit]')];

    const ready = () => (origin === 'link' ? urlInput.value.trim() !== '' : localPath !== '');
    const showError = (err) => {
      errorEl.textContent = String(err?.message || err);
      errorEl.hidden = false;
    };
    const sync = () => {
      submitButtons.forEach((button) => { button.disabled = busy || !ready(); });
      [chooseButton, cancelButton, urlInput, branchInput, ...tabs].forEach((el) => { el.disabled = busy; });
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        origin = tab.dataset.origin;
        tabs.forEach((candidate) => candidate.classList.toggle('active', candidate === tab));
        panes.forEach((pane) => { pane.hidden = pane.dataset.pane !== origin; });
        errorEl.hidden = true;
        sync();
        if (origin === 'link') urlInput.focus();
      });
    });
    urlInput.addEventListener('input', sync);
    urlInput.focus();

    // Same rule as the URL modal: closing mid-run would resolve null while
    // the clone or the snapshot still writes.
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && !busy) close(null);
    });
    cancelButton.addEventListener('click', () => { if (!busy) close(null); });

    chooseButton.addEventListener('click', async () => {
      errorEl.hidden = true;
      try {
        const chosen = await selectRepoDir();
        if (chosen) {
          localPath = chosen;
          pathEl.textContent = chosen;
          pathEl.title = chosen;
        }
      } catch (err) {
        showError(err);
      }
      sync();
    });

    async function snapshotFromLink(button) {
      button.textContent = 'Clonando…';
      const clonePath = await cloneRepo(urlInput.value.trim(), branchInput.value.trim());
      try {
        button.textContent = 'Lendo o repositório…';
        return await snapshotRepo(project.id, clonePath);
      } finally {
        discardClone(clonePath).catch((err) => console.error('discardClone', err));
      }
    }

    submitButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const ingest = button.dataset.submit === 'ingest';
        const label = button.textContent;
        busy = true;
        sync();
        errorEl.hidden = true;
        try {
          let result;
          if (origin === 'link') {
            result = await snapshotFromLink(button);
          } else {
            button.textContent = 'Lendo o repositório…';
            result = await snapshotRepo(project.id, localPath);
          }
          close({ names: result.sources ?? [], ingest });
        } catch (err) {
          showError(err);
          busy = false;
          button.textContent = label;
          sync();
        }
      });
    });
  });
}
