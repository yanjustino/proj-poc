// htmlToMarkdown converts a generated artifact's HTML into Markdown for the
// reading pane's "ver markdown" toggle — artifacts are rendered from JSON,
// so there's no .md on disk to show like the wiki has. Display only: the
// result is never written back anywhere.
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

let service = null;

function getService() {
  if (service) return service;
  service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  service.use(gfm);
  service.remove(['style', 'script', 'noscript', 'template']);
  // <pre class="mermaid"> holds the diagram source (page_shell) — keep it as
  // a ```mermaid fence instead of a plain code block.
  service.addRule('mermaid', {
    filter: (node) => node.nodeName === 'PRE' && node.classList.contains('mermaid'),
    replacement: (_content, node) => `\n\n\`\`\`mermaid\n${node.textContent.trim()}\n\`\`\`\n\n`,
  });
  return service;
}

export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return getService().turndown(doc.body).trim() + '\n';
}
