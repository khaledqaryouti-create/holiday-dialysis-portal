// API client for the mobile app. Holds the session token in the device's secure storage and sends it as a Bearer header.
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

const TOKEN_KEY = 'hdp.session.token';
let token = null;

export async function loadToken() { token = await SecureStore.getItemAsync(TOKEN_KEY); return token; }
export async function setToken(t) { token = t || null; if (t) await SecureStore.setItemAsync(TOKEN_KEY, t); else await SecureStore.deleteItemAsync(TOKEN_KEY); }
export const getToken = () => token;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || body?.message || `Request failed (${status})`);
    this.status = status; this.code = body?.error?.code; this.fields = body?.error?.fields || body?.fields || null;
  }
}

async function request(path, { method = 'GET', body, form, headers = {} } = {}) {
  const h = { 'X-Requested-With': 'hdp', 'X-Client': 'mobile', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) { payload = form; /* multipart: let fetch set the boundary */ }
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(`${API_URL}${path}`, { method, headers: h, body: payload }); }
  catch (e) { throw new ApiError(0, { message: `Can't reach the server. Check your connection and the address in Settings.\n(${e.message})` }); }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (res.status === 401) { await setToken(null); throw new ApiError(401, json || { message: 'Your session ended. Please sign in again.' }); }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p, body) => request(p, { method: 'DELETE', body }),
  upload: (p, form) => request(p, { method: 'POST', form }),
};
