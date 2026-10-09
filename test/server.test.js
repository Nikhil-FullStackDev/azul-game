const test = require('node:test');
const assert = require('node:assert');
const server = require('../server.js');

let B;
test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  B = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.closeAllConnections?.(); server.close(); });

const post = async (p, body) => {
  const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
async function firstSnap(code, token) {
  const ctl = new AbortController();
  const res = await fetch(`${B}/api/events?code=${code}&token=${token}`, { signal: ctl.signal });
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value } = await reader.read();
    buf += dec.decode(value);
    const m = buf.match(/data: (.*)\n\n/);
    if (m) { ctl.abort(); return JSON.parse(m[1]); }
  }
}

test('health and static files', async () => {
  assert.strictEqual((await fetch(B + '/healthz')).status, 200);
  const html = await fetch(B + '/');
  assert.strictEqual(html.status, 200);
  assert.match(await html.text(), /Azul/);
  assert.strictEqual((await fetch(B + '/server.js')).status, 404);
  assert.strictEqual((await fetch(B + '/%2e%2e/server.js')).status, 404);
});

test('room flow: create, add bot, start, act, hidden bag', async () => {
  const c = (await post('/api/create', { name: 'Host' })).body;
  assert.match(c.code, /^[A-Z]{4}$/);
  assert.strictEqual((await post('/api/start', { code: c.code, token: c.token })).status, 400); // needs 2
  assert.strictEqual((await post('/api/addbot', { code: c.code, token: c.token })).status, 200);
  const j = await post('/api/join', { code: c.code, name: 'Guest' });
  assert.strictEqual(j.status, 200);
  assert.strictEqual((await post('/api/start', { code: c.code, token: j.body.token })).status, 403); // host only
  assert.strictEqual((await post('/api/start', { code: c.code, token: c.token })).status, 200);
  assert.strictEqual((await post('/api/join', { code: c.code, name: 'Late' })).status, 400);
  const s = await firstSnap(c.code, c.token);
  assert.strictEqual(s.game.bag, undefined);
  assert.ok(s.game.bagCount > 0);
  assert.strictEqual(s.you, 0);
  assert.strictEqual(s.game.factories.length, 7);
  // wrong-turn / invalid action is refused
  const bad = await post('/api/act', { code: c.code, token: c.token, a: { src: 99, color: 0, row: 0 } });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await post('/api/act', { code: c.code, token: 'nope', a: {} })).status, 403);
});
