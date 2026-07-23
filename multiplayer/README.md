# Zebra Circus multiplayer (shared plaza)

Opt-in real-time presence for the game: players who open the game with
`?mp=1` join a shared room, see each other as crowd-model avatars with name
tags, and walk the same arena. Movement is client-authoritative with server
sanity checks (bounds, speed cap, sequence numbers); the room is authoritative
for presence and identity. Phase 3 (shared balloon pool, scores, emotes) is
not built yet.

## Pieces

- `worker.mjs` - Cloudflare Worker + `ZebraPlazaRoom` Durable Object.
  In-memory state only (no SQLite writes, no R2). Hibernation WebSockets;
  the roster rebuilds from socket attachments after a wake. Snapshots are
  flushed opportunistically from inbound traffic (no timers), capped at
  ~14Hz, and only sent while two or more players are connected.
- `wrangler.jsonc` - deploy config for the `zebra-circus-mp` worker.
- `smoke.mjs` - two-client protocol test (Node, no browser).
- `qa_two_browsers.mjs` - end-to-end Playwright test: two headless browsers
  join, one walks, the other must observe the movement; also asserts the
  Studio editor (`?studioMode=authoring`) never opens a multiplayer socket.

## Client

The game client lives at the end of `../index.html` (the `MP` block).
Query parameters:

- `mp=1` - enable multiplayer (off by default; never active in the editor).
- `mpUrl` - override the relay origin (defaults to the deployed worker).
- `mpRoom` - ask for a specific room (unlisted, not access-controlled).
- `mpName` - display name (otherwise `localStorage.zebraPlayerName` or a
  generated `Zebra NNN`).

## Protocol (JSON over WebSocket)

Client to server: `hello {name}`, `state {seq,x,y,z,yaw,pitch}` (max ~12Hz,
server drops >40Hz), `ping {t}`.
Server to client: `welcome {id,spawn,players,serverTime}`,
`join {player}`, `leave {id}`, `snapshot {t, players:[[id,x,y,z,yaw,pitch]]}`,
`pong {t,serverTime}`.

Server rejections (silent drops): non-finite numbers, positions outside
|x|,|z| <= 60 or y outside [-5,20], displacement over 20 units/s, stale or
repeated sequence numbers, names over 24 chars (clamped), frames over 4KB.

## Deploy and test

```bash
# from this directory, using the engine checkout's wrangler
../..../game-port-studio/node_modules/.bin/wrangler dev --port 8790   # local
node smoke.mjs ws://127.0.0.1:8790

wrangler deploy                                                        # prod
node smoke.mjs wss://zebra-circus-mp.timofeymarkin98.workers.dev

# full browser QA (game served on :8765, e.g. via the editor launcher)
GAME_PORT_STUDIO_PATH=<engine checkout> node multiplayer/qa_two_browsers.mjs
# against prod relay:
MP_QA_WS=wss://zebra-circus-mp.timofeymarkin98.workers.dev GAME_PORT_STUDIO_PATH=<engine> node multiplayer/qa_two_browsers.mjs
```

Costs: Cloudflare free tier covers testing; a continuously full 8-player room
exceeds the free daily request allotment in hours, so enable Workers Paid
($5/mo) before promoting `?mp=1` to the default experience.
