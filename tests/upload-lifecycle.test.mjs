import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import jpeg from 'jpeg-js';
import {startServer} from '../server/index.js';

// Exercise the HTTP gateway and persistent adapters together without writing to production.
test('a real dish photo, free-form shop and authenticated session survive a server restart', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'food-upload-lifecycle-'));
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const basePath = '/food/';
  const options = {origin, basePath, port, host: '127.0.0.1', dataDir, publicRead: true, registrationCode: ''};
  const cookies = new Map();
  let app;
  const request = (route, {method = 'GET', user, body, csrf = true, headers: extra = {}} = {}) => {
    const headers = {...extra};
    if (user) headers.Cookie = cookies.get(user);
    if (!['GET', 'HEAD'].includes(method) && csrf) {
      headers.Origin = origin;
      headers['X-Food-Request'] = '1';
    }
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const endpoint = 'http://127.0.0.1:' + app.server.address().port + basePath;
    return fetch(endpoint + route.replace(/^\//, ''), {method, headers, body});
  };
  const pixels = new Uint8Array(8 * 6 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set([170 + ((index / 4) % 40), 95, 48, 255], index);
  }
  const image = jpeg.encode({width: 8, height: 6, data: pixels}, 85).data;
  const decoded = jpeg.decode(image, {tolerantDecoding: false});
  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 6);
  const photoForm = (bytes = image) => {
    const form = new FormData();
    form.append('photo', new File([bytes], '一人食菜品.jpg', {type: 'image/jpeg'}));
    return form;
  };
  try {
    app = await startServer(options);
    for (const user of ['owner', 'other']) {
      await app.auth.createUser({username: 'photo-test-' + user, password: 'isolated-fixture-password-2026', displayName: user});
      const login = await request('/auth/login', {
        method: 'POST', body: {username: 'photo-test-' + user, password: 'isolated-fixture-password-2026'},
      });
      assert.equal(login.status, 200);
      assert.match(login.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax/);
      cookies.set(user, login.headers.get('Set-Cookie').split(';')[0]);
    }
    const initial = await (await request('/api/catalog')).json();
    assert.equal(initial.features.length, 67);
    assert.equal((await request('/api/uploads', {method: 'POST', body: photoForm()})).status, 401);
    assert.equal((await request('/api/uploads', {method: 'POST', user: 'owner', body: photoForm(), csrf: false})).status, 403);
    assert.equal((await request('/api/uploads', {
      method: 'POST', user: 'owner', body: photoForm(), csrf: false,
      headers: {Origin: 'https://unrelated.example.test', 'X-Food-Request': '1'},
    })).status, 403);
    const invalid = new Uint8Array([255, 216, 255, ...Array(13).fill(0)]);
    assert.equal((await request('/api/uploads', {method: 'POST', user: 'owner', body: photoForm(invalid)})).status, 400);

    const uploaded = await request('/api/uploads', {method: 'POST', user: 'owner', body: photoForm()});
    assert.equal(uploaded.status, 201);
    const media = await uploaded.json();
    assert.match(media.id, /^[a-f0-9-]{36}$/);
    assert.equal(media.url, 'api/media/' + media.id);
    const mediaRow = app.storage.connection.prepare('SELECT object_key,mime,bytes FROM media WHERE id=?').get(media.id);
    assert.equal(mediaRow.mime, 'image/jpeg');
    assert.equal(mediaRow.bytes, image.length);
    const storedPath = join(dataDir, 'media', 'food', media.id + '.object');
    const object = await readFile(storedPath);
    assert.equal(object.subarray(0, 8).toString(), 'FOODOBJ1');
    assert.equal((await stat(storedPath)).mode & 0o777, 0o600);
    for (const method of ['GET', 'HEAD']) {
      for (const user of [undefined, 'other']) assert.equal((await request(media.url, {method, user})).status, 404);
      const own = await request(media.url, {method, user: 'owner'});
      assert.equal(own.status, 200);
      assert.equal(own.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(own.headers.get('Vary'), 'Cookie');
      const bytes = new Uint8Array(await own.arrayBuffer());
      if (method === 'GET') assert.deepEqual(bytes, new Uint8Array(image));
      else assert.equal(bytes.length, 0);
    }
    const entry = {
      requestKey: crypto.randomUUID(), name: '新发现的巷口饭馆（自由店名）',
      address: '北京市东城区东四南大街99号测试门牌', dishes: ['牛肉饭', '小菜'],
      mediaIds: [media.id], lat: 39.923, lng: 116.42, experience: '隔离环境的上传验证',
      mealDate: null, amount: 32, sourceUrl: '',
    };
    assert.equal((await request('/api/entries', {method: 'POST', user: 'other', body: entry})).status, 400);
    const saved = await request('/api/entries', {method: 'POST', user: 'owner', body: entry});
    assert.equal(saved.status, 201);
    const entryId = (await saved.json()).id;
    const repeated = await request('/api/entries', {method: 'POST', user: 'owner', body: entry});
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).id, entryId);
    assert.equal((await request('/api/entries', {method: 'POST', user: 'owner', body: {...entry, name: '变化的店名'}})).status, 409);

    let catalog = await (await request('/api/catalog')).json();
    assert.equal(catalog.features.length, 68);
    const feature = catalog.features.find(item => item.properties.entryId === entryId);
    assert.equal(feature.properties.name, entry.name);
    assert.equal(feature.properties.address, entry.address);
    assert.deepEqual(feature.properties.dishes, entry.dishes);
    assert.deepEqual(feature.geometry.coordinates, [entry.lng, entry.lat]);
    assert.equal(feature.properties.sourceUrl, null);
    assert.equal(feature.properties.photos[0].url, media.url);
    const published = await request(media.url);
    assert.equal(published.status, 200);
    assert.equal(published.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(jpeg.decode(new Uint8Array(await published.arrayBuffer()), {tolerantDecoding: false}).width, 8);
    assert.equal((await request(media.url, {method: 'HEAD'})).status, 200);

    const again = await request('/api/entries', {
      method: 'POST', user: 'owner', body: {...entry, requestKey: crypto.randomUUID(), address: '北京市东城区 东四南大街99号测试门牌', dishes: ['饺子']},
    });
    assert.equal(again.status, 201);
    const otherBranch = await request('/api/entries', {
      method: 'POST', user: 'owner', body: {...entry, requestKey: crypto.randomUUID(), address: '北京市东城区东四南大街101号测试门牌', lat: null, lng: null},
    });
    assert.equal(otherBranch.status, 201);
    catalog = await (await request('/api/catalog')).json();
    const entries = catalog.features.filter(item => item.properties.provenance === 'user');
    assert.equal(entries.length, 3);
    const branches = new Set(entries.map(item => item.properties.branchId));
    assert.equal(branches.size, 2);
    assert.equal(entries.find(item => item.properties.address.includes('101号')).geometry, null);

    // Only an unlinked upload can be removed; another user cannot remove even that upload.
    const orphanUpload = await request('/api/uploads', {method: 'POST', user: 'owner', body: photoForm()});
    assert.equal(orphanUpload.status, 201);
    const orphan = await orphanUpload.json();
    assert.equal((await request(orphan.url, {method: 'DELETE', user: 'other'})).status, 200);
    assert.equal((await request(orphan.url, {user: 'owner'})).status, 200);
    assert.equal((await request(orphan.url, {method: 'DELETE', user: 'owner'})).status, 200);
    assert.equal((await request(orphan.url, {user: 'owner'})).status, 404);
    await assert.rejects(stat(join(dataDir, 'media', 'food', orphan.id + '.object')), {code: 'ENOENT'});
    assert.equal((await request(media.url, {method: 'DELETE', user: 'owner'})).status, 200);
    assert.equal((await request(media.url)).status, 200);

    await app.stop(); app = null;
    app = await startServer(options);
    assert.deepEqual((await (await request('/api/session', {user: 'owner'})).json()).user, {name: 'owner'});
    const afterRestart = await (await request('/api/catalog')).json();
    assert.equal(afterRestart.features.length, 70);
    const persisted = afterRestart.features.find(item => item.properties.entryId === entryId);
    assert.equal(persisted.properties.photos[0].url, media.url);
    assert.equal(persisted.properties.name, entry.name);
    const persistentPhoto = await request(media.url);
    assert.equal(persistentPhoto.status, 200);
    assert.deepEqual(new Uint8Array(await persistentPhoto.arrayBuffer()), new Uint8Array(image));
    assert.equal(app.storage.connection.prepare('SELECT COUNT(*) AS n FROM entry_media WHERE media_id=?').get(media.id).n, 3);
  } finally {
    if (app) await app.stop();
    await rm(dataDir, {recursive: true, force: true});
  }
});
