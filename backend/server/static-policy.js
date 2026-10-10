const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const PRIVATE_IMMUTABLE_CACHE_CONTROL = 'private, no-cache, no-transform';

const STATIC_BUILD_ID_LENGTH = 24;
export {
  COMPRESSIBLE_EXT,
  MIME_TYPES,
  IMMUTABLE_CACHE_CONTROL,
  PRIVATE_IMMUTABLE_CACHE_CONTROL,
  STATIC_BUILD_ID_LENGTH
};
