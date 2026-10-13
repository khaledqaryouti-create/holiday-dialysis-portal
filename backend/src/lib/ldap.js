// Directory (LDAP / Active Directory) access with ldapts.
// Flow: connect → (StartTLS) → bind as service account (or anonymous) → search the user with an escaped filter
//       → bind as the user's DN with the typed password → read e-mail, name and groups.
import { Client } from 'ldapts';
import { buildLdapUserFilter } from '../domain/auth.js';

export function ldapUrl(s) {
  const scheme = s.security === 'ldaps' ? 'ldaps' : 'ldap';
  return `${scheme}://${s.host}:${s.port}`;
}

function tlsOptions(s) {
  return { rejectUnauthorized: !s.allowSelfSigned, minVersion: 'TLSv1.2', servername: /^[\d.]+$/.test(s.host) ? undefined : s.host };
}

async function connect(s) {
  const ms = (Number(s.timeoutSeconds) || 10) * 1000;
  const client = new Client({ url: ldapUrl(s), timeout: ms, connectTimeout: ms, tlsOptions: s.security === 'ldaps' ? tlsOptions(s) : undefined, strictDN: false });
  if (s.security === 'starttls') await client.startTLS(tlsOptions(s));
  return client;
}

async function serviceBind(client, s) {
  if (s.bindDn) await client.bind(s.bindDn, s.bindPassword || '');
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const list = (v) => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

function readUser(entry, s) {
  return {
    dn: entry.dn,
    email: first(entry[s.emailAttr]) ? String(first(entry[s.emailAttr])).toLowerCase() : (first(entry.userPrincipalName) ? String(first(entry.userPrincipalName)).toLowerCase() : null),
    name: first(entry[s.nameAttr]) ? String(first(entry[s.nameAttr])) : (first(entry.cn) ? String(first(entry.cn)) : null),
    groups: list(entry[s.groupAttr]),
  };
}

async function findUser(client, s, username) {
  const { searchEntries } = await client.search(s.baseDn, {
    scope: 'sub',
    filter: buildLdapUserFilter(s.userFilter, username),
    attributes: [s.emailAttr, s.nameAttr, s.groupAttr, 'userPrincipalName', 'cn'],
    sizeLimit: 2,
  });
  if (searchEntries.length !== 1) return null; // 0 = unknown; 2 = ambiguous — never guess
  return readUser(searchEntries[0], s);
}

/** Check the service account can connect, bind and search. Returns a short description. */
export async function testDirectory(s) {
  const client = await connect(s);
  try {
    await serviceBind(client, s);
    const { searchEntries } = await client.search(s.baseDn, { scope: 'base', filter: '(objectClass=*)', attributes: ['dn'] });
    return { baseFound: searchEntries.length === 1 };
  } finally { await client.unbind().catch(() => {}); }
}

/** Verify a user name + password against the directory. Returns the user's details, or null if the credentials are wrong. */
export async function authenticateDirectoryUser(s, username, password) {
  if (!String(username).trim() || !password) return null; // an empty password would be an anonymous bind — never allow
  const client = await connect(s);
  let user;
  try {
    await serviceBind(client, s);
    user = await findUser(client, s, username);
  } finally { await client.unbind().catch(() => {}); }
  if (!user) return null;
  const userClient = await connect(s);
  try {
    await userClient.bind(user.dn, password);
    return user;
  } catch (err) {
    if (isInvalidCredentials(err)) return null;
    throw err;
  } finally { await userClient.unbind().catch(() => {}); }
}

export function isInvalidCredentials(err) {
  return err?.code === 49 || /InvalidCredentials|invalid credentials|data 52e|data 775|data 532|data 533|data 701/i.test(String(err?.name) + String(err?.message));
}

/** Plain-language explanation for connection problems (never includes passwords). */
export function explainLdapError(err, s = {}) {
  const msg = String(err?.message || err || '');
  const where = s.host ? `${s.host}:${s.port}` : 'the directory server';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return `The server name "${s.host}" could not be found. Check the host name.`;
  if (/ECONNREFUSED/i.test(msg)) return `${where} refused the connection. Check the port and the firewall.`;
  if (/timeout|ETIMEDOUT/i.test(msg)) return `No answer from ${where}. Check the host, port and that the portal server can reach the domain controller.`;
  if (/self[- ]signed|unable to verify|certificate|CERT_/i.test(msg)) return 'The server’s certificate could not be verified. Use the server’s full DNS name, install your company CA on the portal server, or (internal servers only) allow self-signed certificates.';
  if (/wrong version number|EPROTO|ECONNRESET/i.test(msg)) return s.security === 'ldaps' ? 'The server is not speaking LDAPS on this port. Try port 636, or choose StartTLS on 389.' : 'The connection was reset. Check the security setting and port.';
  if (isInvalidCredentials(err)) return 'The service account user name or password is wrong (or the account is locked/expired).';
  if (/strongAuthRequired|Confidentiality|code 8|code 13/i.test(msg)) return 'The server requires an encrypted connection. Choose LDAPS or StartTLS.';
  if (/No Such Object|code 32/i.test(msg)) return 'The base DN was not found. Check the "Search base" value.';
  if (/Operations Error|000004DC|code 1\b/i.test(msg)) return 'The directory refused to search without signing in. Enter a service account (bind DN and password).';
  if (/filter/i.test(msg)) return 'The user search filter is not valid LDAP syntax.';
  return `Directory error: ${msg.replace(/\s+/g, ' ').slice(0, 200)}`;
}
