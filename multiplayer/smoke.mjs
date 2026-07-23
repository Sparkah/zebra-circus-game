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

// Leave notification.
clearInterval(streamer);
beta.socket.close();
const leave = await alpha.waitFor((m) => m.type === "leave", 6000);
check("alpha notified of beta leave", leave.id === betaWelcome.id);

alpha.socket.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
