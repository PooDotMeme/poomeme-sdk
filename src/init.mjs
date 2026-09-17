import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { findRepo, readProfile, sdkDir } from "./repo.mjs";
import { PACKAGE_NAME } from "./surface.mjs";

const TOOLCHAIN_KEYS = ["solc_version", "auto_detect_solc", "evm_version", "optimizer", "optimizer_runs", "via_ir"];
const NAME = /^[A-Z][A-Za-z0-9]*$/;
const HANDLE = /^[a-z][a-z0-9-]{2,30}$/;

function pascal(text) {
  const parts = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

function hyphenate(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resolvePackage(flags) {
  if (typeof flags.sdk === "string") {
    const at = resolve(flags.sdk);
    if (!existsSync(join(at, "surface.json"))) throw new Error(`${flags.sdk} is not an assembled ${PACKAGE_NAME}`);
    return at;
  }
  const built = join(sdkDir, "build", PACKAGE_NAME);
  // In a checkout, always reassemble. Reusing a package that happens to be
  // sitting there is how a scaffold gets built against a surface the checkout
  // no longer has: the run prints the stale file count, the tests pass, and
  // the green gate proves nothing. That happened while verifying the surface
  // change of 2026-09-13. Assembly reads the tree and writes the package in
  // about two tenths of a second, so the cache was buying nothing and costing
  // correctness. `--sdk` still names a package deliberately, which is the one
  // case where reusing is the caller's own choice.
  //
  // An installed CLI has no tree to read. Its `prepack` assembled the platform
  // into this same path when the package was built, so that copy is the
  // surface the published version describes.
  const repo = findRepo(sdkDir);
  if (repo !== null && resolve(repo, "sdk") === sdkDir) {
    const { assemble } = await import("./assemble.mjs");
    assemble({ repo, log: () => {} });
    return built;
  }
  if (!existsSync(join(built, "surface.json"))) {
    throw new Error(`this install carries no assembled ${PACKAGE_NAME} and sits in no checkout — reinstall the package, or pass --sdk`);
  }
  return built;
}

function renderRemappings(surface, into = `lib/${PACKAGE_NAME}/`) {
  const rebase = (roots) => Object.entries(roots).map(([prefix, target]) => `${prefix}=${into}${target}`);
  const own = Object.entries(surface.consumerRoots).map(([prefix, target]) => `${prefix}=${target}`);
  return [...rebase(surface.roots), ...own, "", ...rebase(surface.devkitRoots), ""].join("\n");
}

function renderFoundryToml(packageDir) {
  const profile = readProfile(join(packageDir, "foundry.toml"));
  return [
    "[profile.default]",
    'src = "src"',
    'out = "out"',
    'libs = ["lib"]',
    'test = "test"',
    ...TOOLCHAIN_KEYS.map((key) => `${key} = ${profile[key]}`),
    "",
  ].join("\n");
}

function renderReadme(name, handle) {
  return [
    `# ${name}`,
    "",
    `A POO.MEME token module. \`${name}Factory\` carries the manifest the token page reads and the probe`,
    "the registry interrogates before it will publish anything.",
    "",
    "```",
    "forge build     compile the module against the platform",
    "forge test      publish it to a real registry on a throwaway chain",
    "poo preview     draw the token page this manifest asks for",
    "poo dev         stand a chain up and run it there, end to end",
    "poo check       hold every import to the published surface",
    "poo publish     publish a deployed factory to a module registry",
    "```",
    "",
    `The handle \`${handle}\` is claimed by the first wallet that publishes under it, and belongs to that`,
    "wallet's module family afterwards. It shares one namespace with wallet handles, so a handle a wallet",
    "already holds cannot be published under. Change it in the manifest before you publish if you want a",
    "different one.",
    "",
  ].join("\n");
}

export async function init({ directory = ".", flags = {} }) {
  const target = resolve(directory);
  const name = typeof flags.name === "string" ? flags.name : pascal(basename(target));
  if (!NAME.test(name)) {
    throw new Error(`"${name}" is not a contract name — pass --name with an upper-camel-case word`);
  }
  const handle = typeof flags.handle === "string" ? flags.handle : hyphenate(name);
  if (!HANDLE.test(handle)) {
    throw new Error(`"${handle}" is not a handle — 3 to 31 characters of a-z, 0-9 and -, starting with a letter`);
  }

  mkdirSync(target, { recursive: true });
  const existing = readdirSync(target).filter((entry) => !entry.startsWith("."));
  if (existing.length > 0 && flags.force !== true) {
    throw new Error(`${directory} already holds ${existing.join(", ")} — pass --force to write into it anyway`);
  }

  const packageDir = await resolvePackage(flags);
  const surface = JSON.parse(readFileSync(join(packageDir, "surface.json"), "utf8"));

  cpSync(packageDir, join(target, "lib", PACKAGE_NAME), { recursive: true });

  const fill = (text) => text.replaceAll("__MODULE__", name).replaceAll("__HANDLE__", handle);
  const template = (from, to) => {
    const destination = join(target, to);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, fill(readFileSync(join(sdkDir, "template", from), "utf8")));
  };

  template("src/Module.sol", `src/${name}.sol`);
  template("src/ModuleFactory.sol", `src/${name}Factory.sol`);
  template("test/Module.t.sol", `test/${name}.t.sol`);
  template("script/Poo.s.sol", join("script", "Poo.s.sol"));

  writeFileSync(join(target, "foundry.toml"), renderFoundryToml(packageDir));
  writeFileSync(join(target, "remappings.txt"), renderRemappings(surface));
  writeFileSync(join(target, ".gitignore"), ["out/", "cache/", "broadcast/", ".poo/", ""].join("\n"));
  writeFileSync(join(target, "README.md"), renderReadme(name, handle));

  console.log(`scaffolded ${name} into ${directory}`);
  console.log(`  src/${name}.sol            the module a token installs`);
  console.log(`  src/${name}Factory.sol     its manifest, its probe, and how instances are made`);
  console.log(`  test/${name}.t.sol         a real platform, stood up in memory, that publishes it`);
  console.log(`  script/Poo.s.sol          the platform poo dev deploys and poo preview reads`);
  console.log(`  lib/${PACKAGE_NAME}        the platform surface, ${surface.moduleVisible.length} files your sources may import`);

  if (flags.build === false) return 0;
  for (const argv of [["build"], ["test"]]) {
    console.log(`\n$ forge ${argv.join(" ")}`);
    try {
      execFileSync("forge", argv, { cwd: target, stdio: "inherit" });
    } catch {
      console.error(`\nforge ${argv[0]} failed in ${directory}`);
      return 1;
    }
  }
  return 0;
}
