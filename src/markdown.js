// src/markdown.js - tiny, safe markdown renderer (no dependencies).
// Escapes all HTML first, then applies limited formatting. No raw HTML passes through.

export function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text) {
  let out = escapeHtml(text);
  // Inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic (single asterisks not already part of bold)
  out = out.replace(/(?<!\*)\*(?!\s)([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  // Links (http/https only)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return out;
}

export function renderMarkdown(raw) {
  const parts = raw.split(/```/); // alternating: text / code / text / ...
  let html = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // Code block (first line may be a language tag)
      const lines = parts[i].split("\n");
      const code = lines.slice(lines[0].trim() ? 1 : 0).join("\n");
      html += `<pre><code>${escapeHtml(code)}</code></pre>`;
    } else {
      // Paragraphs separated by blank lines
      const blocks = parts[i].split(/\n{2,}/);
      for (const block of blocks) {
        if (!block.trim()) continue;
        html += "<p>" + block
          .split("\n")
          .map(renderInline)
          .join("<br>") + "</p>";
      }
    }
  }
  return html;
}
