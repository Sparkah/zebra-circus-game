import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importGamePortStudioModule } from "../tools/game-port-studio-path.mjs";
import { EXPECTED_OBJECT_COUNT } from "./parity-contract.mjs";

const { chromium } = await importGamePortStudioModule("playwright/index.mjs");
const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalScene = JSON.parse(await readFile(path.join(gameRoot, "zebra-circus.scene.json"), "utf8"));
const uploadedGlb = await readFile(path.join(gameRoot, "models/editor/arena-barrel.glb"));
const PROTOCOL = "game-port-runtime/v1";
const NONCE = "zebra-uploaded-assets";
const baseUrl = process.env.ZEBRA_URL ?? "http://127.0.0.1:8765";
const origin = new URL(baseUrl).origin;

function uploadId(hexCharacter) {
  return `asset-upload-${hexCharacter.repeat(48)}`;
}

function uploadedAsset(id, bytes, source) {
  return {
    id,
    name: `Uploaded ${id.slice(-4)}`,
    type: "model",
    format: "glb",
    fileName: `${id}.glb`,
    bytes,
    ...(source === undefined ? {} : { source }),
  };
}

function embeddedMaterial() {
  return { kind: "embedded", overrides: [] };
}

function replaceObjectMesh(scene, objectId, assetId) {
  const renderer = scene.objects
    .find((object) => object.id === objectId)
    .components.find((component) => component.type === "mesh-renderer");
  renderer.source = { kind: "asset", assetId };
  renderer.material = embeddedMaterial();
}

function addUploadedObject(scene, id, assetId, position = { x: 2, y: 1, z: -3 }) {
  scene.objects.push({
    id,
    name: "Uploaded Object",
    parentId: "decor-root",
    visible: true,
    locked: false,
    position,
    rotation: { x: 0, y: 35, z: 0 },
    scale: { x: 0.75, y: 0.75, z: 0.75 },
    components: [
      {
        id: "mesh-renderer",
        type: "mesh-renderer",
        enabled: true,
        source: { kind: "asset", assetId },
        material: embeddedMaterial(),
      },
      {
        id: "box-collider",
        type: "box-collider",
        enabled: true,
        center: { x: 0, y: 0, z: 0 },
        size: { x: 1, y: 1, z: 1 },
        isTrigger: false,
      },
    ],
  });
}

