// Wiki pages (index.md, entities/*.md, concepts/*.md, sources/*.md) are the
// one place left in the product that's still Markdown — every artifact
// already renders straight to HTML (§3.4 of the plan). `marked` is the only
// client-side rendering this app needs.
import { marked } from 'marked';

marked.setOptions({ breaks: true });

export function renderMarkdown(text) {
  return marked.parse(text ?? '');
}
