function appendVary(current, value) {
  const values = new Set(
    String(current || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  values.add(value);
  return Array.from(values).join(', ');
}

function weakEtagValue(etag) {
  return String(etag || '')
    .trim()
    .replace(/^W\//i, '');
}

function ifNoneMatchMatches(header, etag) {
  const value = String(header || '').trim();
  if (!value) return false;
  return value.split(',').some((candidate) => {
    const normalized = candidate.trim();
    return normalized === '*' || weakEtagValue(normalized) === weakEtagValue(etag);
  });
}

export { appendVary, ifNoneMatchMatches, weakEtagValue };
