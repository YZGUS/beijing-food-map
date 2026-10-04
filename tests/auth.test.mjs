import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createAuth } from '../server/auth.js';

const origin = 'https://food.example.test';
const password = 'a-test-password-12345';
const migrationDir = new URL('../drizzle/', import.meta.url);

function fixture(options = {}) {
 const directory = mkdtempSync(join(tmpdir(), 'food-auth-'));
 const path = join(directory, 'auth.sqlite');
 let connection = new DatabaseSync(path);
 connection.exec('PRAGMA foreign_keys = ON');
 for (const file of readdirSync(migrationDir).filter(file => /^\d+.*\.sql$/.test(file)).sort()) connection.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
 let auth = createAuth({ connection, origin, basePath: '/food/', ...options });
 return {
  get auth() { return auth; }, get connection() { return connection; },
  reopen() { connection.close(); connection = new DatabaseSync(path); connection.exec('PRAGMA foreign_keys = ON'); auth = createAuth({ connection, origin, basePath: '/food/', ...options }); },
  close() { connection.close(); rmSync(directory, { recursive: true, force: true }); },
 };
}

function request(path, body, headers = {}) {
 return new Request(origin + path, body === undefined ? { headers } : { method: 'POST', headers: { Origin: origin, 'X-Food-Request': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

const cookieHeader = response => response.headers.get('set-cookie').split(';')[0];

test('login survives restart, stores only salted passwords and hashed session tokens, and does not accept platform header impersonation', async () => {
 const f = fixture();
 try {
  const user = await f.auth.createUser({ username: 'Food_User', password, displayName: '吃饭的人' });
  const stored = f.connection.prepare('SELECT * FROM auth_users').get();
  assert.equal(stored.username, 'food_user');
  assert.notEqual(stored.password_hash, password);
  assert.equal(stored.password_hash.length, 128);
  assert.equal(stored.password_salt.length, 32);
  const login = await f.auth.handle(request('/auth/login', { username: 'FOOD_USER', password }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\/food\//);
  const token = cookieHeader(login).split('=')[1];
  assert.equal(token.length, 43);
  const saved = f.connection.prepare('SELECT token_hash FROM auth_sessions').get();
  assert.equal(saved.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(saved.token_hash, token);
  f.reopen();
  assert.deepEqual(f.auth.getUser(request('/auth/me', undefined, { Cookie: cookieHeader(login) })), user);
  assert.equal(f.auth.getUser(request('/auth/me', undefined, { 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-full-name': 'Fake' })), null);
  const me = await f.auth.handle(request('/auth/me', undefined, { Cookie: cookieHeader(login) }));
  assert.deepEqual((await me.json()).user, user);
  assert.equal(me.headers.get('cache-control'), 'no-store');
 } finally { f.close(); }
});

test('duplicate user creation and duplicate registration never reset an existing password', async () => {
 const f = fixture({ registrationCode: 'invite-1234567890' });
 try {
  await f.auth.createUser({ username: 'owner', password, displayName: '原昵称' });
  const before = f.connection.prepare('SELECT password_hash, display_name FROM auth_users').get();
  await assert.rejects(f.auth.createUser({ username: 'OWNER', password: 'a-different-password-123', displayName: '新昵称' }), error => error.status === 409);
  const duplicate = await f.auth.handle(request('/auth/register', { username: 'owner', password: 'a-different-password-123', displayName: '新昵称', code: 'invite-1234567890' }));
  assert.equal(duplicate.status, 409);
  assert.deepEqual(f.connection.prepare('SELECT password_hash, display_name FROM auth_users').get(), before);
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password }))).status, 200);
 } finally { f.close(); }
});

test('mutation routes reject cross-site or headerless requests, and logout revokes the server-side session', async () => {
 const f = fixture();
 try {
  await f.auth.createUser({ username: 'owner', password });
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password }, { Origin: 'https://evil.test' }))).status, 403);
  const missingHeader = request('/auth/login', { username: 'owner', password }); missingHeader.headers.delete('X-Food-Request');
  assert.equal((await f.auth.handle(missingHeader)).status, 403);
  const direct = new Request('https://wrong-origin.test/auth/login', { method: 'POST', headers: { Origin: origin, 'X-Food-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password }) });
  assert.equal((await f.auth.handle(direct)).status, 403);
  const login = await f.auth.handle(request('/auth/login', { username: 'owner', password }));
  const cookie = cookieHeader(login);
  assert.equal((await f.auth.handle(request('/auth/logout', {}, { Cookie: cookie, Origin: 'https://evil.test' }))).status, 403);
  assert.ok(f.auth.getUser(request('/auth/me', undefined, { Cookie: cookie })));
  const logout = await f.auth.handle(request('/auth/logout', {}, { Cookie: cookie }));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(f.auth.getUser(request('/auth/me', undefined, { Cookie: cookie })), null);
 } finally { f.close(); }
});

test('failed-login throttling persists across restart without affecting a different user', async () => {
 const f = fixture();
 try {
  await f.auth.createUser({ username: 'owner', password });
  await f.auth.createUser({ username: 'friend', password });
  for (let i = 0; i < 4; i++) assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password: 'incorrect-password' }))).status, 401);
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password: 'incorrect-password' }))).status, 429);
  f.reopen();
  const blocked = await f.auth.handle(request('/auth/login', { username: 'owner', password }));
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '900');
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'friend', password }))).status, 200);
  f.connection.prepare('UPDATE auth_login_attempts SET blocked_until = ?, window_start = ?').run(Date.now() - 1000, Date.now() - 16 * 60 * 1000);
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password }))).status, 200);
  assert.equal(f.connection.prepare('SELECT COUNT(*) AS n FROM auth_login_attempts').get().n, 0);
 } finally { f.close(); }
});

