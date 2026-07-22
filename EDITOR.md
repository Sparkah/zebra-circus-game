# Zebra scene editing

`zebra-circus.scene.json` uses the stable `scene@0.14` document schema inside the focused Zebra editor v0.15. It contains 222 stable objects, 15 Box Colliders and 72 exact GLB assets. The exact set includes four different product QR boards, 40 deterministic seated spectators, and the six original crowd models used across 28 imported spectators.

## Exact scene boundary

Exact pixel/runtime parity applies to Studio's persistent original Zebra runtime only. **Edit** pauses the canonical `index.html` scene and layers authoring controls onto it; **Play Zebra** resumes the same iframe, scene, canvas and WebGL context. The parity test compares the same game-camera pixels, runtime context token and visual manifest across that transition.

The focused collaborator session does not render conversion, publishing, asset-library, assistant, export, or Three.js/Unity project-generation controls. It exists only to edit the current Zebra scene, save it, play it, and return the scene change to GitHub.

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
git checkout v0.15.0
npm ci
```

Then start both local servers from the Zebra checkout:

```bash
cd ../zebra-circus-game
node tools/start-game-port-studio.mjs
```

The launcher verifies the exact tested engine commit before starting. If the repositories are not siblings, set `GAME_PORT_STUDIO_PATH=/path/to/game-port-studio` for the launcher and Zebra tests.

The launcher prints two links. **Game** is the standalone Zebra runtime. **Edit the scene** is a one-run URL containing a temporary fragment token; open that exact URL. The token moves into tab-scoped storage and disappears from the visible address.

## Load and edit Zebra

1. The canonical `zebra-circus.scene.json` opens automatically. Wait for **Up to date** and confirm the viewport badge says **EDITING ORIGINAL ZEBRA RENDERER**. This is the actual paused `index.html` renderer, not a proxy.
2. Select an object in **Objects** or click it in the viewport. Use **Move / Rotate / Scale** or W/E/R. Right-drag orbits; the mouse wheel zooms; **C** toggles the authored game camera. Collider objects show a cyan/orange wireframe helper. Original source definitions and parent links stay identity-locked; moving an original hierarchy root still moves its children.
3. To edit a QR, select `MC9400 QR`, `MC3400 QR`, `PS30 QR`, or `TC8300 QR`. In **Mesh Renderer**, use **QR artwork** to choose one of the four exact product QR/label assets. The original runtime graphic changes immediately; Undo restores it.
4. Edit Box Collider centre, size, enabled state, or trigger state in the Inspector. If an object has no collider, choose **Add component** → **Box Collider**. These edits participate in Undo/Redo.
5. Use **+ Add object** for a supported Empty or primitive extra. Configure its inline untextured material and optional Box Collider, then transform, parent, hide/show, duplicate or delete it as needed.
6. Click **Play Zebra**. The editor resumes the same iframe, scene, canvas and WebGL context. Click **Stop** to freeze the same runtime back into editing.
7. Click **Save** to validate and atomically update only `zebra-circus.scene.json` in this checkout.
8. Click **Save & Push** to review the exact repository, branch, scene file and commit message. Nothing is pushed until the confirmation button is clicked. A successful action creates the scene-only commit `Update Zebra scene from editor` and normally pushes it to `origin`.

Save & Push stops if another repository file is modified/staged/untracked, the branch is detached or not synchronized with GitHub, the remote is not `Mucchun/zebra-circus-game`, the scene changed outside the editor, or the scene/asset contract is invalid. It never force-pushes.

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

`test:zebra` also exercises the focused collaborator UI, including direct load, QR editing, Undo/Redo, Save, confirmation/cancel, Save & Push request handling, same-iframe Play/Stop, and responsive widths. The Zebra test suite verifies the launcher configuration without performing a live GitHub push.

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
