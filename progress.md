Original prompt: Fix the scan close movement bug, add a physical level builder with colliders, and open the game through the experimental Three.js/Unity Game Port Studio for editing.

Latest prompt: Add Option/Alt + Command/Ctrl physical camera movement and let original mesh-bearing objects replace their visual mesh without changing stable identity.

## 2026-07-22 — replaceable visuals and physical camera pan

- Option/Alt + primary drag still orbits; adding Command/Ctrl when the drag begins translates the orbit camera and target together. The gesture is latched before gizmo/selection picking and changes no scene, selection, collaboration revision or Undo/Redo entry.
- The original runtime now separates its 222 stable editable targets from their visual bindings. Each of the 204 mesh-bearing originals may select another allowlisted project GLB while keeping the same target object, parent, transform, collider, gameplay role and component identity. No automatic fit or collider resize is applied.
- Replacement assets load only from the code-owned 72-file same-origin allowlist. Async swaps are revision/generation guarded, preview acknowledgement waits for the requested visual, and Undo/Redo or a fresh saved reload cannot be overwritten by a late model load.
- The focused asset pack remains immutable and newly added objects remain Empty/five-primitive only. Arbitrary URLs, uploaded replacement bytes and asset deletion remain unavailable.
- AI can list bounded mesh metadata and perform a source-only mesh replacement through the scoped live-room MCP connection; GitHub queue/push remains human-only.

## 2026-07-22 — v0.17 AI-ready authoring controls

- The original Zebra authoring runtime now treats Option/Alt + primary drag as camera orbit before gizmo picking or selection. It switches Game camera to Orbit camera, captures only the initiating pointer, and changes no authored scene or history data.
- Command-Z and Command-Shift-Z now leave native text fields alone but relay Undo/Redo to Game Port Studio through the existing validated source/origin/protocol/nonce/revision bridge when the iframe owns focus.
- The authoring validation snapshot exposes orbit state so the exact-runtime Playwright gate proves camera movement without a transform, selection, revision or history change.
- The private hosted editor can issue a room-scoped MCP connection for Mucchun's AI. The AI may inspect/edit/undo/checkpoint the live scene but cannot queue or push GitHub; that stays a human-confirmed editor action.

## 2026-07-22 — v0.16 hosted real-time scene collaboration

- Added a private hosted entry at `zebra-scene-editor.timofeymarkin98.workers.dev`. It opens only the focused exact-runtime scene editor; no conversion, platform, publishing or project-generation UI is exposed.
- Two signed-in collaborators share semantic scene edits, presence, conflict handling, Undo/Redo and online Save checkpoints. Queue GitHub returns a validated checkpoint through a scheduled fork workflow that can normally change only `zebra-circus.scene.json` on the existing review branch.
- The public game remains independent of the private engine checkout. Local authoring remains available through the pinned v0.16.0 tag, while the hosted route needs only the separately shared access code.

## 2026-07-22 — superseded source-lock and current dynamic-extra contract

- Exact visual/runtime parity applies only to the persistent original Zebra `index.html` Edit/Play path. It retains one iframe, scene, canvas and WebGL context and compares byte-identical game-camera pixels. Generated Three.js/Unity outputs are portability builds for the scene, exact asset bytes, stable IDs, supported materials and components; they do not contain the complete Zebra gameplay/HUD and do not claim pixel parity.
- At this milestone all 222 required original objects retained stable runtime IDs, fixed parent links and fixed source definitions. The v0.18 work above supersedes only that source restriction: the stable runtime target remains protected, while its Mesh Renderer may now select another checked-in Zebra GLB. Required originals still cannot be reparented, deleted, duplicated as replacements or redirected to arbitrary URLs.
- Supported persistent extras are Empty, Cube, Sphere, Cylinder, Capsule and Plane. Extras accept an inline untextured material and optional Box Collider and support transforms, parenting, visibility, duplicate and delete. They render through the same persistent Zebra Edit/Play runtime and export to portable targets, but do not acquire Zebra-specific scan/pickup/balloon/scoring/HUD behavior automatically.
- The former 23-object proxy and 24-asset SceneView milestones below are historical and superseded. They are preserved to explain the correction, not as current parity or asset-count claims.

