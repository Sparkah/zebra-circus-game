import assert from "node:assert/strict";
import test from "node:test";
import { importGamePortStudioModule } from "../tools/game-port-studio-path.mjs";
import {
  ALL_OBJECT_IDS,
  EXPECTED_CATEGORY_IDS,
  EXPECTED_OBJECT_COUNT,
} from "./parity-contract.mjs";

const { chromium } = await importGamePortStudioModule("playwright/index.mjs");

const sorted = (values) => [...values].sort();

function assertEditableInventory(state) {
  assert.equal(state.editable?.expectedCount, EXPECTED_OBJECT_COUNT, "runtime parity contract count drifted");
  assert.equal(state.editable?.documentCount, EXPECTED_OBJECT_COUNT, "text state must report the complete scene document");
  assert.equal(state.editable?.registeredCount, EXPECTED_OBJECT_COUNT, "every authored object must have a runtime registration");
  assert.equal(state.editable?.mappedCount, EXPECTED_OBJECT_COUNT, "every authored object must map to a runtime target");
  assert.deepEqual(state.editable?.missingFromDocument, [], "runtime-required IDs are absent from the scene document");
  assert.deepEqual(state.editable?.missingRuntimeBindings, [], "text state reports unmapped authored objects");
  assert.deepEqual(sorted(state.editable?.registeredIds ?? []), sorted(ALL_OBJECT_IDS), "runtime registrations drifted from the stable authoring IDs");
  assert.deepEqual(sorted(state.editable?.mappedIds ?? []), sorted(ALL_OBJECT_IDS), "runtime mappings drifted from the stable authoring IDs");

  for (const [category, expectedIds] of Object.entries(EXPECTED_CATEGORY_IDS)) {
    const counts = state.editable?.categories?.[category];
    assert.ok(counts, `text state is missing editable category ${category}`);
    assert.equal(counts.expected, expectedIds.length, `${category} expected count is wrong`);
    assert.equal(counts.authored, expectedIds.length, `${category} authored count is wrong`);
    assert.equal(counts.registered, expectedIds.length, `${category} registration count is wrong`);
    assert.equal(counts.mapped, expectedIds.length, `${category} mapping count is wrong`);
  }
}

async function postPreview(page, updates) {
  return page.evaluate(async ({ sceneUpdates, expectedCount }) => {
    const next = JSON.parse(JSON.stringify(runtimeSceneDocument));
    for (const [id, update] of Object.entries(sceneUpdates)) {
      const object = next.objects.find((entry) => entry.id === id);
      if (!object) throw new Error(`Unknown parity-test object ${id}`);
      if (update.position) Object.assign(object.position, update.position);
      if (update.rotation) Object.assign(object.rotation, update.rotation);
      if (update.scale) Object.assign(object.scale, update.scale);
      if (update.collider) {
        const collider = object.components.find((component) => component.type === "box-collider");
        if (!collider) throw new Error(`Parity-test object ${id} has no collider`);
        if (update.collider.center) Object.assign(collider.center, update.collider.center);
        if (update.collider.size) Object.assign(collider.size, update.collider.size);
        if (typeof update.collider.enabled === "boolean") collider.enabled = update.collider.enabled;
        if (typeof update.collider.isTrigger === "boolean") collider.isTrigger = update.collider.isTrigger;
      }
    }

    // Studio sends a slim structured-clone payload. The runtime must preserve
    // its already validated input actions and reject any incomplete inventory.
    delete next.inputActions;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Expanded preview ACK timed out")), 5_000);
      const onMessage = (event) => {
        if (event.origin !== location.origin || event.source !== window) return;
        if (event.data?.type !== "game-port-studio:scene-preview-applied" || event.data?.nonce !== "zebra-runtime-parity") return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (event.data.objectCount !== expectedCount) {
          reject(new Error(`Expanded preview ACK reported ${event.data.objectCount} objects instead of ${expectedCount}`));
          return;
        }
        resolve(event.data);
      };
      window.addEventListener("message", onMessage);
      window.postMessage({
        type: "game-port-studio:scene-preview",
        protocol: "game-port-runtime/v1",
        nonce: "zebra-runtime-parity",
        revision: 1,
        scene: next,
      }, location.origin);
    });
  }, { sceneUpdates: updates, expectedCount: EXPECTED_OBJECT_COUNT });
}

