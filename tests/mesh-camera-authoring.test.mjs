import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importGamePortStudioModule } from "../tools/game-port-studio-path.mjs";
import { EXPECTED_OBJECT_COUNT } from "./parity-contract.mjs";

const { chromium } = await importGamePortStudioModule("playwright/index.mjs");
const NONCE = "zebra-mesh-camera-authoring";
const PROTOCOL = "game-port-runtime/v1";
const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assertVectorClose(actual, expected, message, epsilon = 1e-8) {
  assert.equal(actual.length, expected.length, `${message} length`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) <= epsilon, `${message}[${index}]: ${actual[index]} != ${expected[index]}`);
  }
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

async function openAuthoringPage(browser, suffix) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const badResponses = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  const baseUrl = process.env.ZEBRA_URL ?? "http://127.0.0.1:8765";
  const origin = new URL(baseUrl).origin;
  await page.goto(`${baseUrl}/?studioMode=authoring&editorOrigin=${encodeURIComponent(origin)}&${suffix}=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForFunction((count) => window.__zebraStudioValidation?.snapshot().objectCount === count, EXPECTED_OBJECT_COUNT, { timeout: 30_000 });
  return { page, errors, badResponses };
}

async function postScene(page, scene, revision, expectedType = "game-port-studio:scene-preview-applied") {
  return page.evaluate(async ({ nextScene, nextRevision, expectedType, nonce, protocol }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${expectedType} timed out for revision ${nextRevision}`)), 15_000);
    const onMessage = (event) => {
      if (event.origin !== location.origin || event.source !== window || event.data?.nonce !== nonce || event.data?.revision !== nextRevision) return;
      if (event.data?.type === "game-port-studio:scene-preview-rejected" && expectedType !== event.data.type) {
        clearTimeout(timer);
        removeEventListener("message", onMessage);
        reject(new Error(`Unexpected preview rejection: ${event.data.error}`));
        return;
      }
      if (event.data?.type !== expectedType) return;
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      resolve(event.data);
    };
    addEventListener("message", onMessage);
    postMessage({ type: "game-port-studio:scene-preview", protocol, nonce, revision: nextRevision, scene: nextScene }, location.origin);
  }), { nextScene: scene, nextRevision: revision, expectedType, nonce: NONCE, protocol: PROTOCOL });
}

