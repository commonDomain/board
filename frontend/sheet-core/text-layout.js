'use strict';

// Shared by row autofit and painting so explicit breaks, empty lines and font
// metrics have the same meaning in both places. Never compress glyphs to fit.
function cellTextLines(value, width, wrap, measure) {
  const lines = [];
  for (const paragraph of String(value ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!wrap || !paragraph) { lines.push(paragraph); continue; }
    let line = '';
    for (const character of paragraph) {
      const next = line + character;
      if (line && measure(next) > Math.max(1, width)) { lines.push(line); line = character; }
      else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function cellTextFont(style, size = style.size || 13) {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${size}px ${style.family || 'Inter, system-ui, "Microsoft YaHei", sans-serif'}`;
}

module.exports = { cellTextLines, cellTextFont };