test("expanded runtime maps the full scene, preserves strict live editing, and retains scan-X movement", { timeout: 90_000 }, async () => {
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
    const origin = new URL(baseUrl).origin;
    await page.goto(`${baseUrl}/?editorOrigin=${encodeURIComponent(origin)}&expanded-parity=${Date.now()}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).sceneSource === "zebra-circus.scene.json");
    await page.locator("#play-btn").click({ timeout: 30_000 });
    await page.locator("#tut-go-btn").click();
    await page.waitForFunction((expectedCount) => {
      const state = JSON.parse(window.render_game_to_text());
      return gameActive && state.mode === "playing" && state.editable?.registeredCount === expectedCount;
    }, EXPECTED_OBJECT_COUNT, { timeout: 30_000 });

    const initialState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert.equal(initialState.crowd, 28, "legacy textured-crowd count must remain compatible");
    assert.deepEqual(initialState.crowdPopulations, { procedural: 40, gltf: 28, total: 68 });
    assert.deepEqual(initialState.balloons, { alive: 28, total: 28 });
    assertEditableInventory(initialState);

    // An untrusted origin and an untrusted message source must not mutate even
    // one of the newly authorable objects.
    const rejectedMessages = await page.evaluate(async () => {
      const before = layoutObject("balloon-00").position.x;
      const forged = JSON.parse(JSON.stringify(runtimeSceneDocument));
      forged.objects.find((entry) => entry.id === "balloon-00").position.x = 777;
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://evil.example",
        source: window,
        data: { type: "game-port-studio:scene-preview", scene: forged },
      }));
      window.dispatchEvent(new MessageEvent("message", {
        origin: location.origin,
        source: null,
        data: { type: "game-port-studio:scene-preview", scene: forged },
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { before, after: layoutObject("balloon-00").position.x };
    });
    assert.deepEqual(rejectedMessages, { before: rejectedMessages.before, after: rejectedMessages.before });

    const incompletePreview = await page.evaluate(async () => {
      const before = layoutObject("crowd-gltf-00").position.x;
      const malformed = JSON.parse(JSON.stringify(runtimeSceneDocument));
      malformed.objects = malformed.objects.filter((entry) => entry.id !== "balloon-27");
      malformed.objects.find((entry) => entry.id === "crowd-gltf-00").position.x = 555;
      window.postMessage({
        type: "game-port-studio:scene-preview",
        protocol: "game-port-runtime/v1",
        nonce: "zebra-runtime-parity",
        revision: 1,
        scene: malformed,
      }, location.origin);
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { before, after: layoutObject("crowd-gltf-00").position.x };
    });
    assert.deepEqual(incompletePreview, { before: incompletePreview.before, after: incompletePreview.before }, "incomplete same-origin scene was accepted");

    // Exercise the real scan-close path: X is a user gesture, Pointer Lock is
    // restored, and a genuine W input must move the player immediately.
    await page.evaluate(() => {
      const canvas = document.querySelector("#game-canvas");
      let simulatedLockElement = canvas;
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
      document.dispatchEvent(new Event("pointerlockchange"));
      scanQR(qrObjs[0]);
    });
    await page.waitForFunction(() => infoOpen && !isLocked);
    const beforeMove = await page.evaluate(() => ({ x: camera.position.x, z: camera.position.z }));
    await page.locator("#ip-close").click();
    await page.waitForFunction(() => !infoOpen && isLocked && document.pointerLockElement === document.querySelector("#game-canvas"));
    await page.keyboard.down("w");
    await page.evaluate(() => window.advanceTime(500));
    await page.keyboard.up("w");
    const afterMove = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert.ok(afterMove.player.z < beforeMove.z - 0.5, `W did not resume after scan X: ${JSON.stringify({ beforeMove, after: afterMove.player })}`);
    assert.equal(afterMove.score, 50);
    assert.equal(afterMove.scan.panelOpen, false);
    assert.ok(afterMove.scan.scanned.includes("MC9400"));

    const bridgeUpdates = {
      "bleachers-root": { position: { x: 2 } },
      "bleacher-seat-00": { position: { y: 1.25 } },
      "crowd-gltf-00": { position: { x: 9.25 } },
      "balloon-00": { position: { y: 8.5 } },
      "tent-details": { rotation: { y: 12 } },
      "barrel-0": {
        position: { x: 12, y: 0.5, z: 12 },
        rotation: { y: 37 },
        scale: { x: 1, y: 1, z: 1 },
        collider: {
          center: { x: 0.4, y: 0.8, z: -0.2 },
          size: { x: 2.5, y: 3, z: 1.8 },
          enabled: true,
          isTrigger: false,
        },
      },
    };
    const liveAck = await postPreview(page, bridgeUpdates);
    assert.equal(liveAck.objectCount, EXPECTED_OBJECT_COUNT);

    const liveResult = await page.evaluate(() => {
      const state = JSON.parse(window.render_game_to_text());
      const barrelCollider = runtimeColliders.find((entry) => entry.id === "barrel-0");
      const colliderWorldCenter = barrelCollider.target.localToWorld(new THREE.Vector3(
        barrelCollider.component.center.x,
        barrelCollider.component.center.y,
        barrelCollider.component.center.z,
      ));
      const transform = (id) => {
        const target = editableObjects.get(id);
        return {
          position: roundedVector(target.position),
          rotationY: Math.round(THREE.MathUtils.radToDeg(target.rotation.y) * 100) / 100,
          scale: roundedVector(target.scale),
        };
      };
      return {
        state,
        transforms: {
          bleacher: transform("bleacher-seat-00"),
          crowd: transform("crowd-gltf-00"),
          balloon: transform("balloon-00"),
          tentDetails: transform("tent-details"),
          barrel: transform("barrel-0"),
        },
        collider: {
          center: barrelCollider.component.center,
          size: barrelCollider.component.size,
          blockedAtWorldCenter: !canPlayerOccupy(new THREE.Vector3(colliderWorldCenter.x, playerHeight, colliderWorldCenter.z)),
        },
        bleacherLayout: state.layout.find((entry) => entry.id === "bleacher-seat-00"),
        balloonLayout: state.layout.find((entry) => entry.id === "balloon-00"),
      };
    });

    assert.equal(liveResult.state.sceneSource, "live-editor");
    assert.equal(liveResult.state.score, 50, "live editing reset gameplay score");
    assert.deepEqual(liveResult.state.crowdPopulations, { procedural: 40, gltf: 28, total: 68 });
    assert.deepEqual(liveResult.state.balloons, { alive: 28, total: 28 });
    assertEditableInventory(liveResult.state);
    assert.deepEqual(liveResult.transforms.bleacher.position, { x: 2, y: 1.25, z: 0 }, "bleacher target did not flatten its parent X and child Y transforms");
    assert.equal(liveResult.bleacherLayout.parentId, "bleachers-root");
    assert.deepEqual(liveResult.bleacherLayout.position, { x: 0, y: 1.25, z: 0 }, "authored bleacher transform must stay local in text state");
    assert.deepEqual(liveResult.bleacherLayout.worldPosition, { x: 2, y: 1.25, z: 0 }, "text state must expose the flattened bleacher world transform");
    assert.equal(liveResult.transforms.crowd.position.x, 9.25);
    assert.ok(Math.abs(liveResult.transforms.balloon.position.y - 8.5) <= 0.15, "balloon preview did not stay around its edited spawn while bobbing");
    assert.equal(liveResult.balloonLayout.position.y, 8.5, "authored balloon spawn did not retain the live edit");
    assert.equal(liveResult.balloonLayout.worldPosition.y, 8.5, "balloon world mapping did not retain the live edit");
    assert.equal(liveResult.transforms.tentDetails.rotationY, 12);
    assert.deepEqual(liveResult.transforms.barrel.position, { x: 12, y: 0.5, z: 12 });
    assert.equal(liveResult.transforms.barrel.rotationY, 37);
    assert.deepEqual(liveResult.transforms.barrel.scale, { x: 1, y: 1, z: 1 });
    assert.deepEqual(liveResult.collider.center, { x: 0.4, y: 0.8, z: -0.2 });
    assert.deepEqual(liveResult.collider.size, { x: 2.5, y: 3, z: 1.8 });
    assert.equal(liveResult.collider.blockedAtWorldCenter, true, "live collider update did not affect Zebra collision");

    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    assert.deepEqual(badResponses, [], `HTTP errors: ${badResponses.join("; ")}`);
  } finally {
    await browser.close();
  }
});