test("Option/Alt camera gestures latch orbit and Command/Ctrl pan without authoring history", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const { page, errors, badResponses } = await openAuthoringPage(browser, "camera-pan");
  try {
    const before = await page.evaluate(() => {
      setStudioAuthoringSelection("center-plinth");
      requestStudioEditorRender();
      const point = editableObjects.get("center-plinth").getWorldPosition(new THREE.Vector3()).project(studioAuthoring.editorCamera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        pointer: { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 },
        snapshot: window.__zebraStudioValidation.snapshot(),
        selectedLayout: JSON.stringify(layoutObject("center-plinth")),
      };
    });

    await page.keyboard.down("Alt");
    await page.keyboard.down("Meta");
    await page.mouse.move(before.pointer.x, before.pointer.y);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(before.pointer.x + 100, before.pointer.y + 50, { steps: 4 });
    await page.mouse.up({ button: "left" });
    await page.keyboard.up("Meta");
    await page.keyboard.up("Alt");

    const afterPan = await page.evaluate(() => ({
      snapshot: window.__zebraStudioValidation.snapshot(),
      selectedLayout: JSON.stringify(layoutObject("center-plinth")),
    }));
    const beforeOrbit = before.snapshot.orbit;
    const afterPanOrbit = afterPan.snapshot.orbit;
    assert.equal(afterPanOrbit.yaw, beforeOrbit.yaw, "pan must not change orbit yaw");
    assert.equal(afterPanOrbit.pitch, beforeOrbit.pitch, "pan must not change orbit pitch");
    assert.equal(afterPanOrbit.distance, beforeOrbit.distance, "pan must not change orbit distance");
    assert.ok(Math.hypot(...subtract(afterPanOrbit.target, beforeOrbit.target)) > 0.5, "pan did not physically translate the orbit target");
    assertVectorClose(
      subtract(afterPanOrbit.cameraPosition, beforeOrbit.cameraPosition),
      subtract(afterPanOrbit.target, beforeOrbit.target),
      "camera and orbit target pan delta",
    );
    assertVectorClose(
      subtract(afterPanOrbit.cameraPosition, afterPanOrbit.target),
      subtract(beforeOrbit.cameraPosition, beforeOrbit.target),
      "pan must preserve camera-target offset",
    );
    assert.equal(afterPanOrbit.drag, null, "pan pointer capture did not clean up");
    assert.equal(afterPan.snapshot.revision, before.snapshot.revision, "camera pan changed the scene bridge revision");
    assert.equal(afterPan.snapshot.sceneDocumentHash, before.snapshot.sceneDocumentHash, "camera pan authored a scene change");
    assert.equal(afterPan.snapshot.selectedObjectId, "center-plinth", "pan over the gizmo changed selection");
    assert.equal(afterPan.selectedLayout, before.selectedLayout, "pan over the gizmo changed the selected transform");

    await page.keyboard.down("Alt");
    await page.mouse.move(before.pointer.x, before.pointer.y);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(before.pointer.x - 55, before.pointer.y + 35, { steps: 3 });
    await page.mouse.up({ button: "left" });
    await page.keyboard.up("Alt");
    const afterOrbit = await page.evaluate(() => window.__zebraStudioValidation.snapshot());
    assertVectorClose(afterOrbit.orbit.target, afterPanOrbit.target, "Option/Alt orbit target");
    assert.equal(afterOrbit.orbit.distance, afterPanOrbit.distance, "Option/Alt orbit changed distance");
    assert.notEqual(afterOrbit.orbit.yaw, afterPanOrbit.yaw, "Option/Alt drag did not orbit");
    assert.notEqual(afterOrbit.orbit.pitch, afterPanOrbit.pitch, "Option/Alt drag did not change pitch");
    assert.equal(afterOrbit.sceneDocumentHash, before.snapshot.sceneDocumentHash, "orbit authored a scene change");

    await page.setViewportSize({ width: 1000, height: 700 });
    await page.waitForFunction(() => Math.abs(studioAuthoring.editorCamera.aspect - 1000 / 700) < 1e-9);
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    assert.deepEqual(badResponses, [], `HTTP errors: ${badResponses.join("; ")}`);
  } finally {
    await browser.close();
  }
});

