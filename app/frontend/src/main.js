import './style.css';
import { LogFrontendError } from '../wailsjs/go/main/App';
import { mountShell } from './views/shell.js';

// Apply the saved preference before the shell is mounted, avoiding a flash
// of the dark theme when a user has chosen the light one.
try {
  document.documentElement.dataset.theme = localStorage.getItem('senpai-theme') === 'light' ? 'light' : 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}

// Forward every uncaught error/rejection into the Go process's own log
// (App.LogFrontendError) — a packaged production build has no reachable
// devtools console by default, so this is the only way a bug like "the
// work-item list silently stays empty" leaves any trace to debug from.
function reportError(label, err) {
  const detail = err && err.stack ? err.stack : String(err);
  console.error(label, err);
  LogFrontendError(`${label}: ${detail}`).catch(() => {});
}

window.addEventListener('error', (event) => {
  reportError('uncaught error', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  reportError('unhandled rejection', event.reason);
});

mountShell(document.getElementById('app')).catch((err) => {
  reportError('mountShell failed', err);
  document.getElementById('app').innerHTML =
    `<div style="padding:40px;font-family:sans-serif;color:#a23b2e;background:#faf9f6;min-height:100vh">Falha ao iniciar a interface: ${String(err)}</div>`;
});
