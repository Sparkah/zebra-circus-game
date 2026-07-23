import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const editorModelRoot = path.join(root, "models", "editor");

const assetDefinitions = [
  ["asset-mc9400", "MC9400", "mc9400-editor.glb"],
  ["asset-mc3400", "MC3400", "mc3400-editor.glb"],
  ["asset-ps30", "PS30", "ps30-editor.glb"],
  ["asset-tc8300", "TC8300", "tc8300-editor.glb"],
  ["asset-tent", "Circus Tent", "tent-editor.glb"],
  ["asset-arena-circle", "Arena Circle", "arena-circle.glb"],
  ["asset-dirt-ring", "Packed Dirt Ring", "arena-dirt-ring.glb"],
  ["asset-chalk-ring", "Chalk Ring", "arena-chalk-ring.glb"],
  ...["mc9400", "mc3400", "ps30", "tc8300"].map((id) => [
    `asset-qr-${id}`,
    `${id.toUpperCase()} QR Board`,
    `qr-${id}.glb`,
  ]),
  ["asset-barrel", "Arena Barrel", "arena-barrel.glb"],
  ["asset-podium", "Performer Podium", "performer-podium.glb"],
  ["asset-bleacher-seat", "Bleacher Seat Ring", "bleacher-seat.glb"],
  ["asset-bleacher-riser", "Bleacher Riser Ring", "bleacher-riser.glb"],
  ["asset-bunting-flag", "Bunting Flag", "bunting-flag.glb"],
  ...Array.from({ length: 40 }, (_, index) => {
    const suffix = String(index).padStart(2, "0");
    return [`asset-crowd-seated-${suffix}`, `Seated Audience ${index + 1}`, `crowd-seated-${suffix}.glb`];
  }),
  ...["char1", "char2", "char4", "char6", "man", "worker"].map((id) => [
    `asset-crowd-${id}`,
    `${id[0].toUpperCase()}${id.slice(1)} Crowd Model (1.2m)`,
    `crowd-${id}-normalized.glb`,
  ]),
  ["asset-tent-details", "Tent Poles, Lights, and Sign", "tent-details.glb"],
  ...["red", "blue", "yellow", "green", "magenta", "orange", "cyan", "pink"].map((color) => [
    `asset-balloon-${color}`,
    `${color[0].toUpperCase()}${color.slice(1)} Balloon`,
    `balloon-${color}.glb`,
  ]),
];

const assets = await Promise.all(assetDefinitions.map(async ([id, name, fileName]) => {
  const bytes = await readFile(path.join(editorModelRoot, fileName));
  return {
    id,
    name,
    type: "model",
    format: "glb",
    fileName,
    source: bytes.toString("base64"),
    bytes: bytes.length,
  };
}));

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
const ONE = Object.freeze({ x: 1, y: 1, z: 1 });
const vector = (x = 0, y = 0, z = 0) => ({ x, y, z });
const degrees = (radians) => radians * 180 / Math.PI;

function object(id, name, position = ZERO, components = [], options = {}) {
  return {
    id,
    name,
    parentId: options.parentId ?? null,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    position: { ...position },
    rotation: { ...(options.rotation ?? ZERO) },
    scale: { ...(options.scale ?? ONE) },
    components,
  };
}

function empty(id, name, parentId = null) {
  return object(id, name, ZERO, [], { parentId });
}

function mesh(assetId) {
  return {
    id: "mesh-renderer",
    type: "mesh-renderer",
    enabled: true,
    source: { kind: "asset", assetId },
    // GLBs are the visual source of truth. Named material overrides keep every
    // embedded texture/material intact while allowing Studio to replace exact
    // slots such as `MC9400 QR Face Material` without rebuilding geometry.
    material: { kind: "embedded", overrides: [] },
  };
}

function primitive(kind, color) {
  return {
    id: "mesh-renderer",
    type: "mesh-renderer",
    enabled: true,
    source: { kind: "primitive", primitive: kind },
    material: {
      kind: "inline",
      shading: "lit",
      baseColor: color,
      baseColorTextureAssetId: null,
      roughness: 0.72,
      metalness: 0.04,
      opacity: 1,
      alphaMode: "opaque",
      alphaCutoff: 0.5,
      doubleSided: false,
    },
  };
}

