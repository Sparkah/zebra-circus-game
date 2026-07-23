/**
 * zebra-circus-mp - shared-plaza multiplayer relay for Zebra Circus Blaster.
 *
 * One Durable Object instance per room holds ONLY in-memory state (no SQLite
 * rows, no R2): the authoritative roster of connected players and their last
 * accepted transforms. Movement is client-authoritative with server sanity
 * checks; the DO merges everything into one snapshot broadcast, flushed
 * opportunistically from inbound traffic so no timer keeps the object awake.
 *
 * Deliberately NOT here (phase 3+): shared balloon pool, scores, emotes.
 */

const MAX_PLAYERS_PER_ROOM = 8;
const OVERFLOW_ROOMS = 4; // plaza, plaza-2 .. plaza-5
const SNAPSHOT_INTERVAL_MS = 70; // ~14Hz ceiling, driven by inbound traffic
const STALE_SOCKET_MS = 60_000;
const MAX_MESSAGE_BYTES = 4096;
const MAX_NAME_LENGTH = 24;
const WORLD_BOUND_XZ = 60;
const WORLD_BOUND_Y_MIN = -5;
const WORLD_BOUND_Y_MAX = 20;
const MAX_SPEED_UNITS_PER_SEC = 20; // player walks at 6; generous for lag bursts
const MIN_STATE_INTERVAL_MS = 25; // hard inbound cap ~40Hz per connection

const DEFAULT_ALLOWED_ORIGIN_SUFFIXES = [
  "zebra-circus-game.vercel.app",
  "zebra-scene-editor.timofeymarkin98.workers.dev",
  "zebra-circus-mp.timofeymarkin98.workers.dev",
];

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // non-browser smoke clients; the room is unlisted, not secret
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1") return true;
  const extra = (env.MP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGIN_SUFFIXES, ...extra].some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function roomNameForIndex(index) {
  return index === 0 ? "plaza" : `plaza-${index + 1}`;
}

function sanitizeRoomName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(name) ? name : null;
}

function sanitizeDisplayName(raw) {
  if (typeof raw !== "string") return "Guest";
  const cleaned = [...raw]
    .filter((ch) => ch.codePointAt(0) >= 0x20 && ch.codePointAt(0) !== 0x7f)
    .join("")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || "Guest";
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function corsHeadersFor(request) {
  const origin = request.headers.get("Origin");
  return origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeadersFor(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "zebra-circus-mp" }, { headers: cors });
    }
    if (!originAllowed(request, env)) {
      return Response.json({ error: "origin_not_allowed" }, { status: 403 });
    }
    if (url.pathname === "/join") {
      const preferred = sanitizeRoomName(url.searchParams.get("room"));
      if (preferred) {
        const stub = env.PLAZA.get(env.PLAZA.idFromName(preferred));
        const occupancy = await stub.fetch("https://room/occupancy").then((r) => r.json());
        if (occupancy.players < MAX_PLAYERS_PER_ROOM) {
          return Response.json({ room: preferred }, { headers: cors });
        }
        return Response.json({ error: "room_full", room: preferred }, { status: 409, headers: cors });
      }
      for (let index = 0; index < OVERFLOW_ROOMS; index += 1) {
        const room = roomNameForIndex(index);
        const stub = env.PLAZA.get(env.PLAZA.idFromName(room));
        const occupancy = await stub.fetch("https://room/occupancy").then((r) => r.json());
        if (occupancy.players < MAX_PLAYERS_PER_ROOM) {
          return Response.json({ room }, { headers: cors });
        }
      }
      return Response.json({ error: "all_rooms_full" }, { status: 503, headers: cors });
    }
    const wsMatch = url.pathname.match(/^\/room\/([a-z0-9][a-z0-9-]{0,31})\/ws$/);
    if (wsMatch) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return Response.json({ error: "websocket_required" }, { status: 426 });
      }
      const stub = env.PLAZA.get(env.PLAZA.idFromName(wsMatch[1]));
      return stub.fetch(request);
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
};

