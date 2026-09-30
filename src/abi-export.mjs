import { writeFileSync } from "node:fs";

import { artifactOf, build, locateProject, moduleNameOf } from "./project.mjs";

// The ABI a frontend or an indexer needs to call this module and its factory
// directly — read straight off forge's own compiled artifacts, so it is
// exactly what forge build produced, never retyped by hand.
export function abiExport({ directory = ".", flags = {} }) {
  const project = locateProject(directory);
  const name = moduleNameOf(project, flags);
  if (flags.build !== false) build(project);

  const out = {
    module: artifactOf(project, `${name}.sol`, name).abi,
    factory: artifactOf(project, `${name}Factory.sol`, `${name}Factory`).abi,
  };

  if (typeof flags.out === "string") {
    writeFileSync(flags.out, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`wrote ${flags.out}`);
    return 0;
  }
  console.log(JSON.stringify(out, null, 2));
  return 0;
}
