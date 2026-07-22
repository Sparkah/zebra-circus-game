# Zebra Circus Blaster 🎪

A first-person "blaster" browser game that doubles as a **Zebra Technologies** product showcase. Shoot barcode-balloon targets in a circus tent; walk up to real Zebra devices to pick them up as weapons and open their product info.

**▶️ Play it now:** https://zebra-circus-game.vercel.app

Built with [Three.js](https://threejs.org/) (r128) — no build step, no framework. The whole game is a single `index.html`.

## Controls
- **WASD / Arrow keys** — move
- **Mouse** — look / aim (click to lock pointer)
- **Click** — shoot
- **E** — pick up a device near you

## Featured devices
MC3400 · MC9400 · PS30 · TC8300

## Run locally
Any static server works (the 3D models need HTTP, not `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Install as an app (PWA)
The game ships a web-app manifest + service worker, so it's installable:
- **Windows/Mac (Chrome/Edge):** address-bar **Install** icon, or menu → *Install page as app*
- **Safari (Mac):** File → *Add to Dock*
- **Phone:** Share → *Add to Home Screen*

## Repository layout
```
index.html                 the entire game
vendor/                    three.js + GLTFLoader (vendored, no CDN)
models/  textures/         3D assets
icons/  manifest.webmanifest  sw.js   PWA installability
desktop/                   optional Electron desktop wrapper (main.js)
```

## Desktop app (optional)
An Electron wrapper lives in `desktop/`. Its `node_modules` are gitignored — run `npm install` inside `desktop/` to restore the Electron runtime, then `npm start`.
