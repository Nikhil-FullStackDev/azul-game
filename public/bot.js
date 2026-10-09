// Azul bot. Greedy one-ply evaluation of every legal move using only public information.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.AzulBot = factory(root.Azul);
})(this, function (G) {
  function evaluate(S, pid, m) {
    const p = S.players[pid];
    const pool = m.src === G.CENTER ? S.center : S.factories[m.src];
    const count = pool.filter(t => t === m.color).length;
    let score = 0;
    // Taking from the center costs the first-player marker (-1 floor) but also starts next round.
    const marker = m.src === G.CENTER && pool.includes(G.MARKER);
    let floorN = p.floor.length + (marker ? 1 : 0);
    const floorCost = (from, add) => G.floorPenalty(Math.min(7, from + add)) - G.floorPenalty(Math.min(7, from));
    if (marker) score += floorCost(p.floor.length, 1) + 0.6;
    // Leaving tiles in the middle feeds opponents; small penalty per tile left behind on a factory.
    if (m.src !== G.CENTER) score -= (pool.length - count) * 0.12;

    if (m.row === G.FLOOR_ROW) {
      score += floorCost(floorN, count);
      // Dumping is least bad when there's little to lose; hoarding a useless color also denies others.
      score += 0.2 * count;
    } else {
      const line = p.lines[m.row], room = m.row + 1 - line.n;
      const placed = Math.min(room, count), spill = count - placed;
      score += floorCost(floorN, spill);
      const filled = line.n + placed;
      const col = G.colOf(m.row, m.color);
      if (filled === m.row + 1) {
        // Will be placed on the wall this round.
        const wall = p.wall.map(r => r.slice());
        wall[m.row][col] = 1;
        score += G.wallScore(wall, m.row, col) * 1.4 + 0.5;
      } else {
        // Progress toward a line, weighted by how likely it is to be finished and how valuable the spot is.
        const w = p.wall.map(r => r.slice());
        w[m.row][col] = 1;
        const potential = G.wallScore(w, m.row, col);
        score += (filled / (m.row + 1)) * (1.2 + potential * 0.5);
        // A big unfinished line with few tiles left of that color is risky.
        const left = 20 - countColor(S, m.color);
        if (left < m.row + 1 - filled) score -= 1.5;
      }
      // Prefer completing wall columns/colors.
      let colFill = 0, setFill = 0;
      for (let r = 0; r < 5; r++) { if (p.wall[r][col]) colFill++; if (p.wall[r][G.colOf(r, m.color)]) setFill++; }
      score += colFill * 0.25 + setFill * 0.2;
      if (m.row === 0 && count > 1) score -= 0.3; // top rows waste overflow
    }
    return score;
  }
  // Tiles of a color visible on boards, factories and the center (a rough count of what's left to draw).
  function countColor(S, color) {
    let n = 0;
    const add = t => { if (t === color) n++; };
    S.factories.forEach(f => f.forEach(add)); S.center.forEach(add);
    S.players.forEach(p => {
      p.floor.forEach(add);
      p.lines.forEach(l => { if (l.color === color) n += l.n; });
      p.wall.forEach((row, r) => { if (row[G.colOf(r, color)]) n++; });
    });
    return n;
  }

  function plan(S, pid) {
    if (S.winner !== null || S.turn !== pid) return null;
    const ms = G.moves(S, pid);
    let best = null;
    for (const m of ms) {
      const sc = evaluate(S, pid, m) + Math.random() * 0.35;
      if (!best || sc > best.sc) best = { sc, m };
    }
    return best && { src: best.m.src, color: best.m.color, row: best.m.row };
  }

  return { plan, evaluate };
});
