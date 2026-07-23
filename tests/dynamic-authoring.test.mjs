import assert from "node:assert/strict";
import test from "node:test";
import { importGamePortStudioModule } from "../tools/game-port-studio-path.mjs";
import { EXPECTED_OBJECT_COUNT } from "./parity-contract.mjs";

const { chromium } = await importGamePortStudioModule("playwright/index.mjs");

const NONCE = "zebra-dynamic-authoring";
const PROTOCOL = "game-port-runtime/v1";

async function postScene(page, scene, revision, expectedType = "game-port-studio:scene-preview-applied") {
  return page.evaluate(async ({ nextScene, nextRevision, expected, nonce, protocol }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${expected} timed out for revision ${nextRevision}`)), 5_000);
    const onMessage = (event) => {
      if (event.origin !== location.origin || event.source !== window) return;
      if (event.data?.type === "game-port-studio:scene-preview-rejected" && event.data?.nonce === nonce && event.data?.revision === nextRevision && expected !== event.data.type) {
        clearTimeout(timer);
        removeEventListener("message", onMessage);
        reject(new Error(`Unexpected preview rejection: ${event.data.error}`));
        return;
      }
      if (event.data?.type !== expected || event.data?.nonce !== nonce || event.data?.revision !== nextRevision) return;
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
  }), { nextScene: scene, nextRevision: revision, expected: expectedType, nonce: NONCE, protocol: PROTOCOL });
}

async function postMode(page, mode, revision) {
  return page.evaluate(async ({ nextMode, nextRevision, nonce, protocol }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`runtime mode ${nextMode} timed out`)), 5_000);
    const onMessage = (event) => {
      if (event.origin !== location.origin || event.source !== window) return;
      if (event.data?.type !== "game-port-studio:runtime-mode-applied" || event.data?.mode !== nextMode) return;
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

function inlineMaterial(baseColor = "#22aaee") {
  return {
    kind: "inline",
    shading: "lit",
    baseColor,
    baseColorTextureAssetId: null,
    roughness: 0.3,
    metalness: 0.2,
    opacity: 0.75,
    alphaMode: "blend",
    alphaCutoff: 0.45,
    doubleSided: false,
  };
}

test("added primitives reconcile through authoring, play, source changes, rejection, and deletion", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  try {
    const baseUrl = process.env.ZEBRA_URL ?? "http://127.0.0.1:8765";
    const origin = new URL(baseUrl).origin;
    await page.goto(`${baseUrl}/?studioMode=authoring&editorOrigin=${encodeURIComponent(origin)}&dynamic-authoring=${Date.now()}`, { waitUntil: "networkidle" });
    await page.waitForFunction((count) => window.__zebraStudioValidation?.snapshot().objectCount === count, EXPECTED_OBJECT_COUNT, { timeout: 30_000 });

    const baseline = await page.evaluate(() => {
      window.__dynamicWebGLContext = renderer.getContext();
      return {
        contextToken: window.__zebraStudioValidation.snapshot().contextToken,
        fixedManifest: window.__zebraStudioValidation.snapshot().visualManifest,
        scene: JSON.parse(JSON.stringify(runtimeSceneDocument)),
      };
    });
    const addedScene = structuredClone(baseline.scene);
    addedScene.objects.find((object) => object.id === "decor-root").position.x = 2;
    addedScene.objects.push({
      id: "added-cube",
      name: "Added Cube",
      parentId: "decor-root",
      visible: true,
      locked: false,
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 10, y: 20, z: 30 },
      scale: { x: 2, y: 1, z: 0.5 },
      components: [
        { id: "mesh-renderer", type: "mesh-renderer", enabled: true, source: { kind: "primitive", primitive: "cube" }, material: inlineMaterial() },
        { id: "box-collider", type: "box-collider", enabled: true, center: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, isTrigger: false },
      ],
    });
    addedScene.objects.push({
      id: "nested-sphere",
      name: "Nested Sphere",
      parentId: "added-cube",
      visible: true,
      locked: false,
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.5, y: 0.5, z: 0.5 },
      components: [
        { id: "mesh-renderer", type: "mesh-renderer", enabled: true, source: { kind: "primitive", primitive: "sphere" }, material: inlineMaterial("#ff8844") },
      ],
    });

    const addAck = await postScene(page, addedScene, 1);
    assert.equal(addAck.objectCount, EXPECTED_OBJECT_COUNT + 2);
    await page.evaluate(({ nonce, protocol }) => {
      postMessage({
        type: "game-port-studio:editor-state",
        protocol,
        nonce,
        revision: 1,
        selectedObjectId: "added-cube",
        transformMode: "translate",
      }, location.origin);
    }, { nonce: NONCE, protocol: PROTOCOL });
    await page.waitForFunction(() => studioAuthoring.selectedId === "added-cube");
    const authored = await page.evaluate(() => {
      const root = editableObjects.get("added-cube");
      window.__dynamicRootIdentity = root;
      window.__nestedRootIdentity = editableObjects.get("nested-sphere");
      const edited = applyStudioAuthoredTransform("added-cube", {
        position: { x: 2, y: 2, z: 3 },
        rotation: { x: 10, y: 25, z: 30 },
        scale: { x: 2, y: 1, z: 0.5 },
      });
      refreshStudioAuthoringHelpers();
      const mesh = root.children[0];
      const collider = runtimeColliders.find((entry) => entry.id === "added-cube");
      const worldCenter = root.localToWorld(new THREE.Vector3(
        collider.component.center.x,
        collider.component.center.y,
        collider.component.center.z,
      ));
      const playerAtCenter = worldCenter.clone();
      playerAtCenter.y += playerHeight * 0.5;
      return {
        edited,
        registered: dynamicEditableObjectIds.has("added-cube"),
        nestedRegistered: dynamicEditableObjectIds.has("nested-sphere"),
        objectCount: window.__zebraStudioValidation.snapshot().objectCount,
        selected: studioAuthoring.selectedId,
        layoutPosition: layoutObject("added-cube").position,
        worldPosition: (() => {
          const position = root.getWorldPosition(new THREE.Vector3());
          return { x: position.x, y: position.y, z: position.z };
        })(),
        geometry: mesh.geometry.type,
        material: {
          type: mesh.material.type,
          color: `#${mesh.material.color.getHexString()}`,
          opacity: mesh.material.opacity,
          transparent: mesh.material.transparent,
          side: mesh.material.side,
        },
        visible: root.visible,
        colliderRegistered: Boolean(collider),
        collisionBlocks: !canPlayerOccupy(playerAtCenter),
        nested: {
          parent: editableObjects.get("nested-sphere").parent === root,
          material: `#${editableObjects.get("nested-sphere").children[0].material.color.getHexString()}`,
        },
        helpers: {
          selection: Boolean(studioAuthoring.selectionBox),
          collider: Boolean(studioAuthoring.colliderHelper),
          gizmo: Boolean(studioAuthoring.gizmo),
        },
      };
    });
    assert.equal(authored.edited, true);
    assert.equal(authored.registered, true);
    assert.equal(authored.nestedRegistered, true);
    assert.equal(authored.objectCount, EXPECTED_OBJECT_COUNT + 2);
    assert.equal(authored.selected, "added-cube");
    assert.deepEqual(authored.layoutPosition, { x: 2, y: 2, z: 3 }, "gizmo edits must remain local to the authored parent");
    assert.deepEqual(authored.worldPosition, { x: 4, y: 2, z: 3 }, "dynamic object did not inherit its fixed parent's transform");
    assert.equal(authored.geometry, "BoxGeometry");
    assert.deepEqual(authored.material, {
      type: "MeshStandardMaterial",
      color: "#22aaee",
      opacity: 0.75,
      transparent: true,
      side: 0,
    });
    assert.equal(authored.visible, true);
    assert.equal(authored.colliderRegistered, true);
    assert.equal(authored.collisionBlocks, true, "added solid collider was not included in Zebra play collision");
    assert.deepEqual(authored.nested, { parent: true, material: "#ff8844" });
    assert.deepEqual(authored.helpers, { selection: true, collider: true, gizmo: true });

    const hiddenScene = await page.evaluate(() => {
      const scene = JSON.parse(JSON.stringify(runtimeSceneDocument));
      const added = scene.objects.find((object) => object.id === "added-cube");
      added.visible = false;
      added.components.find((component) => component.type === "box-collider").enabled = false;
      return scene;
    });
    await postScene(page, hiddenScene, 2);
    assert.deepEqual(await page.evaluate(() => ({
      visible: editableObjects.get("added-cube").visible,
      collider: runtimeColliders.some((entry) => entry.id === "added-cube"),
      sameObject: editableObjects.get("added-cube") === window.__dynamicRootIdentity,
    })), { visible: false, collider: false, sameObject: true });

    const restoredScene = await page.evaluate(() => {
      const scene = JSON.parse(JSON.stringify(runtimeSceneDocument));
      const added = scene.objects.find((object) => object.id === "added-cube");
      added.visible = true;
      added.components.find((component) => component.type === "box-collider").enabled = true;
      return scene;
    });
    await postScene(page, restoredScene, 3);

    const animatedParentScene = await page.evaluate(() => {
      const scene = JSON.parse(JSON.stringify(runtimeSceneDocument));
      const added = scene.objects.find((object) => object.id === "added-cube");
      added.parentId = "balloon-00";
      added.position = { x: 0.5, y: 0, z: 0 };
      return scene;
    });
    await postScene(page, animatedParentScene, 4);

    const playAck = await postMode(page, "playing", 4);
    assert.equal(playAck.contextToken, baseline.contextToken);
    const playing = await page.evaluate(() => ({
      mode: studioAuthoring.mode,
      sameObject: editableObjects.get("added-cube") === window.__dynamicRootIdentity,
      sameWebGLContext: renderer.getContext() === window.__dynamicWebGLContext,
      collider: runtimeColliders.some((entry) => entry.id === "added-cube"),
      visible: editableObjects.get("added-cube").visible,
    }));
    assert.deepEqual(playing, { mode: "playing", sameObject: true, sameWebGLContext: true, collider: true, visible: true });
    const animatedParentFollow = await page.evaluate(() => {
      const follower = editableObjects.get("added-cube");
      const balloon = editableObjects.get("balloon-00");
      const world = (target) => target.getWorldPosition(new THREE.Vector3());
      const balloonBefore = world(balloon);
      const relativeBefore = world(follower).sub(balloonBefore);
      gameActive = true;
      window.advanceTime(1000);
      const balloonAfter = world(balloon);
      const relativeAfter = world(follower).sub(balloonAfter);
      return {
        balloonTravel: balloonAfter.distanceTo(balloonBefore),
        relativeDrift: relativeAfter.distanceTo(relativeBefore),
        parentIsRuntimeBalloon: follower.parent === balloon,
      };
    });
    assert.equal(animatedParentFollow.parentIsRuntimeBalloon, true, "dynamic extra was not attached to its authored runtime parent");
    assert.ok(animatedParentFollow.balloonTravel > 0.01, `animated parent did not move: ${JSON.stringify(animatedParentFollow)}`);
    assert.ok(animatedParentFollow.relativeDrift < 0.0001, `dynamic extra drifted from its animated parent: ${JSON.stringify(animatedParentFollow)}`);
    const editAck = await postMode(page, "authoring", 4);
    assert.equal(editAck.contextToken, baseline.contextToken);
    assert.deepEqual(await page.evaluate(() => ({
      sameObject: editableObjects.get("added-cube") === window.__dynamicRootIdentity,
      sameWebGLContext: renderer.getContext() === window.__dynamicWebGLContext,
    })), { sameObject: true, sameWebGLContext: true }, "Edit/Play rebuilt the added object or WebGL context");

    const expectedGeometry = {
      plane: "PlaneGeometry",
      sphere: "SphereGeometry",
      cylinder: "CylinderGeometry",
      capsule: "CapsuleGeometry",
    };
    let revision = 4;
    for (const [primitive, geometry] of Object.entries(expectedGeometry)) {
      revision += 1;
      const next = await page.evaluate(({ primitiveType }) => {
        const scene = JSON.parse(JSON.stringify(runtimeSceneDocument));
        scene.objects.find((object) => object.id === "added-cube").components
          .find((component) => component.type === "mesh-renderer").source.primitive = primitiveType;
        return scene;
      }, { primitiveType: primitive });
      await postScene(page, next, revision);
      assert.equal(await page.evaluate(() => editableObjects.get("added-cube").children[0].geometry.type), geometry, `${primitive} was not reconciled`);
      assert.deepEqual(await page.evaluate(() => ({
        sameChild: editableObjects.get("nested-sphere") === window.__nestedRootIdentity,
        attachedToRebuiltParent: editableObjects.get("nested-sphere").parent === editableObjects.get("added-cube"),
        material: `#${editableObjects.get("nested-sphere").children[0].material.color.getHexString()}`,
      })), { sameChild: true, attachedToRebuiltParent: true, material: "#ff8844" }, "rebuilding a dynamic parent damaged its registered child");
    }
    assert.equal(revision, 8);

    const assetScene = await page.evaluate(() => {
      const scene = JSON.parse(JSON.stringify(runtimeSceneDocument));
      const added = scene.objects.find((object) => object.id === "added-cube");
      added.components.find((component) => component.type === "mesh-renderer").source = { kind: "asset", assetId: "asset-user-model" };
      added.components.find((component) => component.type === "mesh-renderer").material = { kind: "embedded", overrides: [] };
      return scene;
    });
    const assetRejection = await postScene(page, assetScene, 9, "game-port-studio:scene-preview-rejected");
    assert.match(assetRejection.error, /asset-backed mesh/i);
    assert.deepEqual(await page.evaluate(() => ({ revision: runtimeBridgeRevision, geometry: editableObjects.get("added-cube").children[0].geometry.type })), { revision: 8, geometry: "CapsuleGeometry" });

    const boundsScene = await page.evaluate(() => {
      const scene = JSON.parse(JSON.stringify(runtimeSceneDocument));
      scene.objects.find((object) => object.id === "added-cube").scale.x = 0.009;
      return scene;
    });
    const boundsRejection = await postScene(page, boundsScene, 9, "game-port-studio:scene-preview-rejected");
    assert.match(boundsRejection.error, /scale\.x is outside the supported range/i);

    const duplicateScene = await page.evaluate(() => {
      const scene = JSON.parse(JSON.stringify(runtimeSceneDocument));
      scene.objects.push(JSON.parse(JSON.stringify(scene.objects.find((object) => object.id === "added-cube"))));
      return scene;
    });
    const duplicateRejection = await postScene(page, duplicateScene, 9, "game-port-studio:scene-preview-rejected");
    assert.match(duplicateRejection.error, /invalid or duplicate id/i);

    const removedScene = await page.evaluate(() => {
      const scene = JSON.parse(JSON.stringify(runtimeSceneDocument));
      scene.objects = scene.objects.filter((object) => object.id !== "added-cube" && object.id !== "nested-sphere");
      return scene;
    });
    const removeAck = await postScene(page, removedScene, 9);
    assert.equal(removeAck.objectCount, EXPECTED_OBJECT_COUNT);
    const removed = await page.evaluate(() => ({
      object: editableObjects.has("added-cube"),
      nestedObject: editableObjects.has("nested-sphere"),
      dynamic: dynamicEditableObjectIds.has("added-cube"),
      collider: runtimeColliders.some((entry) => entry.id === "added-cube"),
      selected: studioAuthoring.selectedId,
      count: window.__zebraStudioValidation.snapshot().objectCount,
      contextToken: window.__zebraStudioValidation.snapshot().contextToken,
      fixedManifest: window.__zebraStudioValidation.snapshot().visualManifest,
    }));
    assert.equal(removed.object, false);
    assert.equal(removed.nestedObject, false);
    assert.equal(removed.dynamic, false);
    assert.equal(removed.collider, false);
    assert.equal(removed.selected, null);
    assert.equal(removed.count, EXPECTED_OBJECT_COUNT);
    assert.equal(removed.contextToken, baseline.contextToken);
    assert.deepEqual(removed.fixedManifest, baseline.fixedManifest, "dynamic reconciliation altered one of the fixed 222 visuals");

    const staleRejection = await postScene(page, removedScene, 8, "game-port-studio:scene-preview-rejected");
    assert.match(staleRejection.error, /older than active revision 9/i);
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
  } finally {
    await browser.close();
  }
});
