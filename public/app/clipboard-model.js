function buildTableClipboardHtml(rows, header = false) {
  const table = document.createElement('table');
  table.style.borderCollapse = 'collapse';
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    row.forEach((value) => {
      const cell = document.createElement(header && rowIndex === 0 ? 'th' : 'td');
      cell.textContent = value;
      cell.style.border = '1px solid #d8dce5';
      cell.style.padding = '6px 8px';
      tr.appendChild(cell);
    });
    table.appendChild(tr);
  });
  return table.outerHTML;
}

function buildTableClipboardText(rows) {
  return rows.map((row) => row.map((cell) => String(cell || '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

function extractRowsFromHtmlTable(table) {
  return Array.from(table.rows)
    .map((row) => Array.from(row.cells).map((cell) => normalizeCellText(cell.textContent)))
    .filter((row) => row.length);
}

function normalizeCellText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTable(text) {
  const rows = String(text || '')
    .replace(/\r?\n$/, '')
    .split(/\r?\n/);
  return rows.length >= 1 && rows.some((row) => row.includes('\t'));
}

function parseDelimitedTable(text) {
  return String(text || '')
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .map((row) => row.split('\t').map((cell) => cell.trim()));
}

function hasHeaderLikeFirstRow(rows) {
  if (rows.length < 2) {
    return false;
  }
  const firstRow = rows[0].join('');
  const secondRow = rows[1].join('');
  return /\D/.test(firstRow) && firstRow !== secondRow;
}

function looksLikeIndentedTree(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return false;
  }
  return lines.some((line) => /^(\t| {2,})/.test(line));
}

function treeFromIndentedText(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const root = { text: cleanMindText(lines[0]), children: [] };
  const stack = [{ depth: 0, node: root }];

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const depth = getIndentDepth(line);
    const node = { text: cleanMindText(line), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }
  return root;
}

function treeFromList(list) {
  const firstLi = Array.from(list.children).find((child) => child.matches('li'));
  if (!firstLi) {
    return null;
  }
  if (Array.from(list.children).filter((child) => child.matches('li')).length === 1) {
    return treeFromLi(firstLi);
  }
  return {
    text: '脑图',
    children: Array.from(list.children)
      .filter((child) => child.matches('li'))
      .map(treeFromLi)
  };
}

function treeFromLi(li) {
  const clone = li.cloneNode(true);
  clone.querySelectorAll('ul, ol').forEach((childList) => childList.remove());
  const text = cleanMindText(clone.textContent) || '主题';
  const children = Array.from(li.children)
    .filter((child) => child.matches('ul, ol'))
    .flatMap((childList) =>
      Array.from(childList.children)
        .filter((child) => child.matches('li'))
        .map(treeFromLi)
    );
  return { text, children };
}

function cleanMindText(value) {
  return String(value || '')
    .replace(/^[\s\t*-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function getIndentDepth(line) {
  const match = line.match(/^(\t+| +)/);
  if (!match) {
    return 1;
  }
  const indent = match[0];
  return indent.includes('\t') ? indent.replace(/ /g, '').length + 1 : Math.floor(indent.length / 2) + 1;
}
export {
  buildTableClipboardHtml,
  buildTableClipboardText,
  normalizeCellText,
  looksLikeTable,
  parseDelimitedTable,
  hasHeaderLikeFirstRow,
  looksLikeIndentedTree,
  cleanMindText,
  getIndentDepth,
  extractRowsFromHtmlTable,
  treeFromIndentedText,
  treeFromLi,
  treeFromList
};
