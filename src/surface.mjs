import { readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

import { contractsDir, ponsFile, srcRemappings, testFixtureFile } from "./repo.mjs";
import { importsOf, isFile, makeResolver, stripComments } from "./solidity.mjs";

export const PACKAGE_NAME = "poo-sdk";

export const VENDORED = [
  { name: "forge-std", from: "contracts/lib/forge-std", trees: ["src"], notices: ["LICENSE-MIT", "LICENSE-APACHE"] },
  { name: "openzeppelin-contracts", from: "contracts/lib/openzeppelin-contracts", trees: ["contracts"], notices: ["LICENSE"] },
];

const TIER_RANK = { surface: 0, platform: 1, devkit: 2 };

const TIER_AUDIENCE = {
  surface: "what a module's own sources may import",
  platform: "the launcher implementation, reachable only through the devkit",
  devkit: "test-only devkit",
};

// What a shipped module factory needs beyond its own file: the interface it
// implements, and the manifest library it builds one with. Both are asked for
// explicitly here rather than discovered by walking a real first-party
// factory, because a real factory (PooBuybackBurnModuleFactory.sol) also
// reaches its own module contract and that module's own dependencies, which
// are none of a module author's business to see as "surface".
const SURFACE_ROOTS = ["IPooModuleFactory.sol"];
const SURFACE_ALSO = ["ModuleManifestLib.sol", "ModuleManifestTypes.sol"];

// The devkit's own real-code roots: the launcher a token is created through,
// and the directory a factory publishes to. Everything they reach — the
// splitter, the manifest checker, the Pons interfaces and pool-key library —
// is platform tier, shipped so `poo dev`-style tests can stand up the whole
// launcher stack, never importable from a module's own src/.
const DEVKIT_ROOTS = ["PooLauncher.sol", "PooModuleDirectory.sol"];

// The launcher test suite's own Pons stand-in and salt miner (see repo.mjs's
// TEST_FIXTURE_FILES) — vendored rather than hand-derived, so a change to
// what PooLauncher expects of Pons (the 2026-09-29 vanity-suffix and
// economics-pin addition, for one) is caught by re-running `poo assemble`
// against this checkout instead of silently going stale in a hand-written
// mock. Everything they reach is platform tier, same as DEVKIT_ROOTS.
const DEVKIT_TEST_ROOTS = ["pons/PonsV2Mocks.sol", "pons/VanityMinerLib.sol"];

const TOP_LEVEL_CONTRACT = /^contract\s+([A-Za-z0-9_$]+)/m;

const unix = (path) => path.split(sep).join(posix.sep);

function targetOf(repo, file) {
  const src = join(contractsDir(repo), "src") + sep;
  if (file.startsWith(src)) return `core/${unix(relative(src, file))}`;
  const test = join(contractsDir(repo), "test") + sep;
  if (file.startsWith(test)) return `core-test/${unix(relative(test, file))}`;
  throw new Error(`${unix(relative(repo, file))} has no place in the package layout`);
}

export function select(repo) {
  const resolveImport = makeResolver(srcRemappings(repo));
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

  const chosen = new Map();
  const claim = (file, tier) => {
    if (chosen.has(file)) return;
    chosen.set(file, { file, tier, source: unix(relative(repo, file)), target: targetOf(repo, file) });
  };

  const surfaceAllow = [...SURFACE_ROOTS, ...SURFACE_ALSO].map((name) => ponsFile(repo, name));
  const surfaceReach = reachable(surfaceAllow.map((f) => f));
  for (const file of surfaceReach) {
    if (isVendored(file)) continue;
    if (!surfaceAllow.includes(file)) {
      throw new Error(
        `${unix(relative(repo, file))} is reachable from the module surface roots but is not on the explicit allow-list — the surface just widened; add it to SURFACE_ROOTS or SURFACE_ALSO deliberately, or narrow the import`,
      );
    }
    claim(file, "surface");
  }

  const devkitReach = reachable([
    ...DEVKIT_ROOTS.map((name) => ponsFile(repo, name)),
    ...DEVKIT_TEST_ROOTS.map((name) => testFixtureFile(repo, name)),
  ]);
  for (const file of devkitReach) {
    if (isVendored(file)) continue;
    claim(file, "platform");
  }

  const files = [...chosen.values()].sort((a, b) => (a.target < b.target ? -1 : 1));
  return { files, edges, isVendored, byPath: chosen, unix };
}

export function closureViolations(repo, selection) {
  const { edges, isVendored, byPath } = selection;
  const problems = [];

  for (const entry of selection.files) {
    if (TIER_RANK[entry.tier] !== 0) continue;
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
