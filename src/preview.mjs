import { join } from "node:path";

import { decode, nameRefusal, outputOf, refusalCatalogue } from "./abi.mjs";
import { ceilingsOf, render, vocabularyOf } from "./manifest.mjs";
import { artifactOf, ensureScript, forgeScript, locatePackage, locateProject, moduleNameOf, unix } from "./project.mjs";

const ANSWERS = ["manifest", "accepted", "entryId", "refusal"];

// A manifest names its own contract by selector, which reads as four bytes of
// hex until it is put back beside the function that answers it.
function selectorsOf(project, name) {
  const known = new Map();
  for (const [file, contract] of [
    [`${name}.sol`, name],
    [`${name}Factory.sol`, `${name}Factory`],
  ]) {
    let artifact;
    try {
      artifact = artifactOf(project, file, contract);
    } catch {
      continue;
    }
    for (const [signature, selector] of Object.entries(artifact.methodIdentifiers ?? {})) {
      known.set(`0x${selector}`, signature);
    }
  }
  return known;
}

// The whole platform, stood up inside one EVM that never existed, so the
// manifest a page would read and the verdict a registry would give both come
// back without a chain, a key, an RPC or anything of POO.MEME's running.
export function look({ project, packageDir, name, quiet = false }) {
  const script = ensureScript(project, name);
  if (script.written && !quiet) {
    console.log(`wrote ${unix(join("script", "Poo.s.sol"))} — the platform this preview stands on`);
  }
  if (!quiet) console.log("$ forge script script/Poo.s.sol --tc Preview");

  const returns = forgeScript(project, ["--tc", "Preview"]);
  for (const key of ANSWERS) {
    if (returns[key] === undefined) {
      throw new Error(`script/Poo.s.sol no longer answers ${key} — delete it and run the command again for a fresh one`);
    }
  }

  const factory = artifactOf(project, `${name}Factory.sol`, `${name}Factory`);
  return {
    raw: returns.manifest.value,
    manifest: decode(outputOf(factory.abi, "manifest"), returns.manifest.value),
    accepted: returns.accepted.value === true || returns.accepted.value === "true",
    entryId: Number(returns.entryId.value),
    refusal: returns.refusal.value,
    packageDir,
  };
}

export function preview({ directory = ".", flags = {} }) {
  const project = locateProject(directory);
  const packageDir = locatePackage(project, flags);
  const name = moduleNameOf(project, flags);
  const seen = look({ project, packageDir, name });

  let verdict;
  if (seen.accepted) {
    verdict = `the registry accepts this manifest — it published as entry ${seen.entryId} on a chain that never existed`;
  } else {
    const known = refusalCatalogue(project, [
      "ManifestChecks",
      "PooModuleRegistry",
      "PooMetadata",
      name,
      `${name}Factory`,
    ]);
    verdict = `the registry REFUSES this manifest: ${nameRefusal(known, seen.refusal).text}`;
  }

  if (flags.json === true) {
    console.log(JSON.stringify({ manifest: seen.manifest, accepted: seen.accepted, entryId: seen.entryId }, null, 2));
    return seen.accepted ? 0 : 1;
  }

  console.log("");
  console.log(
    render(seen.manifest, vocabularyOf(packageDir), {
      selectors: selectorsOf(project, name),
      ceilings: ceilingsOf(packageDir),
      verdict,
    }),
  );
  console.log("");
  console.log("every word, unit, order and width above is your manifest's. POO.MEME seats them in a browser; nothing else about the page is yours to set, and nothing here was fetched from us.");
  return seen.accepted ? 0 : 1;
}
