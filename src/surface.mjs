import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

import { importsOf, isFile, makeResolver, stripComments } from "./solidity.mjs";
import { remappingsOf } from "./repo.mjs";

export const PACKAGE_NAME = "poo-sdk";

export const VENDORED = [
  { name: "forge-std", from: "contracts/lib/forge-std", trees: ["src"], notices: ["LICENSE-MIT", "LICENSE-APACHE"] },
  { name: "openzeppelin-contracts", from: "contracts/lib/openzeppelin-contracts", trees: ["contracts"], notices: ["LICENSE"] },
  { name: "v2-core", from: "contracts/lib/v2-core", trees: ["contracts"], notices: ["LICENSE"] },
  { name: "v2-periphery", from: "contracts/lib/v2-periphery", trees: ["contracts"], notices: ["LICENSE"] },
];

const PLACEMENT = [
  ["contracts/src/", "src/"],
  ["contracts/devkit/", "devkit/"],
];

const TIER_RANK = { surface: 0, platform: 1, devkit: 2 };

const TIER_AUDIENCE = {
  surface: "what a module's own sources may import",
  platform: "platform implementation, reachable only through the harness",
  devkit: "test-only devkit",
};

// The roots that DEFINE the surface, by what they import. Fixed Presale was
// one of them until 2026-09-20; the launch modes are platform-only
// (`contracts/src/launch/`, founder ruling) and publish nothing, so the surface
// is what a TOKEN-module author's own sources reach — and since the 2026-09-21
// layout that is `contracts/src/standard/` alone, the one prefix a stranger's
// sources may name. What a mode promises the platform
// (`contracts/src/launch/mode/`) still ships, because the devkit's mocks
// implement it, but as platform tier, through the harness, rather than as a
// root a module compiles against; nothing else under `contracts/src/launch/`
// may ever be claimed (`closureViolations` below throws on it).
const SURFACE_ROOTS = [
  "contracts/modules/src/holder-rewards/HolderRewards.sol",
  "contracts/modules/src/holder-rewards/HolderRewardsFactory.sol",
];

const SURFACE_ALSO = [
  "contracts/src/standard/IPooFactoryDeveloper.sol",
  "contracts/src/standard/ManifestFieldsLib.sol",
  "contracts/src/standard/IPooProbeHost.sol",
  "contracts/src/standard/token-module/hooks/IPooOperateOnSellHook.sol",
  "contracts/src/standard/token-module/hooks/IPooReceiveHook.sol",
  "contracts/src/standard/token-module/hooks/IPooTrackHook.sol",
  "contracts/src/standard/token-module/hooks/IPooGateHook.sol",
];

const DEVKIT_ROOTS = ["contracts/devkit", "contracts/devkit/mocks"];

const DEVKIT_ALSO = [];

const DEVKIT_WITHHELD = [
  "contracts/devkit/mocks/MockModule.sol",
  "contracts/devkit/mocks/MockModuleFactory.sol",
  "contracts/devkit/mocks/MockVenueRouter.sol",
  "contracts/devkit/mocks/Successors.sol",
];

const SURFACE_DIRS = ["contracts/src/standard/"];

const CALLER_OWNED = ["contracts/modules/src/"];

const SURFACE_CONTRACTS = ["contracts/src/standard/PooBlueprint.sol"];

const DEVKIT_WITHIN = ["contracts/devkit/"];
const PLATFORM_WITHIN = ["contracts/src/"];

// A launch mode is never published: the only launch directory the package may
// carry is what a mode promises the platform. Anything else under
// `contracts/src/launch/` reaching the selection is a leak, however it got there.
const LAUNCH_DIR = "contracts/src/launch/";
const LAUNCH_SHIPPED = "contracts/src/launch/mode/";

const TOP_LEVEL_CONTRACT = /^contract\s+([A-Za-z0-9_$]+)/m;

const unix = (path) => path.split(sep).join(posix.sep);

function expand(repo, entries) {
  const out = [];
  for (const entry of entries) {
    const full = join(repo, entry);
    if (entry.endsWith(".sol")) {
      out.push(full);
      continue;
    }
    for (const name of readdirSync(full).sort()) {
      if (name.endsWith(".sol")) out.push(join(full, name));
    }
  }
  return out;
}

function placementOf(repoRelative) {
  const hit = PLACEMENT.find(([from]) => repoRelative.startsWith(from));
  return hit === undefined ? null : hit[1] + repoRelative.slice(hit[0].length);
}