## 2026-07-22 — exact Edit/Play parity correction (persistent original runtime)

- Superseded the earlier proxy-based result. Matching 222 IDs and transforms was not visual parity: the editor still showed generic QR boards, 40 standing crowd proxies and repeated proxy humans while Play rebuilt the original procedural scene.
- Zebra authoring now runs inside the paused original `index.html` renderer. Selection, W/E/R transform gizmos, collider helpers, orbit/game cameras and bidirectional transform commits are runtime-owned. **Play Zebra** resumes the same iframe, canvas, scene and WebGL context; **Stop** returns that same runtime to authoring instead of reconstructing or swapping renderers.
- Rebuilt the portable scene as v0.14 with 72 exact GLBs: four byte-exact product QR/label boards, 40 deterministic 18-mesh seated spectators, and the six bundled original crowd models assigned across 28 spectators. Generic `asset-qr-board` and `asset-crowd-proxy` references are forbidden from the original-runtime parity path. Generated targets consume the portable data but are not covered by the pixel-parity claim.
- QR graphics are editable through Studio's **QR artwork** field. Switching among MC9400, MC3400, PS30 and TC8300 updates both the rendered QR/label and the scan target in the original runtime; Undo restores the previous artwork.
- Added deterministic crowd/arena construction, exact render-state evidence, per-object visual fingerprints, four distinct QR texture hashes, strict bridge protocol/nonce/revision/context validation, and authoring-time freeze of transient weapon/balloon behaviours.
- Game Port Studio v0.14 now supports 128 assets / 64 MB, validated PNG/JPEG assets, lit/unlit inline materials, named embedded-GLB material overrides, independent instance materials, generated Three.js/Unity texture handling, and IndexedDB persistence for the 14 MB Zebra project.
- `npm run test:zebra` PASS: 222 objects / 72 assets, exact QR and crowd inventory, real pointer gizmo drag, collider helper, QR change + Undo, identical Edit/Play raw canvas hash, same iframe/context/manifest, scan-X movement recovery, Stop, and large-project reload.
- `npm run test:zebra-targets` PASS: served Three.js loaded all 72 assets once with 222 objects / 185 model instances; Unity 6000.3.5f2 generated all 222 stable identities. This is portability evidence, not a Zebra pixel/gameplay-parity result.
- `node --test tests/*.test.mjs` PASS (3/3), including strict live bridge, full runtime mapping, colliders and scan-X recovery.

## 2026-07-22 — completed Zebra runtime bridge

- **Superseded proxy-stage record:** the first expanded SceneView contained 222 stable objects instead of 23 coarse roots. Every persistent arena item was represented—26 bleacher pieces, 40 procedural and 28 imported spectators, 60 alternating flags, three trapeze pieces, 28 deterministic balloon spawns, tent shell/details, six lights, devices, QR boards, barrels, podium, surfaces, boundaries, and the player camera. Its 24 bounded normalized/composite editor GLBs improved the proxy but did not produce visual parity. The persistent original renderer and 72-asset v0.14 document replaced this approach.
- Added validated parent hierarchy and world-transform flattening to the Zebra bridge. Moving a category parent such as **Bleachers** moves its children in the actual game without changing the top-level world-space assumptions used by scanning, pickups, projectiles, balloon animation, and collision. All 222 authored objects report registered/mapped with zero missing bindings.
- Made balloon colour/barcode assignment and imported-crowd model ordering deterministic. Editor and runtime now agree on stable object identity while bob/pop/respawn, projectiles, particles, scan VFX, held-weapon presentation, scoring, and DOM HUD remain intentionally transient.
- Hardened live preview further: incomplete expanded inventories, missing parents, cycles, depth overflow, more than 500 objects, malformed transforms/components, untrusted origins, and null/untrusted message sources are rejected atomically. Extra user-authored objects remain valid in Studio, but cannot masquerade as a complete Zebra scene if stable runtime objects are missing.
- Updated the service worker to a fresh cache and network-first handling for `index.html` and the canonical scene so local edits are not hidden by the old cache-first PWA worker.

