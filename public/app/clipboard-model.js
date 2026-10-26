import { renderRichTextRuns } from './text-rendering-model.js';

function buildTableClipboardHtml(rows, header = false, formats = {}) {
  const table = document.createElement('table');
  table.style.borderCollapse = 'collapse';
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    row.forEach((value, columnIndex) => {
      const cell = document.createElement(header && rowIndex === 0 ? 'th' : 'td');
      const key = `${rowIndex}/${columnIndex}`, style = formats.cellStyles?.[key] || {};
      const runs = formats.cellRichText?.[key];
      if (runs?.length) renderRichTextRuns(cell, runs, style);
      else cell.textContent = value;
      cell.style.whiteSpace = 'pre-wrap';
      if (style.align) cell.style.textAlign = style.align;
      if (style.color) cell.style.color = style.color;
      if (style.fontFamily) cell.style.fontFamily = style.fontFamily;
      if (style.fontSize) cell.style.fontSize = `${style.fontSize}px`;
      if (typeof style.bold === 'boolean') cell.style.fontWeight = style.bold ? '700' : '400';
      if (typeof style.italic === 'boolean') cell.style.fontStyle = style.italic ? 'italic' : 'normal';
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
    .map((row) => Array.from(row.cells).map((cell) => htmlCellRuns(cell).map(run=>run.text).join('')))
    .filter((row) => row.length);
}

function normalizeCellText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\u200b/g, '');
}

function htmlInlineStyle(element, inherited = {}) {
  const result={...inherited}, style=element.style;
  if (element.matches('b,strong,th')) result.bold=true;
  if (element.matches('i,em')) result.italic=true;
  if (element.matches('u')) result.underline=true;
  if (style.color) result.color=style.color;
  if (style.fontFamily) result.fontFamily=style.fontFamily;
  if (/^[\d.]+px$/.test(style.fontSize)) result.fontSize=Math.max(8,Math.min(256,parseFloat(style.fontSize)));
  if (style.fontWeight) result.bold=style.fontWeight==='bold'||parseInt(style.fontWeight,10)>=600;
  if (style.fontStyle) result.italic=style.fontStyle==='italic';
  if (style.textDecorationLine || style.textDecoration) result.underline=(style.textDecorationLine || style.textDecoration).includes('underline');
  if (['left','center','right'].includes(style.textAlign)) result.align=style.textAlign;
  return result;
}

function htmlCellDefaults(cell) {
  const ancestors=[];
  for(let element=cell;element;element=element.parentElement)ancestors.unshift(element);
  return ancestors.reduce((style,element)=>htmlInlineStyle(element,style),{});
}

function htmlCellRuns(cell) {
  const runs=[], append=(text,style)=>{text=normalizeCellText(text);if(text)runs.push({...style,text});};
  const visit = (node,inherited) => {
    if (node.nodeType===Node.TEXT_NODE) {append(node.data,inherited);return;}
    if (node.nodeType!==Node.ELEMENT_NODE || /^(SCRIPT|STYLE)$/.test(node.tagName)) return;
    const style=htmlInlineStyle(node,inherited);
    if(node.tagName==='BR') {
      if(node.hasAttribute('data-empty-line') || node.parentElement===cell&&cell.childNodes.length===1)return;
      if(!(node.parentElement!==cell && node.parentElement.childNodes.length===1 && /^(DIV|P|LI)$/.test(node.parentElement.tagName)))append('\n',style);
      return;
    }
    const block=/^(DIV|P|LI)$/.test(node.tagName);
    if(block&&node.previousSibling&&node.previousSibling.nodeName!=='BR')append('\n',style);
    for(const child of node.childNodes)visit(child,style);
    if(block&&node.nextSibling&&!/^(DIV|P|LI)$/.test(node.nextSibling.nodeName))append('\n',style);
  };
  const defaults=htmlCellDefaults(cell);
  for(const node of cell.childNodes)visit(node,defaults);
  return runs;
}

function extractFormatsFromHtmlTable(table) {
  const cellStyles={},cellRichText={};
  Array.from(table.rows).forEach((row,r)=>Array.from(row.cells).forEach((cell,c)=>{
    const key=`${r}/${c}`;
    cellStyles[key]=htmlCellDefaults(cell);cellRichText[key]=htmlCellRuns(cell);
  }));
  return {cellStyles,cellRichText};
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
    .map((row) => row.split('\t'));
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
  extractFormatsFromHtmlTable,
  treeFromIndentedText,
  treeFromLi,
  treeFromList
};
