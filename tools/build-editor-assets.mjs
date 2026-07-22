import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importGamePortStudioModule } from "./game-port-studio-path.mjs";

const THREE = await importGamePortStudioModule("three/build/three.module.js");
const { GLTFExporter } = await importGamePortStudioModule("three/examples/jsm/exporters/GLTFExporter.js");
const { chromium } = await importGamePortStudioModule("playwright/index.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "models", "editor");
await mkdir(output, { recursive: true });
await Promise.all(["qr-board.glb", "crowd-proxy.glb"].map((fileName) => rm(path.join(output, fileName), { force: true })));

if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class FileReader {
    result = null;
    onloadend = null;
    onerror = null;

    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          this.onloadend?.({ target: this });
        })
        .catch((error) => this.onerror?.(error));
    }

    readAsDataURL(blob) {
      blob.arrayBuffer()
        .then((buffer) => {
          this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
          this.onloadend?.({ target: this });
        })
        .catch((error) => this.onerror?.(error));
    }
  };
}

const exporter = new GLTFExporter();
const standard = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04, ...options });
const basic = (color, options = {}) => new THREE.MeshBasicMaterial({ color, ...options });

async function exportGlb(fileName, object, textureBindings = []) {
  object.updateMatrixWorld(true);
  const bytes = await new Promise((resolve, reject) => {
    exporter.parse(object, resolve, reject, { binary: true, onlyVisible: true });
  });
  const buffer = textureBindings.length
    ? withEmbeddedPngTextures(Buffer.from(bytes), textureBindings)
    : Buffer.from(bytes);
  await writeFile(path.join(output, fileName), buffer);
  return buffer.length;
}

function parseGlb(source) {
  const input = Buffer.from(source);
  if (input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(4) !== 2) throw new Error("Expected a GLB 2.0 file.");
  let offset = 12;
  let document = null;
  let binary = Buffer.alloc(0);
  while (offset < input.length) {
    const length = input.readUInt32LE(offset);
    const type = input.readUInt32LE(offset + 4);
    const chunk = input.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) document = JSON.parse(chunk.toString("utf8").replace(/[\u0000\u0020]+$/g, ""));
    if (type === 0x004e4942) binary = Buffer.from(chunk);
    offset += 8 + length;
  }
  if (!document) throw new Error("GLB JSON chunk is missing.");
  return { document, binary };
}

