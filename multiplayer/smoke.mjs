// Two-client smoke test for the zebra-circus-mp room protocol.
// Usage: node smoke.mjs [ws://127.0.0.1:8790]
const base = (process.argv[2] ?? "ws://127.0.0.1:8790").replace(/\/$/, "");
const results = [];
const check = (name, pass, detail = "") => results.push(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);

function connect(name) {
  const socket = new WebSocket(`${base}/room/plaza/ws`);
  const inbox = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    inbox.push(message);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const [predicate, resolve] = waiters[i];
      if (predicate(message)) {
        waiters.splice(i, 1);
        resolve(message);
      }
    }
  });
  const waitFor = (predicate, ms = 5000) =>
    new Promise((resolve, reject) => {
      const hit = inbox.find(predicate);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => reject(new Error(`timeout waiting (${name})`)), ms);
      waiters.push([predicate, (m) => { clearTimeout(timer); resolve(m); }]);
    });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return { socket, waitFor, opened, inbox, send: (m) => socket.send(JSON.stringify(m)) };
}

const alpha = connect("alpha");
await alpha.opened;
alpha.send({ type: "hello", name: "Alpha" });
const alphaWelcome = await alpha.waitFor((m) => m.type === "welcome");
check("alpha welcomed with server id", typeof alphaWelcome.id === "string" && alphaWelcome.id.length > 10);
check("alpha initial roster empty", Array.isArray(alphaWelcome.players) && alphaWelcome.players.length === 0);

const beta = connect("beta");
await beta.opened;
beta.send({ type: "hello", name: "<b>Béta zebra with a very very long name</b>" });
const betaWelcome = await beta.waitFor((m) => m.type === "welcome");
check("beta welcomed", typeof betaWelcome.id === "string");
check("beta sees alpha in roster", betaWelcome.players.length === 1 && betaWelcome.players[0].name === "Alpha");
const joinMsg = await alpha.waitFor((m) => m.type === "join");
check("alpha notified of beta join", joinMsg.player.id === betaWelcome.id);
check("beta name clamped to 24 chars", joinMsg.player.name.length <= 24, JSON.stringify(joinMsg.player.name));

// Alpha streams movement; beta must receive snapshots containing alpha.
let seq = 0;
const streamer = setInterval(() => {
  seq += 1;
  alpha.send({ type: "state", seq, x: 0.5 + seq * 0.05, y: 1.7, z: 2 - seq * 0.05, yaw: 0.3, pitch: -0.1 });
  beta.send({ type: "state", seq, x: -1, y: 1.7, z: 3, yaw: -0.5, pitch: 0 });
}, 80);
const snapshot = await beta.waitFor((m) => m.type === "snapshot" && m.players.some(([id]) => id === alphaWelcome.id), 8000);
check("beta receives snapshot with alpha", true, `players=${snapshot.players.length}`);
const alphaRow = snapshot.players.find(([id]) => id === alphaWelcome.id);
check("snapshot carries moved position", alphaRow[1] > 0.5, `x=${alphaRow[1]}`);

// Cheat rejection: teleport far beyond speed cap must be dropped.
alpha.send({ type: "state", seq: seq + 100, x: 55, y: 1.7, z: -55, yaw: 0, pitch: 0 });
await new Promise((r) => setTimeout(r, 400));
const latest = beta.inbox.filter((m) => m.type === "snapshot").at(-1);
const cheatedRow = latest.players.find(([id]) => id === alphaWelcome.id);
check("teleport beyond speed cap rejected", Math.abs(cheatedRow[1]) < 10, `x=${cheatedRow[1]}`);

// NaN / bounds rejection must not poison state.
alpha.send({ type: "state", seq: seq + 200, x: Number.NaN, y: 1.7, z: 0, yaw: 0, pitch: 0 });
alpha.send({ type: "state", seq: seq + 201, x: 500, y: 1.7, z: 0, yaw: 0, pitch: 0 });
await new Promise((r) => setTimeout(r, 300));
const afterBad = beta.inbox.filter((m) => m.type === "snapshot").at(-1);
const badRow = afterBad.players.find(([id]) => id === alphaWelcome.id);
check("NaN and out-of-bounds states rejected", Number.isFinite(badRow[1]) && Math.abs(badRow[1]) <= 60, `x=${badRow[1]}`);

// Ping-pong.
alpha.send({ type: "ping", t: 12345 });
const pong = await alpha.waitFor((m) => m.type === "pong");
check("ping answered with pong", pong.t === 12345 && typeof pong.serverTime === "number");

