import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const zebraRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolveGamePortStudioRoot() {
  const explicit = process.env.GAME_PORT_STUDIO_PATH?.trim();
  const candidates = [
    explicit && path.resolve(explicit),
    path.resolve(zebraRoot, "..", "game-port-studio"),
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      const packageJson = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8"));
      if (packageJson.name === "game-port-studio") return candidate;
    } catch {
      // Try the next explicit or sibling checkout.
    }
  }

  throw new Error([
    "Game Port Studio was not found.",
    "Clone Sparkah/game-port-studio beside zebra-circus-game, or set GAME_PORT_STUDIO_PATH to its checkout.",
    "Run npm ci in the engine checkout before using Zebra's editor tools.",
  ].join(" "));
}

export async function importGamePortStudioModule(modulePath) {
  const studioRoot = await resolveGamePortStudioRoot();
  const dependencyRoot = path.join(studioRoot, "node_modules");
  const resolved = path.resolve(dependencyRoot, modulePath);
  if (!resolved.startsWith(`${dependencyRoot}${path.sep}`)) throw new Error("Invalid Game Port Studio module path.");
  return import(pathToFileURL(resolved).href);
}
