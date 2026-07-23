import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importGamePortStudioModule } from "./game-port-studio-path.mjs";

const { chromium } = await importGamePortStudioModule("playwright/index.mjs");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const badResponses = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
});

try {
  const baseUrl = process.env.ZEBRA_URL ?? "http://127.0.0.1:8765";
  await page.goto(`${baseUrl}/?scan-regression=${Date.now()}`, { waitUntil: "networkidle" });
  await page.locator("#play-btn").click({ timeout: 30_000 });
  await page.locator("#tut-go-btn").click();
  await page.waitForFunction(() => gameActive && qrObjs.length === 4 && balloons.length === 28);

  await page.evaluate(() => {
    const canvas = document.querySelector("#game-canvas");
    let simulatedLockElement = canvas;
    window.__pointerLockChanges = 0;
    Object.defineProperty(document, "pointerLockElement", {
      configurable: true,
      get: () => simulatedLockElement,
    });
    Object.defineProperty(document, "exitPointerLock", {
      configurable: true,
      value: () => {
        simulatedLockElement = null;
        document.dispatchEvent(new Event("pointerlockchange"));
      },
    });
    Object.defineProperty(canvas, "requestPointerLock", {
      configurable: true,
      value: () => {
        simulatedLockElement = canvas;
        document.dispatchEvent(new Event("pointerlockchange"));
        return Promise.resolve();
      },
    });
    document.addEventListener("pointerlockchange", () => { window.__pointerLockChanges += 1; });
    document.dispatchEvent(new Event("pointerlockchange"));
    scanQR(qrObjs[0]);
  });

  await page.waitForFunction(() => infoOpen && !isLocked);
  await page.locator("#ip-close").click();
  await page.waitForFunction(() => !infoOpen && isLocked && document.pointerLockElement === document.querySelector("#game-canvas"));

  const before = await page.evaluate(() => ({ x: camera.position.x, z: camera.position.z }));
  await page.keyboard.down("w");
  await page.evaluate(() => window.advanceTime(500));
  await page.keyboard.up("w");
  const result = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text());
    return {
      panelClosed: document.querySelector("#info-panel").style.display === "none",
      infoClosed: infoOpen === false,
      pointerLockChanges: window.__pointerLockChanges,
      isLocked,
      pointerElementIsCanvas: document.pointerLockElement === document.querySelector("#game-canvas"),
      player: state.player,
      score: state.score,
      scanned: state.scan.scanned,
      sceneSource: state.sceneSource,
    };
  });

  if (!result.panelClosed || !result.infoClosed || !result.isLocked || !result.pointerElementIsCanvas) {
    throw new Error(`Scan close did not restore lock: ${JSON.stringify(result)}`);
  }
  if (result.pointerLockChanges < 3) throw new Error(`Expected lock -> unlock -> relock events, got ${result.pointerLockChanges}`);
  if (result.player.z >= before.z - 0.5) throw new Error(`W movement did not resume: before=${JSON.stringify(before)} after=${JSON.stringify(result.player)}`);
  if (result.score !== 50 || !result.scanned.includes("MC9400")) throw new Error(`Real scan state was not preserved: ${JSON.stringify(result)}`);
  if (result.sceneSource !== "zebra-circus.scene.json") throw new Error(`External scene was not loaded: ${result.sceneSource}`);

  // Pointer Lock can be rejected in constrained embeds and headless browsers.
  // The rejection must be handled and keyboard movement must remain available.
  const fallbackBefore = await page.evaluate(() => {
    camera.position.set(10, playerHeight, 5);
    document.exitPointerLock();
    pointerLockFallback = false;
    const canvas = document.querySelector("#game-canvas");
    Object.defineProperty(canvas, "requestPointerLock", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Pointer lock unavailable", "NotAllowedError")),
    });
    requestGamePointerLock();
    return { x: camera.position.x, z: camera.position.z };
  });
  await page.waitForFunction(() => pointerLockFallback && !isLocked);
  await page.keyboard.down("w");
  await page.evaluate(() => window.advanceTime(500));
  await page.keyboard.up("w");
  const fallbackResult = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text());
    return { player: state.player, lock: state.lock };
  });
  if (fallbackResult.player.z >= fallbackBefore.z - 0.5 || !fallbackResult.lock.keyboardFallback) {
    throw new Error(`Pointer-lock fallback did not preserve movement: before=${JSON.stringify(fallbackBefore)} after=${JSON.stringify(fallbackResult)}`);
  }

  // Exercise the existing pickup and firing paths with genuine player inputs.
  await page.evaluate(() => camera.position.set(4, playerHeight, 0));
  await page.keyboard.press("e");
  await page.waitForFunction(() => collected.has(0) && currentWeapon === 0);
  await page.evaluate(() => {
    yaw = 0;
    pitch = 0;
    camera.rotation.set(0, 0, 0);
    lastShot = -Infinity;
    const target = balloons.find((balloon) => balloon.alive);
    target.mesh.position.set(camera.position.x, camera.position.y, camera.position.z - 5);
    target.mesh.visible = true;
    target.mesh.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  });
  const canvasBox = await page.locator("#game-canvas").boundingBox();
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.waitForFunction(() => score === 60 && balloons.filter((balloon) => balloon.alive).length === 27);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).crowd === 28);
  const gameplay = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text());
    return { weapon: state.weapon, collected: state.collected, score: state.score, balloons: state.balloons, crowd: state.crowd };
  });
  if (gameplay.weapon !== "MC9400" || !gameplay.collected.includes("MC9400") || gameplay.score !== 60 || gameplay.crowd !== 28) {
    throw new Error(`Core gameplay regression: ${JSON.stringify(gameplay)}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  if (badResponses.length) throw new Error(`HTTP errors: ${badResponses.join("; ")}`);

  const outputDir = fileURLToPath(new URL("../test-output/", import.meta.url));
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, "scan-close-movement.png"), fullPage: true });
  console.log(JSON.stringify({ scanClose: result, pointerLockFallback: fallbackResult, gameplay }, null, 2));
} finally {
  await browser.close();
}