function encodeGlb(document, binary) {
  const json = Buffer.from(JSON.stringify(document), "utf8");
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const paddedJson = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = binary.length ? (4 - (binary.length % 4)) % 4 : 0;
  const paddedBinary = binary.length ? Buffer.concat([binary, Buffer.alloc(binaryPadding)]) : null;
  const total = 12 + 8 + paddedJson.length + (paddedBinary ? 8 + paddedBinary.length : 0);
  const result = Buffer.alloc(total);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(total, 8);
  result.writeUInt32LE(paddedJson.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(result, 20);
  if (paddedBinary) {
    const binaryHeader = 20 + paddedJson.length;
    result.writeUInt32LE(paddedBinary.length, binaryHeader);
    result.writeUInt32LE(0x004e4942, binaryHeader + 4);
    paddedBinary.copy(result, binaryHeader + 8);
  }
  return result;
}

function withEmbeddedPngTextures(source, bindings) {
  const { document, binary: sourceBinary } = parseGlb(source);
  document.bufferViews ??= [];
  document.images ??= [];
  document.samplers ??= [];
  document.textures ??= [];
  document.materials ??= [];
  const samplerIndex = document.samplers.push({
    magFilter: 9729,
    minFilter: 9987,
    wrapS: 33071,
    wrapT: 33071,
  }) - 1;
  let binary = Buffer.from(sourceBinary);

  for (const binding of bindings) {
    const alignment = (4 - (binary.length % 4)) % 4;
    if (alignment) binary = Buffer.concat([binary, Buffer.alloc(alignment)]);
    const byteOffset = binary.length;
    binary = Buffer.concat([binary, binding.png]);
    const bufferView = document.bufferViews.push({ buffer: 0, byteOffset, byteLength: binding.png.length }) - 1;
    const image = document.images.push({ name: binding.imageName, mimeType: "image/png", bufferView }) - 1;
    const texture = document.textures.push({ name: binding.imageName, sampler: samplerIndex, source: image }) - 1;
    const material = document.materials.find((candidate) => candidate.name === binding.materialName);
    if (!material) throw new Error(`Cannot bind ${binding.imageName}: material ${binding.materialName} is absent.`);
    material.pbrMetallicRoughness ??= {};
    material.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
    material.pbrMetallicRoughness.baseColorTexture = { index: texture };
  }

  document.buffers ??= [{}];
  document.buffers[0].byteLength = binary.length;
  return encodeGlb(document, binary);
}

function transformedGlb(source, { name, scale, translation, baseColorFactor = null }) {
  const { document, binary } = parseGlb(source);
  if (baseColorFactor) {
    for (const material of document.materials ?? []) {
      material.pbrMetallicRoughness ??= {};
      material.pbrMetallicRoughness.baseColorFactor = baseColorFactor;
      delete material.pbrMetallicRoughness.baseColorTexture;
    }
  }
  document.nodes ??= [];
  for (const scene of document.scenes ?? []) {
    const children = Array.isArray(scene.nodes) ? [...scene.nodes] : [];
    const wrapper = document.nodes.push({ name, translation, scale: [scale, scale, scale], children }) - 1;
    scene.nodes = [wrapper];
  }
  return encodeGlb(document, binary);
}

async function normalizeSourceGlbs() {
  const definitions = [
    ["MC9400", 0.6806914793364744, [0.0007966385601026819, 0.0007044479836731775, 0.0033113751484909874]],
    ["MC3400", 0.6814586585059694, [-0.0002659673271117859, 0.0025454043977218245, 0.0025271973338278327]],
    ["PS30", 0.6784873039696663, [0.0012121177147764457, -0.018985520381810277, 0.03899114463538228]],
    ["TC8300", 0.6937194990204922, [0.000972732973960464, 0.009384226868842454, 0.005746650046951681]],
    // Zebra deliberately grounds the tent after fitting rather than centring Y.
    ["Tent", 206.37245855158477, [0.000002865882416535118, 0, 0.000005685554159763546], [0.025, 0.025, 0.025, 1]],
  ];
  const sizes = {};
  for (const [name, scale, translation, baseColorFactor] of definitions) {
    const source = await readFile(path.join(root, "models", `${name}.glb`));
    const fileName = `${name.toLowerCase()}-editor.glb`;
    const bytes = transformedGlb(source, { name: `${name} Editor Normalization`, scale, translation, baseColorFactor });
    await writeFile(path.join(output, fileName), bytes);
    sizes[fileName] = bytes.length;
  }
  const crowdDefinitions = [
    ["char1", 0.6472554145925521],
    ["char2", 0.6461464962516534],
    ["char4", 0.8659675399564433],
    ["char6", 0.45865092276597563],
    ["man", 0.2478697812026271],
    ["worker", 0.6429383277000825],
  ];
  for (const [name, scale] of crowdDefinitions) {
    const source = await readFile(path.join(root, "models", "crowd", `${name}.glb`));
    const fileName = `crowd-${name}-normalized.glb`;
    const bytes = transformedGlb(source, {
      name: `${name} Runtime 1.2m Normalization`,
      scale,
      translation: [0, 0, 0],
    });
    await writeFile(path.join(output, fileName), bytes);
    sizes[fileName] = bytes.length;
  }
  return sizes;
}

function circleSurface() {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 80), standard(0xb58a28, { roughness: 0.95 }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function dirtRing() {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(9 / 26, 0.5, 80), standard(0x7a2800, { roughness: 0.98, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function chalkRing() {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(8.9 / 18.4, 0.5, 80), basic(0xffffff, { side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

const WEAPONS = Object.freeze([
  { id: "MC9400", name: "MC9400" },
  { id: "MC3400", name: "MC3400" },
  { id: "PS30", name: "PS30" },
  { id: "TC8300", name: "TC8300" },
]);

const SKIN_PALETTE = Object.freeze([0xffdbac, 0xf5c5a3, 0xe0a882, 0xc68642, 0x8d5524, 0xd4a070]);
const SHIRT_PALETTE = Object.freeze([0xff3333, 0x3366ff, 0x33cc55, 0xffaa00, 0xcc44cc, 0x00ccdd, 0xff6699, 0xffee33, 0xff7733, 0x44aaff]);
const PANTS_PALETTE = Object.freeze([0x1a1a33, 0x334455, 0x442211, 0x1e3a1e, 0x2a2a2a, 0x553311, 0x1a2a44]);
const HAIR_PALETTE = Object.freeze([0x2b1800, 0x111111, 0xc8960c, 0xb22222, 0x777777, 0xf0e0a0, 0x3b1f0a]);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function runtimeCrowdBlueprints() {
  const random = seededRandom(0x5eb2a123);
  const pick = (palette) => palette[Math.floor(random() * palette.length)];
  return Array.from({ length: 40 }, (_, index) => {
    // Preserve the original runtime call order: three placement draws, four
    // palette draws, then one facing wobble draw per seated audience member.
    const angle = index / 40 * Math.PI * 2 + random() * 0.3;
    const radius = 14.5 + random() * 5.5;
    const y = random() * 2.5;
    const palette = {
      skin: pick(SKIN_PALETTE),
      shirt: pick(SHIRT_PALETTE),
      pants: pick(PANTS_PALETTE),
      hair: pick(HAIR_PALETTE),
    };
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const yaw = Math.atan2(x, z) + Math.PI + (random() - 0.5) * 0.3;
    return { index, x, y, z, yaw, palette };
  });
}

async function renderRuntimeQrTextures() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><meta charset=utf-8><title>Zebra QR asset bake</title>");
    const encoded = await page.evaluate((weapons) => {
      const flippedPng = (canvas) => {
        // GLTFExporter flips CanvasTexture pixels before embedding because
        // CanvasTexture.flipY is true. Mirror that exact conversion here.
        const output = document.createElement("canvas");
        output.width = canvas.width;
        output.height = canvas.height;
        const context = output.getContext("2d");
        context.translate(0, output.height);
        context.scale(1, -1);
        context.drawImage(canvas, 0, 0);
        return output.toDataURL("image/png").split(",")[1];
      };

      return weapons.map((weapon) => {
        const qr = document.createElement("canvas");
        qr.width = 256;
        qr.height = 256;
        const context = qr.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, 256, 256);
        const finder = (x, y) => {
          context.fillStyle = "#000";
          context.fillRect(x, y, 56, 56);
          context.fillStyle = "#fff";
          context.fillRect(x + 7, y + 7, 42, 42);
          context.fillStyle = "#000";
          context.fillRect(x + 14, y + 14, 28, 28);
        };
        finder(8, 8);
        finder(192, 8);
        finder(8, 192);
        context.fillStyle = "#000";
        const seed = weapon.id.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
        for (let row = 0; row < 21; row++) {
          for (let column = 0; column < 21; column++) {
            if (row < 9 && column < 9) continue;
            if (row < 9 && column > 11) continue;
            if (row > 11 && column < 9) continue;
            const value = Math.sin(row * 17 + column * 11 + seed) * Math.cos(row * 7 - column * 13 + seed) > 0.1;
            if (value) context.fillRect(72 + column * 9, 72 + row * 9, 8, 8);
          }
        }
        context.strokeStyle = "#e8c840";
        context.lineWidth = 5;
        context.strokeRect(3, 3, 250, 250);
        context.fillStyle = "#000";
        context.font = "bold 13px Arial";
        context.textAlign = "center";
        context.fillText(weapon.name, 128, 245);

        const label = document.createElement("canvas");
        label.width = 300;
        label.height = 70;
        const labelContext = label.getContext("2d");
        labelContext.fillStyle = "#000";
        labelContext.fillRect(0, 0, 300, 70);
        labelContext.fillStyle = "#e8c840";
        labelContext.font = "bold 24px Arial";
        labelContext.textAlign = "center";
        labelContext.fillText(weapon.name, 150, 45);
        return { id: weapon.id, qr: flippedPng(qr), label: flippedPng(label) };
      });
    }, WEAPONS);
    return new Map(encoded.map((entry) => [entry.id, {
      qr: Buffer.from(entry.qr, "base64"),
      label: Buffer.from(entry.label, "base64"),
    }]));
  } finally {
    await browser.close();
  }
}

function qrBoard(weapon) {
  const root = new THREE.Group();
  root.name = `${weapon.name} QR Board`;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.06), standard(0x111111, { roughness: 1, metalness: 0 }));
  board.name = "QR Board Backing";
  const faceMaterial = basic(0xffffff);
  faceMaterial.name = `${weapon.id} QR Face Material`;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), faceMaterial);
  face.name = `${weapon.id} QR Face`;
  face.position.z = 0.035;
  root.add(board, face);
  const labelMaterial = basic(0xffffff);
  labelMaterial.name = `${weapon.id} QR Label Material`;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.42), labelMaterial);
  label.name = `${weapon.id} QR Label`;
  label.position.set(0, 1.01, 0.035);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 8), standard(0x333333, { roughness: 1, metalness: 0 }));
  post.name = "QR Board Post";
  post.position.y = -1.9;
  root.add(label, post);
  return root;
}