function externalUriGlb() {
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 4, uri: "https://example.invalid/external.bin" }],
    scenes: [{ nodes: [] }],
    scene: 0,
  };
  const json = Buffer.from(JSON.stringify(document));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = Buffer.alloc(12 + 8 + paddedLength, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(paddedLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return bytes;
}

async function postScene(page, scene, revision, expectedType = "game-port-studio:scene-preview-applied") {
  return page.evaluate(async ({ nextScene, nextRevision, expectedType, nonce, protocol }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${expectedType} timed out for revision ${nextRevision}`)), 20_000);
    const onMessage = (event) => {
      if (event.origin !== location.origin
        || event.source !== window
        || event.data?.nonce !== nonce
        || event.data?.revision !== nextRevision) return;
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
    postMessage({
      type: "game-port-studio:scene-preview",
      protocol,
      nonce,
      revision: nextRevision,
      scene: nextScene,
    }, location.origin);
  }), { nextScene: scene, nextRevision: revision, expectedType, nonce: NONCE, protocol: PROTOCOL });
}

async function postMode(page, mode, revision) {
  return page.evaluate(async ({ nextMode, nextRevision, nonce, protocol }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`runtime mode ${nextMode} timed out`)), 10_000);
    const onMessage = (event) => {
      if (event.origin !== location.origin
        || event.source !== window
        || event.data?.type !== "game-port-studio:runtime-mode-applied"
        || event.data?.mode !== nextMode) return;
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      resolve(event.data);
    };
    addEventListener("message", onMessage);
    postMessage({
      type: "game-port-studio:runtime-mode",
      protocol,
      nonce,
      revision: nextRevision,
      mode: nextMode,
    }, location.origin);
  }), { nextMode: mode, nextRevision: revision, nonce: NONCE, protocol: PROTOCOL });
}

async function waitForZebra(page) {
  await page.waitForFunction(
    (count) => window.__zebraStudioValidation?.snapshot().objectCount === count,
    EXPECTED_OBJECT_COUNT,
    { timeout: 30_000 },
  );
}

test("a full scene JSON parses its canonical uploaded GLB source without an asset API request", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const uploadRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/assets/")) uploadRequests.push(request.url());
  });

  const assetId = uploadId("b");
  const scene = structuredClone(canonicalScene);
  scene.assets.push(uploadedAsset(assetId, uploadedGlb.length, uploadedGlb.toString("base64")));
  replaceObjectMesh(scene, "center-plinth", assetId);
  await page.route("**/zebra-circus.scene.json?runtime=*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(scene),
  }));

  try {
    await page.goto(`${baseUrl}/?studioMode=authoring&editorOrigin=${encodeURIComponent(origin)}&full-upload=${Date.now()}`, { waitUntil: "networkidle" });
    await waitForZebra(page);
    const state = await page.evaluate((id) => {
      const target = editableObjects.get("center-plinth");
      const override = fixedEditableVisualOverrides.get("center-plinth");
      const template = replacementAssetTemplates.get(id);
      const overrideMaterials = [];
      const templateMaterials = [];
      override.root.traverse((child) => {
        if (!child.isMesh) return;
        overrideMaterials.push(...(Array.isArray(child.material) ? child.material : [child.material]));
      });
      template.traverse((child) => {
        if (!child.isMesh) return;
        templateMaterials.push(...(Array.isArray(child.material) ? child.material : [child.material]));
      });
      return {
        source: runtimeSceneSource,
        assetHasSource: typeof runtimeSceneDocument.assets.find((asset) => asset.id === id)?.source === "string",
        activeSource: target.userData.activeEditorVisualSource,
        overrideSource: override.root.userData.visualSource,
        concealedNativeCount: override.nativeMaterials.length,
        materialNames: overrideMaterials.map((material) => material.name),
        embeddedMaterialsCloned: overrideMaterials.length > 0
          && overrideMaterials.every((material, index) => material !== templateMaterials[index]),
      };
    }, assetId);
    assert.equal(state.source, "zebra-circus.scene.json");
    assert.equal(state.assetHasSource, true);
    assert.equal(state.activeSource, `asset:${assetId}`);
    assert.equal(state.overrideSource, `asset:${assetId}`);
    assert.ok(state.concealedNativeCount > 0);
    assert.ok(state.materialNames.length > 0);
    assert.equal(state.embeddedMaterialsCloned, true);
    assert.deepEqual(uploadRequests, [], "embedded full-scene assets must not contact the hosted content API");
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
  } finally {
    await browser.close();
  }
});

test("slim uploaded GLBs load only from the canonical API, create dynamic meshes, survive Play, and obey rejection/race guards", { timeout: 120_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const requestedAssetIds = [];
  const slimId = uploadId("a");
  const dynamicId = uploadId("c");
  const slowId = uploadId("d");
  const mismatchId = uploadId("e");
  let releaseSlow;
  let markSlowRequested;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const slowRequested = new Promise((resolve) => { markSlowRequested = resolve; });

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/api/assets/*/content", async (route) => {
    const match = /\/api\/assets\/([^/]+)\/content$/.exec(new URL(route.request().url()).pathname);
    const id = match?.[1];
    requestedAssetIds.push(id);
    if (id === slowId) {
      markSlowRequested();
      await slowGate;
    }
    if ([slimId, slowId, mismatchId].includes(id)) {
      await route.fulfill({
        status: 200,
        contentType: "model/gltf-binary",
        headers: { "content-length": String(uploadedGlb.length) },
        body: uploadedGlb,
      });
      return;
    }
    await route.abort("blockedbyclient");
  });

  try {
    await page.goto(`${baseUrl}/?studioMode=authoring&editorOrigin=${encodeURIComponent(origin)}&slim-upload=${Date.now()}`, { waitUntil: "networkidle" });
    await waitForZebra(page);
    const baseline = await page.evaluate(() => {
      window.__uploadTargetIdentity = editableObjects.get("center-plinth");
      window.__uploadColliderTargetIdentity = runtimeColliders.find((entry) => entry.id === "center-plinth")?.target;
      return structuredClone(runtimeSceneDocument);
    });

    const slimScene = structuredClone(baseline);
    slimScene.assets.push(uploadedAsset(slimId, uploadedGlb.length));
    replaceObjectMesh(slimScene, "center-plinth", slimId);
    await postScene(page, slimScene, 1);
    const slimState = await page.evaluate((id) => {
      const target = editableObjects.get("center-plinth");
      const override = fixedEditableVisualOverrides.get("center-plinth");
      const collider = runtimeColliders.find((entry) => entry.id === "center-plinth");
      return {
        targetIdentity: target === window.__uploadTargetIdentity,
        colliderIdentity: collider.target === window.__uploadColliderTargetIdentity,
        source: target.userData.activeEditorVisualSource,
        overrideSource: override.root.userData.visualSource,
        templateReady: replacementAssetTemplates.has(id),
        meshCount: (() => {
          let count = 0;
          override.root.traverse((child) => { if (child.isMesh) count += 1; });
          return count;
        })(),
      };
    }, slimId);
    assert.equal(slimState.targetIdentity, true);
    assert.equal(slimState.colliderIdentity, true);
    assert.equal(slimState.source, `asset:${slimId}`);
    assert.equal(slimState.overrideSource, `asset:${slimId}`);
    assert.equal(slimState.templateReady, true);
    assert.ok(slimState.meshCount > 0);
    assert.deepEqual(requestedAssetIds, [slimId]);

    const dynamicScene = structuredClone(slimScene);
    dynamicScene.assets.push(uploadedAsset(dynamicId, uploadedGlb.length, uploadedGlb.toString("base64")));
    addUploadedObject(dynamicScene, "uploaded-barrel", dynamicId);
    await postScene(page, dynamicScene, 2);
    const dynamicState = await page.evaluate((id) => {
      const root = editableObjects.get("uploaded-barrel");
      const template = replacementAssetTemplates.get(id);
      const materials = [];
      const templateMaterials = [];
      root.traverse((child) => {
        if (child.isMesh) materials.push(...(Array.isArray(child.material) ? child.material : [child.material]));
      });
      template.traverse((child) => {
        if (child.isMesh) templateMaterials.push(...(Array.isArray(child.material) ? child.material : [child.material]));
      });
      window.__uploadedDynamicIdentity = root;
      return {
        registered: dynamicEditableObjectIds.has("uploaded-barrel"),
        source: root.userData.visualSource,
        kind: root.userData.dynamicVisualKind,
        meshCount: materials.length,
        embeddedMaterialsCloned: materials.length > 0
          && materials.every((material, index) => material !== templateMaterials[index]),
        colliderTarget: runtimeColliders.find((entry) => entry.id === "uploaded-barrel")?.target === root,
      };
    }, dynamicId);
    assert.equal(dynamicState.registered, true);
    assert.equal(dynamicState.source, `asset:${dynamicId}`);
    assert.equal(dynamicState.kind, "asset");
    assert.ok(dynamicState.meshCount > 0);
    assert.equal(dynamicState.embeddedMaterialsCloned, true);
    assert.equal(dynamicState.colliderTarget, true);
    assert.deepEqual(requestedAssetIds, [slimId], "embedded preview source must not use the asset API");

    await postMode(page, "playing", 2);
    assert.deepEqual(await page.evaluate(() => ({
      mode: studioAuthoring.mode,
      sameIdentity: editableObjects.get("uploaded-barrel") === window.__uploadedDynamicIdentity,
      visible: editableObjects.get("uploaded-barrel").visible,
      source: editableObjects.get("uploaded-barrel").userData.visualSource,
    })), {
      mode: "playing",
      sameIdentity: true,
      visible: true,
      source: `asset:${dynamicId}`,
    });
    await postMode(page, "authoring", 2);

    const slowScene = structuredClone(dynamicScene);
    slowScene.assets.push(uploadedAsset(slowId, uploadedGlb.length));
    addUploadedObject(slowScene, "superseded-upload", slowId, { x: -8, y: 1, z: 4 });
    await page.evaluate(({ scene, nonce, protocol }) => {
      window.__uploadRaceMessages = [];
      addEventListener("message", (event) => {
        if (event.origin === location.origin
          && event.source === window
          && event.data?.nonce === nonce
          && event.data?.revision === 3) {
          window.__uploadRaceMessages.push(structuredClone(event.data));
        }
      });
      postMessage({ type: "game-port-studio:scene-preview", protocol, nonce, revision: 3, scene }, location.origin);
    }, { scene: slowScene, nonce: NONCE, protocol: PROTOCOL });
    await slowRequested;

    const latestScene = structuredClone(dynamicScene);
    latestScene.objects.find((object) => object.id === "uploaded-barrel").position.x = 7;
    await postScene(page, latestScene, 4);
    releaseSlow();
    await page.waitForFunction(() => window.__uploadRaceMessages?.some((message) => (
      message.type === "game-port-studio:scene-preview-rejected"
      && /superseded/i.test(message.error)
    )), { timeout: 20_000 });
    assert.deepEqual(await page.evaluate(() => ({
      revision: window.__zebraStudioValidation.snapshot().revision,
      slowExists: editableObjects.has("superseded-upload"),
      activeX: layoutObject("uploaded-barrel").position.x,
      activeIdentity: editableObjects.get("uploaded-barrel") === window.__uploadedDynamicIdentity,
    })), {
      revision: 4,
      slowExists: false,
      activeX: 7,
      activeIdentity: true,
    });

    const mismatchScene = structuredClone(latestScene);
    mismatchScene.assets.push(uploadedAsset(mismatchId, uploadedGlb.length + 4));
    replaceObjectMesh(mismatchScene, "center-plinth", mismatchId);
    const mismatch = await postScene(page, mismatchScene, 5, "game-port-studio:scene-preview-rejected");
    assert.match(mismatch.error, /byte metadata/i);

    const externalBytes = externalUriGlb();
    const externalId = uploadId("f");
    const externalScene = structuredClone(latestScene);
    externalScene.assets.push(uploadedAsset(externalId, externalBytes.length, externalBytes.toString("base64")));
    replaceObjectMesh(externalScene, "center-plinth", externalId);
    const external = await postScene(page, externalScene, 5, "game-port-studio:scene-preview-rejected");
    assert.match(external.error, /external URI dependency/i);

    const urlId = uploadId("9");
    const urlScene = structuredClone(latestScene);
    urlScene.assets.push({
      ...uploadedAsset(urlId, uploadedGlb.length),
      url: "https://example.invalid/arbitrary.glb",
    });
    replaceObjectMesh(urlScene, "center-plinth", urlId);
    const arbitraryUrl = await postScene(page, urlScene, 5, "game-port-studio:scene-preview-rejected");
    assert.match(arbitraryUrl.error, /unsupported metadata/i);

    assert.deepEqual(await page.evaluate(() => ({
      revision: window.__zebraStudioValidation.snapshot().revision,
      source: editableObjects.get("center-plinth").userData.activeEditorVisualSource,
      dynamicX: layoutObject("uploaded-barrel").position.x,
    })), {
      revision: 4,
      source: `asset:${slimId}`,
      dynamicX: 7,
    });
    assert.deepEqual(requestedAssetIds, [slimId, slowId, mismatchId]);
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
  } finally {
    releaseSlow?.();
    await browser.close();
  }
});
