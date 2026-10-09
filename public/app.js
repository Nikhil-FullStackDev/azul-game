(() => {
  'use strict';
  const G = Azul, BOT = AzulBot;
  const GLYPH = ['●', '◆', '▲', '■', '✦']; // shapes double as colorblind aids
  const CNAME = ['blue', 'yellow', 'red', 'black', 'teal'];
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* unsupported */ } };

  const app = $('#app');
  let toastT;
  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // ---------- session state ----------
  let name = store.get('azul-name') || '';
  let local = null;          // {S, bots, timer, me}
  let net = null;            // {code, token, es, snap}
  let view = null, you = 0, snap = null, inGame = false;
  let sel = null, hintRow = null;  // sel = {src, color}; hintRow = row suggested by the hint (0..5)
  let viewing = 0, canUndo = false;
  let lastSeq = -1, busy = false, wasMyTurn = false, overShown = false, lastScoredSeq = -1, wake = null;

  // ---------- tiles ----------
  const tile = (c, extra = '', attrs = '') => c === G.MARKER
    ? `<i class="t mk ${extra}" ${attrs}></i>` : `<i class="t c${c} ${extra}" data-g="${GLYPH[c]}" ${attrs}></i>`;

  // ---------- home ----------
  function home(msg) {
    destroyGame();
    const room = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4);
    let bots = +store.get('azul-bots') || 1;
    app.innerHTML = `<div class="page">
      <div class="logo"><div class="tiles" style="--ts:34px">${[0, 1, 2, 3, 4].map(c => tile(c)).join('')}</div><h1>AZUL</h1><p>Draft the tiles. Build the wall. Dodge the floor.</p></div>
      <div class="card"><h2>Your name</h2><input id="nm" class="field" maxlength="14" placeholder="Artisan" value="${esc(name)}" autocomplete="nickname"></div>
      <div class="card"><h2>Play vs bots</h2>
        <div class="seg" id="seg">${[1, 2, 3].map(n => `<button data-n="${n}" class="${n === bots ? 'on' : ''}">${n} bot${n > 1 ? 's' : ''}</button>`).join('')}</div>
        <button class="btn pri" id="solo">Start game</button></div>
      <div class="card"><h2>Play with friends</h2>
        <button class="btn pri" id="create">Create room</button>
        <div class="row"><input id="code" class="field" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off" value="${esc(room)}" style="text-transform:uppercase;letter-spacing:.2em;text-align:center">
        <button class="btn" id="join">Join</button></div></div>
      <div class="err" id="err">${esc(msg || '')}</div>
      <button class="btn sm" id="how">How to play</button>
    </div>`;
    const err = m => { $('#err').textContent = m; };
    const nm = () => { name = $('#nm').value.trim().slice(0, 14) || 'You'; store.set('azul-name', name); return name; };
    $('#seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; bots = +b.dataset.n; store.set('azul-bots', bots); [...$('#seg').children].forEach(x => x.classList.toggle('on', x === b)); };
    $('#solo').onclick = () => startLocal(nm(), bots);
    $('#create').onclick = async () => {
      const r = await call('/api/create', { name: nm() });
      if (r.error) return err(r.error);
      goOnline(r.code, r.token);
    };
    $('#join').onclick = async () => {
      const code = $('#code').value.trim().toUpperCase();
      if (code.length !== 4) return err('Enter the 4-letter room code');
      const r = await call('/api/join', { code, name: nm() });
      if (r.error) return err(r.error);
      goOnline(r.code, r.token);
    };
    $('#how').onclick = howTo;
  }

  async function call(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return await r.json();
    } catch { return { error: 'No connection. Check your network and try again.' }; }
  }

  function howTo() {
    sheet(`<h2>How to play</h2><ul>
      <li><b>Draft:</b> on your turn take <i>all</i> tiles of one color from a factory (the rest slide to the middle) or from the middle.</li>
      <li>The first player to take from the middle also takes the <b>1</b> marker (goes on their floor, −1) and starts next round.</li>
      <li><b>Place</b> them on one pattern line (the staircase). A line holds one color, and not a color already on your wall row. Extras fall to the <b>floor</b> for penalties (−1, −1, −2, −2, −2, −3, −3).</li>
      <li>When all tiles are gone, each full line moves one tile to the wall and scores: 1 point, plus the length of the connected row and column runs it joins.</li>
      <li>The game ends after a round where someone completes a wall row. Bonuses: <b>+2</b> per full row, <b>+7</b> per full column, <b>+10</b> per color set of five.</li>
      <li><b>Tap to confirm:</b> tap tiles, tap a line (tap it again or press Place). 💡 shows a suggestion.</li></ul>
      <button class="btn pri" data-close>Got it</button>`);
  }
  function sheet(html, mid, onClose) {
    const el = document.createElement('div');
    el.className = 'sheet' + (mid ? ' mid' : '');
    el.innerHTML = `<div class="in">${html}</div>`;
    const close = () => { el.remove(); onClose && onClose(); };
    el.onclick = e => { if (e.target === el || e.target.closest('[data-close]')) close(); };
    document.body.appendChild(el);
    return { el, close };
  }

  // ---------- local (vs bots) ----------
  const BOT_NAMES = ['Ada', 'Bram', 'Cleo'];
  function startLocal(me, nBots) {
    leaveNet();
    const players = [{ name: me }, ...BOT_NAMES.slice(0, nBots).map(n => ({ name: n + ' (bot)', bot: true }))];
    local = { S: G.create(players), bots: nBots, timer: null, me };
    you = 0; enterGame(); setView(G.view(local.S, 0));
    scheduleLocalBot();
  }
  function scheduleLocalBot() {
    clearTimeout(local.timer);
    const S = local.S;
    if (S.winner !== null || !S.players[S.turn].bot) return;
    const recap = S.scored && S.scored.seq === S.seq;
    local.timer = setTimeout(() => {
      if (!local || local.S !== S) return;
      const id = S.turn, a = BOT.plan(S, id);
      const r = a && G.act(S, id, a);
      if (!r || r.error) { const m = G.moves(S, id); G.act(S, id, m[m.length - 1]); }
      setView(G.view(S, 0)); scheduleLocalBot();
    }, (recap ? 2600 : 900) + (S.last && S.last.pid === 0 && !recap ? 2200 : 0) + Math.random() * 600);
  }

  // ---------- online ----------
  function goOnline(code, token) {
    leaveNet(); local = null;
    net = { code, token, es: null, snap: null };
    store.set('azul-sess', JSON.stringify({ code, token }));
    history.replaceState(null, '', location.pathname);
    connect();
  }
  function connect() {
    if (!net) return;
    if (net.es) net.es.close();
    const es = new EventSource(`/api/events?code=${net.code}&token=${net.token}`);
    net.es = es;
    es.onmessage = e => { if (net && net.es === es) onSnap(JSON.parse(e.data)); };
    es.onerror = async () => {
      if (es.readyState !== 2 || !net || net.es !== es) return;
      const r = await call('/api/ping', { code: net.code, token: net.token });
      if (!net || net.es !== es) return;
      if (r.error === 'Room not found' || r.error === 'Bad token') { leaveNet(); home('That room is gone.'); }
      else setTimeout(() => net && net.es === es && connect(), 2000);
    };
  }
  function leaveNet() {
    if (net && net.es) net.es.close();
    net = null; store.set('azul-sess', null);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && net && net.es && net.es.readyState !== 1) connect();
    if (!document.hidden) requestWake();
  });

  function onSnap(s) {
    snap = s; net.snap = s; you = s.you;
    if (s.game) {
      if (!inGame) enterGame();
      setView(s.game);
    } else {
      if (inGame) destroyGame();
      document.querySelectorAll('.sheet').forEach(e => e.remove());
      lobby(s);
    }
  }

  function lobby(s) {
    const n = s.lobby.length;
    app.innerHTML = `<div class="page">
      <div class="logo"><h1>ROOM</h1><p>Share this code or link with friends</p></div>
      <div class="card"><div class="code">${s.code}</div>
        <div class="row"><button class="btn" id="share">Invite friends</button><button class="btn" id="copy">Copy code</button></div></div>
      <div class="card"><h2>Players (${n}/4)</h2><div class="plist">${s.lobby.map((p, i) =>
        `<div class="pl" style="--c:var(--c${i})"><i></i><b>${esc(p.name)}${i === s.you ? ' (you)' : ''}</b><small>${i === 0 ? 'host' : p.bot ? 'bot' : p.connected ? '' : 'offline'}</small>${s.host && i > 0 ? `<button class="x" data-kick="${i}" aria-label="Remove">✕</button>` : ''}</div>`).join('')}</div>
        ${s.host ? `<button class="btn" id="bot" ${n >= 4 ? 'disabled' : ''}>+ Add bot</button>` : ''}</div>
      ${s.host ? `<button class="btn pri" id="start" ${n < 2 ? 'disabled' : ''}>${n < 2 ? 'Need 2+ players' : 'Start game'}</button>` : '<div class="tiny">Waiting for the host to start…</div>'}
      <button class="btn sm bad" id="leave">Leave room</button>
      <div class="err" id="err"></div></div>`;
    const url = `${location.origin}/?room=${s.code}`;
    $('#share').onclick = async () => {
      try { if (navigator.share) return await navigator.share({ title: 'Azul', text: `Join my Azul game! Code ${s.code}`, url }); } catch { return; }
      copy(url);
    };
    $('#copy').onclick = () => copy(s.code);
    $('#leave').onclick = async () => { await call('/api/leave', { code: net.code, token: net.token }); leaveNet(); home(); };
    if (s.host) {
      $('#bot').onclick = () => hostCall('/api/addbot');
      $('#start').onclick = () => hostCall('/api/start');
      app.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => hostCall('/api/kick', { index: +b.dataset.kick }));
    }
  }
  async function hostCall(path, extra) {
    const r = await call(path, { code: net.code, token: net.token, ...extra });
    if (r.error) toast(r.error);
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Copied'), () => toast(text));
  }

  // ---------- game ----------
  function enterGame() {
    destroyGame();
    document.querySelectorAll('.sheet').forEach(e => e.remove());
    inGame = true; viewing = you; sel = hintRow = null; lastSeq = -1; wasMyTurn = false; overShown = false; busy = false; lastScoredSeq = -1;
    app.innerHTML = `<div id="game">
      <div class="top"><div class="chips" id="chips"></div><button class="hint" id="hint" aria-label="Hint">💡</button><button class="menu" id="menu" aria-label="Menu">☰</button></div>
      <div id="status"></div><div id="recap"></div>
      <div class="layout"><div class="table" id="table"></div><div class="boards" id="boards"></div></div>
      <div class="meta" id="meta"></div></div>`;
    $('#game').onclick = onTap;
    $('#menu').onclick = menu;
    $('#hint').onclick = hint;
    requestWake();
  }
  function destroyGame() {
    inGame = false; view = null; sel = hintRow = null;
    if (local) clearTimeout(local.timer);
  }
  async function requestWake() {
    try { if (inGame && 'wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.onrelease = () => { wake = null; }; } } catch { /* denied */ }
  }

  function setView(v) {
    if (inGame && lastSeq >= 0 && v.seq < lastSeq) enterGame(); // a fresh game restarts the counter
    view = v;
    if (!inGame) return;
    if (v.seq !== lastSeq) {
      const l = v.last;
      if (lastSeq >= 0 && l && l.pid !== you && v.seq === lastSeq + 1) buzz(0);
      sel = hintRow = null;
    }
    lastSeq = v.seq;
    const mine = v.winner === null && v.turn === you;
    if (mine && !wasMyTurn && lastSeq > 0) buzz(40);
    wasMyTurn = mine;
    paint();
    if (v.winner !== null) setTimeout(() => inGame && view === v && showWin(), 900);
  }

  const myMove = () => view && view.winner === null && view.turn === you && !busy;
  const poolOf = src => src === G.CENTER ? view.center : view.factories[src];

  // Coordinates are pixels on the 894px board photo (public/img/board.jpg); CSS scales them.
  const ROW_Y = [357, 435, 512, 590, 668], WALL_X = [504, 582, 660, 737, 814], TRACK_Y = [78, 126, 175, 224, 273];
  const PAWN = ['#ffffff', '#c58bff', '#46f08f', '#ff9a45'];
  const at = (cls, x, y, w, extra = '', h) => `<i class="${cls}" style="--x:${x};--y:${y};--w:${w}${h ? `;--h:${h}` : ''}" ${extra}></i>`;
  function boardHtml(p, i, mine) {
    const turn = view.winner === null && view.turn === i;
    const canPlace = mine && myMove() && sel;
    let h = '';
    const fresh = view.scored && view.scored.seq === view.seq ? view.scored.players[i].placed : [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const on = p.wall[r][c];
      h += at(`wc ${on ? 'on' : ''} ${on && fresh.some(x => x.r === r && x.c === c) ? 'new' : ''}`, WALL_X[c], ROW_Y[r], 68);
    }
    for (let r = 0; r < 5; r++) {
      const line = p.lines[r], ok = canPlace && G.rowAccepts(p, r, sel.color), pre = mine && hintRow === r;
      h += at(`hit ${ok ? 'ok' : ''} ${pre ? 'pre' : ''}`, 232, ROW_Y[r], 392, ok ? `data-row="${r}"` : '', 76);
      const add = pre ? Math.min(r + 1 - line.n, countSel()) : 0;
      for (let d = 0; d < r + 1; d++) {
        const x = 388 - 76.5 * d;
        if (d < line.n) h += at(`t c${line.color}`, x, ROW_Y[r], 66);
        else if (d < line.n + add) h += at(`t c${sel.color} ghost`, x, ROW_Y[r], 66);
      }
    }
    const fOk = canPlace, fPre = mine && hintRow === 5;
    h += at(`hit ${fOk ? 'ok' : ''} ${fPre ? 'pre' : ''}`, 330, 800, 604, fOk ? 'data-row="5"' : '', 108);
    p.floor.forEach((t, k) => { h += at(t === G.MARKER ? 't mk' : `t c${t}`, 77 + 84.5 * k, 802, 64); });
    if (fPre) for (let k = 0; k < Math.min(countSel(), 7 - p.floor.length); k++) h += at(`t c${sel.color} ghost`, 77 + 84.5 * (p.floor.length + k), 802, 64);
    const s = Math.min(100, p.score);
    const px = s === 0 ? 70 : 68 + 40 * ((s - 1) % 20), py = s === 0 ? 32 : TRACK_Y[((s - 1) / 20) | 0];
    h += `<i class="sm" style="--x:${px};--y:${py};--w:28;--pc:${PAWN[i]}"></i>`;
    return `<div class="pb ${turn ? 'turn' : ''}"><header><b>${esc(p.name)}${mine ? ' (you)' : ''}</b><span>${p.score}</span></header><div class="bd">${h}</div></div>`;
  }
  function countSel() {
    if (!sel || !view) return 0;
    return poolOf(sel.src).filter(t => t === sel.color).length;
  }

  function paint() {
    if (!inGame || !view) return;
    const v = view, me = v.players[you], over = v.winner !== null, mine = myMove();
    $('#chips').innerHTML = v.players.map((p, i) => `<div class="chip ${!over && v.turn === i ? 'turn' : ''} ${viewing === i ? 'view' : ''}" data-view="${i}"><span>${esc(p.name)}</span><b>${p.score}</b></div>`).join('');
    // factories + middle
    const facs = v.factories.map((f, i) => `<div class="fac ${f.length ? '' : 'empty'}">${f.map(c => {
      const s = sel && sel.src === i;
      return tile(c, mine ? `pick ${s ? (c === sel.color ? 'sel' : 'rest') : ''}` : '', `data-src="${i}" data-color="${c}"`);
    }).join('')}</div>`).join('');
    const mid = [...v.center].sort((a, b) => b - a).map(c => {
      if (c === G.MARKER) return tile(c);
      const s = sel && sel.src === G.CENTER;
      return tile(c, mine ? `pick ${s ? (c === sel.color ? 'sel' : 'rest') : ''}` : '', `data-src="-1" data-color="${c}"`);
    }).join('');
    $('#table').innerHTML = `<div class="factories">${facs}</div><div class="pool"><small>Middle${v.center.includes(G.MARKER) ? ' · first taker gets the 1 marker (−1)' : ''}</small>${mid}</div>`;
    if (viewing >= v.players.length) viewing = you;
    canUndo = undoAvailable();
    $('#boards').innerHTML = boardHtml(v.players[viewing], viewing, viewing === you)
      + (viewing !== you ? `<div class="go"><button class="btn" id="back">← Back to my board</button></div>` : '')
      + (canUndo ? `<div class="go"><button class="btn" id="undo">↩ Undo move</button></div>` : '');
    const back = $('#back'); if (back) back.onclick = () => { viewing = you; paint(); };
    const undo = $('#undo'); if (undo) undo.onclick = doUndo;

    const st = $('#status');
    st.className = mine ? 'me' : '';
    if (over) st.textContent = 'Game over';
    else if (v.turn === you) st.textContent = sel ? 'Now tap a highlighted line, or the floor' : 'Your turn: tap tiles to take every tile of that color';
    else st.textContent = `${v.players[v.turn].name} is thinking…`;
    const l = v.last;
    $('#meta').textContent = `Round ${v.round} · bag ${v.bagCount} · lid ${v.lidCount}` + (l ? ` · ${v.players[l.pid].name} took ${l.count} ${CNAME[l.color]} → ${l.row === 5 ? 'floor' : 'line ' + (l.row + 1)}${l.marker ? ' (+marker)' : ''}` : '');
    // round recap
    const rc = $('#recap');
    if (v.scored && v.scored.seq === v.seq && !over) {
      rc.innerHTML = `<div class="recap"><b>Round ${v.scored.round} scored</b> · ${v.scored.players.map((s, i) => `${esc(v.players[i].name)} ${s.delta >= 0 ? '+' : ''}${s.delta}${s.penalty ? ` (floor ${s.penalty})` : ''}`).join(' · ')}</div>`;
      if (lastScoredSeq !== v.seq) { lastScoredSeq = v.seq; buzz(20); }
    } else rc.innerHTML = '';
    $('#hint').style.visibility = mine ? 'visible' : 'hidden';
  }

  // ---------- input ----------
  function onTap(e) {
    const vw = e.target.closest('[data-view]');
    if (vw && view) { viewing = +vw.dataset.view; return paint(); }
    if (!myMove()) return;
    const t = e.target.closest('[data-color]');
    if (t && t.dataset.src !== undefined && t.classList.contains('pick')) {
      const src = +t.dataset.src, color = +t.dataset.color;
      if (sel && sel.src === src && sel.color === color) sel = hintRow = null;
      else { sel = { src, color }; hintRow = null; viewing = you; }
      buzz(8); return paint();
    }
    const row = e.target.closest('[data-row]');
    if (row && sel && row.dataset.row !== '') place(+row.dataset.row);
  }
  function hint() {
    if (!myMove()) return;
    const a = BOT.plan(view, you);
    if (!a) return;
    viewing = you; sel = { src: a.src, color: a.color }; hintRow = a.row; paint();
  }
  function place(row) {
    if (!myMove() || !sel) return;
    const a = { src: sel.src, color: sel.color, row };
    buzz(15);
    if (local) {
      const before = JSON.stringify(local.S);
      const r = G.act(local.S, you, a);
      if (r.error) return toast(r.error);
      local.undo = { seq: local.S.seq, snap: before };
      setView(G.view(local.S, 0)); scheduleLocalBot();
    } else if (net) {
      busy = true; paint();
      call('/api/act', { code: net.code, token: net.token, a }).then(r => {
        busy = false;
        if (r.error) toast(r.error);
        if (inGame) paint();
      });
    }
  }
  // Undo is offered until the next player acts (bots wait a moment so there is time to use it).
  function undoAvailable() {
    if (!view || view.winner !== null) return false;
    if (local) return !!local.undo && local.undo.seq === local.S.seq;
    return !!(snap && snap.canUndo);
  }
  function doUndo() {
    if (!undoAvailable()) return;
    buzz(10);
    if (local) {
      clearTimeout(local.timer);
      local.S = JSON.parse(local.undo.snap); local.undo = null;
      sel = hintRow = null; viewing = you;
      setView(G.view(local.S, 0)); scheduleLocalBot();
    } else if (net) {
      call('/api/undo', { code: net.code, token: net.token }).then(r => { if (r.error) toast(r.error); });
    }
  }

  function menu() {
    const s = sheet(`<h2>Menu</h2>
      <button class="btn" id="m-how">How to play</button>
      <button class="btn bad" id="m-quit">${local ? 'Quit to menu' : 'Leave game'}</button>
      <button class="btn pri" data-close>Back to game</button>`);
    $('#m-how', s.el).onclick = () => { s.close(); howTo(); };
    $('#m-quit', s.el).onclick = () => { s.close(); quit(); };
  }
  async function quit() {
    if (net) { await call('/api/leave', { code: net.code, token: net.token }); leaveNet(); }
    if (local) { clearTimeout(local.timer); local = null; }
    home();
  }

  function showWin() {
    if (overShown || !view || view.winner === null) return;
    overShown = true;
    const v = view, iWon = v.winners.includes(you);
    buzz(iWon ? [60, 50, 60, 50, 120] : 30);
    const names = v.winners.map(i => v.players[i].name).join(' & ');
    const order = v.players.map((p, i) => i).sort((a, b) => v.players[b].score - v.players[a].score);
    const online = !!net, host = snap && snap.host;
    const s = sheet(`<div class="win"><div class="big">${iWon ? (v.winners.length > 1 ? 'You tie for the win!' : 'You win!') : esc(names) + ' wins!'}</div></div>
      <table class="tbl"><tr><th></th><th>Rows</th><th>Cols</th><th>Sets</th><th>Score</th></tr>${order.map(i => `<tr class="${v.winners.includes(i) ? 'w1' : ''}"><td>${esc(v.players[i].name)}</td><td>${v.final[i].rows}</td><td>${v.final[i].cols}</td><td>${v.final[i].sets}</td><td>${v.players[i].score}</td></tr>`).join('')}</table>
      <p class="tiny">Bonuses: +2 row, +7 column, +10 color set. Ties go to the most full rows.</p>
      ${online ? (host ? '<button class="btn pri" id="again">Play again</button><button class="btn" id="lob">Back to lobby</button>' : '<p class="tiny">Waiting for the host to start another game…</p>')
        : '<button class="btn pri" id="again">Play again</button>'}
      <button class="btn bad" id="quit">${online ? 'Leave room' : 'Main menu'}</button>`, true);
    const again = $('#again', s.el);
    if (again) again.onclick = () => { s.close(); if (local) startLocal(local.me, local.bots); else hostCall('/api/start'); };
    const lob = $('#lob', s.el);
    if (lob) lob.onclick = () => { s.close(); hostCall('/api/lobby'); };
    $('#quit', s.el).onclick = () => { s.close(); quit(); };
  }

  // ---------- boot ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  const saved = (() => { try { return JSON.parse(store.get('azul-sess')); } catch { return null; } })();
  if (saved && saved.code && saved.token) { net = { code: saved.code, token: saved.token, es: null, snap: null }; connect(); }
  else home();
})();