function collider(size = ONE, center = ZERO, isTrigger = false, enabled = true) {
  return {
    id: "box-collider",
    type: "box-collider",
    enabled,
    center: { ...center },
    size: { ...size },
    isTrigger,
  };
}

function moveFromInput(speed = 6) {
  return {
    id: "move-from-input",
    type: "move-from-input",
    enabled: true,
    inputActionId: "move",
    plane: "xz",
    space: "parent",
    speed,
  };
}

function directionalLight(color, intensity, castShadows = false) {
  return {
    id: "directional-light",
    type: "directional-light",
    enabled: true,
    color,
    intensity,
    castShadows,
  };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const objects = [
  empty("arena-root", "Zebra Circus Arena"),
  empty("devices-root", "Devices and QR Boards", "arena-root"),
  empty("bleachers-root", "Bleachers", "arena-root"),
  empty("decor-root", "Arena Decorations", "arena-root"),
  empty("bunting-root", "Bunting Flags", "arena-root"),
  empty("crowd-root", "Audience", "arena-root"),
  empty("balloons-root", "Scannable Balloons", "arena-root"),
  object("main-camera", "Player Start / Main Camera", vector(0, 1.7, 2), [
    {
      id: "camera",
      type: "camera",
      enabled: true,
      projection: "perspective",
      verticalFov: 72,
      nearClip: 0.05,
      farClip: 150,
    },
    moveFromInput(6),
    collider(vector(0.8, 1.7, 0.8), vector(0, -0.85, 0)),
  ]),
  object("arena-floor", "Arena Floor", ZERO, [mesh("asset-arena-circle"), collider(vector(1, 0.2, 1), vector(0, -0.1, 0))], {
    parentId: "arena-root",
    scale: vector(52, 1, 52),
  }),
  object("arena-dirt-ring", "Packed Dirt Ring", vector(0, 0.01, 0), [mesh("asset-dirt-ring")], {
    parentId: "arena-root",
    scale: vector(26, 1, 26),
  }),
  object("arena-performance-ring", "Performance Ring", vector(0, 0.02, 0), [mesh("asset-arena-circle")], {
    parentId: "arena-root",
    scale: vector(18, 1, 18),
  }),
  object("arena-chalk-ring", "Chalk Ring", vector(0, 0.03, 0), [mesh("asset-chalk-ring")], {
    parentId: "arena-root",
    scale: vector(18.4, 1, 18.4),
  }),
  object("tent", "Circus Tent", ZERO, [mesh("asset-tent")], { parentId: "arena-root" }),
  object("tent-details", "Tent Poles, String Lights, and Zebra Sign", ZERO, [mesh("asset-tent-details")], { parentId: "arena-root" }),
];

const lightDefinitions = [
  ["arena-ambient-light", "Warm Arena Fill", "#2a1800", 0.25, vector(0, 16, 10), vector(58, 180, 0), false],
  ["arena-top-light", "Main Top Light", "#fff0cc", 1.35, vector(0, 22, 0), vector(90, 0, 0), true],
  ["arena-rim-east", "East Amber Rim", "#ffaa44", 0.45, vector(8, 12, 0), vector(56.31, -90, 0), false],
  ["arena-rim-west", "West Amber Rim", "#ffaa44", 0.45, vector(-8, 12, 0), vector(56.31, 90, 0), false],
  ["arena-rim-north", "North Warm Rim", "#ffd080", 0.4, vector(0, 12, 8), vector(56.31, 180, 0), false],
  ["arena-rim-south", "South Cool Rim", "#7799ff", 0.35, vector(0, 12, -8), vector(56.31, 0, 0), false],
];
for (const [id, name, color, intensity, position, rotation, castShadows] of lightDefinitions) {
  objects.push(object(id, name, position, [directionalLight(color, intensity, castShadows)], {
    parentId: "arena-root",
    rotation,
  }));
}

const weaponNames = ["MC9400", "MC3400", "PS30", "TC8300"];
const weaponRadius = [5, 6.5, 8, 5];
weaponNames.forEach((name, index) => {
  const angle = index / weaponNames.length * Math.PI * 2;
  objects.push(object(
    `weapon-${name.toLowerCase()}`,
    `${name} Pickup`,
    vector(Math.cos(angle) * weaponRadius[index], 0.45, Math.sin(angle) * weaponRadius[index]),
    [mesh(`asset-${name.toLowerCase()}`)],
    { parentId: "devices-root", rotation: vector(0, index * 90, 0) },
  ));

  const qrAngle = angle + Math.PI * 0.18;
  const x = Math.cos(qrAngle) * 9;
  const z = Math.sin(qrAngle) * 9;
  objects.push(object(
    `qr-${name.toLowerCase()}`,
    `${name} QR Board`,
    vector(x, 3, z),
    [mesh(`asset-qr-${name.toLowerCase()}`), collider(vector(1.7, 3.8, 0.2), vector(0, -1.1, 0))],
    { parentId: "devices-root", rotation: vector(0, degrees(Math.atan2(-x, -z)), 0) },
  ));
});

const boundaryDefinitions = [
  ["north", 0, -21.5, 43, 1],
  ["south", 0, 21.5, 43, 1],
  ["west", -21.5, 0, 1, 43],
  ["east", 21.5, 0, 1, 43],
];
for (const [side, x, z, sx, sz] of boundaryDefinitions) {
  objects.push(object(
    `arena-boundary-${side}`,
    `Arena Boundary ${side[0].toUpperCase()}${side.slice(1)}`,
    vector(x, 1.5, z),
    [collider(vector(sx, 3, sz))],
    { parentId: "arena-root" },
  ));
}

for (let index = 0; index < 4; index++) {
  const angle = index / 4 * Math.PI * 2 + Math.PI / 4;
  objects.push(object(
    `barrel-${index}`,
    `Arena Barrel ${index + 1}`,
    vector(Math.cos(angle) * 7.2, 0.425, Math.sin(angle) * 7.2),
    [mesh("asset-barrel"), collider()],
    { parentId: "decor-root", scale: vector(0.84, 0.85, 0.84) },
  ));
}
objects.push(object("center-plinth", "Performer Podium", vector(0, 0.55, -2.5), [mesh("asset-podium"), collider()], {
  parentId: "decor-root",
  scale: vector(1.3, 1.1, 1.3),
}));

objects.push(object("trapeze-bar", "Trapeze Bar", vector(0, 17, 0), [primitive("cylinder", "#5c3010")], {
  parentId: "decor-root",
  rotation: vector(0, 0, 90),
  scale: vector(0.08, 2.5, 0.08),
}));
for (const [side, x] of [["left", -2.5], ["right", 2.5]]) {
  objects.push(object(`trapeze-rope-${side}`, `Trapeze Rope ${side[0].toUpperCase()}${side.slice(1)}`, vector(x, 21.5, 0), [primitive("cylinder", "#b89040")], {
    parentId: "decor-root",
    scale: vector(0.03, 4.5, 0.03),
  }));
}

for (let tier = 0; tier < 5; tier++) {
  const radius = 14 + tier * 1.4;
  const y = tier * 0.55 + 0.28;
  const suffix = String(tier).padStart(2, "0");
  objects.push(object(`bleacher-seat-${suffix}`, `Bleacher Seat ${tier + 1}`, vector(0, y, 0), [mesh("asset-bleacher-seat")], {
    parentId: "bleachers-root",
    scale: vector(radius / 14, 1, radius / 14),
  }));
  objects.push(object(`bleacher-riser-${suffix}`, `Bleacher Riser ${tier + 1}`, vector(0, y - 0.3, 0), [mesh("asset-bleacher-riser")], {
    parentId: "bleachers-root",
    scale: vector(radius / 14, 1, radius / 14),
  }));
}
for (let index = 0; index < 16; index++) {
  const angle = index / 16 * Math.PI * 2;
  objects.push(object(`bleacher-strut-${String(index).padStart(2, "0")}`, `Bleacher Support ${index + 1}`, vector(Math.cos(angle) * 17.5, 1.75, Math.sin(angle) * 17.5), [primitive("cube", "#2a2a2a")], {
    parentId: "bleachers-root",
    scale: vector(0.1, 3.5, 0.1),
  }));
}

for (let span = 0; span < 10; span++) {
  const angle0 = span / 10 * Math.PI * 2;
  const angle1 = (span + 1) / 10 * Math.PI * 2;
  const x0 = Math.cos(angle0) * 22;
  const z0 = Math.sin(angle0) * 22;
  const x1 = Math.cos(angle1) * 22;
  const z1 = Math.sin(angle1) * 22;
  for (let segment = 0; segment < 6; segment++) {
    const index = span * 6 + segment;
    const midpoint = (segment + 0.5) / 6;
    const sag = Math.sin(midpoint * Math.PI) * 1.2;
    const x = x0 + (x1 - x0) * midpoint;
    const z = z0 + (z1 - z0) * midpoint;
    objects.push(object(
      `bunting-${String(index).padStart(2, "0")}`,
      `Bunting Flag ${index + 1}`,
      vector(x, 19 - sag, z),
      [mesh("asset-bunting-flag")],
      {
        parentId: "bunting-root",
        // The single lightweight asset has a red front and white back. Flipping
        // alternating instances preserves the runtime's red/white pattern from
        // the player's view without spending another asset slot.
        rotation: vector(0, degrees(Math.atan2(-x, -z)) + (segment % 2 ? 180 : 0), 0),
      },
    ));
  }
}

const crowdRandom = seededRandom(0x5eb2a123);
for (let index = 0; index < 40; index++) {
  const angle = index / 40 * Math.PI * 2 + crowdRandom() * 0.3;
  const radius = 14.5 + crowdRandom() * 5.5;
  const y = crowdRandom() * 2.5;
  // Keep the exact original palette draw order even though each chosen palette
  // is baked into that spectator's GLB. Runtime and Edit now consume the same
  // deterministic seated visual and therefore cannot diverge by random draw.
  crowdRandom(); // skin
  crowdRandom(); // shirt
  crowdRandom(); // pants
  crowdRandom(); // hair
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const yaw = degrees(Math.atan2(x, z) + Math.PI + (crowdRandom() - 0.5) * 0.3);
  const suffix = String(index).padStart(2, "0");
  objects.push(object(`crowd-proc-${suffix}`, `Seated Audience Member ${index + 1}`, vector(x, y, z), [mesh(`asset-crowd-seated-${suffix}`)], {
    parentId: "crowd-root",
    rotation: vector(0, yaw, 0),
    scale: ONE,
  }));
}
const crowdModelIds = ["char1", "char2", "char4", "char6", "man", "worker"];
for (let index = 0; index < 28; index++) {
  const angle = index / 28 * Math.PI * 2;
  const radius = 11.5 + (crowdRandom() - 0.5) * 1.5;
  const scale = 1.5 * (0.85 + crowdRandom() * 0.3);
  const modelId = crowdModelIds[index % crowdModelIds.length];
  objects.push(object(`crowd-gltf-${String(index).padStart(2, "0")}`, `Imported ${modelId} Audience Member ${index + 1}`, vector(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), [mesh(`asset-crowd-${modelId}`)], {
    parentId: "crowd-root",
    rotation: vector(0, degrees(angle + Math.PI), 0),
    scale: vector(scale, scale, scale),
  }));
}

const balloonColors = ["red", "blue", "yellow", "green", "magenta", "orange", "cyan", "pink"];
const balloonRandom = seededRandom(0xba1100a5);
for (let index = 0; index < 28; index++) {
  const angle = balloonRandom() * Math.PI * 2;
  const radius = balloonRandom() * 17 + 1;
  const height = 2 + balloonRandom() * 9;
  const color = balloonColors[index % balloonColors.length];
  objects.push(object(`balloon-${String(index).padStart(2, "0")}`, `${color[0].toUpperCase()}${color.slice(1)} Balloon ${index + 1}`, vector(Math.cos(angle) * radius, height, Math.sin(angle) * radius), [mesh(`asset-balloon-${color}`)], {
    parentId: "balloons-root",
  }));
}

const scene = {
  schema: "game-port-studio/scene@0.14",
  name: "Zebra Circus Blaster",
  background: "#111111",
  activeCameraId: "main-camera",
  inputActions: [{
    id: "move",
    name: "Move",
    valueType: "vector2",
    bindings: ["keyboard-wasd-arrows", "gamepad-left-stick", "touch-virtual-stick"],
  }],
  projectVariables: [],
  signals: [],
  projectEvents: [],
  assets,
  objects,
};

const outputPath = path.join(root, "zebra-circus.scene.json");
await writeFile(outputPath, `${JSON.stringify(scene, null, 2)}\n`);
const colliders = objects.filter((entry) => entry.components.some((component) => component.type === "box-collider")).length;
const binaryBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
console.log(`Wrote Zebra editor scene with ${objects.length} objects, ${colliders} colliders, ${assets.length} GLB assets, and ${binaryBytes} embedded binary bytes.`);