test('self-registration is closed by default and requires an invitation plus valid credentials', async () => {
 const closed = fixture();
 try {
  assert.equal((await closed.auth.handle(request('/auth/register', { username: 'friend', password, displayName: '朋友', code: '' }))).status, 403);
  assert.equal((await (await closed.auth.handle(request('/auth/me'))).json()).registrationEnabled, false);
 } finally { closed.close(); }
 const f = fixture({ registrationCode: 'invite-1234567890', publicRead: true });
 try {
  const me = await (await f.auth.handle(request('/auth/me'))).json();
  assert.equal(me.registrationEnabled, true); assert.equal(me.publicRead, true);
  assert.equal((await f.auth.handle(request('/auth/register', { username: 'friend', password, displayName: '朋友', code: 'wrong' }))).status, 403);
  assert.equal((await f.auth.handle(request('/auth/register', { username: 'friend', password: 'short', displayName: '朋友', code: 'invite-1234567890' }))).status, 400);
  const registered = await f.auth.handle(request('/auth/register', { username: 'friend', password, displayName: '朋友', code: 'invite-1234567890' }));
  assert.equal(registered.status, 200);
  assert.equal(f.auth.getUser(request('/auth/me', undefined, { Cookie: cookieHeader(registered) })).name, '朋友');
 } finally { f.close(); }
});

test('expired sessions, malformed cookies, invalid bodies and route methods are handled without trusting client state', async () => {
 const f = fixture();
 try {
  await f.auth.createUser({ username: 'owner', password });
  const login = await f.auth.handle(request('/auth/login', { username: 'owner', password }));
  f.connection.prepare('UPDATE auth_sessions SET expires_at = ?').run(Date.now() - 1);
  assert.equal(f.auth.getUser(request('/auth/me', undefined, { Cookie: cookieHeader(login) })), null);
  assert.equal(f.connection.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
  assert.equal(f.auth.getUser(request('/auth/me', undefined, { Cookie: 'food_session=%bad' })), null);
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password }, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password: 'x'.repeat(9000) }))).status, 413);
  const method = await f.auth.handle(request('/auth/login'));
  assert.equal(method.status, 405); assert.equal(method.headers.get('allow'), 'POST');
  assert.equal(await f.auth.handle(request('/other')), null);
 } finally { f.close(); }
});

test('password derivation has a bounded process-wide queue and recovers after overload', async () => {
 const f = fixture();
 try {
  await f.auth.createUser({ username: 'owner', password });
  const responses = await Promise.all(Array.from({ length: 11 }, () => f.auth.handle(request('/auth/login', { username: 'owner', password }))));
  assert.equal(responses.filter(res => res.status === 200).length, 10);
  const overloaded = responses.filter(res => res.status === 429);
  assert.equal(overloaded.length, 1);
  assert.equal(overloaded[0].headers.get('retry-after'), '30');
  assert.equal(f.connection.prepare('SELECT COUNT(*) AS n FROM auth_login_attempts').get().n, 0);
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password }))).status, 200);
 } finally { f.close(); }
});

test('invitation guessing is throttled persistently even when each request changes its username', async () => {
 const f = fixture({ registrationCode: 'invite-1234567890' });
 try {
  await f.auth.createUser({ username: 'owner', password });
  for (let i = 0; i < 4; i++) assert.equal((await f.auth.handle(request('/auth/register', { username: 'guess_' + i, password, displayName: '朋友', code: 'wrong-' + i }))).status, 403);
  assert.equal((await f.auth.handle(request('/auth/register', { username: 'guess_4', password, displayName: '朋友', code: 'wrong-4' }))).status, 429);
  f.reopen();
  const blocked = await f.auth.handle(request('/auth/register', { username: 'friend', password, displayName: '朋友', code: 'invite-1234567890' }));
  assert.equal(blocked.status, 429);
  assert.equal((await f.auth.handle(request('/auth/login', { username: 'owner', password }))).status, 200);
  f.connection.prepare('UPDATE auth_login_attempts SET blocked_until = ?, window_start = ?').run(Date.now() - 1000, Date.now() - 16 * 60 * 1000);
  assert.equal((await f.auth.handle(request('/auth/register', { username: 'friend', password, displayName: '朋友', code: 'invite-1234567890' }))).status, 200);
 } finally { f.close(); }
});
