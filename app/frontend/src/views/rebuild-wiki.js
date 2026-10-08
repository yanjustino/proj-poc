import { openConfirmModal } from './confirm-modal.js';
import { rebuildWiki } from '../ingest-queue.js';

// confirmRebuildWiki: the one confirmation before rebuilding a work-item's
// wiki (ingest-queue.js's rebuildWiki), shared by the Fontes and Wiki tabs.
// Resolves true once the rebuild started.
export async function confirmRebuildWiki(projectId) {
  const ok = await openConfirmModal({
    title: 'Reprocessar wiki',
    body: `
      <p>A wiki será apagada e as fontes ingeridas serão processadas de novo, na ordem original. No fim, a wiki é verificada.</p>
      <p>Isso chama a LLM uma vez por fonte e leva alguns minutos. As respostas arquivadas ficam, com um aviso de que citam a wiki anterior; artefatos já gerados podem citar páginas que deixarem de existir.</p>
    `,
    confirmLabel: 'Reprocessar',
  });
  if (!ok) return false;
  try {
    await rebuildWiki(projectId);
    return true;
  } catch (err) {
    window.alert('Erro ao reprocessar a wiki: ' + (err.message || err));
    return false;
  }
}
