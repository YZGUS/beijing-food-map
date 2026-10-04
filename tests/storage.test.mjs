import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../server/storage.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'food-storage-'));
  const config = { dataDir: path.join(root, 'data'), migrationsDir: path.join(root, 'drizzle'), publicDir: path.join(root, 'public') };
  await mkdir(config.migrationsDir); await mkdir(config.publicDir);
  await writeFile(path.join(config.migrationsDir, '0000_initial.sql'), 'CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);\n--> statement-breakpoint\nCREATE TABLE related (id INTEGER PRIMARY KEY, thing_id INTEGER NOT NULL REFERENCES things(id));');
  await writeFile(path.join(config.publicDir, 'index.html'), '<!doctype html><title>Food</title>');
  await writeFile(path.join(config.publicDir, 'app.js'), 'console.log("Food");');
  const stores = [];
  t.after(async () => { stores.forEach(store => store.close()); await rm(root, { recursive: true, force: true }); });
  return { root, config, async open() { const store = await createStorage(config); stores.push(store); return store; } };
}

test('SQLite persists records and images after restart, with foreign keys and WAL enabled', async t => {
  const f = await fixture(t); let storage = await f.open();
  assert.equal(storage.connection.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(storage.connection.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal((await storage.DB.prepare('INSERT INTO things(name) VALUES (?)').bind('Noodles').run()).meta.changes, 1);
  assert.deepEqual(await storage.DB.prepare('SELECT * FROM things WHERE name=?').bind('Noodles').first(), { id: 1, name: 'Noodles' });
  assert.equal(await storage.DB.prepare('SELECT name FROM things WHERE id=?').bind(1).first('name'), 'Noodles');
  assert.equal(await storage.DB.prepare('SELECT * FROM things WHERE id=?').bind(9).first(), null);
  await assert.rejects(storage.DB.prepare('INSERT INTO related(thing_id) VALUES (?)').bind(900).run(), /FOREIGN KEY/);
  const key = 'food/41bcd110-852a-4fa1-80d7-7625c7b03c64';
  const body = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  await storage.BUCKET.put(key, body, { httpMetadata: { contentType: 'image/png' } });
  storage.close(); storage = await f.open();
  assert.equal((await storage.DB.prepare('SELECT count(*) AS n FROM things').first()).n, 1);
  const object = await storage.BUCKET.get(key);
  assert.equal(object.httpMetadata.contentType, 'image/png');
  assert.deepEqual(Buffer.from(await new Response(object.body).arrayBuffer()), body);
  const head = await storage.BUCKET.head(key);
  assert.equal(head.size, body.length); assert.equal(head.body, undefined); assert.equal(head.etag, object.etag);
  assert.equal(storage.connection.prepare('SELECT count(*) AS n FROM __food_migrations').get().n, 1);
  await storage.BUCKET.delete(key); assert.equal(await storage.BUCKET.get(key), null);
  await storage.BUCKET.delete(key);
});

test('a failed D1 batch rolls back earlier writes and successful queries return D1 results', async t => {
  const f = await fixture(t); const storage = await f.open(); const db = storage.DB;
  await assert.rejects(db.batch([
    db.prepare('INSERT INTO things(name) VALUES (?)').bind('Repeated'),
    db.prepare('INSERT INTO things(name) VALUES (?)').bind('Repeated'),
  ]), /UNIQUE/);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM things').first()).n, 0);
  const results = await db.batch([
    db.prepare('INSERT INTO things(name) VALUES (?)').bind('Dumplings'),
    db.prepare('SELECT id, name FROM things'),
  ]);
  assert.equal(results[0].meta.changes, 1);
  assert.deepEqual(results[1].results, [{ id: 1, name: 'Dumplings' }]);
  assert.deepEqual((await db.prepare('SELECT * FROM things').all()).results, [{ id: 1, name: 'Dumplings' }]);
  assert.deepEqual(await db.prepare('DELETE FROM things WHERE id=? RETURNING name').bind(1).first(), { name: 'Dumplings' });
  assert.throws(() => db.prepare('SELECT 1; DROP TABLE things;'), /one SQL statement/);
  assert.equal((await db.prepare('SELECT 1 AS n; -- trailing comment\n').first()).n, 1);
  await assert.rejects(db.batch([{}]), /from this database/);
});

test('applied migration tampering is refused and each new migration is atomic', async t => {
  const f = await fixture(t); let storage = await f.open(); storage.close();
  const original = await readFile(path.join(f.config.migrationsDir, '0000_initial.sql'), 'utf8');
  await writeFile(path.join(f.config.migrationsDir, '0000_initial.sql'), original + '\n-- altered');
  await assert.rejects(f.open(), /applied migration was changed/);
  await writeFile(path.join(f.config.migrationsDir, '0000_initial.sql'), original);
  await writeFile(path.join(f.config.migrationsDir, '0001_broken.sql'), 'CREATE TABLE transient (id INTEGER); INSERT INTO nonexistent VALUES (1);');
  await assert.rejects(f.open(), /no such table/);
  await rm(path.join(f.config.migrationsDir, '0001_broken.sql'));
  storage = await f.open();
  assert.equal(storage.connection.prepare("SELECT name FROM sqlite_master WHERE name='transient'").get(), undefined);
  assert.equal(storage.connection.prepare('SELECT count(*) AS n FROM __food_migrations').get().n, 1);
  storage.close();
  await writeFile(path.join(f.config.migrationsDir, '0001_ready.sql'), 'ALTER TABLE things ADD COLUMN description TEXT;');
  storage = await f.open();
  await storage.DB.prepare('INSERT INTO things(name,description) VALUES (?,?)').bind('Rice', 'Warm').run();
  assert.equal((await storage.DB.prepare('SELECT description FROM things').first()).description, 'Warm');
  storage.close();
  await rm(path.join(f.config.migrationsDir, '0000_initial.sql'));
  await assert.rejects(f.open(), /changed, removed, or reordered/);
});

test('object store rejects arbitrary paths and symbolic links and uses complete atomic replacements', async t => {
  const f = await fixture(t); const storage = await f.open(); const bucket = storage.BUCKET;
  const key = 'food/4b2a0d6d-b0dc-4a46-b7ae-bfe3c6fb42a2';
  for (const bad of ['../secret', 'food/../secret', '/food/4b2a0d6d-b0dc-4a46-b7ae-bfe3c6fb42a2', key + '/extra', key + '\\extra', 'food/not-a-uuid']) {
    await assert.rejects(bucket.put(bad, 'test'), /Invalid object key/);
    await assert.rejects(bucket.get(bad), /Invalid object key/);
    await assert.rejects(bucket.head(bad), /Invalid object key/);
    await assert.rejects(bucket.delete(bad), /Invalid object key/);
  }
  await bucket.put(key, 'first'); await bucket.put(key, new Uint8Array([0, 1, 2]));
  assert.deepEqual((await bucket.get(key)).body, Buffer.from([0, 1, 2]));
  assert.equal((await readdir(path.join(f.config.dataDir, 'media', 'food'))).some(name => name.endsWith('.tmp')), false);
  const external = path.join(f.root, 'secret'); await writeFile(external, 'secret');
  const objectPath = path.join(f.config.dataDir, 'media', 'food', key.slice(5) + '.object');
  await rm(objectPath); await symlink(external, objectPath);
  await assert.rejects(bucket.get(key), /Symbolic links/);
  await assert.rejects(bucket.put(key, 'overwrite'), /Symbolic links/);
  await assert.rejects(bucket.delete(key), /Symbolic links/);
  assert.equal(await readFile(external, 'utf8'), 'secret');
  await rm(objectPath);
  const foodDir = path.join(f.config.dataDir, 'media', 'food');
  await rename(foodDir, foodDir + '-old'); await symlink(f.root, foodDir);
  await assert.rejects(bucket.put(key, 'escape'), /Symbolic links/);
});

test('static assets serve MIME and HEAD while refusing traversal, directory links and hidden files', async t => {
  const f = await fixture(t); const storage = await f.open();
  const fetch = (url, options) => storage.ASSETS.fetch(new Request('http://localhost' + url, options));
  const index = await fetch('/'); assert.equal(index.status, 200); assert.match(index.headers.get('Content-Type'), /text\/html/);
  assert.match(await index.text(), /Food/);
  const script = await fetch('/app.js'); assert.match(script.headers.get('Content-Type'), /javascript/);
  assert.equal((await fetch('/app.js', { method: 'HEAD' })).headers.get('Content-Length'), String(Buffer.byteLength('console.log("Food");')));
  assert.equal(await (await fetch('/app.js', { method: 'HEAD' })).text(), '');
  assert.equal((await fetch('/app.js', { headers: { 'If-None-Match': script.headers.get('ETag') } })).status, 304);
  assert.equal((await fetch('/app.js', { method: 'POST' })).status, 405);
  assert.equal((await fetch('/%2e%2e%2fsecret')).status, 404);
  assert.equal((await fetch('/%5csecret')).status, 404);
  assert.equal((await fetch('/%00')).status, 404);
  assert.equal((await fetch('/missing')).status, 404);
  await writeFile(path.join(f.config.publicDir, '.env'), 'SECRET=private');
  assert.equal((await fetch('/.env')).status, 404);
  const outside = path.join(f.root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'secret.txt'), 'private');
  await symlink(outside, path.join(f.config.publicDir, 'linked'));
  await symlink(path.join(outside, 'secret.txt'), path.join(f.config.publicDir, 'secret.txt'));
  assert.equal((await fetch('/linked/secret.txt')).status, 404);
  assert.equal((await fetch('/secret.txt')).status, 404);
});
