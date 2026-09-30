import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sdkDir } from "./repo.mjs";

const USAGE = `poo — build a POO.MEME Pons module

  poo init [directory]     scaffold a module project that builds and tests offline
  poo check [directory]    hold a project to the published surface, and run the directory's own manifest rules locally
  poo preview [directory]  draw the token page your manifest asks for
  poo abi [directory]      print this module's and factory's compiled ABI
  poo assemble             rebuild the Solidity package from this checkout

A module is deployed and published with plain forge: forge script
script/Publish.s.sol --rpc-url <url> [--broadcast] in a project poo init
scaffolded.

Options
  --name <Name>            the module in this project (default: the one <Name>Factory.sol there is)
  --handle <slug>          manifest handle for the scaffold (default: the name, hyphenated)
  --sdk <path>             an assembled poo-sdk package to scaffold or check against
  --out <path>             where poo assemble or poo abi writes its output
  --json                   poo preview: the decoded manifest, not the drawing
  --no-manifest            poo check: skip the off-chain manifest-rule check
  --no-build               skip forge, write or check files only
  --force                  write into a directory that already has files
  -h, --help               this
  -v, --version             the CLI version
`;

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }
    if (token === "-h") {
      flags.help = true;
      continue;
    }
    if (token === "-v") {
      flags.version = true;
      continue;
    }
    const name = token.replace(/^--/, "");
    if (name.startsWith("no-")) {
      flags[name.slice(3)] = false;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("-")) {
      flags[name] = true;
      continue;
    }
    flags[name] = next;
    index += 1;
  }
  return { positional, flags };
}

export async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;

  if (flags.version) {
    const pkg = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8"));
    console.log(pkg.version);
    return 0;
  }
  if (flags.help || command === undefined || command === "help") {
    console.log(USAGE);
    return command === undefined && !flags.help ? 1 : 0;
  }

  try {
    if (command === "assemble") {
      const { assemble } = await import("./assemble.mjs");
      assemble({ out: typeof flags.out === "string" ? flags.out : undefined });
      return 0;
    }
    if (command === "init") {
      const { init } = await import("./init.mjs");
      return await init({ directory: rest[0], flags });
    }
    if (command === "check") {
      const { check } = await import("./check.mjs");
      return await check({ directory: rest[0], flags });
    }
    if (command === "preview") {
      const { preview } = await import("./preview.mjs");
      return await preview({ directory: rest[0], flags });
    }
    if (command === "abi") {
      const { abiExport } = await import("./abi-export.mjs");
      return await abiExport({ directory: rest[0], flags });
    }
  } catch (error) {
    console.error(`poo ${command}: ${error.message}`);
    return 1;
  }

  console.error(`poo: unknown command ${command}`);
  console.error(USAGE);
  return 1;
}