export class ZebraPlazaRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.lastFlush = 0;
    // In-memory only. After hibernation the constructor reruns; rebuild the
    // roster from the socket attachments that survived it.
    this.players = new Map();
    for (const socket of this.ctx.getWebSockets()) {
      const attached = socket.deserializeAttachment();
      if (attached?.id) this.players.set(attached.id, { ...attached, socket });
    }
  }

  playerCount() {
    let count = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.READY_STATE_OPEN || socket.readyState === 1) count += 1;
    }
    return count;
  }

  sweepStaleSockets(now) {
    // Runs on allocation paths as well as the snapshot flush: a room holding
    // only ghost sockets receives no inbound traffic, and without this it
    // would report itself full forever.
    for (const socket of this.ctx.getWebSockets()) {
      const player = this.playerForSocket(socket);
      if (player && now - player.lastSeenAt > STALE_SOCKET_MS) this.dropSocket(socket);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.sweepStaleSockets(Date.now());
    if (url.pathname === "/occupancy") {
      return Response.json({ players: this.playerCount() });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "websocket_required" }, { status: 426 });
    }
    if (this.playerCount() >= MAX_PLAYERS_PER_ROOM) {
      return Response.json({ error: "room_full" }, { status: 409 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    const player = {
      id,
      name: "Guest",
      x: 0,
      y: 1.7,
      z: 2,
      yaw: 0,
      pitch: 0,
      seq: 0,
      lastStateAt: 0,
      lastSeenAt: Date.now(),
      hello: false,
    };
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment(this.attachmentFor(player));
    this.players.set(id, { ...player, socket: server });
    return new Response(null, { status: 101, webSocket: client });
  }

  attachmentFor(player) {
    const { socket, ...plain } = player;
    return plain;
  }

  playerForSocket(socket) {
    const tag = this.ctx.getTags(socket)[0];
    if (!tag) return null;
    let player = this.players.get(tag);
    if (!player) {
      const attached = socket.deserializeAttachment();
      if (!attached?.id) return null;
      player = { ...attached, socket };
      this.players.set(attached.id, player);
    }
    player.socket = socket;
    return player;
  }

  webSocketMessage(socket, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return;
    const player = this.playerForSocket(socket);
    if (!player) return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    player.lastSeenAt = now;
    if (message.type === "hello" && !player.hello) {
      player.hello = true;
      player.name = sanitizeDisplayName(message.name);
      const spawn = this.spawnFor(this.playerCount());
      player.x = spawn.x;
      player.z = spawn.z;
      socket.serializeAttachment(this.attachmentFor(player));
      this.send(socket, {
        type: "welcome",
        id: player.id,
        room: this.roomLabel ?? null,
        serverTime: now,
        spawn,
        players: this.rosterExcept(player.id),
      });
      this.broadcastExcept(player.id, {
        type: "join",
        player: this.publicPlayer(player),
      });
      return;
    }
    if (message.type === "state" && player.hello) {
      if (now - player.lastStateAt < MIN_STATE_INTERVAL_MS) return;
      const seq = finiteOrNull(message.seq);
      if (seq === null || seq <= player.seq) return;
      const x = finiteOrNull(message.x);
      const y = finiteOrNull(message.y);
      const z = finiteOrNull(message.z);
      const yaw = finiteOrNull(message.yaw);
      const pitch = finiteOrNull(message.pitch);
      if (x === null || y === null || z === null || yaw === null || pitch === null) return;
      if (Math.abs(x) > WORLD_BOUND_XZ || Math.abs(z) > WORLD_BOUND_XZ) return;
      if (y < WORLD_BOUND_Y_MIN || y > WORLD_BOUND_Y_MAX) return;
      const elapsedSec = Math.max((now - (player.lastStateAt || now)) / 1000, 0.016);
      const dx = x - player.x;
      const dz = z - player.z;
      const distance = Math.hypot(dx, dz);
      if (player.lastStateAt && distance / elapsedSec > MAX_SPEED_UNITS_PER_SEC) return;
      player.x = x;
      player.y = y;
      player.z = z;
      player.yaw = ((yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      player.pitch = Math.max(-1.6, Math.min(1.6, pitch));
      player.seq = seq;
      player.lastStateAt = now;
      socket.serializeAttachment(this.attachmentFor(player));
      this.flushSnapshots(now);
      return;
    }
    if (message.type === "ping") {
      this.send(socket, { type: "pong", t: finiteOrNull(message.t) ?? 0, serverTime: now });
      this.flushSnapshots(now);
    }
  }

  webSocketClose(socket) {
    this.dropSocket(socket);
  }

  webSocketError(socket) {
    this.dropSocket(socket);
  }

  dropSocket(socket) {
    const tag = this.ctx.getTags(socket)[0];
    if (!tag) return;
    const player = this.players.get(tag);
    this.players.delete(tag);
    try {
      socket.close(1000, "bye");
    } catch {
      // Already closed.
    }
    if (player?.hello) this.broadcastExcept(tag, { type: "leave", id: tag });
  }

  spawnFor(index) {
    // Spread joiners on a small arc behind the default player start so two
    // players never fuse into one another on arrival.
    const angle = (index % MAX_PLAYERS_PER_ROOM) * (Math.PI / 5) - Math.PI / 2.5;
    return { x: Math.sin(angle) * 2.2, y: 1.7, z: 2 + Math.cos(angle) * 1.4 };
  }

  publicPlayer(player) {
    return {
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
    };
  }

  rosterExcept(exceptId) {
    const roster = [];
    for (const socket of this.ctx.getWebSockets()) {
      const player = this.playerForSocket(socket);
      if (player && player.hello && player.id !== exceptId) roster.push(this.publicPlayer(player));
    }
    return roster;
  }

  send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Socket went away between roster scan and send.
    }
  }

  broadcastExcept(exceptId, message) {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      const tag = this.ctx.getTags(socket)[0];
      if (!tag || tag === exceptId) continue;
      try {
        socket.send(encoded);
      } catch {
        // Skip dead sockets; close events reap them.
      }
    }
  }

  flushSnapshots(now) {
    if (now - this.lastFlush < SNAPSHOT_INTERVAL_MS) return;
    this.lastFlush = now;
    const sockets = this.ctx.getWebSockets();
    if (sockets.length < 2) return;
    this.sweepStaleSockets(now);
    const players = [];
    for (const socket of sockets) {
      const player = this.playerForSocket(socket);
      if (!player || !player.hello) continue;
      if (!this.players.has(player.id)) continue;
      players.push([
        player.id,
        Math.round(player.x * 100) / 100,
        Math.round(player.y * 100) / 100,
        Math.round(player.z * 100) / 100,
        Math.round(player.yaw * 1000) / 1000,
        Math.round(player.pitch * 1000) / 1000,
      ]);
    }
    if (players.length < 2) return;
    const encoded = JSON.stringify({ type: "snapshot", t: now, players });
    for (const socket of sockets) {
      try {
        socket.send(encoded);
      } catch {
        // Skip dead sockets.
      }
    }
  }
}
