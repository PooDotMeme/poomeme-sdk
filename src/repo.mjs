import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRemappings } from "./solidity.mjs";

export const sdkDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function findRepo(start = sdkDir) {
  let at = resolve(start);
  for (;;) {
    if (existsSync(join(at, "contracts", "foundry.toml")) && existsSync(join(at, "modules", "remappings.txt"))) {
      return at;
    }
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

export function requireRepo(start = sdkDir) {
  const repo = findRepo(start);
  if (repo === null) {
    throw new Error("no launchpad checkout above this package: contracts/foundry.toml and modules/remappings.txt not found");
  }
  return repo;
}

const SCALAR = /^([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/;

export function readProfile(tomlPath, profile = "profile.default") {
  const values = {};
  let inside = false;
  for (const line of readFileSync(tomlPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") continue;
    if (trimmed.startsWith("[")) {
      inside = trimmed === `[${profile}]`;
      continue;
    }
    if (!inside) continue;
    const hit = SCALAR.exec(trimmed);
    if (hit === null) continue;
    values[hit[1]] = hit[2];
  }
  return values;
}

export function toolchainOf(repo) {
  const profile = readProfile(join(repo, "contracts", "foundry.toml"));
  const required = ["solc_version", "auto_detect_solc", "evm_version", "optimizer", "optimizer_runs", "via_ir"];
  const missing = required.filter((key) => profile[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`contracts/foundry.toml no longer pins ${missing.join(", ")}`);
  }
  return Object.fromEntries(required.map((key) => [key, profile[key]]));
}

export function remappingsOf(repo) {
  const contracts = parseRemappings(
    readFileSync(join(repo, "contracts", "remappings.txt"), "utf8"),
    join(repo, "contracts"),
  );
  const modules = parseRemappings(
    readFileSync(join(repo, "modules", "remappings.txt"), "utf8"),
    join(repo, "modules"),
  );
  const merged = new Map();
  for (const entry of [...contracts, ...modules]) merged.set(entry.prefix, entry);
  return [...merged.values()];
}

export function moduleSurfaceRoots(repo) {
  const [first] = readFileSync(join(repo, "modules", "remappings.txt"), "utf8").split(/\n\s*\n/);
  return parseRemappings(first, join(repo, "modules")).map((entry) => entry.prefix);
}

export function submodulePins(repo) {
  try {
    const out = execFileSync("git", ["-C", repo, "submodule", "status"], { encoding: "utf8" });
    const pins = {};
    for (const line of out.split("\n")) {
      const hit = /^[\s+-U]?([0-9a-f]{40})\s+(\S+)/.exec(line);
      if (hit !== null) pins[hit[2]] = hit[1];
    }
    return pins;
  } catch {
    return {};
  }
}
