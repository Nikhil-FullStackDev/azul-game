# Azul Online

A mobile-first take on the tile-drafting game Azul for 2-4 players: play against bots instantly, or create a room and share the 4-letter code with friends (bots can fill empty seats).

**Rules in brief:** take every tile of one color from a factory (leftovers slide to the middle) or from the middle (the first taker also takes the first-player marker, -1). Place them on one pattern line; overflow drops to the floor for penalties (-1,-1,-2,-2,-2,-3,-3). When the tiles run out, full lines move one tile to your wall and score (1 + connected row/column runs). The game ends after a round that completes a wall row; bonuses are +2 per row, +7 per column, +10 per color set. Ties go to the most completed rows.

- `public/game.js` is the rules engine, shared by server and browser.
- `public/bot.js` is the bot (greedy evaluation using only public information; also powers the 💡 hint).
- `server.js` is a zero-dependency Node server using REST + Server-Sent Events.
- Solo-vs-bots runs entirely in the browser, so it works offline once loaded (PWA, installable).
- Tiles carry shapes as well as colors, for color-blind players.

```bash
npm start   # http://localhost:3000
npm test
```

A seat that drops offline for 25 s is played by a bot until they reconnect. Clients reconnect automatically and resume from `localStorage`. `render.yaml` deploys a free Render web service with no build step; rooms are in memory and reset when the free instance sleeps.

Azul is a Plan B Games / Next Move Games design; this is a fan project.
