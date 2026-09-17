import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/[^\n]*/g;
const IMPORT = /\bimport\b[^;]*;/g;
const QUOTED = /["']([^"']+)["']/g;

const blank = (text) => text.replace(/[^\n]/g, " ");

export function stripComments(source) {
  return source.replace(BLOCK_COMMENT, blank).replace(LINE_COMMENT, blank);
}

export function importSitesOf(source) {
  const stripped = stripComments(source);
  const sites = [];
  for (const match of stripped.matchAll(IMPORT)) {
    const quoted = [...match[0].matchAll(QUOTED)].map(([, value]) => value);
    if (quoted.length === 0) continue;
    sites.push({
      spec: quoted[quoted.length - 1],
      line: stripped.slice(0, match.index).split("\n").length,
    });
  }
  return sites;
}

export function importsOf(source) {
  return importSitesOf(source).map((site) => site.spec);
}

export function parseRemappings(text, base) {
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf("=");
    if (split < 0) continue;
    entries.push({ prefix: trimmed.slice(0, split), target: resolve(base, trimmed.slice(split + 1)) });
  }
  return entries;
}

export function makeResolver(remappings) {
  const ordered = [...remappings].sort((a, b) => b.prefix.length - a.prefix.length);
  return (fromFile, spec) => {
    if (spec.startsWith(".")) return resolve(dirname(fromFile), spec);
    const hit = ordered.find((entry) => spec.startsWith(entry.prefix));
    return hit ? resolve(hit.target, spec.slice(hit.prefix.length)) : null;
  };
}

export function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}
