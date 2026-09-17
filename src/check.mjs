import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { build, locatePackage, locateProject, sourceDir, unix } from "./project.mjs";
import { importSitesOf, isFile, makeResolver, parseRemappings } from "./solidity.mjs";

const WHY = {
  platform: "platform implementation — a module declares against interfaces and types, never against one",
  devkit: "devkit — your tests may stand a platform up with it, your module may not import it",
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

export function check({ directory = ".", flags = {} }) {
  const project = locateProject(directory);
  const packageDir = locatePackage(project, flags);
  const surface = JSON.parse(readFileSync(join(packageDir, "surface.json"), "utf8"));
  const moduleVisible = new Set(surface.moduleVisible.map((path) => join(packageDir, path)));
  const testOnly = new Map(Object.entries(surface.testOnly).map(([path, tier]) => [join(packageDir, path), { path, tier }]));
  const vendored = join(packageDir, "lib") + sep;

  const srcDir = sourceDir(project);
  if (flags.build !== false) build(project);

  const remappingsPath = join(project, "remappings.txt");
  if (!isFile(remappingsPath)) throw new Error(`${directory} has no remappings.txt`);
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

  console.log(`\nchecked ${files.length} module sources, ${imports} imports, against ${surface.moduleVisible.length} published files`);
  if (problems.length === 0) {
    console.log("boundary ok — every import lands on the published surface");
    return 0;
  }
  console.error(`\n${problems.length} import${problems.length === 1 ? " reaches" : "s reach"} outside the surface:`);
  for (const [at, spec, why] of problems) {
    console.error(`  ${at}  imports ${spec}`);
    console.error(`      ${why}`);
  }
  return 1;
}
