import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALL_OBJECT_IDS,
  BALLOON_IDS,
  BLEACHER_IDS,
  BLEACHER_RISER_IDS,
  BLEACHER_SEAT_IDS,
  BLEACHER_STRUT_IDS,
  BUNTING_IDS,
  CATEGORY_ROOT_IDS,
  EXPECTED_ASSET_COUNT,
  EXPECTED_ASSET_FILES,
  EXPECTED_OBJECT_COUNT,
  EXPECTED_VISUAL_STRUCTURE_SHA256,
  GLTF_CROWD_IDS,
  LIGHT_IDS,
  MAX_EMBEDDED_ASSET_BYTES,
  PROCEDURAL_CROWD_IDS,
  TRAPEZE_IDS,
} from "./parity-contract.mjs";

const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenePath = path.join(gameRoot, "zebra-circus.scene.json");
const editorModelsPath = path.join(gameRoot, "models", "editor");

const sorted = (values) => [...values].sort();

function objectMap(scene) {
  return new Map(scene.objects.map((object) => [object.id, object]));
}

function meshRenderer(object) {
  return object.components.find((component) => component.type === "mesh-renderer") ?? null;
}

function boxCollider(object) {
  return object.components.find((component) => component.type === "box-collider") ?? null;
}

function assertDirectParent(objects, ids, parentId) {
  for (const id of ids) {
    assert.equal(objects.get(id)?.parentId, parentId, `${id} must be a direct child of ${parentId}`);
  }
}

function assertAssetFile(objects, assets, id, expectedFile) {
  const renderer = meshRenderer(objects.get(id));
  assert.equal(renderer?.source?.kind, "asset", `${id} must use an editor GLB instead of a coarse primitive`);
  assert.equal(assets.get(renderer.source.assetId)?.fileName, expectedFile, `${id} must use ${expectedFile}`);
}

