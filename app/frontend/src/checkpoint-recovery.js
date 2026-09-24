const RECOVERY_TERMINAL_STATES = new Set(['completed', 'failed', 'canceled', 'paused']);

// Builds a fresh-run approval from the paused checkpoint's public vars. The
// current Discovery/Delivery definition recognizes approval_data in Dispatch
// and jumps directly to its deterministic Commit step, so this never calls an
// LLM or regenerates what the reviewer already accepted.
export function approvalRecoveryArgs({ workflow, projectId, projectType, row, status }) {
  const vars = status?.vars || {};
  if (vars.pending_data == null) {
    throw new Error('O checkpoint antigo não contém o documento pendente necessário para concluir a aprovação.');
  }

  const artifact = workflow === 'Discovery' && row.featureId ? 'historias' : row.key;
  const args = {
    project_id: projectId,
    artifact,
    buddy: false,
    approved: true,
    approval_data: vars.pending_data,
    approval_tokens_in: Number(vars.tokens_in || 0),
    approval_tokens_out: Number(vars.tokens_out || 0),
  };

  if (workflow === 'Discovery') {
    if (row.featureId) args.feature_id = row.featureId;
  } else {
    args.mode = projectType;
  }
  return args;
}

// startAndWatch deliberately returns after arming the Go-side watcher, not
// after the run finishes. Approval recovery is different from an ordinary
// fire-and-forget generation: it must know whether the replacement Commit
// actually completed before retiring the incompatible checkpoint. Poll the
// durable status to that terminal decision instead of treating the initial
// `working` snapshot as a failed recovery.
export async function waitForRecoveryTerminal({
  runId,
  initialStatus,
  getStatus,
  onUpdate = () => {},
  pollIntervalMs = 150,
  timeoutMs = 15000,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let status = initialStatus;
  const deadline = Date.now() + timeoutMs;

  while (!status || !RECOVERY_TERMINAL_STATES.has(status.state)) {
    if (Date.now() >= deadline) {
      throw new Error('A persistência do documento pendente não terminou dentro do tempo esperado.');
    }
    await delay(pollIntervalMs);
    status = await getStatus(runId);
    onUpdate(status);
  }
  return status;
}
