function extractHttpUrl(value) {
  const text = String(value || '');
  const match = text.match(/https?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9\-._~%!$&'()*+,;=:@/?#]*)?/i);
  return match?.[0]?.replace(/[),.;!?]+$/g, '') || null;
}

function normalizeKdocsUrl(value) {
  const candidate = extractHttpUrl(value);
  if (!candidate || candidate.length > 2048) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'www.kdocs.cn' ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
export { extractHttpUrl, normalizeKdocsUrl };
