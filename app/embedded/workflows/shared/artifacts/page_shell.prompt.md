<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
:root{--bg:#fff;--soft:#fafaf8;--ink:#1a1a1a;--muted:#6e6e6e;--line:#e3e3e3;--line-soft:#efefec;--accent:#ec7000;--accent-soft:#fff0e0;--link:#003399;--ok:#2c7a4b;--ok-bg:#eaf4ee;--bad:#b02a07;--bad-bg:#fdece6;--info:#39468a;--info-bg:#eceef7;--warn:#9a5b00;--warn-bg:#fff4dc;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;color-scheme:light}
*{box-sizing:border-box}
body{margin:0 auto;padding:36px 44px 56px;max-width:1480px;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
h1{margin:0 0 28px;padding-bottom:20px;border-bottom:1px solid var(--line);font-size:30px;line-height:1.2;letter-spacing:-.01em}
h1::before{content:'Artefato';display:block;margin-bottom:8px;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--accent)}
h2{display:flex;align-items:center;gap:10px;margin:36px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line);font-size:18px;line-height:1.3}
h2::before{content:'';flex:none;width:4px;height:18px;border-radius:2px;background:var(--accent)}
h3{margin:18px 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
p{margin:0 0 12px}
ul,ol{margin:0 0 14px;padding-left:22px}
li{margin-bottom:6px}
li::marker{color:var(--accent)}
code{font-family:var(--mono);font-size:.88em;background:var(--soft);border:1px solid var(--line-soft);border-radius:4px;padding:1px 5px}
pre{margin:0 0 16px;padding:14px 16px;background:var(--soft);border:1px solid var(--line);border-radius:10px;overflow:auto;font:12.5px/1.6 var(--mono)}
pre code{background:none;border:0;padding:0;font-size:inherit}
pre.mermaid{padding:20px;background:var(--bg);text-align:center;font-family:inherit}
blockquote{margin:0 0 16px;padding:12px 16px;background:var(--soft);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;color:#3a3a3a}
table{width:100%;border-collapse:separate;border-spacing:0;margin:4px 0 18px;font-size:14px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:var(--soft);padding:10px 14px;border-bottom:1px solid var(--line)}
td{padding:10px 14px;border-top:1px solid var(--line-soft);vertical-align:top}
tbody tr:first-child td{border-top:none}
tbody tr:hover td{background:#fcfcfb}
.meta{margin-top:44px;padding-top:14px;border-top:1px solid var(--line);font-family:var(--mono);font-size:11px;color:#9a9a9a}
.cite{display:inline-block;font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:999px;margin:3px 4px 0 0;white-space:nowrap}
.cite-fonte{background:var(--ok-bg);color:var(--ok)}
.cite-gap{background:var(--bad-bg);color:var(--bad)}
.cite-inferencia{background:var(--info-bg);color:var(--info)}
.cite-num{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--accent);margin:0 1px}
.cite-references{margin:0 0 14px;padding-left:22px;font-family:var(--mono);font-size:12px;color:var(--muted)}
.cite-references li{margin-bottom:6px}
p.fontes{margin:-4px 0 16px;line-height:2}
.item-classification{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.item-kind{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 9px;border-radius:999px;vertical-align:middle}
.item-kind-business{background:var(--ok-bg);color:var(--ok)}
.item-kind-enabler{background:var(--info-bg);color:var(--info)}
.item-kind-subtype{background:var(--line-soft);color:var(--muted)}
.c4-legend{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px 20px;font-size:13px}
.c4-legend li{display:flex;align-items:center;gap:8px;margin:0}
.c4-swatch{display:inline-block;width:14px;height:14px;border-radius:3px}
.c4-swatch-node{border:1px solid #888;background:#fff}
.c4-swatch-boundary{border:1px dashed #444}
.c4-swatch-relation{height:0;width:22px;border-top:2px dashed #707070;border-radius:0}
.c4-warnings{margin:0 0 16px;padding:12px 16px 12px 34px;background:var(--warn-bg);border:1px solid #f0cf8a;border-left:4px solid var(--warn);border-radius:10px;font-size:14px}
.c4-warnings li{margin-bottom:6px}
.radahn-badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 9px;border-radius:999px;background:#e3f0fb;color:#1c5a8f;vertical-align:middle}
.radahn-yaml{white-space:pre}
.autorrevisao{margin:0 0 16px;padding:10px 14px;background:var(--ok-bg);border-left:3px solid var(--ok);border-radius:0 8px 8px 0;font-size:13px;color:#2c5a3b}
.er-legend{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px 22px;font-size:13px}
.er-legend li{margin:0}
</style>
</head>
<body>
<h1>${title}</h1>
${body}
<div class="meta">${meta}</div>
</body>
</html>
