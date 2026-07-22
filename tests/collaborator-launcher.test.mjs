import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collaboratorEditorUrl, collaboratorEnvironment, verifyStudioCheckout } from "../tools/start-game-port-studio.mjs";

const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(gameRoot, "game-port-studio.project.json"), "utf8"));
const token = "launcher_test_token_000000000000000000000000000";

test("Zebra launcher enables only the focused scene repository session", () => {
  assert.equal(manifest.engine.version, "0.18.0");
  assert.equal(manifest.engine.testedCommit, "5f1ad5d0e4da2ce3cdc741118db1f271cd639f9e");
  assert.equal(manifest.collaboration.mode, "focused-scene");
  assert.equal(manifest.collaboration.repository, "Mucchun/zebra-circus-game");
  assert.equal(manifest.collaboration.remote, "origin");
  assert.equal(manifest.collaboration.commitMessage, "Update Zebra scene from editor");
  assert.equal(manifest.collaboration.hosted.editorUrl, "https://zebra-scene-editor.timofeymarkin98.workers.dev");
  assert.equal(manifest.collaboration.hosted.pullRequestUrl, "https://github.com/Mucchun/zebra-circus-game/pull/1");

  const environment = collaboratorEnvironment(manifest, token, gameRoot);
  assert.deepEqual(environment, {
    GAME_PORT_COLLABORATOR_PROJECT_ROOT: gameRoot,
    GAME_PORT_COLLABORATOR_SCENE: "zebra-circus.scene.json",
    GAME_PORT_COLLABORATOR_ORIGIN: "http://127.0.0.1:8766",
    GAME_PORT_COLLABORATOR_TOKEN: token,
    GAME_PORT_COLLABORATOR_REPOSITORY: "Mucchun/zebra-circus-game",
    GAME_PORT_COLLABORATOR_REMOTE: "origin",
    GAME_PORT_COLLABORATOR_COMMIT_MESSAGE: "Update Zebra scene from editor",
  });

  const editorUrl = new URL(collaboratorEditorUrl(manifest, token));
  assert.equal(editorUrl.origin, "http://127.0.0.1:8766");
  assert.equal(editorUrl.search, "", "The one-run token must never be placed in the query string.");
  assert.equal(new URLSearchParams(editorUrl.hash.slice(1)).get("editorToken"), token);
});

test("incomplete focused collaboration configuration fails closed", () => {
  assert.throws(
    () => collaboratorEnvironment({ ...manifest, collaboration: { mode: "focused-scene" } }, token, gameRoot),
    /missing its focused Zebra collaboration settings/,
  );
});

test("Zebra launcher rejects a dirty engine checkout even when HEAD matches the pin", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zebra-studio-pin-"));
  try {
    execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "config", "user.name", "Zebra Launcher Test"]);
    execFileSync("git", ["-C", root, "config", "user.email", "zebra-launcher@example.invalid"]);
    await writeFile(path.join(root, "package.json"), "{}\n");
    execFileSync("git", ["-C", root, "add", "--", "package.json"]);
    execFileSync("git", ["-C", root, "commit", "-m", "Fixture"], { stdio: "ignore" });
    const testedCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const pinned = { ...manifest, engine: { ...manifest.engine, testedCommit } };
    assert.equal(verifyStudioCheckout(root, pinned), testedCommit);
    await writeFile(path.join(root, "package.json"), "{\"dirty\":true}\n");
    assert.throws(() => verifyStudioCheckout(root, pinned), /checkout has local changes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
