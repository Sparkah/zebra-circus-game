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
