import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveGamePortStudioRoot, zebraRoot } from "./game-port-studio-path.mjs";

export function collaboratorEnvironment(manifest, token, projectRoot = zebraRoot) {
  if (manifest.collaboration?.mode !== "focused-scene" || !manifest.collaboration.repository || !manifest.collaboration.remote || !manifest.collaboration.commitMessage) {
    throw new Error("game-port-studio.project.json is missing its focused Zebra collaboration settings.");
  }
  const editorOrigin = `http://${manifest.studio.host}:${manifest.studio.port}`;
  return {
    GAME_PORT_COLLABORATOR_PROJECT_ROOT: projectRoot,
    GAME_PORT_COLLABORATOR_SCENE: manifest.scene,
    GAME_PORT_COLLABORATOR_ORIGIN: editorOrigin,
    GAME_PORT_COLLABORATOR_TOKEN: token,
    GAME_PORT_COLLABORATOR_REPOSITORY: manifest.collaboration.repository,
    GAME_PORT_COLLABORATOR_REMOTE: manifest.collaboration.remote,
    GAME_PORT_COLLABORATOR_COMMIT_MESSAGE: manifest.collaboration.commitMessage,
  };
}

export function collaboratorEditorUrl(manifest, token) {
  return `http://${manifest.studio.host}:${manifest.studio.port}/#editorToken=${encodeURIComponent(token)}`;
}

export function verifyStudioCheckout(studioRoot, manifest) {
  const actualCommit = execFileSync("git", ["-C", studioRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actualCommit !== manifest.engine.testedCommit) {
    throw new Error(`Zebra was verified with editor engine ${manifest.engine.testedCommit}; found ${actualCommit}. Checkout tag v${manifest.engine.version}.`);
  }
  const dirty = execFileSync("git", ["-C", studioRoot, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" }).trim();
  if (dirty) throw new Error(`The editor engine checkout has local changes. Restore the clean v${manifest.engine.version} release before opening Zebra.`);
  return actualCommit;
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(zebraRoot, "game-port-studio.project.json"), "utf8"));
  if (manifest.schema !== "game-port-studio/link@1" || manifest.adapter !== "zebra-runtime") {
    throw new Error("game-port-studio.project.json is not a supported Zebra editor link.");
  }

  const studioRoot = await resolveGamePortStudioRoot();
  const studioPackage = JSON.parse(await readFile(path.join(studioRoot, "package.json"), "utf8"));
  if (studioPackage.version !== manifest.engine.version) {
    throw new Error(`Zebra requires editor engine ${manifest.engine.version}; found ${studioPackage.version}.`);
  }

  const actualCommit = verifyStudioCheckout(studioRoot, manifest);

  await Promise.all([
    access(path.join(studioRoot, "node_modules", "vite", "bin", "vite.js")),
    access(path.join(zebraRoot, manifest.scene)),
    access(path.join(zebraRoot, manifest.runtime.entry)),
  ]);

  const token = randomBytes(32).toString("base64url");
  const editorEnvironment = collaboratorEnvironment(manifest, token);
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

  children.push(spawn(npmCommand, ["run", "dev", "--", "--host", manifest.studio.host, "--port", String(manifest.studio.port), "--strictPort"], {
    cwd: studioRoot,
    env: { ...process.env, ...editorEnvironment },
    stdio: "inherit",
  }));

  console.log(`Zebra Scene Editor ${manifest.engine.version} @ ${actualCommit.slice(0, 7)}`);
  console.log(`Game: http://${manifest.runtime.host}:${manifest.runtime.port}/`);
  console.log(`Edit the scene: ${collaboratorEditorUrl(manifest, token)}`);
  console.log(`Save writes only ${manifest.scene}; Save & Push targets ${manifest.collaboration.repository} via ${manifest.collaboration.remote}.`);

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

  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(signal, 0));

  function shutdown(signal, exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) child.kill(signal);
    }
    process.exitCode = exitCode;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
