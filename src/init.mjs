import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { findRepo, sdkDir } from "./repo.mjs";
import { PACKAGE_NAME } from "./surface.mjs";

const NAME = /^[A-Z][A-Za-z0-9]*$/;
const HANDLE = /^(?=.{3,31}$)[a-z](?:-?[a-z0-9])+$/;
const RENAMED_DIRS = ["src", "test"];
const TOP_FILES = ["foundry.toml", "remappings.txt", ".gitignore"];
const SCRIPT_FILES = ["Poo.s.sol", "Publish.s.sol"];

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
  // no longer has: assembly reads the tree and writes the package in a
  // fraction of a second, so the cache buys nothing and costs correctness.
  // `--sdk` still names a package deliberately, which is the one case where
  // reusing is the caller's own choice.
  //
  // An installed CLI has no tree to read. Its `prepack` assembled the
  // platform into this same path when the package was built, so that copy is
  // the surface the published version describes.
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

function copyTemplate(target, name, handle) {
  const fill = (text) => text.replaceAll("__MODULE__", name).replaceAll("__HANDLE__", handle);
  const write = (destPath, srcPath) => {
    mkdirSync(join(destPath, ".."), { recursive: true });
    writeFileSync(destPath, fill(readFileSync(srcPath, "utf8")));
  };

  for (const dir of RENAMED_DIRS) {
    const from = join(sdkDir, "template", dir);
    for (const entry of readdirSync(from)) {
      write(join(target, dir, entry.replace("Module", name)), join(from, entry));
    }
  }
  for (const entry of SCRIPT_FILES) {
    write(join(target, "script", entry), join(sdkDir, "template", "script", entry));
  }
  for (const entry of TOP_FILES) {
    write(join(target, entry), join(sdkDir, "template", entry));
  }
}

function renderReadme(name, handle) {
  return [
    `# ${name}`,
    "",
    `A POO.MEME Pons module. \`${name}Factory\` carries the manifest the token page reads and is what`,
    "\`PooModuleDirectory.publish\` interrogates before it will list you.",
    "",
    "```",
    "forge build                            compile the module against the real launcher stack",
    "forge test                              stand the real launcher, directory and a Pons stand-in up, register and launch",
    "poo preview                             draw the token page this manifest asks for",
    "poo check                               hold every import to the published surface, and run the directory's own manifest rules locally",
    "poo abi                                 print this module's and factory's compiled ABI",
    "forge script script/Publish.s.sol --rpc-url <url> [--broadcast]   deploy (if needed) and publish to a real directory",
    "```",
    "",
    `The handle \`${handle}\` names this module family. The first wallet to publish a factory under it holds it`,
    "from then on — every later version must come from the same wallet. Change it in the manifest before you",
    "publish if you want a different one.",
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
    throw new Error(`"${handle}" is not a handle — 3 to 31 characters of a-z, 0-9 and -, starting with a letter, with no - at the end or twice in a row`);
  }

  mkdirSync(target, { recursive: true });
  const existing = readdirSync(target).filter((entry) => !entry.startsWith("."));
  if (existing.length > 0 && flags.force !== true) {
    throw new Error(`${directory} already holds ${existing.join(", ")} — pass --force to write into it anyway`);
  }

  const packageDir = await resolvePackage(flags);
  const surface = JSON.parse(readFileSync(join(packageDir, "surface.json"), "utf8"));

  copyTemplate(target, name, handle);
  cpSync(packageDir, join(target, "lib", PACKAGE_NAME), { recursive: true });
  writeFileSync(join(target, "README.md"), renderReadme(name, handle));

  console.log(`scaffolded ${name} into ${directory}`);
  console.log(`  src/${name}.sol             the module a token installs`);
  console.log(`  src/${name}Factory.sol      its manifest and how instances are made`);
  console.log(`  test/${name}.t.sol          the real launcher, directory and a Pons stand-in, in memory`);
  console.log(`  script/Poo.s.sol          that same devkit, deployed — poo preview reads it, forge script --tc Dev runs it on a chain`);
  console.log(`  script/Publish.s.sol      deploy and register with a real directory — dry run unless you pass --broadcast`);
  console.log(`  lib/${PACKAGE_NAME}         the module surface, ${surface.moduleVisible.length} files your sources may import`);

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