function barrel() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 14), standard(0x5c3010)));
  for (const y of [-0.3235, -0.0059, 0.3235]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.524, 0.0333, 5, 20), standard(0x333333, { metalness: 0.75 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    root.add(band);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.0647, 14), standard(0x5c3010));
  lid.position.y = 0.5353;
  root.add(lid);
  return root;
}

function podium() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.423, 0.5, 1, 16), standard(0x5c3010)));
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.446, 0.446, 0.064, 16), standard(0xd4a800, { metalness: 0.5 }));
  top.position.y = 0.527;
  root.add(top);
  return root;
}

function bleacherRing(radius, tube, color) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 3, 120), standard(color));
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function buntingFlag() {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.25, 0.275, 0,
    0.25, 0.275, 0,
    0, -0.275, 0,
  ], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  const redFace = new THREE.Mesh(geometry, standard(0xcc0000, { side: THREE.FrontSide }));
  redFace.position.z = 0.002;
  const whiteFace = new THREE.Mesh(geometry, standard(0xffffff, { side: THREE.FrontSide }));
  whiteFace.rotation.y = Math.PI;
  whiteFace.position.z = -0.002;
  root.add(redFace, whiteFace);
  return root;
}

function seatedFigure(blueprint) {
  const root = new THREE.Group();
  root.name = `Seated Audience ${String(blueprint.index + 1).padStart(2, "0")}`;
  const material = (color, name) => {
    const result = standard(color, { roughness: 1, metalness: 0 });
    result.name = name;
    return result;
  };
  const skin = material(blueprint.palette.skin, "Audience Skin");
  const shirt = material(blueprint.palette.shirt, "Audience Shirt");
  const pants = material(blueprint.palette.pants, "Audience Pants");
  const hair = material(blueprint.palette.hair, "Audience Hair");
  const shoe = material(0x1a0f05, "Audience Shoes");
  const benchMaterial = material(0x5a3010, "Audience Bench");
  const eyeMaterial = material(0x111111, "Audience Eyes");

  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.3), benchMaterial);
  bench.name = "Bench Seat";
  bench.position.set(0, 0.43, 0.06);
  root.add(bench);

  for (const [side, x] of [["Left", -0.085], ["Right", 0.085]]) {
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.058, 0.36, 7), pants);
    thigh.name = `${side} Thigh`;
    thigh.rotation.x = Math.PI / 2;
    thigh.position.set(x, 0.45, 0.18);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.052, 0.42, 7), pants);
    shin.name = `${side} Shin`;
    shin.position.set(x, 0.23, 0.37);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.065, 0.17), shoe);
    foot.name = `${side} Shoe`;
    foot.position.set(x, 0.03, 0.40);
    root.add(thigh, shin, foot);
  }

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.16), pants);
  hips.name = "Hips";
  hips.position.set(0, 0.48, 0.02);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.4, 0.13), shirt);
  torso.name = "Torso";
  torso.position.set(0, 0.72, -0.02);
  root.add(hips, torso);

  for (const [side, x] of [["Left", -0.165], ["Right", 0.165]]) {
    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.046, 0.24, 6), shirt);
    upperArm.name = `${side} Upper Arm`;
    upperArm.rotation.x = Math.PI * 0.42;
    upperArm.position.set(x, 0.66, 0.1);
    const lowerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.22, 6), skin);
    lowerArm.name = `${side} Lower Arm`;
    lowerArm.rotation.x = Math.PI * 0.5;
    lowerArm.position.set(x, 0.46, 0.26);
    root.add(upperArm, lowerArm);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.1, 7), skin);
  neck.name = "Neck";
  neck.position.set(0, 0.95, -0.01);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 9), skin);
  head.name = "Head";
  head.position.set(0, 1.08, -0.01);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
  hairCap.name = "Hair Cap";
  hairCap.position.set(0, 1.08, -0.01);
  root.add(neck, head, hairCap);
  for (const [side, x] of [["Left", -0.042], ["Right", 0.042]]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 5), eyeMaterial);
    eye.name = `${side} Eye`;
    eye.position.set(x, 1.085, 0.104);
    root.add(eye);
  }
  return root;
}

