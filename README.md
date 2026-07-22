# Zebra Circus Blaster 🎪

A first-person "blaster" browser game that doubles as a **Zebra Technologies** product showcase. Shoot barcode-balloon targets in a circus tent; walk up to real Zebra devices to pick them up as weapons and open their product info.

**▶️ Play it now:** https://zebra-circus-game.vercel.app

Built with [Three.js](https://threejs.org/) (r128) — no framework or game build step. `index.html` remains the canonical playable game; `zebra-circus.scene.json` is its editable arena layout.

## Controls
- **WASD / Arrow keys** — move
- **Mouse** — look / aim (click to lock pointer)
- **Click** — shoot
- **E** — pick up a device near you
- **X** — close a scanned QR product panel and resume movement

## Featured devices
MC3400 · MC9400 · PS30 · TC8300

## Run locally
Any static server works (the 3D models need HTTP, not `file://`):

```bash
python3 -m http.server 8765 --bind 127.0.0.1
# then open http://127.0.0.1:8765/
```

To move arena objects, edit colliders, change QR artwork, add simple scene objects, and save the reviewed scene back to GitHub, follow [EDITOR.md](EDITOR.md).

**Online scene editor:** [zebra-scene-editor.timofeymarkin98.workers.dev](https://zebra-scene-editor.timofeymarkin98.workers.dev). Tim shares the private access code separately. The hosted page opens only the exact Zebra scene editor, supports real-time co-editing, Command-Z / Command-Shift-Z, Option/Alt + primary-drag orbit, and a revocable **Connect AI** workflow. AI may inspect/edit/undo/checkpoint the live room but cannot queue GitHub; validated scene-only GitHub updates stay human-confirmed and are reviewed in [pull request 1](https://github.com/Mucchun/zebra-circus-game/pull/1). No private engine checkout is required.

Zebra pins the compatible private editor release in `game-port-studio.project.json`. For local engine work, collaborators with repository access can keep `game-port-studio` beside this repository and run:

```bash
node tools/start-game-port-studio.mjs
```

This starts the game on port 8765 and prints a one-run focused editor URL on port 8766. The collaborator lands directly in the real Zebra scene; the engine Home, conversion, publishing and project-generation UI is not rendered.

## Focused scene editor

The focused editor shows only Objects, the original Zebra viewport, Inspector, scene transforms, Undo/Redo, Play/Stop, Save and Save & Push. Edit/Play parity is exact because both modes pause and resume the same canonical `index.html` iframe, scene, canvas and WebGL context.

The 222 original Zebra objects keep stable IDs, fixed hierarchy, and fixed model/primitive sources. Their transforms (including hierarchy-root transforms), visibility and authored Box Colliders are editable; the only original-source exception is switching a QR among the exact MC9400, MC3400, PS30 and TC8300 artwork family. The editor can also add persistent **Empty**, **Cube**, **Sphere**, **Cylinder**, **Capsule** and **Plane** extras with an inline untextured material and optional Box Collider. Extras support transforms, parenting, visibility, duplicate and delete, but do not automatically gain Zebra scan, pickup, balloon, scoring or HUD behavior.

## Install as an app (PWA)
The game ships a web-app manifest + service worker, so it's installable:
- **Windows/Mac (Chrome/Edge):** address-bar **Install** icon, or menu → *Install page as app*
- **Safari (Mac):** File → *Add to Dock*
- **Phone:** Share → *Add to Home Screen*

## Repository layout
```
index.html                 canonical playable game
zebra-circus.scene.json    222-object editable arena layout
game-port-studio.project.json  pinned private editor version and verified commit
models/editor/             exact QR, seated-crowd, imported-crowd, and arena GLBs
tools/  tests/             editor launcher, deterministic scene builders, parity and portability checks
vendor/                    three.js + GLTFLoader (vendored, no CDN)
models/  textures/         3D assets
icons/  manifest.webmanifest  sw.js   PWA installability
desktop/                   optional Electron desktop wrapper (main.js)
```

## Desktop app (optional)
An Electron wrapper lives in `desktop/`. Its `node_modules` are gitignored — run `npm install` inside `desktop/` to restore the Electron runtime, then `npm start`.
