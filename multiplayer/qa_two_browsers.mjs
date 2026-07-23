// Two-browser multiplayer QA: both clients join the plaza, Alpha walks,
// Beta must see Alpha's avatar move. Run with the game served on :8765 and
// the MP worker on :8790 (wrangler dev).
// Usage: node multiplayer/qa_two_browsers.mjs
import { importGamePortStudioModule } from "../tools/game-port-studio-path.mjs";

const { chromium } = await importGamePortStudioModule("playwright/index.mjs");
const OUT = process.env.MP_QA_OUT || "test-output";
const GAME = process.env.MP_QA_GAME || "http://127.0.0.1:8765";
const WS = process.env.MP_QA_WS || "ws://127.0.0.1:8790";
const results = [];
const check = (name, pass, detail = "") => results.push(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);

const browser = await chromium.launch({ headless: true });

async function boot(name) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.goto(`${GAME}/?mp=1&mpUrl=${encodeURIComponent(WS)}&mpName=${name}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#play-btn", { state: "visible", timeout: 20000 });
  await page.click("#play-btn");
  await page.waitForSelector("#tut-go-btn", { state: "visible", timeout: 10000 });
  await page.click("#tut-go-btn");
  // Movement is gated on pointer lock (or its fallback), which is only
  // requested on a canvas click.
  await page.mouse.click(450, 300);
  await page.waitForTimeout(400);
  return page;
}

const alpha = await boot("Alpha");
const beta = await boot("Beta");
await beta.waitForTimeout(3500);

const alphaDebug = await alpha.evaluate(() => window.__mpDebug());
const betaDebug = await beta.evaluate(() => window.__mpDebug());
check("alpha connected to plaza", alphaDebug.connected && alphaDebug.room === "plaza", JSON.stringify({ room: alphaDebug.room }));
check("beta connected to plaza", betaDebug.connected && betaDebug.room === "plaza");
check("alpha sees exactly one remote", alphaDebug.remotes.length === 1, `remotes=${alphaDebug.remotes.length}`);
check("beta sees exactly one remote", betaDebug.remotes.length === 1, `remotes=${betaDebug.remotes.length}`);

await alpha.waitForTimeout(2500);
const betaModel = await beta.evaluate(() => window.__mpDebug().remotes[0]?.hasModel === true);
check("beta's remote avatar model loaded", betaModel);

const before = await beta.evaluate(() => {
  const r = window.__mpDebug().remotes[0];
  return { x: r.x, z: r.z };
});
// Alpha walks forward for 1.6 seconds.
await alpha.keyboard.down("w");
await alpha.waitForTimeout(1600);
await alpha.keyboard.up("w");
await beta.waitForTimeout(800);
const after = await beta.evaluate(() => {
  const r = window.__mpDebug().remotes[0];
  return { x: r.x, z: r.z };
});
const movedDistance = Math.hypot(after.x - before.x, after.z - before.z);
check("beta observed alpha walking", movedDistance > 1, `moved=${movedDistance.toFixed(2)} units`);

// ── Shared balloons: Alpha walks to a weapon pickup (E), aims at a real
// balloon (iterative drag-look) and shoots with a real click; both clients
// must agree it popped and the scoreboard must credit Alpha.
async function playerState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}
async function rotateTo(page, desiredYaw) {
  for (let i = 0; i < 4; i += 1) {
    const state = await playerState(page);
    let diff = desiredYaw - state.player.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) < 0.06) return;
    const dragPx = Math.max(-820, Math.min(820, -diff / 0.0018));
    const startX = dragPx > 0 ? 40 : 860;
    await page.mouse.move(startX, 300);
    await page.mouse.down();
    await page.mouse.move(startX + dragPx, 300, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
}
async function walkToNearestPickup(page) {
  let previous = null;
  for (let step = 0; step < 22; step += 1) {
    const pickups = await page.evaluate(() => window.__mpDebug().pickups.filter((p) => !p.collected));
    if (!pickups.length) return false;
    const state = await playerState(page);
    const me = state.player;
    pickups.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    const target = pickups[0];
    const distance = Math.hypot(target.x - me.x, target.z - me.z);
    if (distance < 2.2) {
      await page.keyboard.press("e");
      await page.waitForTimeout(300);
      const held = (await playerState(page)).weapon;
      if (held) return true;
    }
    if (previous && Math.hypot(me.x - previous.x, me.z - previous.z) < 0.25) {
      // Wedged against a collider head-on: sidestep, then continue.
      await page.keyboard.down("d");
      await page.waitForTimeout(450);
      await page.keyboard.up("d");
    }
    previous = { x: me.x, z: me.z };
    await rotateTo(page, Math.atan2(-(target.x - me.x), -(target.z - me.z)));
    await page.keyboard.down("w");
    await page.waitForTimeout(Math.min(700, Math.max(220, distance * 130)));
    await page.keyboard.up("w");
  }
  return false;
}
const armed = await walkToNearestPickup(alpha);
check("alpha picked up a weapon", armed, JSON.stringify((await playerState(alpha)).weapon));
async function aimAtBalloon(page) {
  for (let i = 0; i < 6; i += 1) {
    const target = await page.evaluate(() => window.__mpDebug().balloonScreens[0] ?? null);
    if (!target) {
      await page.mouse.move(30, 300);
      await page.mouse.down();
      await page.mouse.move(30 + 400, 300, { steps: 10 });
      await page.mouse.up();
      continue;
    }
    if (Math.abs(target.sx - 450) < 20 && Math.abs(target.sy - 300) < 20) return true;
    // Screen offset to look-angle: focal length = (h/2)/tan(fov/2) = 413px at
    // 600px height / FOV 72; fallback look sensitivity is 0.0018 rad/px.
    const dxPx = Math.atan((target.sx - 450) / 413) / 0.0018;
    const dyPx = Math.atan((target.sy - 300) / 413) / 0.0018;
    const startX = dxPx > 0 ? 30 : 870;
    const startY = dyPx > 0 ? 80 : 520;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + Math.max(-800, Math.min(800, dxPx)), startY + Math.max(-400, Math.min(400, dyPx)), { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  return false;
}
async function dismissInfoPanel(page) {
  const open = await page.evaluate(() => document.getElementById("info-panel")?.style.display === "block");
  if (open) {
    await page.click("#ip-close");
    await page.waitForTimeout(250);
  }
}
// Server scores are the authoritative pop evidence; the local alive count
// races the 10s server respawn cycle during this slow QA loop.
let alphaServerScore = 0;
let aimedOnce = false;
for (let attempt = 0; attempt < 4 && alphaServerScore === 0; attempt += 1) {
  await dismissInfoPanel(alpha);
  aimedOnce = (await aimAtBalloon(alpha)) || aimedOnce;
  // The aim drags themselves fire shots (mousedown shoots), so respect the
  // weapon fire-rate cooldown before the deliberate shot.
  await alpha.waitForTimeout(1250);
  await dismissInfoPanel(alpha);
  await alpha.mouse.click(450, 300);
  await alpha.waitForTimeout(1600);
  alphaServerScore = await alpha.evaluate(() => { const d = window.__mpDebug(); return d.scores[d.selfId] ?? 0; });
}
check("alpha aimed at a balloon", aimedOnce);
check("balloon pop confirmed by the room", alphaServerScore > 0, `score=${alphaServerScore}`);
const parity = await Promise.all([alpha, beta].map((page) => page.evaluate(() => window.__mpDebug().balloonsAlive)));
check("balloon state parity across players", parity[0] === parity[1], `alpha=${parity[0]} beta=${parity[1]}`);
const betaSeesScore = await beta.evaluate(() => { const d = window.__mpDebug(); const other = Object.keys(d.scores).find((id) => id !== d.selfId); return d.scores[other] ?? 0; });
check("pop score propagated to the other player", betaSeesScore === alphaServerScore, `beta sees ${betaSeesScore}`);
await dismissInfoPanel(alpha);
const betaBoard = await beta.evaluate(() => document.getElementById("mp-scoreboard")?.textContent ?? "");
check("beta scoreboard credits Alpha", /Alpha · [1-9]/.test(betaBoard), JSON.stringify(betaBoard));

// ── Emote: Alpha presses G, Beta's remote must show it.
await alpha.keyboard.press("g");
await beta.waitForTimeout(700);
const betaSeesEmote = await beta.evaluate(() => window.__mpDebug().remotes[0]?.emoting === true);
check("beta sees alpha's emote", betaSeesEmote);

// Alpha turns ~180 degrees via the drag-look fallback (0.0018 rad/px) to
// face Beta for the shot: two ~90 degree drags.
for (let turn = 0; turn < 2; turn += 1) {
  await alpha.mouse.move(30, 300);
  await alpha.mouse.down();
  await alpha.mouse.move(30 + 872, 300, { steps: 20 });
  await alpha.mouse.up();
  await alpha.waitForTimeout(250);
}
await alpha.waitForTimeout(400);
await alpha.screenshot({ path: `${OUT}/mp_alpha_view.png` });
await beta.screenshot({ path: `${OUT}/mp_beta_view.png` });
const spawnSeparation = await beta.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text());
  const remote = window.__mpDebug().remotes[0];
  return Math.hypot(state.player.x - remote.x, state.player.z - remote.z);
});
check("players not fused at spawn", spawnSeparation > 0.8, `separation=${spawnSeparation.toFixed(2)}`);

// Disconnect propagation.
await alpha.close();
await beta.waitForTimeout(2500);
const afterLeave = await beta.evaluate(() => window.__mpDebug().remotes.length);
check("beta's roster empties after alpha leaves", afterLeave === 0, `remotes=${afterLeave}`);

// Studio authoring mode must never touch multiplayer.
const studio = await browser.newPage({ viewport: { width: 900, height: 600 } });
let studioSockets = 0;
studio.on("websocket", () => { studioSockets += 1; });
await studio.goto(`${GAME}/?mp=1&mpUrl=${encodeURIComponent(WS)}&studioMode=authoring`, { waitUntil: "networkidle" });
await studio.waitForTimeout(4000);
check("authoring mode opens no MP socket", studioSockets === 0, `sockets=${studioSockets}`);
await studio.close();

await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
