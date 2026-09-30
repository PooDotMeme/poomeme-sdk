import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { checkManifest } from "./manifest-check.mjs";
import { look } from "./preview.mjs";
import { build, locatePackage, locateProject, moduleNameOf, sourceDir, unix } from "./project.mjs";
import { importSitesOf, isFile, makeResolver, parseRemappings } from "./solidity.mjs";

const WHY = {
  platform: "the launcher implementation — a module declares against interfaces and types, never against one",
  devkit: "devkit — your tests may stand a launcher and directory up with it, your module may not import it",
};

function sources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (name.endsWith(".sol")) out.push(path);
  }
  return out;
}

function checkBoundary(project, packageDir, surface) {
  const moduleVisible = new Set(surface.moduleVisible.map((path) => join(packageDir, path)));
  const testOnly = new Map(Object.entries(surface.testOnly).map(([path, tier]) => [join(packageDir, path), { path, tier }]));
  const vendored = join(packageDir, "lib") + sep;

  const srcDir = sourceDir(project);
  const remappingsPath = join(project, "remappings.txt");
  if (!isFile(remappingsPath)) throw new Error(`${unix(relative(project, project))} has no remappings.txt`);
  const resolveImport = makeResolver(parseRemappings(readFileSync(remappingsPath, "utf8"), project));

  const problems = [];
  const files = sources(srcDir);
  let imports = 0;

  for (const file of files) {
    const where = unix(relative(project, file));
    for (const site of importSitesOf(readFileSync(file, "utf8"))) {
      imports += 1;
      const target = resolveImport(file, site.spec);
      const at = `${where}:${site.line}`;
      if (target === null) {
        problems.push([at, site.spec, "no remapping in this project resolves it"]);
        continue;
      }
      if (!isFile(target)) {
        problems.push([at, site.spec, `${unix(relative(project, target))} does not exist`]);
        continue;
      }
      if (target.startsWith(srcDir + sep) || target.startsWith(vendored)) continue;
      if (moduleVisible.has(target)) continue;
      const shipped = testOnly.get(target);
      if (shipped !== undefined) {
        problems.push([at, site.spec, `${shipped.path} is ${WHY[shipped.tier]}`]);
        continue;
      }
      problems.push([at, site.spec, `${unix(relative(project, target))} is not part of the published surface`]);
    }
  }

  return { files, imports, problems };
}

export function check({ directory = ".", flags = {} }) {
  const project = locateProject(directory);
  const packageDir = locatePackage(project, flags);
  const surface = JSON.parse(readFileSync(join(packageDir, "surface.json"), "utf8"));

  if (flags.build !== false) build(project);

  const boundary = checkBoundary(project, packageDir, surface);
  console.log(`\nchecked ${boundary.files.length} module sources, ${boundary.imports} imports, against ${surface.moduleVisible.length} published files`);
  if (boundary.problems.length === 0) {
    console.log("boundary ok — every import lands on the published surface");
  } else {
    console.error(`\n${boundary.problems.length} import${boundary.problems.length === 1 ? " reaches" : "s reach"} outside the surface:`);
    for (const [at, spec, why] of boundary.problems) {
      console.error(`  ${at}  imports ${spec}`);
      console.error(`      ${why}`);
    }
  }

  let manifestProblems = [];
  if (flags.manifest !== false) {
    const name = moduleNameOf(project, flags);
    console.log(`\n$ forge script script/Poo.s.sol --tc Preview   (reading manifest() the same way poo preview does)`);
    const seen = look({ project, packageDir, name, quiet: true });
    const encodedBytes = (seen.raw.length - 2) / 2;
    manifestProblems = checkManifest(seen.manifest, encodedBytes);
    console.log(`checked the manifest against ModuleManifestCheckLib's own rules, ${encodedBytes} bytes ABI-encoded`);
    if (manifestProblems.length === 0) {
      console.log("manifest ok — every rule the directory enforces on-chain passes here too");
    } else {
      console.error(`\n${manifestProblems.length} manifest problem${manifestProblems.length === 1 ? "" : "s"}:`);
      for (const problem of manifestProblems) console.error(`  ${problem}`);
    }
  }

  console.log("");
  return boundary.problems.length === 0 && manifestProblems.length === 0 ? 0 : 1;
}
