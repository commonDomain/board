function columnName(index) {
  let remaining = Math.max(0, Math.floor(index));
  let name = '';
  while (remaining >= 0) {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return name;
}

function columnIndex(name) {
  let index = 0;
  const text = String(name || '').toUpperCase();
  for (let i = 0; i < text.length; i += 1) index = index * 26 + (text.charCodeAt(i) - 64);
  return index - 1;
}

function cellReference(row, column) {
  return `${columnName(column)}${row + 1}`;
}
export { columnName, columnIndex, cellReference };