test("F frames the selected rendered replacement from the canvas or validated parent action without authoring state", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const { page, errors, badResponses } = await openAuthoringPage(browser, "camera-frame");
  try {
    const replacementScene = await page.evaluate(() => {
      const scene = structuredClone(runtimeSceneDocument);
      const rendererComponent = scene.objects
        .find((entry) => entry.id === "center-plinth")
        .components.find((entry) => entry.type === "mesh-renderer");
      rendererComponent.source = { kind: "asset", assetId: "asset-barrel" };
      return scene;
    });
    await postScene(page, replacementScene, 1);

    const before = await page.evaluate(() => {
      setStudioAuthoringSelection("center-plinth");
      const override = fixedEditableVisualOverrides.get("center-plinth");
      if (!override?.nativeMaterials.length) throw new Error("The plinth replacement did not conceal a native mesh.");
      // A hidden native mesh is deliberately moved far away. Raw Box3/BoxHelper
      // includes it even though its material is invisible, so framing must use
      // the rendered override rather than the stable target's unfiltered box.
      override.nativeMaterials[0].mesh.position.x += 400;
      override.nativeMaterials[0].mesh.updateWorldMatrix(true, true);
      override.root.updateWorldMatrix(true, true);
      const renderedBox = new THREE.Box3().setFromObject(override.root);
      const rawTargetBox = new THREE.Box3().setFromObject(editableObjects.get("center-plinth"));
      const center = renderedBox.getCenter(new THREE.Vector3());
      const corners = [
        [renderedBox.min.x, renderedBox.min.y, renderedBox.min.z],
        [renderedBox.min.x, renderedBox.min.y, renderedBox.max.z],
        [renderedBox.min.x, renderedBox.max.y, renderedBox.min.z],
        [renderedBox.min.x, renderedBox.max.y, renderedBox.max.z],
        [renderedBox.max.x, renderedBox.min.y, renderedBox.min.z],
        [renderedBox.max.x, renderedBox.min.y, renderedBox.max.z],
        [renderedBox.max.x, renderedBox.max.y, renderedBox.min.z],
        [renderedBox.max.x, renderedBox.max.y, renderedBox.max.z],
      ];
      studioAuthoring.orbitTarget.set(-35, 24, 31);
      studioAuthoring.orbitDistance = 70;
      studioAuthoring.cameraView = "game";
      updateStudioOrbitCamera();
      renderer.domElement.tabIndex = 0;
      renderer.domElement.focus({ preventScroll: true });
      const snapshot = window.__zebraStudioValidation.snapshot();
      return {
        center: center.toArray(),
        corners,
        rawCenter: rawTargetBox.getCenter(new THREE.Vector3()).toArray(),
        orbit: snapshot.orbit,
        revision: snapshot.revision,
        sceneDocumentHash: snapshot.sceneDocumentHash,
        selectedObjectId: snapshot.selectedObjectId,
        layout: JSON.stringify(layoutObject("center-plinth")),
      };
    });
    assert.ok(Math.hypot(...subtract(before.rawCenter, before.center)) > 50, "the hidden-native regression fixture did not diverge from the rendered replacement");

    await page.keyboard.press("f");
    await page.waitForFunction((center) => {
      const snapshot = window.__zebraStudioValidation.snapshot();
      return snapshot.renderState.cameraView === "orbit"
        && snapshot.orbit.target.every((value, index) => Math.abs(value - center[index]) < 1e-7);
    }, before.center);
    const afterCanvas = await page.evaluate((corners) => {
      const snapshot = window.__zebraStudioValidation.snapshot();
      return {
        snapshot,
        layout: JSON.stringify(layoutObject("center-plinth")),
        projected: corners.map((corner) => new THREE.Vector3(...corner).project(studioAuthoring.editorCamera).toArray()),
        selectionBox: studioAuthoring.selectionBox?.box ? {
          min: studioAuthoring.selectionBox.box.min.toArray(),
          max: studioAuthoring.selectionBox.box.max.toArray(),
        } : null,
      };
    }, before.corners);
    assertVectorClose(afterCanvas.snapshot.orbit.target, before.center, "canvas F orbit target");
    assert.equal(afterCanvas.snapshot.orbit.yaw, before.orbit.yaw, "canvas F changed orbit yaw");
    assert.equal(afterCanvas.snapshot.orbit.pitch, before.orbit.pitch, "canvas F changed orbit pitch");
    assert.ok(afterCanvas.snapshot.orbit.distance < before.orbit.distance, "canvas F did not move close to the selected replacement");
    assert.ok(
      afterCanvas.projected.every(([x, y, z]) => Math.abs(x) < 0.95 && Math.abs(y) < 0.95 && z > -1 && z < 1),
      `framed replacement falls outside the viewport: ${JSON.stringify(afterCanvas.projected)}`,
    );
    assert.ok(afterCanvas.selectionBox, "the rendered selection outline is missing");
    assertVectorClose(afterCanvas.selectionBox.min, [
      Math.min(...before.corners.map(([x]) => x)),
      Math.min(...before.corners.map(([, y]) => y)),
      Math.min(...before.corners.map(([, , z]) => z)),
    ], "replacement selection outline minimum");
    assertVectorClose(afterCanvas.selectionBox.max, [
      Math.max(...before.corners.map(([x]) => x)),
      Math.max(...before.corners.map(([, y]) => y)),
      Math.max(...before.corners.map(([, , z]) => z)),
    ], "replacement selection outline maximum");
    assert.equal(afterCanvas.snapshot.revision, before.revision, "canvas F changed the bridge revision");
    assert.equal(afterCanvas.snapshot.sceneDocumentHash, before.sceneDocumentHash, "canvas F changed the authored scene");
    assert.equal(afterCanvas.snapshot.selectedObjectId, before.selectedObjectId, "canvas F changed selection");
    assert.equal(afterCanvas.layout, before.layout, "canvas F changed the selected object");

    const inputGuard = await page.evaluate(() => {
      studioAuthoring.orbitTarget.set(23, 17, -19);
      studioAuthoring.orbitDistance = 41;
      updateStudioOrbitCamera();
      const input = document.createElement("input");
      input.id = "frame-shortcut-input-guard";
      document.body.appendChild(input);
      input.focus();
      return window.__zebraStudioValidation.snapshot().orbit;
    });
    await page.keyboard.press("f");
    const afterInput = await page.evaluate(() => window.__zebraStudioValidation.snapshot().orbit);
    assertVectorClose(afterInput.target, inputGuard.target, "input-focused F target");
    assert.equal(afterInput.distance, inputGuard.distance, "input-focused F changed distance");
    await page.evaluate(() => document.getElementById("frame-shortcut-input-guard")?.remove());

    const beforeParentAction = await page.evaluate(() => {
      studioAuthoring.orbitTarget.set(-21, -12, 29);
      studioAuthoring.orbitDistance = 63;
      updateStudioOrbitCamera();
      const snapshot = window.__zebraStudioValidation.snapshot();
      postMessage({
        type: "game-port-studio:editor-action",
        protocol: RUNTIME_BRIDGE_PROTOCOL,
        nonce: runtimeBridgeNonce,
        revision: runtimeBridgeRevision,
        action: "frame-selection",
        objectId: "center-plinth",
      }, location.origin);
      return snapshot;
    });
    await page.waitForFunction((center) => window.__zebraStudioValidation.snapshot().orbit.target
      .every((value, index) => Math.abs(value - center[index]) < 1e-7), before.center);
    const afterParentAction = await page.evaluate(() => window.__zebraStudioValidation.snapshot());
    assertVectorClose(afterParentAction.orbit.target, before.center, "validated parent frame target");
    assert.equal(afterParentAction.orbit.yaw, beforeParentAction.orbit.yaw, "parent frame changed orbit yaw");
    assert.equal(afterParentAction.orbit.pitch, beforeParentAction.orbit.pitch, "parent frame changed orbit pitch");
    assert.equal(afterParentAction.revision, before.revision, "parent frame changed the bridge revision");
    assert.equal(afterParentAction.sceneDocumentHash, before.sceneDocumentHash, "parent frame changed the authored scene");

    const playGuard = await page.evaluate(() => {
      studioAuthoring.orbitTarget.set(31, 11, -27);
      studioAuthoring.orbitDistance = 52;
      updateStudioOrbitCamera();
      setStudioRuntimeMode("playing");
      renderer.domElement.focus({ preventScroll: true });
      return window.__zebraStudioValidation.snapshot().orbit;
    });
    await page.keyboard.press("f");
    const afterPlayKey = await page.evaluate(() => window.__zebraStudioValidation.snapshot());
    assert.equal(afterPlayKey.renderState.mode, "playing");
    assertVectorClose(afterPlayKey.orbit.target, playGuard.target, "Play-mode F target");
    assert.equal(afterPlayKey.orbit.distance, playGuard.distance, "Play-mode F changed distance");
    assert.equal(afterPlayKey.revision, before.revision, "Play-mode F changed the bridge revision");
    assert.equal(afterPlayKey.sceneDocumentHash, before.sceneDocumentHash, "Play-mode F changed the authored scene");
    await page.evaluate(() => setStudioRuntimeMode("authoring"));

    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    assert.deepEqual(badResponses, [], `HTTP errors: ${badResponses.join("; ")}`);
  } finally {
    await browser.close();
  }
});