- Confirmed `index.html` is the canonical and only game entry point.
- Fixed scan-panel X close so the user-gesture path requests pointer lock again; Escape still releases control normally. Pointer Lock requests are now promise-safe, and browsers that reject the API keep keyboard movement through an explicit fallback instead of producing an unhandled error or trapping the player.
- Made `zebra-circus.scene.json` the authoritative initial authored layout. It is fetched and strictly validated before Play is shown, with a complete embedded fallback when the file is unavailable or malformed.
- **Superseded early-stage record:** expanded the first generated scene from an 11-object approximation to 23 coarse canonical roots. The current document contains 222 required originals; neither the 11- nor 23-object stage is a current import/parity claim.
- Corrected canonical positions that did not match gameplay in the first editor draft (PS30, TC8300, all barrels, podium, and camera).
- Added 15 authored Box Colliders: player body, floor, four QR boards, four barrels, podium, and four visible/enabled arena boundaries. Zebra's FPS runtime resolves the 14 static non-trigger colliders as rotated/scaled local boxes; the player collider is exported but correctly excluded from self-collision.
- Added the portable `move` Vector2 Input Action and enabled `move-from-input` component on `main-camera` at 6 units/second so Studio Play, generated Three.js, and generated Unity builds have a playable player object.
- Bound the Zebra runtime to scene transforms for player/camera, weapon pickups, QR boards, all arena layers, the entire tent assembly (mesh, poles, sign, and string lights), barrels, podium, and boundaries. Live changes do not reset balloons, score, scans, crowd, or weapon state.
- Added a strict live-preview receiver for `{ type: "game-port-studio:scene-preview", scene }`. It accepts only the exact same origin or an exact `http(s)` loopback `editorOrigin` parent/opener, validates the editor's slim `{ schema, name, objects }` scene while preserving the loaded Move action, applies it before or during play, and replies to that exact origin with `{ type: "game-port-studio:scene-preview-applied", objectCount }`.
- Closed the initial-load/live-message race: if Studio sends a scene before the external scene fetch finishes, the accepted live scene remains authoritative instead of being overwritten after its ACK.
- Added `window.render_game_to_text()` with mode, external/fallback/live scene source, player transform, score, weapon inventory, balloon/crowd counts, scan state, pointer-lock state, authored layout positions, and active obstacle IDs.
- Added bounded `window.advanceTime(ms)` (maximum 1000 ms / 60 fixed steps per call) for deterministic browser checks.
- Removed the Zebra.com iframe entirely and replaced it with a safe official-catalogue link, avoiding the site's cross-origin frame refusal and automatic popup behavior.
- Replaced six crowd GLBs that reference missing PNG files with six bundled-texture crowd GLBs. The crowd still contains 28 rendered members with no missing-texture requests.
- Yielded one animation frame before the heavy one-time scene build so Play paints the tutorial immediately and automated/user clicks no longer time out.
- Added [EDITOR.md](EDITOR.md) with the scene workflow, security contract, and runtime/editor boundary.
- Corrected Game Port Studio's primary Play integration after user testing showed that it still presented the generic portable scene renderer. **Play Zebra** now runs this canonical `index.html` inside the editor's main viewport, applies the current authored scene through the strict bridge, and exposes the real Zebra HUD, balloons, crowd, QR scanning, weapons, and scoring.
- The Studio runtime adapter recognizes Zebra from the exact validated schema/camera/object/asset signature rather than the editable scene name. It ignores scene-supplied runtime URLs, never silently falls back to the generic renderer, unloads competing/hidden Zebra frames, and restores the untouched authored scene on Stop.

## Verification

