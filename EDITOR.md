# Zebra scene editing

`zebra-circus.scene.json` is the Game Port Studio v0.14 project for Zebra. It contains 222 stable objects, 15 Box Colliders and 72 exact GLB assets. The exact set includes four different product QR boards, 40 deterministic seated spectators, and the six original crowd models used across 28 imported spectators.

## What is exact and what is portable

Exact pixel/runtime parity applies to Studio's persistent original Zebra runtime only. **Edit** pauses the canonical `index.html` scene and layers authoring controls onto it; **Play Zebra** resumes the same iframe, scene, canvas and WebGL context. The parity test compares the same game-camera pixels, runtime context token and visual manifest across that transition.

**Create Three.js project** and **Create Unity project** are portable scene exports, not rebuilt copies of the complete Zebra game. They carry the validated scene, exact asset bytes, stable object IDs, transforms, supported materials, hierarchy and components. Zebra's procedural balloon/weapon/scan systems, DOM HUD, scoring and other runtime-only behavior are not exported, so generated targets are not expected or claimed to match `index.html` pixel-for-pixel.

## Editable scope

- The 222 original runtime-bound objects must remain present with their stable IDs, fixed hierarchy, and fixed model/primitive sources. Their transforms (including hierarchy-root transforms), visibility and authored Box Collider values are editable. They cannot be reparented, deleted, duplicated as replacement originals or pointed at arbitrary source assets.
- The four original QR objects are the source-lock exception. Their **QR artwork** may switch only among the exact MC9400, MC3400, PS30 and TC8300 artwork family.
- New persistent extras may be **Empty**, **Cube**, **Sphere**, **Cylinder**, **Capsule** or **Plane**. An extra supports an inline untextured material, an optional Box Collider, transforms, parenting, visibility, duplicate and delete.
- Dynamic extras appear in the same persistent Zebra Edit/Play runtime and in portable exports. They do not automatically become scanners, pickups, balloons, score targets or HUD elements. Imported/custom model sources and textured extra materials are outside this Zebra-extra contract.

## Start locally

Game Port Studio is a separate private repository pinned by `game-port-studio.project.json`. After accepting access, clone it beside Zebra and install it once:

```bash
git clone https://github.com/Sparkah/game-port-studio.git
git clone https://github.com/Mucchun/zebra-circus-game.git
cd game-port-studio
git checkout v0.14.0
npm ci
```

Then start both local servers from the Zebra checkout:

```bash
cd ../zebra-circus-game
node tools/start-game-port-studio.mjs
```

The launcher verifies the exact tested engine commit before starting. If the repositories are not siblings, set `GAME_PORT_STUDIO_PATH=/path/to/game-port-studio` for the launcher and Zebra tests.

Open:

- Standalone Zebra: http://127.0.0.1:8765/
- Game Port Studio: http://127.0.0.1:8766/

## Load and edit Zebra

1. In Studio, choose **Build a game**.
2. Click **Open scene** and select `zebra-circus.scene.json` from this repository.
3. Wait for **Saved on this Mac**. The project is about 14 MB, so Studio stores it in IndexedDB instead of localStorage.
4. Confirm the viewport badge says **EDITING ORIGINAL ZEBRA RENDERER**. This is the actual paused `index.html` renderer, not a proxy SceneView.
5. Select an object in the hierarchy or click it in the viewport. Use **Move / Rotate / Scale** or W/E/R. Right-drag orbits; the mouse wheel zooms; **C** toggles the authored game camera. Collider objects show a cyan/orange wireframe helper. Original source definitions and parent links stay identity-locked; moving an original hierarchy root still moves its children.
6. To edit a QR, select `MC9400 QR`, `MC3400 QR`, `PS30 QR`, or `TC8300 QR`. In **Mesh Renderer**, use **QR artwork** to choose one of the four exact product QR/label assets. The original runtime graphic changes immediately; Undo restores it.
7. Edit Box Collider centre, size, enabled state, or trigger state in the Inspector. Transform and collider edits are sent back to the scene document and participate in Undo/Redo.
8. For a new object, use one of the supported dynamic-extra kinds listed above. Configure its inline untextured material and optional Box Collider, then transform, parent, hide/show, duplicate or delete it as needed.
9. Click **Play Zebra**. Studio resumes the same iframe, scene, canvas and WebGL context. It does not construct another scene. Click **Stop** to freeze the same runtime back into editable authoring mode.
10. Click **Export scene** to download the reviewed v0.14 document. Export does not overwrite the repository file automatically.

The separate **Live game** panel remains a diagnostic side-by-side bridge, but it is not needed for normal Zebra editing.

## Verify

With both servers running:

```bash
cd ../game-port-studio
ZEBRA_GAME_PATH=../zebra-circus-game npm run test:zebra
ZEBRA_GAME_PATH=../zebra-circus-game npm run test:zebra-targets

cd ../zebra-circus-game
GAME_PORT_STUDIO_PATH=../game-port-studio \
node --test tests/*.test.mjs
```

`test:zebra` fails unless the persistent original-runtime Edit and Play modes retain the same iframe/context/visual manifest and produce a byte-identical raw canvas from the same game camera. It also checks all four distinct QR textures, 40 seated plus 28 imported spectators, a real pointer gizmo drag, collider helper, QR artwork change/Undo, scan-panel X movement recovery, Stop, large-project reload and the bounded dynamic-extra contract. Separately, `test:zebra-targets` verifies portable 222-object/72-asset Three.js and Unity 6000.3.5f2 scene output; it does not assert Zebra gameplay or pixel parity.

## Runtime boundary and security

All original persistent arena roots have stable editor IDs and fixed sources, with the exact QR family as the only source-artwork exception. Supported dynamic extras receive their own editor IDs. Gameplay-only state—balloon bob/pop/respawn, weapon pickup presentation, projectiles, particles, scan VFX, score and DOM HUD—stays in the original runtime. Authoring freezes those behaviours; Play resumes them. Dynamic extras remain visual/spatial authored objects unless Zebra-specific gameplay support is added explicitly.

The bridge accepts only the exact iframe source plus an allowlisted same-origin or loopback `editorOrigin`. Every message carries the code-owned protocol, session nonce and exact scene revision:

```js
{
  type: "game-port-studio:scene-preview",
  protocol: "game-port-runtime/v1",
  nonce,
  revision,
  scene
}
```

Acknowledgements return the same protocol/nonce/revision plus the runtime context token and visual-manifest hash. Stale revisions, forged sources, mismatched nonces and non-loopback origins are rejected.
