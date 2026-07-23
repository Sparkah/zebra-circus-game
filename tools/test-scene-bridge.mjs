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

async function postPreview(updates) {
  return page.evaluate(async (sceneUpdates) => {
    window.__zebraBridgeTest ??= { nonce: "zebra-scene-bridge-test", revision: 0 };
    const bridge = window.__zebraBridgeTest;
    bridge.revision += 1;
    const next = JSON.parse(JSON.stringify(runtimeSceneDocument));
    for (const [id, update] of Object.entries(sceneUpdates)) {
      const object = next.objects.find((entry) => entry.id === id);
      if (!object) throw new Error(`Unknown test object ${id}`);
      if (update.position) Object.assign(object.position, update.position);
      if (update.rotation) Object.assign(object.rotation, update.rotation);
      if (update.scale) Object.assign(object.scale, update.scale);
    }
    // Studio deliberately sends a slim preview without multi-megabyte assets
    // or project-level arrays; the runtime preserves its validated Move action.
    delete next.inputActions;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Preview ACK timed out")), 3000);
      const onMessage = (event) => {
        if (event.data?.protocol !== "game-port-runtime/v1"
          || event.data?.nonce !== bridge.nonce
          || event.data?.revision !== bridge.revision) return;
        if (event.data?.type === "game-port-studio:scene-preview-rejected") {
          clearTimeout(timer);
          window.removeEventListener("message", onMessage);
          reject(new Error(`Preview rejected: ${event.data.error}`));
          return;
        }
        if (event.data?.type !== "game-port-studio:scene-preview-applied") return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(event.data);
      };
      window.addEventListener("message", onMessage);
      window.postMessage({
        type: "game-port-studio:scene-preview",
        protocol: "game-port-runtime/v1",
        nonce: bridge.nonce,
        revision: bridge.revision,
        scene: next,
      }, location.origin);
    });
  }, updates);
}

try {
  const baseUrl = process.env.ZEBRA_URL ?? "http://127.0.0.1:8765";
  const editorOrigin = new URL(baseUrl).origin;
  await page.goto(`${baseUrl}/?editorOrigin=${encodeURIComponent(editorOrigin)}&bridge-test=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).sceneSource === "zebra-circus.scene.json");

  const rejected = await page.evaluate(async () => {
    const before = layoutObject("main-camera").position.x;
    const forged = JSON.parse(JSON.stringify(runtimeSceneDocument));
    forged.objects.find((entry) => entry.id === "main-camera").position.x = 777;
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://evil.example",
      source: window,
      data: { type: "game-port-studio:scene-preview", scene: forged },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { before, after: layoutObject("main-camera").position.x };
  });
  if (rejected.after !== rejected.before) throw new Error(`Untrusted origin changed the scene: ${JSON.stringify(rejected)}`);

  const invalidShape = await page.evaluate(async () => {
    const before = layoutObject("main-camera").position.x;
    const malformed = JSON.parse(JSON.stringify(runtimeSceneDocument));
    malformed.objects = malformed.objects.filter((entry) => entry.id !== "tent");
    malformed.objects.find((entry) => entry.id === "main-camera").position.x = 555;
    window.postMessage({
      type: "game-port-studio:scene-preview",
      protocol: "game-port-runtime/v1",
      nonce: "zebra-invalid-shape-test",
      revision: 0,
      scene: malformed,
    }, location.origin);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { before, after: layoutObject("main-camera").position.x };
  });
  if (invalidShape.after !== invalidShape.before) throw new Error(`Malformed same-origin scene changed the runtime: ${JSON.stringify(invalidShape)}`);

  const beforeStartAck = await postPreview({
    "main-camera": { position: { x: 3.25 } },
  });
  if (beforeStartAck.objectCount !== 222) throw new Error(`Unexpected pre-start ACK: ${JSON.stringify(beforeStartAck)}`);

  await page.locator("#play-btn").click({ timeout: 30_000 });
  await page.locator("#tut-go-btn").click();
  await page.waitForFunction(() => gameActive && weaponObjs.length === 4 && qrObjs.length === 4 && runtimeColliders.length === 14);

  const liveAck = await postPreview({
    "main-camera": { position: { x: 4.25 } },
    "weapon-mc9400": { position: { x: 3 } },
    "barrel-0": { position: { x: 10, z: 10 } },
  });
  if (liveAck.objectCount !== 222) throw new Error(`Unexpected live ACK: ${JSON.stringify(liveAck)}`);

  const result = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text());
    const mc9400 = weaponObjs.find((entry) => entry.editorId === "weapon-mc9400");
    return {
      source: state.sceneSource,
      player: state.player,
      layoutPlayer: state.layout.find((entry) => entry.id === "main-camera")?.position,
      weaponX: mc9400?.mesh.position.x,
      obstacleCount: state.obstacles.length,
      barrelBlocksPlayer: !canPlayerOccupy(new THREE.Vector3(10, playerHeight, 10)),
      gameplay: { balloons: state.balloons, qrBoards: qrObjs.length, weapons: weaponObjs.length, score: state.score },
    };
  });

  if (result.source !== "live-editor") throw new Error(`Live scene source not reported: ${JSON.stringify(result)}`);
  if (result.player.x !== 4.25 || result.layoutPlayer.x !== 4.25) throw new Error(`Player transform was not applied live: ${JSON.stringify(result)}`);
  if (result.weaponX !== 3) throw new Error(`Weapon transform was not applied live: ${JSON.stringify(result)}`);
  if (!result.barrelBlocksPlayer || result.obstacleCount !== 14) throw new Error(`Collider preview was not applied: ${JSON.stringify(result)}`);
  if (result.gameplay.balloons.alive !== 28 || result.gameplay.qrBoards !== 4 || result.gameplay.weapons !== 4 || result.gameplay.score !== 0) {
    throw new Error(`Gameplay did not survive a live scene update: ${JSON.stringify(result)}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  if (badResponses.length) throw new Error(`HTTP errors: ${badResponses.join("; ")}`);

  const outputDir = fileURLToPath(new URL("../test-output/", import.meta.url));
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, "live-scene-bridge.png"), fullPage: true });
  console.log(JSON.stringify({ rejected, invalidShape, beforeStartAck, liveAck, result }, null, 2));
} finally {
  await browser.close();
}