function parseGlb(bytes) {
  let offset = 12;
  let document = null;
  let binary = Buffer.alloc(0);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, "asset must be a GLB container");
  assert.equal(bytes.readUInt32LE(4), 2, "asset must be GLB 2.0");
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) document = JSON.parse(chunk.toString("utf8").replace(/[\u0000\u0020]+$/g, ""));
    if (type === 0x004e4942) binary = Buffer.from(chunk);
    offset += 8 + length;
  }
  assert.ok(document, "GLB JSON chunk is required");
  return { document, binary };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function linearColorFactor(hex) {
  const convert = (component) => {
    const srgb = component / 255;
    return srgb < 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return [convert((hex >> 16) & 0xff), convert((hex >> 8) & 0xff), convert(hex & 0xff), 1];
}

function assertNumbersClose(actual, expected, label, epsilon = 1e-9) {
  assert.equal(actual.length, expected.length, `${label} length drifted`);
  for (let index = 0; index < expected.length; index++) {
    assert.ok(Math.abs(actual[index] - expected[index]) <= epsilon, `${label}[${index}] drifted: ${actual[index]} != ${expected[index]}`);
  }
}

test("expanded Zebra scene has the exact stable authoring inventory", async () => {
  const scene = JSON.parse(await readFile(scenePath, "utf8"));
  const objects = objectMap(scene);

  assert.equal(scene.schema, "game-port-studio/scene@0.14");
  assert.equal(scene.activeCameraId, "main-camera");
  assert.equal(scene.objects.length, EXPECTED_OBJECT_COUNT);
  assert.equal(objects.size, EXPECTED_OBJECT_COUNT, "scene object IDs must be unique");
  assert.deepEqual(sorted(objects.keys()), sorted(ALL_OBJECT_IDS), "generated scene IDs drifted from the runtime/editor parity contract");

  for (const rootId of CATEGORY_ROOT_IDS) {
    const root = objects.get(rootId);
    assert.ok(root, `missing category root ${rootId}`);
    assert.equal(root.components.length, 0, `${rootId} must remain a transform-only category root`);
    assert.ok(scene.objects.some((object) => object.parentId === rootId), `${rootId} must own at least one direct child`);
  }

  assertDirectParent(objects, BLEACHER_IDS, "bleachers-root");
  assertDirectParent(objects, BUNTING_IDS, "bunting-root");
  assertDirectParent(objects, [...PROCEDURAL_CROWD_IDS, ...GLTF_CROWD_IDS], "crowd-root");
  assertDirectParent(objects, BALLOON_IDS, "balloons-root");
  assertDirectParent(objects, TRAPEZE_IDS, "decor-root");
  assertDirectParent(objects, LIGHT_IDS, "arena-root");
  assert.equal(objects.get("tent-details")?.parentId, "arena-root", "tent details must remain an independently movable arena assembly");

  assert.equal(scene.objects.filter((object) => object.parentId === "bleachers-root").length, 26);
  assert.equal(scene.objects.filter((object) => object.parentId === "bunting-root").length, 60);
  assert.equal(scene.objects.filter((object) => object.parentId === "crowd-root").length, 68);
  assert.equal(scene.objects.filter((object) => object.parentId === "balloons-root").length, 28);

  for (const id of LIGHT_IDS) {
    const object = objects.get(id);
    assert.ok(object.components.some((component) => component.type === "directional-light"), `${id} must expose an editable light component`);
  }

  assert.equal(BLEACHER_SEAT_IDS.length, 5);
  assert.equal(BLEACHER_RISER_IDS.length, 5);
  assert.equal(BLEACHER_STRUT_IDS.length, 16);
  assert.equal(PROCEDURAL_CROWD_IDS.length, 40);
  assert.equal(GLTF_CROWD_IDS.length, 28);
  assert.equal(BUNTING_IDS.length, 60);
  assert.equal(BALLOON_IDS.length, 28);
  assert.equal(TRAPEZE_IDS.length, 3);

  const player = objects.get("main-camera");
  assert.ok(player.components.some((component) => component.type === "move-from-input" && component.enabled), "player movement component is required");
  assert.ok(boxCollider(player)?.enabled, "player collider is required");
  for (const id of ["arena-boundary-north", "arena-boundary-south", "arena-boundary-west", "arena-boundary-east"]) {
    assert.ok(boxCollider(objects.get(id))?.enabled, `${id} must retain its authored collider`);
  }
});

test("expanded Zebra scene uses the bounded, exact editor asset pack", async () => {
  const scene = JSON.parse(await readFile(scenePath, "utf8"));
  const objects = objectMap(scene);
  const assets = new Map(scene.assets.map((asset) => [asset.id, asset]));

  assert.equal(scene.assets.length, EXPECTED_ASSET_COUNT);
  assert.equal(assets.size, EXPECTED_ASSET_COUNT, "asset IDs must be unique");
  assert.deepEqual(sorted(scene.assets.map((asset) => asset.fileName)), sorted(EXPECTED_ASSET_FILES));

  let totalEmbeddedBytes = 0;
  for (const asset of scene.assets) {
    assert.equal(asset.type, "model", `${asset.id} must be a model asset`);
    assert.equal(asset.format, "glb", `${asset.id} must be an embedded GLB`);
    assert.equal(typeof asset.source, "string", `${asset.id} is missing embedded bytes`);
    const decoded = Buffer.from(asset.source, "base64");
    assert.equal(decoded.toString("base64"), asset.source, `${asset.id} source is not canonical base64`);
    assert.equal(decoded.length, asset.bytes, `${asset.id} byte metadata is stale`);
    const checkedIn = await readFile(path.join(editorModelsPath, asset.fileName));
    assert.ok(decoded.equals(checkedIn), `${asset.id} does not match models/editor/${asset.fileName}`);
    totalEmbeddedBytes += decoded.length;
  }
  assert.ok(
    totalEmbeddedBytes <= MAX_EMBEDDED_ASSET_BYTES,
    `embedded asset budget exceeded: ${totalEmbeddedBytes} > ${MAX_EMBEDDED_ASSET_BYTES}`,
  );

  const referencedAssetIds = new Set();
  for (const object of scene.objects) {
    const renderer = meshRenderer(object);
    if (renderer?.source?.kind !== "asset") continue;
    assert.ok(assets.has(renderer.source.assetId), `${object.id} references missing asset ${renderer.source.assetId}`);
    referencedAssetIds.add(renderer.source.assetId);
  }
  assert.deepEqual(sorted(referencedAssetIds), sorted(assets.keys()), "every embedded editor asset must be used by the scene");

  assertAssetFile(objects, assets, "arena-floor", "arena-circle.glb");
  assertAssetFile(objects, assets, "arena-performance-ring", "arena-circle.glb");
  assertAssetFile(objects, assets, "arena-dirt-ring", "arena-dirt-ring.glb");
  assertAssetFile(objects, assets, "arena-chalk-ring", "arena-chalk-ring.glb");
  assertAssetFile(objects, assets, "tent", "tent-editor.glb");
  assertAssetFile(objects, assets, "tent-details", "tent-details.glb");
  assertAssetFile(objects, assets, "weapon-mc9400", "mc9400-editor.glb");
  assertAssetFile(objects, assets, "weapon-mc3400", "mc3400-editor.glb");
  assertAssetFile(objects, assets, "weapon-ps30", "ps30-editor.glb");
  assertAssetFile(objects, assets, "weapon-tc8300", "tc8300-editor.glb");

  for (const id of ["qr-mc9400", "qr-mc3400", "qr-ps30", "qr-tc8300"]) {
    assertAssetFile(objects, assets, id, `${id}.glb`);
  }
  for (const id of ["barrel-0", "barrel-1", "barrel-2", "barrel-3"]) assertAssetFile(objects, assets, id, "arena-barrel.glb");
  assertAssetFile(objects, assets, "center-plinth", "performer-podium.glb");
  for (const id of BLEACHER_SEAT_IDS) assertAssetFile(objects, assets, id, "bleacher-seat.glb");
  for (const id of BLEACHER_RISER_IDS) assertAssetFile(objects, assets, id, "bleacher-riser.glb");
  for (const id of BUNTING_IDS) assertAssetFile(objects, assets, id, "bunting-flag.glb");
  for (const [index, id] of PROCEDURAL_CROWD_IDS.entries()) {
    assertAssetFile(objects, assets, id, `crowd-seated-${String(index).padStart(2, "0")}.glb`);
  }
  const crowdCycle = ["char1", "char2", "char4", "char6", "man", "worker"];
  for (const [index, id] of GLTF_CROWD_IDS.entries()) {
    assertAssetFile(objects, assets, id, `crowd-${crowdCycle[index % crowdCycle.length]}-normalized.glb`);
  }

  assert.ok(
    scene.assets.every((asset) => !asset.id.includes("proxy") && !asset.fileName.includes("proxy")),
    "exact Zebra authoring must never fall back to proxy assets",
  );

  const visualFilePattern = /^(?:qr-(?:mc9400|mc3400|ps30|tc8300)|crowd-(?:seated-\d{2}|char1-normalized|char2-normalized|char4-normalized|char6-normalized|man-normalized|worker-normalized))\.glb$/;
  const exactVisualAssets = scene.assets
    .filter((asset) => visualFilePattern.test(asset.fileName))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  assert.equal(exactVisualAssets.length, 50, "four QR boards, forty seated people, and six source crowd models must be exact assets");

  const crowdNormalization = new Map([
    ["char1", 0.6472554145925521],
    ["char2", 0.6461464962516534],
    ["char4", 0.8659675399564433],
    ["char6", 0.45865092276597563],
    ["man", 0.2478697812026271],
    ["worker", 0.6429383277000825],
  ]);
  const qrFaceTextureHashes = new Set();
  const visualDocuments = new Map();
  for (const asset of exactVisualAssets) {
    const bytes = Buffer.from(asset.source, "base64");
    const { document, binary } = parseGlb(bytes);
    visualDocuments.set(asset.fileName, document);
    if (asset.fileName.startsWith("qr-")) {
      assert.equal(document.meshes?.length, 4, `${asset.fileName} must contain backing, exact QR face, exact label, and post`);
      assert.equal(document.images?.length, 2, `${asset.fileName} must embed its weapon-specific QR and label PNGs`);
      assert.ok(document.nodes.some((node) => node.name?.endsWith("QR Face")), `${asset.fileName} is missing its editable QR face mesh`);
      assert.ok(document.nodes.some((node) => node.name?.endsWith("QR Label")), `${asset.fileName} is missing its editable label mesh`);
      const qrImage = document.images.find((image) => image.name?.endsWith("Runtime QR Texture"));
      const qrBufferView = document.bufferViews[qrImage?.bufferView];
      assert.ok(qrBufferView, `${asset.fileName} has no embedded runtime QR pixels`);
      qrFaceTextureHashes.add(sha256(binary.subarray(qrBufferView.byteOffset ?? 0, (qrBufferView.byteOffset ?? 0) + qrBufferView.byteLength)));
    } else if (asset.fileName.startsWith("crowd-seated-")) {
      assert.equal(document.meshes?.length, 18, `${asset.fileName} must preserve the runtime seated anatomy`);
      assert.equal(document.nodes?.length, 19, `${asset.fileName} must expose every seated mesh beneath one visual root`);
      assert.deepEqual(
        new Set(document.materials?.map((material) => material.name)),
        new Set(["Audience Bench", "Audience Pants", "Audience Shoes", "Audience Shirt", "Audience Skin", "Audience Hair", "Audience Eyes"]),
        `${asset.fileName} must preserve its deterministic original palette slots`,
      );
      assert.ok(document.nodes.some((node) => node.name === "Bench Seat"), `${asset.fileName} must be seated, not a standing proxy`);
      assert.ok(document.nodes.some((node) => node.name === "Left Thigh"), `${asset.fileName} is missing its seated thigh pose`);
      assert.ok(document.nodes.some((node) => node.name === "Left Shin"), `${asset.fileName} is missing its hanging shin pose`);
    } else {
      const modelId = asset.fileName.match(/^crowd-(.+)-normalized\.glb$/)?.[1];
      const wrapper = document.nodes.find((node) => node.name === `${modelId} Runtime 1.2m Normalization`);
      assert.deepEqual(wrapper?.scale, [crowdNormalization.get(modelId), crowdNormalization.get(modelId), crowdNormalization.get(modelId)], `${asset.fileName} has stale 1.2m normalization`);
    }
  }
  assert.equal(qrFaceTextureHashes.size, 4, "all four editable QR faces must retain distinct weapon-specific pixels");

  const skinPalette = [0xffdbac, 0xf5c5a3, 0xe0a882, 0xc68642, 0x8d5524, 0xd4a070];
  const shirtPalette = [0xff3333, 0x3366ff, 0x33cc55, 0xffaa00, 0xcc44cc, 0x00ccdd, 0xff6699, 0xffee33, 0xff7733, 0x44aaff];
  const pantsPalette = [0x1a1a33, 0x334455, 0x442211, 0x1e3a1e, 0x2a2a2a, 0x553311, 0x1a2a44];
  const hairPalette = [0x2b1800, 0x111111, 0xc8960c, 0xb22222, 0x777777, 0xf0e0a0, 0x3b1f0a];
  const crowdRandom = seededRandom(0x5eb2a123);
  const pick = (palette) => palette[Math.floor(crowdRandom() * palette.length)];
  for (let index = 0; index < 40; index++) {
    const angle = index / 40 * Math.PI * 2 + crowdRandom() * 0.3;
    const radius = 14.5 + crowdRandom() * 5.5;
    const y = crowdRandom() * 2.5;
    const expectedPalette = new Map([
      ["Audience Skin", pick(skinPalette)],
      ["Audience Shirt", pick(shirtPalette)],
      ["Audience Pants", pick(pantsPalette)],
      ["Audience Hair", pick(hairPalette)],
    ]);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const yaw = (Math.atan2(x, z) + Math.PI + (crowdRandom() - 0.5) * 0.3) * 180 / Math.PI;
    const suffix = String(index).padStart(2, "0");
    const object = objects.get(`crowd-proc-${suffix}`);
    assert.deepEqual(object.position, { x, y, z }, `crowd-proc-${suffix} placement no longer follows the deterministic original call order`);
    assert.equal(object.rotation.y, yaw, `crowd-proc-${suffix} facing no longer follows the deterministic original call order`);
    const document = visualDocuments.get(`crowd-seated-${suffix}.glb`);
    for (const [slot, color] of expectedPalette) {
      const actual = document.materials.find((material) => material.name === slot)?.pbrMetallicRoughness?.baseColorFactor;
      assert.ok(actual, `crowd-seated-${suffix}.glb is missing ${slot}`);
      assertNumbersClose(actual, linearColorFactor(color), `crowd-seated-${suffix}.glb ${slot}`);
    }
  }

  const fingerprintBindings = [...["qr-mc9400", "qr-mc3400", "qr-ps30", "qr-tc8300"], ...PROCEDURAL_CROWD_IDS, ...GLTF_CROWD_IDS].map((id) => {
    const object = objects.get(id);
    const renderer = meshRenderer(object);
    return {
      id,
      fileName: assets.get(renderer.source.assetId).fileName,
      position: object.position,
      rotation: object.rotation,
      scale: object.scale,
    };
  });
  const visualStructureFingerprint = sha256(JSON.stringify({
    assets: exactVisualAssets.map((asset) => ({ fileName: asset.fileName, bytes: asset.bytes, sha256: sha256(Buffer.from(asset.source, "base64")) })),
    bindings: fingerprintBindings,
  }));
  assert.equal(visualStructureFingerprint, EXPECTED_VISUAL_STRUCTURE_SHA256, "QR/crowd geometry, palettes, normalization, or stable scene bindings drifted");

  const balloonFiles = new Set();
  for (const id of BALLOON_IDS) {
    const renderer = meshRenderer(objects.get(id));
    const fileName = assets.get(renderer?.source?.assetId)?.fileName;
    assert.match(fileName ?? "", /^balloon-(?:red|blue|yellow|green|magenta|orange|cyan|pink)\.glb$/, `${id} must use a balloon preview asset`);
    balloonFiles.add(fileName);
  }
  assert.equal(balloonFiles.size, 8, "all eight runtime balloon colours must appear in the deterministic edit preview");
});