- **Superseded proxy-stage check:** `node tools/build-editor-assets.mjs && node tools/build-editor-scene.mjs` passed for a deterministic 3,002,576-byte, 24-GLB editor proxy pack. The current v0.14 document/runtime path uses 72 exact assets.
- `node --test tests/*.test.mjs` — PASS (3/3): exact expanded inventory/assets, all 222 runtime bindings, parent-world flattening, strict/incomplete message rejection, live collider propagation, and scan-X movement.
- **Superseded proxy-stage check:** Studio accepted the former 222-object/24-asset document, one portable action, seven category roots and 15 colliders. Current validation targets the v0.14 72-asset document.
- **Superseded early-stage fallback check:** `node tools/test-scene-fallback.mjs` passed when the embedded fallback still used 23 coarse roots, 14 static obstacles, 28 balloons, four weapons and four QR boards. It is retained as historical behavior, not current 222-object parity evidence.
- `node tools/test-scene-bridge.mjs` — PASS: hostile origin rejected, malformed same-origin scene rejected, pre-start and live updates ACKed with 222 objects, player/weapon/barrel transforms applied, barrel collision active, and ongoing gameplay state preserved.
- `node tools/test-scan-close.mjs` — PASS: real QR scan awarded 50, pointer-lock sequence emitted lock → unlock → relock, X closed the panel, genuine W moved the player, a forced Pointer Lock rejection enabled error-free keyboard fallback, genuine E picked up MC9400, genuine click popped a balloon and advanced score to 60, and 28 textured crowd members remained.
- Game Port Studio `npm run test:zebra` — PASS: primary **Play Zebra** mounted the actual runtime in the main viewport with no generic canvas, received the exact 222-object ACK, started real 28-balloon/68-spectator gameplay, closed a QR scan and resumed W movement, disabled unsupported Pause/Step, and restored unchanged authored scene bytes in under 1.2 seconds on Stop (749 ms in the final run). The separate edit-while-running panel passed transform propagation and complete scene export; an unavailable runtime failed closed without showing the generic renderer.
- Game Port Studio `npm test`, `npm run test:unity`, and `npm run test:zebra-targets` — PASS: full web/editor suite; native Unity 6000.3.5f2 validation; portable Zebra Three.js output with 222 required objects, 185 model instances and all 72 assets fetched once; portable Zebra Unity scene with 222 stable object identities. These generated-target checks do not assert full Zebra gameplay or pixel parity.
- Shared `develop-web-game` Playwright client against `http://127.0.0.1:8765/` — PASS for deterministic state: mode `playing`, external scene, 28 balloons/crowd, Pointer Lock rejection fallback, real forward movement, and no browser errors. Its canvas-only PNG is black because non-preserved WebGL buffers read opaque black in that helper; this is a capture artifact, not runtime evidence.
- Inspected the final persistent original-runtime Edit/Play screenshots: the original HUD/arena plus authored bleachers, 68 spectators, balloons, flags, QR boards, barrels, podium, tent and rings render correctly. The generated Three.js screenshot separately verifies portable scene rendering; it is not evidence that the generated target contains Zebra's original HUD/gameplay or matches its pixels.
- Browser tests fail on any page error, console error, or HTTP 4xx/5xx; final runs reported none.
- Independent final review found zero visible runtime meshes outside an editable stable target, confirmed 222/222 registered and mapped, reproduced scan-close/W recovery, and verified the actual Zebra iframe rather than the generic canvas. Its initial Stop-latency finding was fixed by preserving the editor view/model cache across external Play; the final integration gate proves sub-second restoration.

## Intentional boundaries

- Balloon spawn locations, all 68 spectator placements, every bleacher part, 60 flags, trapeze parts, tent shell/details, and six lights are individually authored. Balloon bob/pop/respawn state, projectiles, particles, scan VFX, held-weapon presentation, scoring, and the DOM HUD remain runtime-only transient systems.
- The 222 originals are stable required runtime bindings. Their mesh-bearing members may replace only the renderer visual source; object identity, parent, component identity and gameplay role remain protected. Supported dynamic extras are the bounded Empty/five-primitive, inline-untextured-material and optional-Box-Collider corridor described above; they do not implicitly become Zebra gameplay entities.
- Generated Three.js and Unity projects are scene portability outputs. They intentionally omit Zebra's complete procedural runtime and therefore have no pixel-parity guarantee.
- Zebra collision is a focused first-person static-obstacle solver, not a rigid-body physics engine. The shared scene still exports standard Box Collider data for the generated engines.
- Live preview is intentionally limited to same-origin or loopback-hosted local Studio sessions. Persisting an edit still requires exporting/saving `zebra-circus.scene.json`.
