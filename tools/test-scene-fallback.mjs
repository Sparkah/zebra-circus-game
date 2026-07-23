import { importGamePortStudioModule } from "./game-port-studio-path.mjs";

const { chromium } = await importGamePortStudioModule("playwright/index.mjs");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.route("**/zebra-circus.scene.json?runtime=*", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: "not valid json",
}));

try {
  const baseUrl = process.env.ZEBRA_URL ?? "http://127.0.0.1:8765";
  await page.goto(`${baseUrl}/?fallback-test=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).sceneSource === "embedded");
  await page.locator("#play-btn").click({ timeout: 30_000 });
  await page.locator("#tut-go-btn").click();
  await page.waitForFunction(() => gameActive && runtimeColliders.length === 14);
  const result = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text());
    const playerLayout = runtimeSceneDocument.objects.find((entry) => entry.id === "main-camera");
    return {
      source: state.sceneSource,
      objectCount: runtimeSceneDocument.objects.length,
      colliderObstacles: state.obstacles.length,
      playerHasMove: playerLayout.components.some((component) => component.type === "move-from-input" && component.enabled),
      playerHasCollider: playerLayout.components.some((component) => component.type === "box-collider" && component.enabled && !component.isTrigger),
      gameplay: { balloons: balloons.length, weapons: weaponObjs.length, qrBoards: qrObjs.length },
    };
  });
  if (result.source !== "embedded" || result.objectCount !== 23 || result.colliderObstacles !== 14 || !result.playerHasMove || !result.playerHasCollider) {
    throw new Error(`Embedded fallback is incomplete: ${JSON.stringify(result)}`);
  }
  if (result.gameplay.balloons !== 28 || result.gameplay.weapons !== 4 || result.gameplay.qrBoards !== 4) {
    throw new Error(`Fallback gameplay did not initialize: ${JSON.stringify(result)}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
