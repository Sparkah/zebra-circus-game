'use strict';
const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 58762;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json',
  '.wasm': 'application/wasm'
};

// Minimal static file server (localhost only).
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '') p = '/index.html';
      const fp = path.normalize(path.join(ROOT, p));
      if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        res.end(data);
      });
    });
    server.on('error', (e) => {
      // Port already in use (e.g. an old server) — just load whatever is there.
      console.warn('server error:', e.message);
      resolve();
    });
    server.listen(PORT, '127.0.0.1', () => { console.log(`serving ${ROOT} on :${PORT}`); resolve(); });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Zebra Circus Blaster',
    backgroundColor: '#05050d',
    webPreferences: { contextIsolation: true, backgroundThrottling: false }
  });

  win.setMenuBarVisibility(false);
  win.loadURL(`http://127.0.0.1:${PORT}/`);

  // window.open(...) → open Zebra links in the real browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
