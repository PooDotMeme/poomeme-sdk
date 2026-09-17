import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { decode, outputOf } from "./abi.mjs";
import { artifactOf, forgeScript, locateProject, moduleNameOf, RECORD_FILE, unix, ensureScript } from "./project.mjs";

const DEFAULT_PORT = 8545;
const LOCAL_CHAINS = new Set([31337, 31338, 31339]);

async function rpc(url, method, params = []) {
  const answer = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = await answer.json();
  if (body.error !== undefined) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function listening(url) {
  try {
    await rpc(url, "eth_chainId");
    return true;
  } catch {
    return false;
  }
}

// Anvil is Foundry's, not ours, and a chain with no fork URL never reaches the
// network. Nothing of POO.MEME's has to be running for any of this.
async function startChain(port) {
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--gas-limit", "300000000", "--silent"],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  let failed = null;
  child.on("error", (error) => {
    failed = error;
  });
  child.on("exit", (code) => {
    if (failed === null && code !== 0) failed = new Error(`anvil exited with ${code}`);
  });
  for (let tries = 0; tries < 100; tries += 1) {
    if (failed !== null) throw new Error(`anvil would not start on port ${port}: ${failed.message}`);
    if (await listening(url)) return { url, child };
    await new Promise((done) => setTimeout(done, 100));
  }
  child.kill();
  throw new Error(`anvil did not answer on port ${port} within ten seconds`);
}

function hold(child) {
  return new Promise((done) => {
    const stop = () => child.kill("SIGINT");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    child.on("exit", () => done(0));
  });
}

const ROWS = [
  ["token", "the token that installed your module"],
  ["module", "your module, as that token's holder calls it"],
  ["moduleFactory", "your factory"],
  ["moduleEntry", "its entry in the module registry"],
  ["quote", "the quote asset the token trades against"],
  ["moduleRegistry", "the registry that published you"],
  ["tokenFactory", "the factory that made the token"],
  ["venueRegistry", "the venue registry"],
  ["metadata", "the metadata registry"],
  ["launchFactory", "the launch the token used"],
  ["deployer", "the wallet that sent all of it"],
];

export async function dev({ directory = ".", flags = {} }) {
  const project = locateProject(directory);
  const name = moduleNameOf(project, flags);

  const script = ensureScript(project, name);
  if (script.written) console.log(`wrote ${unix(join("script", "Poo.s.sol"))} — edit it to change the dev token`);

  const port = typeof flags.port === "string" ? Number(flags.port) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0) throw new Error(`--port ${flags.port} is not a port number`);

  let url = typeof flags.rpc === "string" ? flags.rpc : `http://127.0.0.1:${port}`;
  let child = null;
  if (await listening(url)) {
    console.log(`using the chain already answering on ${url}`);
  } else if (typeof flags.rpc === "string") {
    throw new Error(`nothing answers on ${url} — start a node there, or drop --rpc and let poo dev start one`);
  } else {
    console.log(`$ anvil --port ${port}`);
    ({ url, child } = await startChain(port));
  }

  const chainId = Number(await rpc(url, "eth_chainId"));
  if (!LOCAL_CHAINS.has(chainId)) {
    if (child !== null) child.kill();
    throw new Error(`${url} is chain ${chainId} — poo dev only ever builds on 31337, 31338 and 31339`);
  }
  const [sender] = await rpc(url, "eth_accounts");
  if (sender === undefined) {
    if (child !== null) child.kill();
    throw new Error(`${url} holds no unlocked account for poo dev to send from`);
  }

  console.log(`$ forge script script/Poo.s.sol --tc Dev --broadcast`);
  let returns;
  try {
    // --skip-simulation, because the platform is stood up on a chain the
    // script itself finishes building: Uniswap V2 reaches its canonical
    // addresses through anvil_setCode, which the fork forge would re-simulate
    // against cached before the call landed. The run inside the script is the
    // simulation, and it already happened. --non-interactive because the same
    // script deploys a contract and then calls it, which forge stops to ask
    // about, and there is nobody at this keyboard.
    returns = forgeScript(project, [
      "--tc",
      "Dev",
      "--rpc-url",
      url,
      "--broadcast",
      "--skip-simulation",
      "--non-interactive",
      "--unlocked",
      "--sender",
      sender,
    ]);
  } catch (error) {
    if (child !== null) child.kill();
    throw error;
  }

  const devScript = artifactOf(project, "Poo.s.sol", "Dev");
  const graph = decode(outputOf(devScript.abi, "run"), returns.encoded.value);
  const record = { chainId, rpc: url, module: name, ...graph };

  const at = join(project, RECORD_FILE);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, `${JSON.stringify(record, null, 2)}\n`);

  console.log("");
  console.log(`chain ${chainId} at ${url}`);
  for (const [key, why] of ROWS) console.log(`  ${key.padEnd(15)} ${String(graph[key]).padEnd(44)} ${why}`);
  console.log("");
  console.log(`recorded in ${unix(RECORD_FILE)}`);
  console.log(`  cast call ${graph.module} "<yours>" --rpc-url ${url}`);
  console.log(`  poo publish --rpc ${url} --factory ${graph.moduleFactory}`);

  if (child === null) return 0;
  console.log("");
  console.log("the chain is yours until you stop it — ctrl-c");
  return hold(child);
}
