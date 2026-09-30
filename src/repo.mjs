import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRemappings } from "./solidity.mjs";

export const sdkDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The Pons launcher stack is the one Foundry project at contracts/ since the
// 2026-09-29 merge (the nested project it came from is gone), and every
// POO.MEME source imports another through the one @poomeme/ -> src/ prefix.
export function contractsDir(repo) {
  const dir = join(repo, "contracts");
  return existsSync(join(dir, "foundry.toml")) ? dir : null;
}

export function findRepo(start = sdkDir) {
  let at = resolve(start);
  for (;;) {
    if (contractsDir(at) !== null) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

export function requireRepo(start = sdkDir) {
  const repo = findRepo(start);
  if (repo === null) {
    throw new Error("no launchpad checkout above this package: contracts/foundry.toml not found");
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

const TOOLCHAIN_REQUIRED = ["solc_version", "auto_detect_solc", "evm_version", "optimizer", "optimizer_runs", "via_ir"];
const TOOLCHAIN_OPTIONAL = ["isolate"];

export function toolchainOf(repo) {
  const dir = contractsDir(repo);
  if (dir === null) throw new Error("contracts/foundry.toml does not exist");
  const profile = readProfile(join(dir, "foundry.toml"));
  const missing = TOOLCHAIN_REQUIRED.filter((key) => profile[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`${dir}/foundry.toml no longer pins ${missing.join(", ")}`);
  }
  const out = Object.fromEntries(TOOLCHAIN_REQUIRED.map((key) => [key, profile[key]]));
  for (const key of TOOLCHAIN_OPTIONAL) if (profile[key] !== undefined) out[key] = profile[key];
  return out;
}

// contracts/remappings.txt is split into blocks by blank lines: block 1 is
// what src/ may import, block 2 is test/script-only. The package only ever
// vendors src/ files and the test fixtures below, whose own imports reach
// src/ through block 1 alone, so only block 1 is read.
export function srcRemappings(repo) {
  const dir = contractsDir(repo);
  const text = readFileSync(join(dir, "remappings.txt"), "utf8");
  const [block1] = text.split(/\n\s*\n/);
  return parseRemappings(block1, dir);
}

const PONS_FILES = [
  "IPooModuleFactory.sol",
  "ModuleManifestTypes.sol",
  "ModuleManifestLib.sol",
  "ModuleManifestCheckLib.sol",
  "LaunchTypes.sol",
  "PooLauncher.sol",
  "PooModuleDirectory.sol",
];

export function ponsFile(repo, name) {
  if (!PONS_FILES.includes(name)) throw new Error(`${name} is not one of the module-factory files this SDK vendors`);
  const dir = contractsDir(repo);
  return join(dir, "src", "pons", name);
}

const TEST_FIXTURE_FILES = ["pons/PonsV2Mocks.sol", "pons/VanityMinerLib.sol"];

// The launcher test suite's own fixtures — a CREATE2-spawner Pons stand-in
// (PonsV2Mocks.sol) and its salt miner (VanityMinerLib.sol) — proven against
// PooLauncher's vanity-suffix and economics-pin checks by that suite
// itself. The devkit vendors these rather than re-deriving an equivalent by
// hand, so a future change to what PooLauncher expects of Pons is only one
// `poo assemble` away from being caught, not a second hand-written mock this
// SDK must remember to update.
export function testFixtureFile(repo, name) {
  if (!TEST_FIXTURE_FILES.includes(name)) throw new Error(`${name} is not one of the test fixtures this SDK vendors`);
  const dir = contractsDir(repo);
  return join(dir, "test", ...name.split("/"));
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