export function select(repo) {
  const resolveImport = makeResolver(remappingsOf(repo));
  const vendorRoots = VENDORED.flatMap((dep) => dep.trees.map((tree) => join(repo, dep.from, tree) + sep));
  const isVendored = (path) => vendorRoots.some((root) => path.startsWith(root));

  const edges = new Map();
  const walk = (file) => {
    if (edges.has(file)) return;
    if (!isFile(file)) throw new Error(`missing source: ${file}`);
    edges.set(file, []);
    if (isVendored(file)) return;
    for (const spec of importsOf(readFileSync(file, "utf8"))) {
      const target = resolveImport(file, spec);
      if (target === null) throw new Error(`${unix(relative(repo, file))} imports ${spec} — no remapping resolves it`);
      edges.get(file).push({ spec, target });
      walk(target);
    }
  };

  const reachable = (roots) => {
    for (const root of roots) walk(root);
    const seen = new Set();
    const stack = [...roots];
    while (stack.length > 0) {
      const at = stack.pop();
      if (seen.has(at)) continue;
      seen.add(at);
      for (const edge of edges.get(at) ?? []) stack.push(edge.target);
    }
    return [...seen].sort();
  };

  const under = (file, prefixes) => prefixes.some((prefix) => unix(relative(repo, file)).startsWith(prefix));

  const chosen = new Map();
  const claim = (file, tier) => {
    if (chosen.has(file)) return;
    const source = unix(relative(repo, file));
    const target = placementOf(source);
    if (target === null) throw new Error(`${source} has no place in the package layout`);
    chosen.set(file, { file, tier, source, target });
  };

  const surfaceReach = reachable([
    ...expand(repo, SURFACE_ROOTS),
    ...SURFACE_ALSO.map((entry) => join(repo, entry)),
  ]);
  for (const file of surfaceReach) {
    if (isVendored(file) || under(file, CALLER_OWNED)) continue;
    if (under(file, SURFACE_DIRS)) claim(file, "surface");
  }

  const devkitRoots = expand(repo, DEVKIT_ROOTS).filter((file) => !DEVKIT_WITHHELD.includes(unix(relative(repo, file))));
  const devkitReach = reachable([...devkitRoots, ...expand(repo, DEVKIT_ALSO)]);
  for (const file of devkitReach) if (under(file, DEVKIT_WITHIN)) claim(file, "devkit");
  for (const file of devkitReach) {
    if (isVendored(file)) continue;
    if (under(file, PLATFORM_WITHIN)) claim(file, "platform");
  }

  for (const entry of chosen.values()) {
    if (entry.source.startsWith(LAUNCH_DIR) && !entry.source.startsWith(LAUNCH_SHIPPED)) {
      throw new Error(`${entry.source} reached the package — nothing under ${LAUNCH_DIR} but ${LAUNCH_SHIPPED} may ship`);
    }
  }

  const files = [...chosen.values()].sort((a, b) => (a.target < b.target ? -1 : 1));
  return { files, edges, isVendored, byPath: chosen, unix };
}

export function closureViolations(repo, selection) {
  const { edges, isVendored, byPath } = selection;
  const problems = [];

  for (const entry of selection.files) {
    if (TIER_RANK[entry.tier] !== 0 || SURFACE_CONTRACTS.includes(entry.source)) continue;
    const hit = TOP_LEVEL_CONTRACT.exec(stripComments(readFileSync(entry.file, "utf8")));
    if (hit !== null) {
      problems.push(
        `${entry.source} declares contract ${hit[1]} — the module surface carries interfaces, types and pure libraries`,
      );
    }
  }

  for (const entry of selection.files) {
    for (const edge of edges.get(entry.file) ?? []) {
      if (isVendored(edge.target)) {
        if (!isFile(edge.target)) {
          problems.push(`${entry.source} imports ${edge.spec} — no such file in any vendored dependency`);
        }
        continue;
      }
      const target = byPath.get(edge.target);
      if (target === undefined) {
        problems.push(
          `${entry.source} imports ${edge.spec} — ${unix(relative(repo, edge.target))} is outside the selection`,
        );
        continue;
      }
      if (TIER_RANK[target.tier] > TIER_RANK[entry.tier]) {
        problems.push(
          `${entry.source} (${entry.tier}) imports ${edge.spec} — ${target.source} is ${TIER_AUDIENCE[target.tier]}`,
        );
      }
    }
  }
  return problems;
}
