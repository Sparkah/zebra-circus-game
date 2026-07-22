import { spawn, execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveGamePortStudioRoot, zebraRoot } from "./game-port-studio-path.mjs";

const manifest = JSON.parse(await readFile(path.join(zebraRoot, "game-port-studio.project.json"), "utf8"));
if (manifest.schema !== "game-port-studio/link@1" || manifest.adapter !== "zebra-runtime") {
  throw new Error("game-port-studio.project.json is not a supported Zebra editor link.");
}

const studioRoot = await resolveGamePortStudioRoot();
const studioPackage = JSON.parse(await readFile(path.join(studioRoot, "package.json"), "utf8"));
if (studioPackage.version !== manifest.engine.version) {
  throw new Error(`Zebra requires Game Port Studio ${manifest.engine.version}; found ${studioPackage.version}.`);
}

const actualCommit = execFileSync("git", ["-C", studioRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (actualCommit !== manifest.engine.testedCommit) {
  throw new Error(`Zebra was verified with Game Port Studio ${manifest.engine.testedCommit}; found ${actualCommit}. Checkout tag v${manifest.engine.version}.`);
}

await Promise.all([
  access(path.join(studioRoot, "node_modules", "vite", "bin", "vite.js")),
  access(path.join(zebraRoot, manifest.scene)),
  access(path.join(zebraRoot, manifest.runtime.entry)),
]);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
let shuttingDown = false;

children.push(spawn(process.execPath, [path.join(studioRoot, "scripts", "serve-game.mjs"), zebraRoot], {
  cwd: studioRoot,
  env: {
    ...process.env,
    GAME_HOST: manifest.runtime.host,
    GAME_PORT: String(manifest.runtime.port),
  },
  stdio: "inherit",
}));

children.push(spawn(npmCommand, ["run", "dev", "--", "--host", manifest.studio.host, "--port", String(manifest.studio.port)], {
  cwd: studioRoot,
  env: process.env,
  stdio: "inherit",
}));

console.log(`Game Port Studio ${manifest.engine.version} @ ${actualCommit.slice(0, 7)}`);
console.log(`Zebra: http://${manifest.runtime.host}:${manifest.runtime.port}/`);
console.log(`Editor: http://${manifest.studio.host}:${manifest.studio.port}/`);
console.log(`Open ${manifest.scene} from the Zebra repository root.`);

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    shutdown("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`Editor process stopped (${signal ?? code}).`);
      shutdown("SIGTERM", code ?? 1);
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal, 0));
}

function shutdown(signal, exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  process.exitCode = exitCode;
}
