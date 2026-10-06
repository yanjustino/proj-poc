import { LogFrontendError } from '../wailsjs/go/main/App';

// TEMPORARIO — diagnostico de "projeto demorando para carregar". Cada fase
// do carregamento de um work-item vai para o app.log como
// "frontend error: perf <rotulo>: <ms>ms" (LogFrontendError e o unico canal
// para o log do Go). Remover junto com as chamadas quando a causa for achada.
export function perfStart() {
  return Date.now();
}

export function perfLog(label, start) {
  const ms = Math.round(Date.now() - start);
  LogFrontendError(`perf ${label}: ${ms}ms`).catch(() => {});
  return ms;
}

// perfTime: mede uma promise e devolve o resultado dela.
export async function perfTime(label, promise) {
  const start = perfStart();
  try {
    return await promise;
  } finally {
    perfLog(label, start);
  }
}