function balloon(color) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 16), standard(color, { roughness: 0.3, metalness: 0.05 }));
  body.scale.y = 1.28;
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), standard(color));
  knot.position.y = -0.49;
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.4, 4), basic(0xffffff));
  string.position.y = -1.2;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), basic(0xffffff, { side: THREE.DoubleSide }));
  tag.position.set(0, 0.05, 0.42);
  root.add(body, knot, string, tag);
  const moduleGeometry = new THREE.PlaneGeometry(0.035, 0.035);
  const moduleMaterial = basic(0x111111, { side: THREE.DoubleSide });
  for (let row = 0; row < 5; row++) for (let column = 0; column < 5; column++) {
    if ((row * 3 + column * 5 + row * column) % 2) continue;
    const module = new THREE.Mesh(moduleGeometry, moduleMaterial);
    module.position.set(-0.07 + column * 0.035, 0.12 - row * 0.035, 0.423);
    root.add(module);
  }
  return root;
}

function tentDetails() {
  const root = new THREE.Group();
  const pole = standard(0xe6e6e6, { metalness: 0.45 });
  const dark = standard(0x1a1a1a, { metalness: 0.75 });
  const gold = standard(0xd4a800, { metalness: 0.8 });
  root.add(zebraTentLining());
  const shaftGeometry = new THREE.CylinderGeometry(0.13, 0.15, 19, 10);
  const collarGeometry = new THREE.CylinderGeometry(0.22, 0.25, 0.3, 10);
  const finialGeometry = new THREE.ConeGeometry(0.18, 0.5, 8);
  for (let index = 0; index < 10; index++) {
    const angle = index / 10 * Math.PI * 2;
    const x = Math.cos(angle) * 22;
    const z = Math.sin(angle) * 22;
    const shaft = new THREE.Mesh(shaftGeometry, pole);
    shaft.position.set(x, 9.5, z);
    const collar = new THREE.Mesh(collarGeometry, dark);
    collar.position.set(x, 0.15, z);
    const finial = new THREE.Mesh(finialGeometry, gold);
    finial.position.set(x, 19.3, z);
    root.add(shaft, collar, finial);
  }
  const bulbColors = [0xff2020, 0x22ff22, 0x2222ff, 0xffff22, 0xff22ff, 0x22ffff];
  const bulbGeometry = new THREE.SphereGeometry(0.07, 6, 6);
  const bulbMaterials = bulbColors.map((color) => basic(color));
  for (let ring = 0; ring < 4; ring++) {
    const radius = 8 + ring * 3.5;
    const height = 13 - ring * 1.5;
    const count = 18 + ring * 10;
    for (let index = 0; index < count; index++) {
      const angle = index / count * Math.PI * 2;
      const bulb = new THREE.Mesh(bulbGeometry, bulbMaterials[(index + ring) % bulbMaterials.length]);
      bulb.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      root.add(bulb);
    }
  }
  const sign = new THREE.Mesh(new THREE.BoxGeometry(7, 1.75, 0.08), basic(0x050505));
  sign.position.set(0, 5.5, -17);
  const signInset = new THREE.Mesh(new THREE.BoxGeometry(6.65, 1.38, 0.09), basic(0xe8c840));
  signInset.position.set(0, 5.5, -17.01);
  const signFace = new THREE.Mesh(new THREE.BoxGeometry(6.42, 1.15, 0.1), basic(0x050505));
  signFace.position.set(0, 5.5, -17.02);
  root.add(sign, signInset, signFace);
  return root;
}

