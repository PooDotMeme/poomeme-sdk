import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

import { readProfile, sdkDir } from "./repo.mjs";
import { PACKAGE_NAME } from "./surface.mjs";

const SCRIPT_FILE = join("script", "Poo.s.sol");
export const RECORD_FILE = join(".poo", "dev.json");

export const unix = (path) => path.split(sep).join(posix.sep);

export function locateProject(directory = ".") {
  const project = resolve(directory);
  if (!existsSync(join(project, "foundry.toml"))) throw new Error(`${directory} is not a Foundry project`);
  return project;
}

export function locatePackage(project, flags = {}) {
  const at = typeof flags.sdk === "string" ? resolve(flags.sdk) : join(project, "lib", PACKAGE_NAME);
  if (!existsSync(join(at, "surface.json"))) {
    throw new Error(`no assembled ${PACKAGE_NAME} at ${unix(relative(project, at)) || at} — run poo init, or pass --sdk`);
  }
  return at;
}

export function sourceDir(project) {
  return join(project, JSON.parse(readProfile(join(project, "foundry.toml")).src ?? '"src"'));
}

export function moduleNameOf(project, flags = {}) {
  if (typeof flags.name === "string") return flags.name;
  const src = sourceDir(project);
  const factories = readdirSync(src)
    .filter((entry) => entry.endsWith("Factory.sol"))
    .map((entry) => entry.slice(0, -"Factory.sol".length));
  if (factories.length === 1) return factories[0];
  const where = unix(relative(project, src)) || "src";
  if (factories.length === 0) throw new Error(`no <Name>Factory.sol in ${where} — pass --name to say which contract`);
  throw new Error(`${where} holds ${factories.join("Factory, ")}Factory — pass --name to say which one`);
}

export function ensureScript(project, name) {
  const at = join(project, SCRIPT_FILE);
  if (existsSync(at)) return { path: at, written: false };
  mkdirSync(dirname(at), { recursive: true });
  const template = readFileSync(join(sdkDir, "template", "script", "Poo.s.sol"), "utf8");
  writeFileSync(at, template.replaceAll("__MODULE__", name));
  return { path: at, written: true };
}

function jsonLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* forge interleaves plain lines with the JSON record */
    }
  }
  return out;
}

// forge script prints its JSON record on stdout and its progress on stderr, so
// the author still watches the build while we read the returns.
export function forgeScript(project, argv) {
  let stdout;
  try {
    stdout = execFileSync("forge", ["script", SCRIPT_FILE, ...argv, "--json"], {
      cwd: project,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (error) {
    const said = jsonLines(error.stdout ?? "").find((record) => typeof record.error === "string");
    throw new Error(said === undefined ? "forge script failed" : said.error);
  }
  const returned = jsonLines(stdout).find((record) => record.returns !== undefined);
  if (returned === undefined) throw new Error("forge script answered nothing — no returns in its JSON record");
  return returned.returns;
}

export function build(project) {
  console.log("$ forge build");
  try {
    execFileSync("forge", ["build"], { cwd: project, stdio: "inherit" });
  } catch {
    throw new Error("forge build failed — fix the compiler first");
  }
}

export function artifactOf(project, file, contract) {
  const at = join(project, "out", file, `${contract}.json`);
  if (!existsSync(at)) throw new Error(`no compiled ${contract} at ${unix(relative(project, at))} — run forge build`);
  return JSON.parse(readFileSync(at, "utf8"));
}
