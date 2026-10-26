import { MAX_ASSET_SIZE } from './config.js';

async function readJsonBody(req, maximumBytes = 16 * 1024) {
  const mimeType = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (mimeType !== 'application/json') {
    throw Object.assign(new Error('Content-Type must be application/json.'), {
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE'
    });
  }
  const body = await readRequestBody(req, maximumBytes);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400, code: 'INVALID_JSON' });
  }
}

function readRequestBody(req, maximumBytes = MAX_ASSET_SIZE) {
  if (Buffer.isBuffer(req.decryptedApiBody)) {
    if (req.decryptedApiBody.length > maximumBytes) {
      return Promise.reject(
        Object.assign(new Error('Payload too large'), { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' })
      );
    }
    return Promise.resolve(req.decryptedApiBody);
  }
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      req.resume();
      reject(Object.assign(new Error('Payload too large'), { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' }));
      return;
    }
    const chunks = [];
    let total = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maximumBytes) {
        rejected = true;
        chunks.length = 0;
        req.resume();
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

export { readJsonBody, readRequestBody };
