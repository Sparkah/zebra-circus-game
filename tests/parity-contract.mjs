const pad2 = (value) => String(value).padStart(2, "0");

export const LEGACY_OBJECT_IDS = Object.freeze([
  "main-camera",
  "arena-floor",
  "arena-dirt-ring",
  "arena-performance-ring",
  "arena-chalk-ring",
  "tent",
  "weapon-mc9400",
  "weapon-mc3400",
  "weapon-ps30",
  "weapon-tc8300",
  "qr-mc9400",
  "qr-mc3400",
  "qr-ps30",
  "qr-tc8300",
  "barrel-0",
  "barrel-1",
  "barrel-2",
  "barrel-3",
  "center-plinth",
  "arena-boundary-north",
  "arena-boundary-south",
  "arena-boundary-west",
  "arena-boundary-east",
]);

export const CATEGORY_ROOT_IDS = Object.freeze([
  "arena-root",
  "devices-root",
  "bleachers-root",
  "decor-root",
  "bunting-root",
  "crowd-root",
  "balloons-root",
]);

export const LIGHT_IDS = Object.freeze([
  "arena-ambient-light",
  "arena-top-light",
  "arena-rim-east",
  "arena-rim-west",
  "arena-rim-north",
  "arena-rim-south",
]);

export const BLEACHER_SEAT_IDS = Object.freeze(Array.from({ length: 5 }, (_, index) => `bleacher-seat-${pad2(index)}`));
export const BLEACHER_RISER_IDS = Object.freeze(Array.from({ length: 5 }, (_, index) => `bleacher-riser-${pad2(index)}`));
export const BLEACHER_STRUT_IDS = Object.freeze(Array.from({ length: 16 }, (_, index) => `bleacher-strut-${pad2(index)}`));
export const BLEACHER_IDS = Object.freeze([...BLEACHER_SEAT_IDS, ...BLEACHER_RISER_IDS, ...BLEACHER_STRUT_IDS]);

export const TRAPEZE_IDS = Object.freeze([
  "trapeze-bar",
  "trapeze-rope-left",
  "trapeze-rope-right",
]);

export const BUNTING_IDS = Object.freeze(Array.from({ length: 60 }, (_, index) => `bunting-${pad2(index)}`));
export const PROCEDURAL_CROWD_IDS = Object.freeze(Array.from({ length: 40 }, (_, index) => `crowd-proc-${pad2(index)}`));
export const GLTF_CROWD_IDS = Object.freeze(Array.from({ length: 28 }, (_, index) => `crowd-gltf-${pad2(index)}`));
export const BALLOON_IDS = Object.freeze(Array.from({ length: 28 }, (_, index) => `balloon-${pad2(index)}`));

export const EXPANDED_OBJECT_IDS = Object.freeze([
  ...CATEGORY_ROOT_IDS,
  "tent-details",
  ...LIGHT_IDS,
  ...BLEACHER_IDS,
  ...TRAPEZE_IDS,
  ...BUNTING_IDS,
  ...PROCEDURAL_CROWD_IDS,
  ...GLTF_CROWD_IDS,
  ...BALLOON_IDS,
]);

export const ALL_OBJECT_IDS = Object.freeze([...LEGACY_OBJECT_IDS, ...EXPANDED_OBJECT_IDS]);
export const EXPECTED_OBJECT_COUNT = 222;

export const EXPECTED_CATEGORY_IDS = Object.freeze({
  roots: CATEGORY_ROOT_IDS,
  core: LEGACY_OBJECT_IDS,
  tentDetails: Object.freeze(["tent-details"]),
  lights: LIGHT_IDS,
  bleachers: BLEACHER_IDS,
  trapeze: TRAPEZE_IDS,
  bunting: BUNTING_IDS,
  crowdProcedural: PROCEDURAL_CROWD_IDS,
  crowdGltf: GLTF_CROWD_IDS,
  balloons: BALLOON_IDS,
});

export const EXPECTED_ASSET_FILES = Object.freeze([
  "arena-barrel.glb",
  "arena-chalk-ring.glb",
  "arena-circle.glb",
  "arena-dirt-ring.glb",
  "balloon-blue.glb",
  "balloon-cyan.glb",
  "balloon-green.glb",
  "balloon-magenta.glb",
  "balloon-orange.glb",
  "balloon-pink.glb",
  "balloon-red.glb",
  "balloon-yellow.glb",
  "bleacher-riser.glb",
  "bleacher-seat.glb",
  "bunting-flag.glb",
  "crowd-char1-normalized.glb",
  "crowd-char2-normalized.glb",
  "crowd-char4-normalized.glb",
  "crowd-char6-normalized.glb",
  "crowd-man-normalized.glb",
  "crowd-worker-normalized.glb",
  ...Array.from({ length: 40 }, (_, index) => `crowd-seated-${pad2(index)}.glb`),
  "mc3400-editor.glb",
  "mc9400-editor.glb",
  "performer-podium.glb",
  "ps30-editor.glb",
  "qr-mc3400.glb",
  "qr-mc9400.glb",
  "qr-ps30.glb",
  "qr-tc8300.glb",
  "tc8300-editor.glb",
  "tent-details.glb",
  "tent-editor.glb",
]);

export const EXPECTED_ASSET_COUNT = 72;
// Exact per-object seated palettes plus the six normalized source characters
// currently total about 10.9 MB. Keep a narrow ceiling so a raw/un-normalized
// duplicate library cannot silently enter the portable scene document.
export const MAX_EMBEDDED_ASSET_BYTES = 12 * 1024 * 1024;
export const EXPECTED_VISUAL_STRUCTURE_SHA256 = "4b935ac167e9fd2635157e81807cc719f25992839a7cc4fd67d248d6c7c580ee";

if (new Set(ALL_OBJECT_IDS).size !== ALL_OBJECT_IDS.length || ALL_OBJECT_IDS.length !== EXPECTED_OBJECT_COUNT) {
  throw new Error("The Zebra parity contract contains duplicate or incorrectly counted object IDs.");
}

if (new Set(EXPECTED_ASSET_FILES).size !== EXPECTED_ASSET_FILES.length || EXPECTED_ASSET_FILES.length !== EXPECTED_ASSET_COUNT) {
  throw new Error("The Zebra parity contract contains duplicate or incorrectly counted asset files.");
}
