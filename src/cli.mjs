import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sdkDir } from "./repo.mjs";

const USAGE = `poo — build a POO.MEME module

  poo init [directory]     scaffold a module project that builds and tests offline
  poo dev [directory]      stand a chain up and run your module on it
  poo preview [directory]  draw the token page your manifest asks for
  poo check [directory]    compile a module project and hold it to the published surface
  poo publish [directory]  publish a deployed factory to a POO.MEME module registry
  poo assemble             rebuild the Solidity package from this checkout

Options
  --name <Name>            the module in this project (default: the one <Name>Factory.sol there is)
  --handle <slug>          manifest handle for the scaffold (default: the name, hyphenated)
  --sdk <path>             an assembled poo-sdk package to scaffold or check against
  --out <path>             where poo assemble writes the package
  --port <n>               port for the chain poo dev starts (default: 8545)
  --rpc <url>              a chain to use instead of starting one; required by poo publish
  --registry <address>     the module registry poo publish reaches
  --factory <address>      the factory you deployed
  --from <address>         the wallet that will sign
  --broadcast              poo publish: send it, rather than only checking it
  --json                   poo preview: the decoded manifest, not the drawing
  --force                  write into a directory that already has files
  --no-build               skip forge, write files only
  -- <flags>               everything after this goes to cast, signing flags included
  -h, --help               this
  -v, --version            the CLI version
`;

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const passthrough = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      passthrough.push(...argv.slice(index + 1));
      break;
    }
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
  return { positional, flags, passthrough };
}

export async function main(argv) {
  const { positional, flags, passthrough } = parseArgs(argv);
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
    if (command === "dev") {
      const { dev } = await import("./dev.mjs");
      return await dev({ directory: rest[0], flags });
    }
    if (command === "preview") {
      const { preview } = await import("./preview.mjs");
      return await preview({ directory: rest[0], flags });
    }
    if (command === "publish") {
      const { publish } = await import("./publish.mjs");
      return await publish({ directory: rest[0], flags, passthrough });
    }
  } catch (error) {
    console.error(`poo ${command}: ${error.message}`);
    return 1;
  }

  console.error(`poo: unknown command ${command}`);
  console.error(USAGE);
  return 1;
}
