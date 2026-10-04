import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const SESSION_SECONDS = 14 * 24 * 60 * 60;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const COOKIE_NAME = 'food_session';
const DUMMY_SALT = '8af49e2fa256bc6614d7856c9f39c2d0';
const HASH_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hash = value => createHash('sha256').update(value).digest('hex');
let activeDerivations = 0;
const derivationQueue = [];

export class AuthError extends Error {
 constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

// Bound process-wide memory and CPU even when many accounts are tried at once.
async function derivePassword(password, salt) {
 if (activeDerivations >= 2) {
  if (derivationQueue.length >= 8) throw new AuthError(429, '登录请求较多，请稍后重试', 30);
  await new Promise(resolve => derivationQueue.push(resolve));
 } else activeDerivations++;
 try { return await derive(password, salt, 64, HASH_OPTIONS); }
 finally {
  const next = derivationQueue.shift();
  if (next) next();
  else activeDerivations--;
 }
}

function normalizeUsername(value) {
 const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
 if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name)) throw new AuthError(400, '用户名需为 3–32 位英文字母、数字、下划线或短横线');
 return name;
}

function validatePassword(value) {
 if (typeof value !== 'string' || Array.from(value).length < 12 || Array.from(value).length > 256) throw new AuthError(400, '密码需为 12–256 个字符');
 return value;
}

function normalizeDisplayName(value, username) {
 const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : username;
 if (!name || Array.from(name).length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new AuthError(400, '昵称需为 1–40 个字符');
 return name;
}

function response(payload, status = 200, extra = {}) {
 return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie', ...extra } });
}

async function readJSON(request) {
 if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new AuthError(415, '请以 JSON 格式提交');
 if (Number(request.headers.get('Content-Length')) > 8192) throw new AuthError(413, '提交内容过长');
 const reader = request.body?.getReader();
 if (!reader) throw new AuthError(400, '提交内容为空');
 const chunks = []; let size = 0;
 try {
  while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > 8192) { await reader.cancel(); throw new AuthError(413, '提交内容过长'); }
   chunks.push(value);
  }
 } finally { reader.releaseLock(); }
 let body;
 try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AuthError(400, '提交内容格式不正确'); }
 if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError(400, '提交内容格式不正确');
 return body;
}