test("fixed Zebra roots swap allowlisted GLBs and primitives without changing identity or colliders", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const { page, errors, badResponses } = await openAuthoringPage(browser, "mesh-replacement");
  try {
    const baseline = await page.evaluate(() => ({
      scene: structuredClone(runtimeSceneDocument),
      visual: window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth"),
      qrTextureHashes: window.__zebraStudioValidation.snapshot().qrTextureHashes,
    }));
    assert.equal(baseline.scene.assets.length, 72, "runtime discarded compact Zebra asset metadata");
    assert.equal("source" in baseline.scene.assets[0], false, "runtime retained embedded asset bytes");

    const assetScene = structuredClone(baseline.scene);
    assetScene.objects.find((entry) => entry.id === "center-plinth").components.find((entry) => entry.type === "mesh-renderer").source = { kind: "asset", assetId: "asset-barrel" };
    await postScene(page, assetScene, 1);
    const assetVisual = await page.evaluate(() => window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth"));
    assert.equal(assetVisual.targetUuid, baseline.visual.targetUuid, "asset replacement changed the stable editable target");
    assert.equal(assetVisual.collider.targetUuid, baseline.visual.collider.targetUuid, "asset replacement rebound the collider target");
    assert.deepEqual(assetVisual.collider, baseline.visual.collider, "asset replacement changed collider data");
    assert.equal(assetVisual.requestedSource, "asset:asset-barrel");
    assert.equal(assetVisual.activeSource, "asset:asset-barrel");
    assert.equal(assetVisual.nativeSource, "asset:asset-podium");
    assert.equal(assetVisual.overridden, true);
    assert.ok(assetVisual.overrideMeshCount > 0, "asset replacement installed no visible meshes");
    assert.equal(assetVisual.nativeMeshCount, baseline.visual.nativeMeshCount, "native mesh ownership changed");
    const assetRuntime = await page.evaluate(() => {
      const override = fixedEditableVisualOverrides.get("center-plinth");
      return {
        overrideVisible: override.root.visible,
        overrideParentUuid: override.root.parent?.uuid,
        targetUuid: editableObjects.get("center-plinth").uuid,
        hiddenNativeMaterials: override.nativeMaterials.every((entry) => entry.hidden.every((material) => material.visible === false)),
      };
    });
    assert.equal(assetRuntime.overrideVisible, true);
    assert.equal(assetRuntime.overrideParentUuid, baseline.visual.targetUuid, "replacement was not mounted under the stable root");
    assert.equal(assetRuntime.targetUuid, baseline.visual.targetUuid);
    assert.equal(assetRuntime.hiddenNativeMaterials, true, "native target-owned meshes were not concealed");

    const primitiveScene = structuredClone(assetScene);
    const rendererComponent = primitiveScene.objects.find((entry) => entry.id === "center-plinth").components.find((entry) => entry.type === "mesh-renderer");
    rendererComponent.source = { kind: "primitive", primitive: "sphere" };
    rendererComponent.material = {
      kind: "inline", shading: "lit", baseColor: "#22aaee", baseColorTextureAssetId: null,
      roughness: 0.3, metalness: 0.2, opacity: 1, alphaMode: "opaque", alphaCutoff: 0.5, doubleSided: true,
    };
    await postScene(page, primitiveScene, 2);
    const primitiveVisual = await page.evaluate(() => window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth"));
    assert.equal(primitiveVisual.targetUuid, baseline.visual.targetUuid, "primitive replacement changed the stable editable target");
    assert.equal(primitiveVisual.requestedSource, "primitive:sphere");
    assert.equal(primitiveVisual.activeSource, "primitive:sphere");
    assert.equal(primitiveVisual.overrideMeshCount, 1);
    assert.deepEqual(primitiveVisual.collider, baseline.visual.collider, "primitive replacement changed collider data");

    const invalidScene = structuredClone(primitiveScene);
    invalidScene.objects.find((entry) => entry.id === "center-plinth").components.find((entry) => entry.type === "mesh-renderer").source = { kind: "asset", assetId: "asset-not-allowlisted" };
    const rejection = await postScene(page, invalidScene, 3, "game-port-studio:scene-preview-rejected");
    assert.match(rejection.error, /unavailable asset-backed mesh/i);
    const afterRejection = await page.evaluate(() => ({
      revision: window.__zebraStudioValidation.snapshot().revision,
      visual: window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth"),
    }));
    assert.equal(afterRejection.revision, 2, "rejected replacement advanced the active revision");
    assert.equal(afterRejection.visual.activeSource, "primitive:sphere", "rejected replacement partially changed the visual");

    const restoredScene = structuredClone(primitiveScene);
    const restoredRenderer = restoredScene.objects.find((entry) => entry.id === "center-plinth").components.find((entry) => entry.type === "mesh-renderer");
    restoredRenderer.source = { kind: "asset", assetId: "asset-podium" };
    restoredRenderer.material = { kind: "embedded", overrides: [] };
    await postScene(page, restoredScene, 3);
    const restored = await page.evaluate(() => ({
      visual: window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth"),
      nativeMaterialsVisible: (() => {
        let visible = true;
        traverseOwnedRuntimeObject(editableObjects.get("center-plinth"), (child) => {
          if (!child.isMesh) return;
          for (const material of Array.isArray(child.material) ? child.material : [child.material]) visible &&= material.visible !== false;
        });
        return visible;
      })(),
    }));
    assert.equal(restored.visual.targetUuid, baseline.visual.targetUuid, "Undo-style restore changed stable target identity");
    assert.equal(restored.visual.overridden, false);
    assert.equal(restored.visual.overrideMeshCount, 0);
    assert.equal(restored.visual.activeSource, "asset:asset-podium");
    assert.deepEqual(restored.visual.collider, baseline.visual.collider);
    assert.equal(restored.nativeMaterialsVisible, true, "native meshes were not restored after replacement Undo");

    const slowAssetScene = structuredClone(restoredScene);
    slowAssetScene.objects.find((entry) => entry.id === "center-plinth").components.find((entry) => entry.type === "mesh-renderer").source = { kind: "asset", assetId: "asset-tent" };
    const latestPrimitiveScene = structuredClone(primitiveScene);
    latestPrimitiveScene.objects.find((entry) => entry.id === "center-plinth").components.find((entry) => entry.type === "mesh-renderer").source = { kind: "primitive", primitive: "cube" };
    const race = await page.evaluate(async ({ slowScene, latestScene, nonce, protocol }) => new Promise((resolve, reject) => {
      const messages = [];
      const timer = setTimeout(() => reject(new Error("replacement race timed out")), 15_000);
      const onMessage = (event) => {
        if (event.origin !== location.origin || event.source !== window || event.data?.nonce !== nonce) return;
        if (![4, 5].includes(event.data?.revision)) return;
        messages.push({ type: event.data.type, revision: event.data.revision, error: event.data.error ?? null });
        if (event.data.type === "game-port-studio:scene-preview-applied" && event.data.revision === 5) {
          setTimeout(() => {
            clearTimeout(timer);
            removeEventListener("message", onMessage);
            resolve(messages);
          }, 750);
        }
      };
      addEventListener("message", onMessage);
      postMessage({ type: "game-port-studio:scene-preview", protocol, nonce, revision: 4, scene: slowScene }, location.origin);
      postMessage({ type: "game-port-studio:scene-preview", protocol, nonce, revision: 5, scene: latestScene }, location.origin);
    }), { slowScene: slowAssetScene, latestScene: latestPrimitiveScene, nonce: NONCE, protocol: PROTOCOL });
    assert.ok(race.some((entry) => entry.type === "game-port-studio:scene-preview-applied" && entry.revision === 5), "latest replacement was not applied");
    const afterRace = await page.evaluate(() => ({
      revision: window.__zebraStudioValidation.snapshot().revision,
      visual: window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth"),
    }));
    assert.equal(afterRace.revision, 5);
    assert.equal(afterRace.visual.activeSource, "primitive:cube", "late GLB completion overwrote the latest primitive replacement");
    assert.equal(afterRace.visual.targetUuid, baseline.visual.targetUuid);

    await page.evaluate(() => {
      window.__zebraOriginalGltfLoad = THREE.GLTFLoader.prototype.load;
      THREE.GLTFLoader.prototype.load = function load(url, onLoad, onProgress, onError) {
        if (String(url).includes("crowd-seated-39.glb")) {
          queueMicrotask(() => onError?.(new Error("forced replacement load failure")));
          return this;
        }
        return window.__zebraOriginalGltfLoad.call(this, url, onLoad, onProgress, onError);
      };
    });
    const failedLoadScene = structuredClone(restoredScene);
    failedLoadScene.objects.find((entry) => entry.id === "center-plinth").components.find((entry) => entry.type === "mesh-renderer").source = { kind: "asset", assetId: "asset-crowd-seated-39" };
    const failedLoad = await postScene(page, failedLoadScene, 6, "game-port-studio:scene-preview-rejected");
    assert.match(failedLoad.error, /Could not load replacement asset asset-crowd-seated-39/i);
    const afterFailedLoad = await page.evaluate(() => ({
      revision: window.__zebraStudioValidation.snapshot().revision,
      visual: window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth"),
    }));
    assert.equal(afterFailedLoad.revision, 5, "failed GLB load advanced the active revision");
    assert.equal(afterFailedLoad.visual.activeSource, "primitive:cube", "failed GLB load partially changed the visible mesh");
    assert.equal(afterFailedLoad.visual.targetUuid, baseline.visual.targetUuid);
    await page.evaluate(() => { THREE.GLTFLoader.prototype.load = window.__zebraOriginalGltfLoad; });

    const qrScene = structuredClone(latestPrimitiveScene);
    qrScene.objects.find((entry) => entry.id === "qr-mc9400").components.find((entry) => entry.type === "mesh-renderer").source = { kind: "asset", assetId: "asset-qr-mc3400" };
    await postScene(page, qrScene, 6);
    const editedQr = await page.evaluate(() => ({
      hash: window.__zebraStudioValidation.snapshot().qrTextureHashes.find((entry) => entry.id === "qr-mc9400")?.hash,
      weapon: qrObjs.find((entry) => entry.editorId === "qr-mc9400")?.w.id,
      visual: window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "qr-mc9400"),
    }));
    assert.equal(editedQr.hash, baseline.qrTextureHashes.find((entry) => entry.id === "qr-mc3400")?.hash, "active QR hash did not follow its exact GLB replacement");
    assert.equal(editedQr.weapon, "MC3400", "QR replacement did not preserve the product-scanning behavior");
    assert.equal(editedQr.visual.activeSource, "asset:asset-qr-mc3400");
    assert.equal(editedQr.visual.overrideMeshCount, 4);
    const qrRestoredScene = structuredClone(qrScene);
    qrRestoredScene.objects.find((entry) => entry.id === "qr-mc9400").components.find((entry) => entry.type === "mesh-renderer").source = { kind: "asset", assetId: "asset-qr-mc9400" };
    await postScene(page, qrRestoredScene, 7);
    const restoredQr = await page.evaluate(() => ({
      hash: window.__zebraStudioValidation.snapshot().qrTextureHashes.find((entry) => entry.id === "qr-mc9400")?.hash,
      weapon: qrObjs.find((entry) => entry.editorId === "qr-mc9400")?.w.id,
      visual: window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "qr-mc9400"),
    }));
    assert.equal(restoredQr.hash, baseline.qrTextureHashes.find((entry) => entry.id === "qr-mc9400")?.hash);
    assert.equal(restoredQr.weapon, "MC9400");
    assert.equal(restoredQr.visual.overridden, false);

    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    assert.deepEqual(badResponses, [], `HTTP errors: ${badResponses.join("; ")}`);
  } finally {
    await browser.close();
  }
});

