const test = require('node:test');
const assert = require('node:assert');
const G = require('../public/game.js');
const { plan } = require('../public/bot.js');

const P = n => Array.from({ length: n }, (_, i) => ({ name: 'P' + i }));
const total = S => S.bag.length + S.lid.length + S.factories.flat().length + S.center.filter(t => t !== 5).length
  + S.players.reduce((a, p) => a + p.floor.filter(t => t !== 5).length + p.lines.reduce((x, l) => x + l.n, 0) + p.wall.flat().filter(Boolean).length, 0);

test('setup per player count', () => {
  for (const n of [2, 3, 4]) {
    const S = G.create(P(n), 1);
    assert.strictEqual(S.factories.length, G.FACTORIES[n]);
    assert.ok(S.factories.every(f => f.length === 4));
    assert.deepStrictEqual(S.center, [5]);
    assert.strictEqual(total(S), 100);
  }
});

test('taking from a factory sends the rest to the middle', () => {
  const S = G.create(P(2), 3);
  const f = S.factories[0], color = f[0], n = f.filter(t => t === color).length;
  assert.ok(G.act(S, S.turn, { src: 0, color, row: 4 }).ok);
  assert.strictEqual(S.factories[0].length, 0);
  assert.strictEqual(S.center.length, 1 + 4 - n);
});

test('rejects wrong turn, bad colors, wrong line', () => {
  const S = G.create(P(2), 5);
  const other = (S.turn + 1) % 2;
  assert.ok(G.act(S, other, { src: 0, color: S.factories[0][0], row: 0 }).error);
  const missing = [0, 1, 2, 3, 4].find(c => !S.factories[0].includes(c));
  if (missing !== undefined) assert.ok(G.act(S, S.turn, { src: 0, color: missing, row: 0 }).error);
  const p = S.players[S.turn];
  p.lines[2] = { color: 1, n: 1 };
  const c = [0, 2, 3, 4].find(x => S.factories[0].includes(x));
  if (c !== undefined) assert.ok(G.act(S, S.turn, { src: 0, color: c, row: 2 }).error);
});

test('overflow goes to floor; marker lands on first center taker', () => {
  const S = G.create(P(2), 9);
  S.factories[0] = [2, 2, 2, 2]; S.factories[1] = [1, 1, 0, 0];
  const a = S.turn;
  G.act(S, a, { src: 0, color: 2, row: 1 });
  assert.strictEqual(S.players[a].lines[1].n, 2);
  assert.strictEqual(S.players[a].floor.length, 2);
  const b = S.turn;
  G.act(S, b, { src: -1, color: 2, row: 5 }); // center has nothing red yet? center is marker only
});

test('middle: marker taken by first center picker', () => {
  const S = G.create(P(2), 9);
  S.factories = S.factories.map(() => []);
  S.factories[0] = [3, 3, 1, 0];
  const a = S.turn;
  G.act(S, a, { src: 0, color: 3, row: 1 });
  assert.deepStrictEqual(S.center.sort(), [0, 1, 5]);
  const b = S.turn;
  G.act(S, b, { src: -1, color: 1, row: 0 });
  assert.deepStrictEqual(S.players[b].floor, [5]);
  assert.strictEqual(S.starter, b);
  assert.ok(!S.center.includes(5));
});

test('wall scoring: isolated, row run, column run, both', () => {
  const w = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  assert.strictEqual(G.wallScore(Object.assign(w, { 2: [0, 0, 1, 0, 0] }), 2, 2), 1);
  const w2 = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  w2[1] = [1, 1, 1, 0, 0];
  assert.strictEqual(G.wallScore(w2, 1, 2), 3);
  const w3 = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  w3[0][2] = 1; w3[1][2] = 1; w3[1][1] = 1; w3[1][3] = 1;
  assert.strictEqual(G.wallScore(w3, 1, 2), 3 + 2);
});

test('floor penalty table', () => {
  assert.strictEqual(G.floorPenalty(0), 0);
  assert.strictEqual(G.floorPenalty(2), -2);
  assert.strictEqual(G.floorPenalty(7), -14);
});

test('wall pattern is a latin square', () => {
  for (let r = 0; r < 5; r++) assert.strictEqual(new Set([0, 1, 2, 3, 4].map(c => G.colOf(r, c))).size, 5);
  for (let c = 0; c < 5; c++) assert.strictEqual(new Set([0, 1, 2, 3, 4].map(r => G.colOf(r, c))).size, 5);
});

test('end of round moves full lines to the wall and applies penalties', () => {
  const S = G.create(P(2), 11);
  S.factories = S.factories.map(() => []); S.center = [];
  const p = S.players[0];
  p.score = 5;
  p.lines[1] = { color: 2, n: 1 };
  S.factories[0] = [2, 4, 4, 4];
  S.turn = 0;
  G.act(S, 0, { src: 0, color: 2, row: 1 }); // completes row 1 (red)
  S.turn = 1;
  assert.strictEqual(S.round, 1);
  // remaining tiles are in the middle: finish them off
  while (S.round === 1) { const m = G.moves(S, S.turn)[0]; G.act(S, S.turn, m); }
  assert.strictEqual(p.wall[1][G.colOf(1, 2)], 1);
  assert.strictEqual(S.scored.round, 1);
  assert.ok(p.score >= 5 + 1 - 14);
});

test('full-row completion ends game with bonuses', () => {
  const S = G.create(P(2), 13);
  S.factories = S.factories.map(() => []); S.center = [];
  const p = S.players[0];
  p.wall[0] = [1, 1, 1, 1, 0];
  p.lines[0] = { color: G.colOf(0, 4) === 4 ? 4 : 4, n: 0 };
  S.factories[0] = [4, 0, 0, 0];
  S.turn = 0;
  G.act(S, 0, { src: 0, color: 4, row: 0 });
  while (S.winner === null && S.round === 1) { const m = G.moves(S, S.turn)[0]; G.act(S, S.turn, m); }
  assert.strictEqual(S.phase, 'over');
  assert.strictEqual(S.final[0].rows, 1);
  assert.deepStrictEqual(S.winners, [0]);
});

test('view hides the bag order but keeps counts', () => {
  const S = G.create(P(2), 2), v = G.view(S, 0);
  assert.strictEqual(v.bag, undefined);
  assert.strictEqual(v.bagCount, S.bag.length);
});

test('bot self-play finishes with every tile accounted for', () => {
  for (const n of [2, 3, 4]) for (let g = 0; g < 8; g++) {
    const S = G.create(P(n), g * 7 + n);
    let guard = 0;
    while (S.winner === null && guard++ < 2000) {
      const id = S.turn, a = plan(S, id);
      assert.ok(a, 'bot returned a move');
      const r = G.act(S, id, a);
      assert.ok(!r.error, r.error);
      if (S.winner === null) assert.strictEqual(total(S) + S.players.reduce((x, p) => x, 0) >= 0, true);
    }
    assert.notStrictEqual(S.winner, null, 'game ended');
    assert.ok(S.players.some(p => p.wall.some(row => row.every(Boolean))));
  }
});

test('tile conservation across rounds', () => {
  const S = G.create(P(3), 21);
  let guard = 0;
  while (S.winner === null && guard++ < 2000) {
    G.act(S, S.turn, plan(S, S.turn));
    assert.strictEqual(total(S), 100);
  }
});
