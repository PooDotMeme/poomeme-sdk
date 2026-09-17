import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

import { moduleSurfaceRoots, requireRepo, sdkDir, submodulePins, toolchainOf } from "./repo.mjs";
import { importsOf, isFile, makeResolver, parseRemappings } from "./solidity.mjs";
import { closureViolations, PACKAGE_NAME, select, VENDORED } from "./surface.mjs";

const PACKAGE_ROOTS = {
  "@openzeppelin/": "lib/openzeppelin-contracts/",
  "@uniswap/v2-core/": "lib/v2-core/contracts/",
  "@uniswap/v2-periphery/": "lib/v2-periphery/contracts/",
  "forge-std/": "lib/forge-std/src/",
  "@standard/": "src/standard/",
  "@launch-module/": "src/launch-module/",
  "@token-module/": "src/token-module/",
};

const DEVKIT_ROOTS = {
  "@poo/devkit/": "devkit/",
  "@registry/": "src/registry/",
  "@token/": "src/token/",
};

const CONSUMER_ROOTS = { "@modules/": "src/" };

const unix = (path) => path.split(sep).join(posix.sep);

function checkRootsAgainstRepo(repo) {
  const declared = new Set([...Object.keys(PACKAGE_ROOTS), ...Object.keys(CONSUMER_ROOTS)]);
  const missing = moduleSurfaceRoots(repo).filter((root) => !declared.has(root));
  if (missing.length > 0) {
    throw new Error(
      `modules/remappings.txt block 1 declares ${missing.join(", ")}; the package has no mapping for it`,
    );
  }
}

function renderRemappings() {
  const block = (roots) => Object.entries(roots).map(([prefix, target]) => `${prefix}=${target}`);
  return [...block(PACKAGE_ROOTS), "", ...block(DEVKIT_ROOTS), ""].join("\n");
}

function renderFoundryToml(toolchain) {
  return [
    "[profile.default]",
    'src = "src"',
    'out = "out"',
    'libs = ["lib"]',
    'test = "test"',
    `solc_version = ${toolchain.solc_version}`,
    `auto_detect_solc = ${toolchain.auto_detect_solc}`,
    `evm_version = ${toolchain.evm_version}`,
    `optimizer = ${toolchain.optimizer}`,
    `optimizer_runs = ${toolchain.optimizer_runs}`,
    `via_ir = ${toolchain.via_ir}`,
    "",
  ].join("\n");
}

function listSol(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) listSol(path, base, out);
    else if (name.endsWith(".sol")) out.push(unix(relative(base, path)));
  }
  return out;
}

function verifyEmitted(buildDir) {
  const roots = { ...PACKAGE_ROOTS, ...DEVKIT_ROOTS };
  const resolveImport = makeResolver(
    parseRemappings(
      Object.entries(roots)
        .map(([prefix, target]) => `${prefix}=${target}`)
        .join("\n"),
      buildDir,
    ),
  );
  const problems = [];
  for (const dir of ["src", "devkit"]) {
    const full = join(buildDir, dir);
    let files;
    try {
      files = listSol(full);
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(full, file);
      for (const spec of importsOf(readFileSync(path, "utf8"))) {
        const target = resolveImport(path, spec);
        if (target === null) problems.push(`${dir}/${file} imports ${spec} — the package declares no root for it`);
        else if (!isFile(target)) problems.push(`${dir}/${file} imports ${spec} — ${unix(relative(buildDir, target))} is not in the package`);
      }
    }
  }
  return problems;
}

export function assemble({ repo = requireRepo(), out = join(sdkDir, "build", PACKAGE_NAME), log = console.log } = {}) {
  checkRootsAgainstRepo(repo);
  const toolchain = toolchainOf(repo);
  const selection = select(repo);

  const violations = closureViolations(repo, selection);
  if (violations.length > 0) {
    const error = new Error(`the module surface is not closed:\n  ${violations.join("\n  ")}`);
    error.violations = violations;
    throw error;
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const entry of selection.files) {
    const destination = join(out, entry.target);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(entry.file));
  }

  for (const dep of VENDORED) {
    for (const tree of dep.trees) {
      cpSync(join(repo, dep.from, tree), join(out, "lib", dep.name, tree), { recursive: true });
    }
    for (const notice of dep.notices) {
      const source = join(repo, dep.from, notice);
      if (isFile(source)) writeFileSync(join(out, "lib", dep.name, notice), readFileSync(source));
    }
  }

  writeFileSync(join(out, "foundry.toml"), renderFoundryToml(toolchain));
  writeFileSync(join(out, "remappings.txt"), renderRemappings());

  const emitted = verifyEmitted(out);
  if (emitted.length > 0) {
    const error = new Error(`the assembled package does not resolve on disk:\n  ${emitted.join("\n  ")}`);
    error.violations = emitted;
    throw error;
  }

  const pins = submodulePins(repo);
  const inTier = (...tiers) =>
    selection.files.filter((entry) => tiers.includes(entry.tier)).map((entry) => entry.target).sort();

  const surface = {
    package: PACKAGE_NAME,
    solc: JSON.parse(toolchain.solc_version),
    roots: PACKAGE_ROOTS,
    devkitRoots: DEVKIT_ROOTS,
    consumerRoots: CONSUMER_ROOTS,
    moduleVisible: inTier("surface"),
    testOnly: Object.fromEntries(
      selection.files
        .filter((entry) => entry.tier === "platform" || entry.tier === "devkit")
        .map((entry) => [entry.target, entry.tier])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    ),
    dependencies: Object.fromEntries(
      VENDORED.map((dep) => [dep.name, pins[dep.from] ?? null]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    ),
  };
  writeFileSync(join(out, "surface.json"), `${JSON.stringify(surface, null, 2)}\n`);

  const lines = (tiers) =>
    selection.files
      .filter((entry) => tiers.includes(entry.tier))
      .reduce((total, entry) => total + readFileSync(entry.file, "utf8").split("\n").length - 1, 0);

  const report = {
    out,
    files: selection.files,
    moduleVisible: surface.moduleVisible,
    testOnly: Object.keys(surface.testOnly),
    surfaceLines: lines(["surface"]),
    testOnlyLines: lines(["platform", "devkit"]),
  };

  log(`assembled ${PACKAGE_NAME} into ${unix(relative(repo, out))}`);
  log(`  module surface  ${surface.moduleVisible.length} files, ${report.surfaceLines} lines`);
  log(`  test-only       ${report.testOnly.length} files, ${report.testOnlyLines} lines`);
  log(`  vendored        ${VENDORED.map((dep) => dep.name).join(", ")}`);
  log(`  closure check   passed — every import lands inside the package`);
  return report;
}
