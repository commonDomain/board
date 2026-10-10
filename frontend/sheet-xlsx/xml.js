function escapeXml(value) {
  return (
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // Control characters are not legal in XML 1.0 and would corrupt the file.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  );
}

function parseXml(text) {
  if (typeof DOMParser === 'function') return new DOMParser().parseFromString(text, 'application/xml');
  return createMiniDocument(text);
}

function createMiniDocument(source) {
  const root = { name: '#document', children: [], text: '' };
  const stack = [root];
  let index = 0;
  const text = String(source ?? '');
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open < 0) {
      stack[stack.length - 1].text += text.slice(index);
      break;
    }
    if (open > index) stack[stack.length - 1].text += text.slice(index, open);
    if (text.startsWith('<!--', open)) {
      index = text.indexOf('-->', open) + 3 || text.length;
      continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open);
      stack[stack.length - 1].text += text.slice(open + 9, end < 0 ? text.length : end);
      index = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', open) || text.startsWith('<!', open)) {
      const end = text.indexOf('>', open);
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    const close = findTagEnd(text, open);
    if (close < 0) break;
    const raw = text.slice(open + 1, close);
    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      index = close + 1;
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const spaceAt = body.search(/[\s/]/);
    const name = spaceAt < 0 ? body : body.slice(0, spaceAt);
    const node = { name, attributes: parseAttributes(spaceAt < 0 ? '' : body.slice(spaceAt)), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    index = close + 1;
  }
  return wrapDocument(root);
}

function findTagEnd(text, open) {
  let quote = null;
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

function parseAttributes(text) {
  const attributes = {};
  const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(text))) {
    attributes[match[1]] = decodeEntities(match[3] !== undefined ? match[3] : match[4]);
  }
  return attributes;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (all, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function wrapDocument(root) {
  const descendants = (node) => {
    const output = [];
    const visit = (current) => {
      for (const child of current.children) {
        output.push(child);
        visit(child);
      }
    };
    visit(node);
    return output;
  };
  const wrap = (node) => ({
    nodeName: node.name,
    textContent: collectText(node),
    getAttribute: (name) => (node.attributes[name] === undefined ? null : node.attributes[name]),
    getElementsByTagName(tag) {
      const matches = descendants(node).filter((child) => child.name === tag);
      return wrapList(matches.map(wrap));
    }
  });
  const wrapList = (items) => {
    const list = items.slice();
    for (let index = 0; index < items.length; index += 1) list[index] = items[index];
    list.item = (position) => list[position] || null;
    return list;
  };
  return {
    documentElement: wrap(root),
    getElementsByTagName: (tag) =>
      wrapList(
        descendants(root)
          .filter((child) => child.name === tag)
          .map(wrap)
      )
  };
}

function collectText(node) {
  // Entities are decoded here so the mini parser matches DOMParser, which
  // also returns decoded character data.
  let output = decodeEntities(node.text || '');
  for (const child of node.children) output += collectText(child);
  return output;
}
export {
  escapeXml,
  parseXml,
  createMiniDocument,
  findTagEnd,
  parseAttributes,
  decodeEntities,
  wrapDocument,
  collectText
};
