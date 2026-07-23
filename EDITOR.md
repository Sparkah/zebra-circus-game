# Zebra scene editing

`zebra-circus.scene.json` uses the stable `scene@0.14` document schema inside the focused Zebra editor v0.19. It contains 222 stable objects, 15 Box Colliders and 72 exact built-in GLB assets. The exact set includes four different product QR boards, 40 deterministic seated spectators, and the six original crowd models used across 28 imported spectators. Project uploads extend that immutable pack without rewriting it.

## Exact scene boundary

Exact pixel/runtime parity applies to Studio's persistent original Zebra runtime only. **Edit** pauses the canonical `index.html` scene and layers authoring controls onto it; **Play Zebra** resumes the same iframe, scene, canvas and WebGL context. The parity test compares the same game-camera pixels, runtime context token and visual manifest across that transition.

The focused collaborator session does not render conversion, publishing, assistant, export, or Three.js/Unity project-generation controls. It exists only to edit the current Zebra scene, manage its bounded project GLBs, save it, play it, and return the scene change to GitHub.

## Edit online in real time

Open [zebra-scene-editor.timofeymarkin98.workers.dev](https://zebra-scene-editor.timofeymarkin98.workers.dev). Enter your name and the access code Tim shares privately, then wait for **Live**. No engine checkout or local setup is required. The v0.19 asset-enabled deployment requires the Cloudflare account's one-time R2 activation; until that deployment is complete, this URL remains on the stable v0.18 build.

1. Select an object in **Objects** or in the exact runtime viewport and edit it with the Inspector, Move/Rotate/Scale, W/E/R or the supported Add object/component controls.
2. Other signed-in editors appear beside the Live status. Different fields merge; a same-field race keeps the first confirmed value and asks the other editor to retry.
3. Click **Save** to create an online checkpoint of the confirmed shared revision.
4. Click **Queue GitHub**, review the fixed target and confirm. The browser does not receive GitHub credentials or push directly.
5. The fork workflow validates the checkpoint and normally pushes only `zebra-circus.scene.json` to `Sparkah:agent/game-port-studio-integration`. Review progress in [pull request 1](https://github.com/Mucchun/zebra-circus-game/pull/1).

Treat the access code as a password. Do not place it in this repository, an issue or a screenshot. Sessions expire after seven days.

### Controls that match the desktop editor

- Command-Z undoes the current editor's last confirmed operation; Command-Shift-Z redoes it. Both work after the original Zebra canvas has keyboard focus.
- Press F to move the Orbit camera close to the selected object's visible rendered bounds. Framing preserves the current orbit angle, works with replacement meshes and hierarchy roots, and does not change the scene or add an Undo entry.
- Hold Option and drag with the primary mouse button to orbit. Alt is the equivalent on non-Mac keyboards. Add Command (Ctrl on non-Mac keyboards) when starting the drag to physically translate the camera and orbit target. Both gestures switch Game camera to Orbit camera without selecting or moving an object and without adding an Undo entry.
- W, E and R choose Move, Rotate and Scale. Inspector and gizmo changes share the same history.
- The bottom **Project Assets** dock shows the immutable built-in models and shared uploaded GLBs. **Upload GLB** adds a self-contained model up to 8 MiB to project storage; an uploaded item can be added to the scene, used as a replacement mesh, or removed when it is no longer referenced.

### Connect Mucchun's AI

1. Sign in as Mucchun, click **Connect AI**, and create a clearly named connection.
2. Copy the shown-once token and bridge configuration before closing the dialog. Download `zebra-ai-bridge.mjs` and keep it private.
3. Add the copied stdio MCP configuration to the AI client. The generic form is:

```json
{
  "command": "node",
  "args": ["/ABSOLUTE/PATH/zebra-ai-bridge.mjs"],
  "env": {
    "ZEBRA_EDITOR_MCP_URL": "https://zebra-scene-editor.timofeymarkin98.workers.dev/api/ai/mcp",
    "ZEBRA_EDITOR_TOKEN": "PASTE_THE_SHOWN_ONCE_TOKEN"
  }
}
```

Reconnect the AI client and have it call `zebra_scene_status` first. It can search and read objects, list built-in and uploaded mesh metadata, replace one object's mesh source without changing its other renderer fields, apply exact-revision semantic edits, review recent changes, undo edits made by that exact connection, and save an online checkpoint. It cannot queue or push GitHub. Direct Streamable HTTP is an advanced option only for clients that let the user set a manual Authorization Bearer header; the downloaded stdio bridge is the portable supported route.

The token lasts up to 30 days and can be revoked immediately from **Connect AI**. Raw tokens are shown once and are never listed later. Any signed-in room editor can revoke a connection. If the access code or a token leaks, revoke every connection and ask Tim to rotate both the editor access code and session secret; rotating only the access code does not end existing sessions or tokens. After signing in as a new browser session, use the AI's own undo tool or create a fresh connection when browser Command-Z ownership matters.

## Editable scope

- The 222 original runtime-bound objects must remain present with their stable IDs and fixed hierarchy. Their transforms (including hierarchy-root transforms), visibility, supported materials and authored Box Collider values are editable. They cannot be reparented, deleted, duplicated as replacement originals or pointed at arbitrary/non-project asset URLs.
- Stable runtime identity is separate from visual source. The 222 original IDs, parents and gameplay roles remain protected, while any of the 204 originals that already has a Mesh Renderer may choose another checked-in Zebra GLB or a project upload. The target object, transform, collider and gameplay references remain unchanged; replacement does not auto-fit the model or resize the collider. The exact 72-file built-in pack cannot be removed or rewritten.
- New persistent extras may be **Empty**, **Cube**, **Sphere**, **Cylinder**, **Capsule**, **Plane** or an uploaded project GLB. An extra supports an optional Box Collider, transforms, parenting, visibility, duplicate and delete.
- Dynamic extras appear in the same persistent Zebra Edit/Play runtime and in portable exports. They do not automatically become scanners, pickups, balloons, score targets or HUD elements. Imported/custom model sources and textured extra materials are outside this Zebra-extra contract.

## Start locally

Game Port Studio is a separate private repository pinned by `game-port-studio.project.json`. After accepting access, clone it beside Zebra and install it once:

```bash
git clone https://github.com/Sparkah/game-port-studio.git
git clone https://github.com/Mucchun/zebra-circus-game.git
cd game-port-studio
git checkout v0.19.0
npm ci
```

Then start both local servers from the Zebra checkout:

```bash
cd ../zebra-circus-game
node tools/start-game-port-studio.mjs
```

The launcher verifies the exact tested engine commit before starting. If the repositories are not siblings, set `GAME_PORT_STUDIO_PATH=/path/to/game-port-studio` for the launcher and Zebra tests.

The launcher prints two links. **Game** is the standalone Zebra runtime. **Edit the scene** is a one-run URL containing a temporary fragment token; open that exact URL. The token moves into tab-scoped storage and disappears from the visible address.

## Load and edit Zebra locally

1. The canonical `zebra-circus.scene.json` opens automatically. Wait for **Up to date** and confirm the viewport badge says **EDITING ORIGINAL ZEBRA RENDERER**. This is the actual paused `index.html` renderer, not a proxy.
2. Select an object in **Objects** or click it in the viewport. Press **F** to frame its visible rendered bounds, including a replacement model or the visible children of a hierarchy root. Use **Move / Rotate / Scale** or W/E/R. Option/Alt + primary drag orbits; add Command/Ctrl to pan the camera and target (right/middle drag also remains available). The mouse wheel zooms; **C** toggles the authored game camera. Command-Z / Command-Shift-Z perform Undo/Redo even when the runtime canvas has focus. Collider objects show a cyan/orange wireframe helper. Original parent links and stable IDs remain protected; moving an original hierarchy root still moves its children.
3. To add a model, use **Upload GLB** in the bottom **Project Assets** dock, then choose **Add to scene** on that asset. To replace an existing visual instead, select an original mesh-bearing object and choose a built-in or uploaded model from **Mesh Renderer → Mesh**. The same runtime target and gameplay role remain active. Use Command-Z to restore the prior model and Command-Shift-Z to reapply it. QR objects retain the four-board **QR artwork** convenience selector as well.
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

`test:zebra` also exercises the focused collaborator UI, including direct load, replacement-aware F framing, iframe-focused Command-Z / Command-Shift-Z, Option/Alt orbit, Option/Alt + Command/Ctrl pan, mesh replacement, Save, confirmation/cancel, Save & Push request handling, same-iframe Play/Stop, and responsive widths. The hosted gate separately exercises the real stdio MCP bridge, AI mesh discovery/replacement, token isolation/revocation and AI-to-GitHub denial. The Zebra test suite verifies the launcher configuration without performing a live GitHub push.

`test:zebra` fails unless the persistent original-runtime Edit and Play modes retain the same iframe/context/visual manifest and produce a byte-identical raw canvas from the same game camera. It also checks all four distinct QR textures, 40 seated plus 28 imported spectators, a stable-root model swap with Undo/Redo, revision-safe camera pan/orbit/framing, a real pointer gizmo drag, collider helper, scan-panel X movement recovery, Stop, large-project reload and the bounded dynamic-extra contract. Separately, `test:zebra-targets` verifies portable 222-object/72-asset Three.js and Unity 6000.3.5f2 scene output; it does not assert Zebra gameplay or pixel parity.

## Runtime boundary and security

All original persistent arena roots have stable editor IDs, fixed hierarchy and fixed gameplay roles. Their visible Mesh Renderer source is a separate editable property: any mesh-bearing original can use another built-in or uploaded project GLB without replacing its runtime target, transform, collider or gameplay references. Supported dynamic extras receive their own editor IDs. Gameplay-only state—balloon bob/pop/respawn, weapon pickup presentation, projectiles, particles, scan VFX, score and DOM HUD—stays in the original runtime. Authoring freezes those behaviours; Play resumes them. Dynamic extras remain visual/spatial authored objects unless Zebra-specific gameplay support is added explicitly.

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

The original 72 GLBs still resolve only through their code-owned same-origin filenames. Additional assets must use the server-issued `asset-upload-<48 lowercase hex>` identity, `model/glb` metadata, the matching `<id>.glb` filename and a declared size no larger than 8 MiB. A saved full scene carries canonical base64; a hosted slim preview can fetch only `/api/assets/<id>/content` on the current origin. Byte mismatches, malformed containers, external GLB URI dependencies and descriptor-supplied URLs are rejected before the active scene changes.
