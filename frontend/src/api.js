// Thin fetch wrapper for the Express API. Cookies carry the session; X-Requested-With is required on writes (CSRF guard).

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status}).`);
    this.status = status;
    this.code = body?.error?.code;
    this.fields = body?.error?.fields || {};
    this.step = body?.error?.step;
  }
}

async function request(method, path, body, { form } = {}) {
  const headers = { 'X-Requested-With': 'hdp' };
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, headers, credentials: 'same-origin',
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' } });
  }
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('hdp:unauthorized'));
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, form) => request('POST', p, undefined, { form }),
};

/** Build a query string, dropping empty values and joining arrays with commas. */
export function qs(obj) {
  const entries = Object.entries(obj)
    .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]);
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
}