function zebraTentLining() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const dark = new THREE.Color(0x090909);
  const warm = new THREE.Color(0xc08b22);
  const radialSegments = 72;
  const wallRows = 18;
  const roofRows = 16;

  const pushQuad = (a, b, c, d, normalA, normalB, color) => {
    const offset = positions.length / 3;
    for (const point of [a, b, c, d]) positions.push(point.x, point.y, point.z);
    for (const normal of [normalA, normalA, normalB, normalB]) normals.push(normal.x, normal.y, normal.z);
    for (let index = 0; index < 4; index++) colors.push(color.r, color.g, color.b);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };

  const ringPoint = (radius, height, segment) => {
    const angle = segment / radialSegments * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  };
  const inwardNormal = (segment) => {
    const angle = segment / radialSegments * Math.PI * 2;
    return new THREE.Vector3(-Math.cos(angle), 0, -Math.sin(angle));
  };
  const stripeColor = (segment, row) => ((segment + row * 2) % 11 < 2 ? warm : dark);

  for (let row = 0; row < wallRows; row++) {
    const y0 = row / wallRows * 17;
    const y1 = (row + 1) / wallRows * 17;
    for (let segment = 0; segment < radialSegments; segment++) {
      const next = segment + 1;
      pushQuad(
        ringPoint(23.92, y0, segment),
        ringPoint(23.92, y0, next),
        ringPoint(23.92, y1, next),
        ringPoint(23.92, y1, segment),
        inwardNormal(segment),
        inwardNormal(next),
        stripeColor(segment, row),
      );
    }
  }

  for (let row = 0; row < roofRows; row++) {
    const t0 = row / roofRows;
    const t1 = (row + 1) / roofRows;
    const radius0 = 23.92 * (1 - t0) + 0.35 * t0;
    const radius1 = 23.92 * (1 - t1) + 0.35 * t1;
    const y0 = 17 + t0 * 14;
    const y1 = 17 + t1 * 14;
    for (let segment = 0; segment < radialSegments; segment++) {
      const next = segment + 1;
      const n0 = inwardNormal(segment).setY(-0.45).normalize();
      const n1 = inwardNormal(next).setY(-0.45).normalize();
      pushQuad(
        ringPoint(radius0, y0, segment),
        ringPoint(radius0, y0, next),
        ringPoint(radius1, y1, next),
        ringPoint(radius1, y1, segment),
        n0,
        n1,
        stripeColor(segment, row + wallRows),
      );
    }
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = standard(0xffffff, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
  const lining = new THREE.Mesh(geometry, material);
  lining.name = "Zebra striped tent lining";
  return lining;
}

const qrTextures = await renderRuntimeQrTextures();
const crowdBlueprints = runtimeCrowdBlueprints();
const sizes = await normalizeSourceGlbs();
Object.assign(sizes, {
  "arena-circle.glb": await exportGlb("arena-circle.glb", circleSurface()),
  "arena-dirt-ring.glb": await exportGlb("arena-dirt-ring.glb", dirtRing()),
  "arena-chalk-ring.glb": await exportGlb("arena-chalk-ring.glb", chalkRing()),
  "arena-barrel.glb": await exportGlb("arena-barrel.glb", barrel()),
  "performer-podium.glb": await exportGlb("performer-podium.glb", podium()),
  "bleacher-seat.glb": await exportGlb("bleacher-seat.glb", bleacherRing(14, 0.22, 0x6b3e1c)),
  "bleacher-riser.glb": await exportGlb("bleacher-riser.glb", bleacherRing(14, 0.12, 0x3e2008)),
  "bunting-flag.glb": await exportGlb("bunting-flag.glb", buntingFlag()),
  "tent-details.glb": await exportGlb("tent-details.glb", tentDetails()),
});

for (const weapon of WEAPONS) {
  const fileName = `qr-${weapon.id.toLowerCase()}.glb`;
  const textures = qrTextures.get(weapon.id);
  sizes[fileName] = await exportGlb(fileName, qrBoard(weapon), [
    {
      materialName: `${weapon.id} QR Face Material`,
      imageName: `${weapon.id} Runtime QR Texture`,
      png: textures.qr,
    },
    {
      materialName: `${weapon.id} QR Label Material`,
      imageName: `${weapon.id} Runtime Label Texture`,
      png: textures.label,
    },
  ]);
}

for (const blueprint of crowdBlueprints) {
  const fileName = `crowd-seated-${String(blueprint.index).padStart(2, "0")}.glb`;
  sizes[fileName] = await exportGlb(fileName, seatedFigure(blueprint));
}

const balloonColors = {
  red: 0xff2222,
  blue: 0x2266ff,
  yellow: 0xffee00,
  green: 0x22dd44,
  magenta: 0xff44dd,
  orange: 0xff8822,
  cyan: 0x44eeff,
  pink: 0xff6688,
};
for (const [name, color] of Object.entries(balloonColors)) {
  const fileName = `balloon-${name}.glb`;
  sizes[fileName] = await exportGlb(fileName, balloon(color));
}

console.log(JSON.stringify({ output, files: sizes, totalBytes: Object.values(sizes).reduce((sum, value) => sum + value, 0) }, null, 2));
