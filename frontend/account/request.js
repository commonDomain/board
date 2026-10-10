import { expireSession } from './session.js';
import { ACCOUNT_REQUEST_TIMEOUT_MS, global, nativeFetch, state } from './state.js';

function apiError(body, fallback) {
  const error = new Error(body?.error || fallback);
  error.code = body?.code;
  error.status = body?.status;
  return error;
}

function isNetworkFailure(error) {
  return error?.code === 'NETWORK_UNAVAILABLE' || error?.code === 'REQUEST_TIMEOUT';
}

function networkError(error, timedOut) {
  const offline = global.navigator.onLine === false;
  const result = new Error(
    timedOut
      ? '请求超时，网络恢复后请重试。'
      : offline
        ? '当前网络已断开，恢复连接后会自动重试。'
        : '网络连接不稳定，请稍后重试。'
  );
  result.code = timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE';
  result.cause = error;
  return result;
}

function accountGenerationGuard() {
  const generation = global.WhiteboardStorage?.getGeneration?.();
  return () => {
    if (generation !== global.WhiteboardStorage?.getGeneration?.()) {
      throw Object.assign(new Error('账号已切换，请在当前账号下重试。'), { code: 'STALE_ACCOUNT' });
    }
  };
}

async function request(url, options = {}) {
  const requireCurrentAccount = accountGenerationGuard();
  const method = String(options.method || 'GET').toUpperCase();
  const safeToRetry = method === 'GET' || method === 'HEAD';
  const maximumAttempts = 1 + Math.max(0, Number(options.retries ?? (safeToRetry ? 2 : 0)) || 0);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || ACCOUNT_REQUEST_TIMEOUT_MS);
  const { retries: _retries, timeoutMs: _timeoutMs, ...fetchOptions } = options;
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (state.session?.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method))
    headers['x-csrf-token'] = state.session.csrfToken;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    requireCurrentAccount();
    const controller = new AbortController();
    let timedOut = false;
    const externalSignal = fetchOptions.signal;
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await nativeFetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...fetchOptions,
        headers,
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      requireCurrentAccount();
      if (response.status === 401 && body.code === 'AUTH_EXPIRED') expireSession();
      if (!response.ok) {
        if (safeToRetry && attempt + 1 < maximumAttempts && [502, 503, 504].includes(response.status)) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        const error = apiError(body, `请求失败 (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      if (error?.code || (error instanceof Error && !['AbortError', 'TypeError'].includes(error.name))) throw error;
      const failure = networkError(error, timedOut);
      if (!safeToRetry || attempt + 1 >= maximumAttempts) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.('abort', forwardAbort);
    }
  }
  throw networkError(null, false);
}

function isSameOrigin(input) {
  try {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    return url.origin === location.origin;
  } catch {
    return false;
  }
}

global.fetch = async function accountAwareFetch(input, init = {}) {
  const requireCurrentAccount = accountGenerationGuard();
  const method = String(init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
  const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
  const sameOrigin = isSameOrigin(input);
  if (state.session?.csrfToken && sameOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('x-csrf-token', state.session.csrfToken);
  }
  const safeToRetry = sameOrigin && ['GET', 'HEAD'].includes(method);
  const maximumAttempts = safeToRetry ? 3 : 1;
  const externalSignal = init.signal || (typeof input !== 'string' ? input.signal : null);
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    if (sameOrigin) requireCurrentAccount();
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ACCOUNT_REQUEST_TIMEOUT_MS);
    try {
      const response = await nativeFetch(input, {
        ...init,
        headers,
        credentials: init.credentials || 'same-origin',
        signal: controller.signal
      });
      if (sameOrigin) requireCurrentAccount();
      if (safeToRetry && attempt + 1 < maximumAttempts && [502, 503, 504].includes(response.status)) {
        await response.body?.cancel?.().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      if (response.status === 401 && sameOrigin) {
        const body = await response
          .clone()
          .json()
          .catch(() => ({}));
        requireCurrentAccount();
        if (body.code === 'AUTH_EXPIRED') expireSession();
      }
      return response;
    } catch (error) {
      if (!['AbortError', 'TypeError'].includes(error?.name)) throw error;
      if (externalSignal?.aborted) throw error;
      if (safeToRetry && attempt + 1 < maximumAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      throw networkError(error, timedOut);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.('abort', forwardAbort);
    }
  }
  throw networkError(null, false);
};

export { accountGenerationGuard, apiError, isNetworkFailure, isSameOrigin, networkError, request };