test("a replacement saved in the packaged scene still overrides the hardcoded Zebra native mesh", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    const packaged = JSON.parse(await readFile(path.join(gameRoot, "zebra-circus.scene.json"), "utf8"));
    packaged.objects.find((entry) => entry.id === "center-plinth").components.find((entry) => entry.type === "mesh-renderer").source = { kind: "asset", assetId: "asset-barrel" };
    await page.route("**/zebra-circus.scene.json?*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(packaged),
    }));
    const baseUrl = process.env.ZEBRA_URL ?? "http://127.0.0.1:8765";
    const origin = new URL(baseUrl).origin;
    await page.goto(`${baseUrl}/?studioMode=authoring&editorOrigin=${encodeURIComponent(origin)}&packaged-replacement=${Date.now()}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__zebraStudioValidation?.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth")?.activeSource === "asset:asset-barrel", { timeout: 30_000 });
    const state = await page.evaluate(() => ({
      source: JSON.parse(window.render_game_to_text()).sceneSource,
      assetCount: window.__zebraStudioValidation.snapshot().assetCount,
      visual: window.__zebraStudioValidation.snapshot().meshVisuals.find((entry) => entry.id === "center-plinth"),
    }));
    assert.equal(state.source, "zebra-circus.scene.json");
    assert.equal(state.assetCount, 72);
    assert.equal(state.visual.nativeSource, "asset:asset-podium", "native source was inferred from mutable scene JSON");
    assert.equal(state.visual.requestedSource, "asset:asset-barrel");
    assert.equal(state.visual.overridden, true);
    assert.ok(state.visual.overrideMeshCount > 0);
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
  } finally {
    await browser.close();
  }
});
