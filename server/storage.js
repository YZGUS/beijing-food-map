import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, readFile, readdir, lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const OBJECT_KEY = /^food\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const OBJECT_MAGIC = Buffer.from('FOODOBJ1');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = values => values.map(value => ({ ...value }));

function hasSqlContent(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*(?:\n|$)/g, '').trim() !== '';
}

function databaseAdapter(connection) {
  const ownedStatements = new WeakSet();
  const changes = connection.prepare('SELECT total_changes() AS n, last_insert_rowid() AS id');
  class Statement {
    constructor(sql, values = []) {
      if (typeof sql !== 'string' || !hasSqlContent(sql)) throw new TypeError('SQL statement required');
      this.statement = connection.prepare(sql);
      // SQLite prepares only the first statement; reject a second statement instead of silently ignoring it.
      const prepared = this.statement.sourceSQL;
      if (!sql.startsWith(prepared) || hasSqlContent(sql.slice(prepared.length))) {
        throw new TypeError('Only one SQL statement is allowed');
      }
      this.sql = sql;
      this.values = values;
      ownedStatements.add(this);
    }
    bind(...values) { return new Statement(this.sql, values); }
    async first(column) {
      const value = this.statement.get(...this.values);
      if (!value) return null;
      if (column !== undefined) {
        if (!(column in value)) throw new Error('SQL result column does not exist');
        return value[column];
      }
      return { ...value };
    }
    execute() {
      const before = changes.get().n;
      const results = rows(this.statement.all(...this.values));
      const after = changes.get();
      return { success: true, results, meta: { changes: after.n - before, last_row_id: after.id } };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
  }
  return {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      if (!Array.isArray(statements) || statements.some(statement => !ownedStatements.has(statement))) {
        throw new TypeError('Batch requires statements from this database');
      }
      connection.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute());
        connection.exec('COMMIT');
        return results;
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

async function applyMigrations(connection, migrationsDir) {
  const names = (await readdir(migrationsDir)).filter(name => /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
  const migrations = await Promise.all(names.map(async name => {
    const filename = path.join(migrationsDir, name);
    if ((await lstat(filename)).isSymbolicLink()) throw new Error('Migration files cannot be symbolic links');
    const bytes = await readFile(filename);
    return { name, hash: digest(bytes), sql: bytes.toString('utf8') };
  }));
  connection.exec('CREATE TABLE IF NOT EXISTS __food_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = connection.prepare('SELECT name, hash FROM __food_migrations ORDER BY name').all();
  for (let index = 0; index < applied.length; index++) {
    const migration = migrations[index];
    if (!migration || migration.name !== applied[index].name || migration.hash !== applied[index].hash) {
      throw new Error('An applied migration was changed, removed, or reordered: ' + applied[index].name);
    }
  }
  const find = connection.prepare('SELECT hash FROM __food_migrations WHERE name=?');
  const record = connection.prepare('INSERT INTO __food_migrations (name, hash, applied_at) VALUES (?, ?, ?)');
  for (const migration of migrations) {
    connection.exec('BEGIN IMMEDIATE');
    try {
      const previous = find.get(migration.name);
      if (previous && previous.hash !== migration.hash) throw new Error('An applied migration was changed: ' + migration.name);
      if (!previous) {
        connection.exec(migration.sql);
        record.run(migration.name, migration.hash, new Date().toISOString());
      }
      connection.exec('COMMIT');
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
}

async function checkedPath(root, segments, { allowMissing = false } = {}) {
  let target = root;
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Symbolic links are not allowed');
  for (let index = 0; index < segments.length; index++) {
    target = path.join(target, segments[index]);
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
      if (index < segments.length - 1 && !info.isDirectory()) throw new Error('Invalid directory');
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing && index === segments.length - 1) return target;
      throw error;
    }
  }
  const canonical = await realpath(target);
  if (canonical !== root && !canonical.startsWith(root + path.sep)) throw new Error('Path is outside storage');
  return target;
}

async function readWithoutLinks(filename) {
  const handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file');
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function inputBytes(value) {
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value && typeof value.arrayBuffer === 'function') return Buffer.from(await value.arrayBuffer());
  if (value instanceof ReadableStream) return Buffer.from(await new Response(value).arrayBuffer());
  throw new TypeError('Unsupported object body');
}

function objectStore(root) {
  async function filename(key, allowMissing = false) {
    const match = typeof key === 'string' && key.match(OBJECT_KEY);
    if (!match) throw new TypeError('Invalid object key');
    return checkedPath(root, ['food', match[1] + '.object'], { allowMissing });
  }
  async function getObject(key, includeBody) {
    try {
      const bytes = await readWithoutLinks(await filename(key));
      if (bytes.length < 12 || !bytes.subarray(0, 8).equals(OBJECT_MAGIC)) throw new Error('Invalid stored object');
      const length = bytes.readUInt32BE(8);
      if (length > 4096 || length + 12 > bytes.length) throw new Error('Invalid stored metadata');
      const metadata = JSON.parse(bytes.subarray(12, 12 + length).toString('utf8'));
      const body = bytes.subarray(12 + length);
      if (metadata.size !== body.length) throw new Error('Invalid stored object size');
      return { key, size: metadata.size, etag: metadata.etag, httpEtag: '"' + metadata.etag + '"',
        uploaded: new Date(metadata.uploaded), httpMetadata: metadata.httpMetadata,
        ...(includeBody ? { body } : {}),
        writeHttpMetadata(headers) { if (metadata.httpMetadata.contentType) headers.set('Content-Type', metadata.httpMetadata.contentType); },
      };
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return {
    async put(key, value, options = {}) {
      const target = await filename(key, true);
      const body = await inputBytes(value);
      const httpMetadata = {};
      if (options.httpMetadata?.contentType) {
        if (typeof options.httpMetadata.contentType !== 'string' || /[\r\n]/.test(options.httpMetadata.contentType)) throw new TypeError('Invalid content type');
        httpMetadata.contentType = options.httpMetadata.contentType.slice(0, 200);
      }
      const metadata = { size: body.length, etag: digest(body), uploaded: new Date().toISOString(), httpMetadata };
      const encoded = Buffer.from(JSON.stringify(metadata));
      const prefix = Buffer.alloc(12); OBJECT_MAGIC.copy(prefix); prefix.writeUInt32BE(encoded.length, 8);
      const temporary = path.join(path.dirname(target), '.' + randomUUID() + '.tmp');
      let handle;
      try {
        handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
        await handle.writeFile(Buffer.concat([prefix, encoded, body]));
        await handle.sync(); await handle.close(); handle = null;
        // Recheck after writing before replacing an existing object.
        await filename(key, true);
        await rename(temporary, target);
        const directory = await open(path.dirname(target), fsConstants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
      } finally {
        if (handle) await handle.close();
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      return { key, size: metadata.size, etag: metadata.etag, httpMetadata };
    },
    get(key) { return getObject(key, true); },
    head(key) { return getObject(key, false); },
    async delete(key) {
      try { await unlink(await filename(key)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
  };
}

function staticAssets(root) {
  return { async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    try {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      if (/[\\\0]/.test(pathname)) throw new Error('Invalid path');
      const segments = pathname.split('/').filter(Boolean);
      if (segments.some(segment => segment.startsWith('.'))) throw new Error('Invalid path');
      if (!segments.length || pathname.endsWith('/')) segments.push('index.html');
      const filename = await checkedPath(root, segments);
      const bytes = await readWithoutLinks(filename);
      const etag = '"' + digest(bytes) + '"';
      const headers = { 'Content-Type': MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': path.extname(filename) === '.html' ? 'no-cache' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff', ETag: etag };
      if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
      headers['Content-Length'] = String(bytes.length);
      return new Response(request.method === 'HEAD' ? null : bytes, { headers });
    } catch (error) {
      return new Response('Not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
    }
  } };
}

export async function createStorage({ dataDir, migrationsDir, publicDir }) {
  if (![dataDir, migrationsDir, publicDir].every(value => typeof value === 'string' && value)) throw new TypeError('Storage directories are required');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dataRoot = await realpath(dataDir);
  const objectsRoot = path.join(dataRoot, 'media');
  await mkdir(objectsRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(objectsRoot)).isSymbolicLink()) throw new Error('Media directory cannot be a symbolic link');
  await mkdir(path.join(objectsRoot, 'food'), { recursive: true, mode: 0o700 });
  await checkedPath(objectsRoot, ['food']);
  if ((await lstat(publicDir)).isSymbolicLink()) throw new Error('Public directory cannot be a symbolic link');
  const publicRoot = await realpath(publicDir);
  const databasePath = path.join(dataRoot, 'food-map.sqlite');
  try { if ((await lstat(databasePath)).isSymbolicLink()) throw new Error('Database cannot be a symbolic link'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const connection = new DatabaseSync(databasePath);
  try {
    connection.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    await applyMigrations(connection, migrationsDir);
    let closed = false;
    return { DB: databaseAdapter(connection), BUCKET: objectStore(objectsRoot), ASSETS: staticAssets(publicRoot), connection,
      close() { if (!closed) { connection.close(); closed = true; } },
    };
  } catch (error) { connection.close(); throw error; }
}