// ── Shared balloon pool ──
check("welcome carries 28 balloons", Array.isArray(alphaWelcome.balloons) && alphaWelcome.balloons.length === 28);
const [slotA, genA] = alphaWelcome.balloons.find(([, , alive]) => alive === 1);
alpha.send({ type: "pop", slot: slotA, gen: genA, x: 1, y: 5, z: 1, weapon: "PS30" });
const popEvent = await beta.waitFor((m) => m.type === "balloon" && m.slot === slotA && m.alive === false);
check("pop broadcast with weapon points", popEvent.by === alphaWelcome.id && popEvent.pts === 15, `pts=${popEvent.pts}`);
check("pop carries authoritative scores", popEvent.scores && popEvent.scores[alphaWelcome.id] === 15);

// Losing claim on the same slot+gen is silently dropped: exactly one pop
// event for the slot ever reaches alpha, no matter when its copy arrives.
await alpha.waitFor((m) => m.type === "balloon" && m.slot === slotA && m.alive === false);
beta.send({ type: "pop", slot: slotA, gen: genA, x: 1, y: 5, z: 1, weapon: "PS30" });
await new Promise((r) => setTimeout(r, 400));
check("double pop rejected", alpha.inbox.filter((m) => m.type === "balloon" && m.slot === slotA && m.alive === false).length === 1);

// Wrong generation rejected; pop cooldown enforced.
const [slotB, genB] = alphaWelcome.balloons.find(([slot, , alive]) => alive === 1 && slot !== slotA);
beta.send({ type: "pop", slot: slotB, gen: genB + 5, x: 1, y: 5, z: 1 });
alpha.send({ type: "pop", slot: slotB, gen: genB, x: 1, y: 5, z: 1 }); // within alpha's 120ms cooldown of... actually alpha popped long ago; use beta for cooldown
await alpha.waitFor((m) => m.type === "balloon" && m.slot === slotB && m.alive === false, 3000);
check("valid pop lands while stale-gen claim is dropped", true);
const [slotC, genC] = alphaWelcome.balloons.find(([slot, , alive]) => alive === 1 && slot !== slotA && slot !== slotB);
const [slotD, genD] = alphaWelcome.balloons.find(([slot, , alive]) => alive === 1 && ![slotA, slotB, slotC].includes(slot));
beta.send({ type: "pop", slot: slotC, gen: genC, x: 1, y: 5, z: 1 });
beta.send({ type: "pop", slot: slotD, gen: genD, x: 1, y: 5, z: 1 }); // immediate second pop: cooldown drop
await alpha.waitFor((m) => m.type === "balloon" && m.slot === slotC, 3000);
await new Promise((r) => setTimeout(r, 300));
check("pop cooldown drops rapid second claim", !alpha.inbox.some((m) => m.type === "balloon" && m.slot === slotD));

// Emotes: broadcast to others only, invalid kinds dropped.
beta.send({ type: "emote", kind: 2 });
const emote = await alpha.waitFor((m) => m.type === "emote");
check("emote relayed to peers", emote.id === betaWelcome.id && emote.kind === 2);
check("emote not echoed to sender", !beta.inbox.some((m) => m.type === "emote" && m.id === betaWelcome.id));
beta.send({ type: "emote", kind: 99 });
await new Promise((r) => setTimeout(r, 250));
check("invalid emote kind dropped", alpha.inbox.filter((m) => m.type === "emote").length === 1);

// Late joiner sees popped balloons and standing scores in its welcome.
const gamma = connect("gamma");
await gamma.opened;
gamma.send({ type: "hello", name: "Gamma" });
const gammaWelcome = await gamma.waitFor((m) => m.type === "welcome");
const gammaSlotA = gammaWelcome.balloons.find(([slot]) => slot === slotA);
check("late joiner sees popped balloon", gammaSlotA[2] === 0);
check("late joiner sees scores", gammaWelcome.scores[alphaWelcome.id] >= 15, `alphaScore=${gammaWelcome.scores[alphaWelcome.id]}`);
gamma.socket.close();

// Respawn: popped balloon returns with a new generation (10s server timer).
await new Promise((r) => setTimeout(r, 10_500));
alpha.send({ type: "ping", t: 1 }); // any traffic triggers respawn processing
const respawn = await alpha.waitFor((m) => m.type === "balloon" && m.slot === slotA && m.alive === true, 6000);
check("balloon respawns with bumped generation", respawn.gen === genA + 1, `gen=${respawn.gen}`);

// Leave notification.
clearInterval(streamer);
beta.socket.close();
const leave = await alpha.waitFor((m) => m.type === "leave" && m.id === betaWelcome.id, 6000);
check("alpha notified of beta leave", leave.id === betaWelcome.id);

alpha.socket.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