export function createAuth({ connection, origin, basePath = '/', publicRead = false, registrationCode = '' }) {
 const site = new URL(origin);
 if (!['http:', 'https:'].includes(site.protocol) || site.origin !== origin || site.username || site.password) throw new Error('AUTH origin must be a canonical HTTP(S) origin');
 if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('AUTH basePath must begin and end with /');
 if (typeof registrationCode !== 'string') throw new Error('AUTH registrationCode must be a string');
 const cookie = (token, maxAge) => `${COOKIE_NAME}=${token}; Path=${basePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${site.protocol === 'https:' ? '; Secure' : ''}`;
 const findAccount = connection.prepare('SELECT * FROM auth_users WHERE username = ?');
 const findSession = connection.prepare('SELECT u.id, u.display_name AS name, s.expires_at FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ?');
 const deleteSession = connection.prepare('DELETE FROM auth_sessions WHERE token_hash = ?');
 const findAttempts = connection.prepare('SELECT failed_count, window_start, blocked_until FROM auth_login_attempts WHERE account_key = ?');
 const clearAttempts = connection.prepare('DELETE FROM auth_login_attempts WHERE account_key = ?');
 const recordAttempt = connection.prepare('INSERT INTO auth_login_attempts (account_key, failed_count, window_start, blocked_until) VALUES (?, ?, ?, ?) ON CONFLICT(account_key) DO UPDATE SET failed_count = excluded.failed_count, window_start = excluded.window_start, blocked_until = excluded.blocked_until');

 function currentToken(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const part of cookieHeader.split(';')) {
   const [name, ...rest] = part.trim().split('=');
   if (name === COOKIE_NAME) { const token = rest.join('='); return /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : null; }
  }
  return null;
 }

 function getUser(request) {
  const token = currentToken(request);
  if (!token) return null;
  const tokenHash = hash(token), found = findSession.get(tokenHash);
  if (!found) return null;
  if (found.expires_at <= Date.now()) { deleteSession.run(tokenHash); return null; }
  return { id: found.id, name: found.name };
 }

 function csrf(request) {
  if (new URL(request.url).origin !== origin || request.headers.get('Origin') !== origin || request.headers.get('X-Food-Request') !== '1') throw new AuthError(403, '请从食单页面重试');
 }

 function checkLimit(accountKey) {
  const attempt = findAttempts.get(accountKey);
  if (attempt?.blocked_until > Date.now()) throw new AuthError(429, '尝试次数过多，请 15 分钟后再试', 900);
 }

 function failedAttempt(accountKey, status, message) {
  const now = Date.now(), existing = findAttempts.get(accountKey);
  const active = existing && now - existing.window_start < ATTEMPT_WINDOW;
  const count = active ? existing.failed_count + 1 : 1;
  recordAttempt.run(accountKey, count, active ? existing.window_start : now, count >= 5 ? now + ATTEMPT_WINDOW : 0);
  if (count >= 5) throw new AuthError(429, '尝试次数过多，请 15 分钟后再试', 900);
  throw new AuthError(status, message);
 }

 async function createUser({ username: input, password, displayName }) {
  const username = normalizeUsername(input);
  validatePassword(password);
  const name = normalizeDisplayName(displayName, username);
  if (findAccount.get(username)) throw new AuthError(409, '该用户名已被使用');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await derivePassword(password, salt)).toString('hex');
  const id = 'user:' + randomUUID();
  try { connection.prepare('INSERT INTO auth_users (id, username, display_name, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, username, name, salt, passwordHash, Date.now()); }
  catch (error) { if (findAccount.get(username)) throw new AuthError(409, '该用户名已被使用'); throw error; }
  return { id, name };
 }

 function startSession(user) {
  const now = Date.now(), token = randomBytes(32).toString('base64url');
  connection.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
  connection.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hash(token), user.id, now, now + SESSION_SECONDS * 1000);
  connection.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC, token_hash DESC LIMIT 20)').run(user.id, user.id);
  return response({ user }, 200, { 'Set-Cookie': cookie(token, SESSION_SECONDS) });
 }

 async function handle(request) {
  const path = new URL(request.url).pathname;
  const methods = { '/auth/login': 'POST', '/auth/register': 'POST', '/auth/logout': 'POST', '/auth/me': 'GET' };
  if (!Object.hasOwn(methods, path)) return null;
  if (request.method !== methods[path]) return response({ error: '不支持此请求方式' }, 405, { Allow: methods[path] });
  try {
   if (path === '/auth/me') return response({ user: getUser(request), registrationEnabled: Boolean(registrationCode), publicRead: Boolean(publicRead) });
   csrf(request);
   if (path === '/auth/logout') {
    const token = currentToken(request);
    if (token) deleteSession.run(hash(token));
    return response({ user: null }, 200, { 'Set-Cookie': cookie('', 0) });
   }
   const body = await readJSON(request);
   if (path === '/auth/register') {
    if (!registrationCode) throw new AuthError(403, '当前仅开放受邀账号登录');
    const invitationKey = hash('invite:global');
    checkLimit(invitationKey);
    if (typeof body.code !== 'string' || !timingSafeEqual(Buffer.from(hash(body.code)), Buffer.from(hash(registrationCode)))) failedAttempt(invitationKey, 403, '邀请口令不正确');
    const user = await createUser(body);
    clearAttempts.run(invitationKey);
    return startSession(user);
   }
   const username = normalizeUsername(body.username), accountKey = hash(username);
   checkLimit(accountKey);
   const account = findAccount.get(username);
   const supplied = typeof body.password === 'string' && Array.from(body.password).length <= 256 ? body.password : '';
   const candidate = await derivePassword(supplied, account?.password_salt || DUMMY_SALT);
   if (!account || !timingSafeEqual(candidate, Buffer.from(account.password_hash, 'hex'))) failedAttempt(accountKey, 401, '用户名或密码不正确');
   clearAttempts.run(accountKey);
   return startSession({ id: account.id, name: account.display_name });
  } catch (error) {
   if (error instanceof AuthError) return response({ error: error.message }, error.status, error.status === 429 ? { 'Retry-After': String(error.retryAfter || 900) } : {});
   throw error;
  }
 }

 return { getUser, handle, createUser };
}
