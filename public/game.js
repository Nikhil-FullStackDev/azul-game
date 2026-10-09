// Azul rules engine. Pure functions on plain JSON state, shared by server, bots and browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Azul = factory();
})(this, function () {
  const COLORS = ['blue', 'yellow', 'red', 'black', 'teal']; // tile colors are 0..4
  const FLOOR = [-1, -1, -2, -2, -2, -3, -3];
  const FACTORIES = { 2: 5, 3: 7, 4: 9 };
  const MIN_PLAYERS = 2, MAX_PLAYERS = 4;
  const CENTER = -1, FLOOR_ROW = 5, MARKER = 5; // the first-player marker is stored as tile 5
  // Wall: row r holds color c at column (c + r) % 5, the classic diagonal pattern.
  const colOf = (r, c) => (c + r) % 5;

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function create(players, seed) {
    const n = players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error('2-4 players');
    seed = seed == null ? (Math.random() * 2 ** 32) >>> 0 : seed;
    const rnd = mulberry(seed);
    const bag = [];
    for (let c = 0; c < 5; c++) for (let i = 0; i < 20; i++) bag.push(c);
    shuffle(bag, rnd);
    const S = {
      n, round: 1, turn: (rnd() * n) | 0, starter: 0, phase: 'pick', winner: null, winners: [], seq: 0,
      seed, nextRnd: seed ^ 0x9e3779b9,
      bag, lid: [], factories: [], center: [MARKER], last: null, scored: null, final: null,
      players: players.map(p => ({
        name: p.name, bot: !!p.bot, score: 0,
        lines: [0, 1, 2, 3, 4].map(() => ({ color: -1, n: 0 })),
        wall: [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0, 0]),
        floor: [],
      })),
    };
    S.starter = S.turn;
    fillFactories(S);
    return S;
  }

  function draw(S) {
    if (!S.bag.length && S.lid.length) {
      S.nextRnd = (S.nextRnd + 0x6d2b79f5) >>> 0;
      S.bag = shuffle(S.lid.splice(0), mulberry(S.nextRnd));
    }
    return S.bag.length ? S.bag.pop() : null;
  }
  function fillFactories(S) {
    S.factories = [];
    for (let f = 0; f < FACTORIES[S.n]; f++) {
      const t = [];
      for (let i = 0; i < 4; i++) { const x = draw(S); if (x !== null) t.push(x); }
      S.factories.push(t);
    }
    S.center = [MARKER];
  }

  const rowAccepts = (p, row, color) =>
    p.lines[row].n < row + 1 && (p.lines[row].color === color || p.lines[row].n === 0) && !p.wall[row][colOf(row, color)];

  // Every legal {src, color, row}. src is a factory index or CENTER; row 5 is the floor.
  function moves(S, pid) {
    const p = S.players[pid], out = [];
    const srcs = S.factories.map((t, i) => [i, t]).concat([[CENTER, S.center]]);
    for (const [src, tiles] of srcs) {
      for (const color of new Set(tiles.filter(t => t !== MARKER))) {
        for (let row = 0; row < 5; row++) if (rowAccepts(p, row, color)) out.push({ src, color, row });
        out.push({ src, color, row: FLOOR_ROW });
      }
    }
    return out;
  }

  function addFloor(S, p, tile) {
    if (p.floor.length < FLOOR.length) p.floor.push(tile);
    else if (tile !== MARKER) S.lid.push(tile); // overflow is discarded
  }

  function act(S, pid, a) {
    if (S.winner !== null || S.phase !== 'pick') return { error: 'Game over' };
    if (S.turn !== pid) return { error: 'Not your turn' };
    const p = S.players[pid];
    const src = Number(a.src), color = Number(a.color), row = Number(a.row);
    if (!(Number.isInteger(src) && src >= CENTER && src < S.factories.length)) return { error: 'Bad source' };
    if (!(Number.isInteger(color) && color >= 0 && color < 5)) return { error: 'Bad color' };
    if (!(Number.isInteger(row) && row >= 0 && row <= FLOOR_ROW)) return { error: 'Bad row' };
    const pool = src === CENTER ? S.center : S.factories[src];
    const take = pool.filter(t => t === color);
    if (!take.length) return { error: 'No such tiles there' };
    if (row < 5 && !rowAccepts(p, row, color)) return { error: "Can't place that color on that row" };

    const rest = pool.filter(t => t !== color);
    let tookMarker = false;
    if (src === CENTER) {
      tookMarker = rest.includes(MARKER);
      S.center = rest.filter(t => t !== MARKER);
    } else {
      S.factories[src] = [];
      S.center.push(...rest);
    }
    if (tookMarker) { addFloor(S, p, MARKER); S.starter = pid; }

    let spill = take.length;
    if (row < 5) {
      const line = p.lines[row], placed = Math.min(row + 1 - line.n, take.length);
      spill = take.length - placed;
      line.color = color; line.n += placed;
    }
    for (let i = 0; i < spill; i++) addFloor(S, p, color);
    S.last = { pid, src, color, row, count: take.length, marker: tookMarker };
    S.seq++;

    if (S.factories.every(f => !f.length) && !S.center.length) endRound(S);
    else S.turn = (S.turn + 1) % S.n;
    return { ok: true };
  }

  function wallScore(wall, r, c) {
    let h = 1, v = 1;
    for (let i = c - 1; i >= 0 && wall[r][i]; i--) h++;
    for (let i = c + 1; i < 5 && wall[r][i]; i++) h++;
    for (let i = r - 1; i >= 0 && wall[i][c]; i--) v++;
    for (let i = r + 1; i < 5 && wall[i][c]; i++) v++;
    if (h === 1 && v === 1) return 1;
    return (h > 1 ? h : 0) + (v > 1 ? v : 0);
  }
  const floorPenalty = n => FLOOR.slice(0, n).reduce((a, b) => a + b, 0);

  function endRound(S) {
    const scored = [];
    let ended = false;
    const before = S.players.map(p => JSON.parse(JSON.stringify({ lines: p.lines, wall: p.wall, floor: p.floor, score: p.score })));
    S.players.forEach(p => {
      const placed = [];
      let gain = 0;
      for (let r = 0; r < 5; r++) {
        const line = p.lines[r];
        if (line.n !== r + 1) continue;
        const c = colOf(r, line.color);
        p.wall[r][c] = 1;
        const pts = wallScore(p.wall, r, c);
        gain += pts; placed.push({ r, c, pts, color: line.color });
        for (let i = 0; i < r; i++) S.lid.push(line.color); // one tile goes on the wall, the rest to the lid
        line.n = 0; line.color = -1;
      }
      const pen = floorPenalty(p.floor.length);
      for (const t of p.floor) if (t !== MARKER) S.lid.push(t);
      const before = p.score;
      p.score = Math.max(0, p.score + gain + pen);
      scored.push({ placed, gain, penalty: pen, floor: p.floor.slice(), delta: p.score - before });
      p.floor = [];
      if (p.wall.some(row => row.every(Boolean))) ended = true;
    });
    S.scored = { round: S.round, seq: S.seq, before, players: scored };
    if (ended) return finish(S);
    S.round++;
    fillFactories(S);
    if (S.factories.every(f => !f.length)) return finish(S); // out of tiles entirely: end rather than stall
    S.turn = S.starter;
  }

  function bonuses(p) {
    let rows = 0, cols = 0, sets = 0;
    for (let r = 0; r < 5; r++) if (p.wall[r].every(Boolean)) rows++;
    for (let c = 0; c < 5; c++) if (p.wall.every(row => row[c])) cols++;
    for (let k = 0; k < 5; k++) if (p.wall.every((row, r) => row[colOf(r, k)])) sets++;
    return { rows, cols, sets, points: rows * 2 + cols * 7 + sets * 10 };
  }

  function finish(S) {
    S.phase = 'over';
    S.final = S.players.map(p => {
      const b = bonuses(p);
      p.score += b.points;
      return b;
    });
    const best = Math.max(...S.players.map(p => p.score));
    const tied = S.players.map((p, i) => i).filter(i => S.players[i].score === best);
    const mostRows = Math.max(...tied.map(i => S.final[i].rows));
    S.winners = tied.filter(i => S.final[i].rows === mostRows);
    S.winner = S.winners[0];
  }

  // Everything in Azul is public information; a view only hides the bag's order.
  function view(S, pid) {
    const { bag, lid, nextRnd, seed, ...rest } = S;
    return { ...JSON.parse(JSON.stringify(rest)), bagCount: bag.length, lidCount: lid.length, you: pid };
  }

  return {
    COLORS, FLOOR, FACTORIES, MIN_PLAYERS, MAX_PLAYERS, CENTER, FLOOR_ROW, MARKER,
    colOf, create, moves, act, view, wallScore, floorPenalty, bonuses, rowAccepts,
  };
});
