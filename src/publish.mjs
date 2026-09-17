import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { nameRefusal, refusalCatalogue } from "./abi.mjs";
import { look } from "./preview.mjs";
import { locatePackage, locateProject, moduleNameOf, RECORD_FILE, unix } from "./project.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function cast(argv) {
  try {
    return execFileSync("cast", argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (error) {
    throw new Error(`cast ${argv[0]} failed: ${String(error.stderr ?? error.message).trim().split("\n").pop()}`);
  }
}

function readCall(rpc, to, signature, args = []) {
  return cast(["call", to, signature, ...args, "--rpc-url", rpc]);
}

function address(value, what) {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new Error(`${what} is not an address: ${value}`);
  return value;
}

function recordOf(project) {
  const at = join(project, RECORD_FILE);
  if (!existsSync(at)) return null;
  try {
    return JSON.parse(readFileSync(at, "utf8"));
  } catch {
    return null;
  }
}

function line(label, ok, said) {
  return `  ${ok ? "ok    " : "REFUSE"}  ${label.padEnd(48)} ${said ?? ""}`.trimEnd();
}

export async function publish({ directory = ".", flags = {}, passthrough = [] }) {
  const project = locateProject(directory);
  const packageDir = locatePackage(project, flags);
  const name = moduleNameOf(project, flags);
  const record = recordOf(project);

  if (typeof flags.rpc !== "string") {
    throw new Error("pass --rpc <url> — publishing reaches a chain, and the SDK never picks one for you");
  }
  const rpc = flags.rpc;
  const chainId = Number(cast(["chain-id", "--rpc-url", rpc]));

  let registry = typeof flags.registry === "string" ? flags.registry : undefined;
  if (registry === undefined && record !== null && record.chainId === chainId) registry = record.moduleRegistry;
  if (registry === undefined) {
    throw new Error(
      `pass --registry <address> — the SDK carries no address for POO.MEME's module registry on chain ${chainId}`,
    );
  }
  address(registry, "--registry");
  const factory = address(typeof flags.factory === "string" ? flags.factory : "", "--factory");

  // What this project builds, and what the registry would make of it, decided
  // here rather than on the chain: a refusal costs nothing before it is sent.
  const local = look({ project, packageDir, name, quiet: true });
  const handle = local.manifest.handle;

  const checks = [];
  const refuse = (label, said) => {
    checks.push(line(label, false, said));
    return false;
  };
  const accept = (label, said) => {
    checks.push(line(label, true, said));
    return true;
  };

  let ok = true;
  if (cast(["code", registry, "--rpc-url", rpc]).length <= 2) {
    throw new Error(`no contract at ${registry} on chain ${chainId} — that is not a module registry`);
  }
  ok = (cast(["code", factory, "--rpc-url", rpc]).length > 2
    ? accept("the factory address holds code", factory)
    : refuse("the factory address holds code", "nothing is deployed there — deploy first, then publish")) && ok;

  if (ok) {
    const onChain = readCall(rpc, factory, "manifest()");
    ok = (onChain.toLowerCase() === local.raw.toLowerCase()
      ? accept("its manifest is this checkout's, byte for byte")
      : refuse(
          "its manifest is this checkout's, byte for byte",
          "the deployed factory carries a different manifest — deploy this build, or check out the one you deployed",
        )) && ok;
  }

  if (local.accepted) accept("the registry accepts this manifest", `entry ${local.entryId} on a throwaway chain`);
  else {
    const known = refusalCatalogue(project, ["ManifestChecks", "PooModuleRegistry", "PooMetadata", name, `${name}Factory`]);
    ok = refuse("the registry accepts this manifest", nameRefusal(known, local.refusal).text) && ok;
  }

  let developer;
  if (typeof flags.from === "string") developer = address(flags.from, "--from");
  else {
    try {
      developer = cast(["wallet", "address", ...passthrough]);
    } catch {
      developer = null;
    }
  }
  if (developer === null) {
    checks.push(line("the signer is the factory's developer", false, "pass --from <address>, or a signing flag after --"));
    ok = false;
  } else {
    let declared = null;
    for (const signature of ["developer()(address)", "owner()(address)"]) {
      try {
        declared = readCall(rpc, factory, signature);
        break;
      } catch {
        /* a factory answers one of the two, or the registry refuses it */
      }
    }
    ok = (declared !== null && declared.toLowerCase() === developer.toLowerCase()
      ? accept("the signer is the factory's developer", developer)
      : refuse(
          "the signer is the factory's developer",
          `the factory answers ${declared ?? "neither developer() nor owner()"}, you would send from ${developer}`,
        )) && ok;
  }

  const metadata = readCall(rpc, registry, "metadata()(address)");
  const [holder, kind, dropped] = readCall(rpc, metadata, "handleRecord(string)((address,uint8,bool))", [handle])
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((part) => part.trim());
  const label = `the handle "${handle}" is yours to publish under`;
  const free = kind === "0" && dropped === "false";
  const mine = kind === "2" && dropped === "false" && developer !== null && holder.toLowerCase() === developer.toLowerCase();
  ok = (free || mine
    ? accept(label, free ? "unclaimed — this claims it" : "already your module family's")
    : refuse(
        label,
        dropped === "true"
          ? "POO.MEME has dropped it — choose another"
          : `${holder} holds it${kind === "1" ? " as a wallet handle" : ""}`,
      )) && ok;

  const listed = Number(readCall(rpc, registry, "listedId(address)(uint32)", [factory]));
  ok = (listed === 0
    ? accept("this factory is not published yet")
    : refuse("this factory is not published yet", `it is already entry ${listed}`)) && ok;

  const fee = readCall(rpc, registry, "publishFee()(uint256)").split(" ")[0];

  console.log("");
  console.log(`network    chain ${chainId} at ${rpc}`);
  console.log(`registry   ${registry}`);
  console.log(`factory    ${factory}`);
  console.log(`handle     ${handle}`);
  console.log(`fee        ${fee} wei, sent exactly — the registry refuses any other amount`);
  console.log("");
  for (const said of checks) console.log(said);
  console.log("");

  if (!ok) {
    console.error("nothing was sent.");
    return 1;
  }
  if (flags.broadcast !== true) {
    console.log("every check passed, and nothing was sent. add --broadcast to publish for real.");
    if (record !== null && record.chainId === chainId) {
      console.log(`this is ${unix(RECORD_FILE)}'s own chain, so publishing here rehearses, it does not ship.`);
    }
    return 0;
  }

  console.log(`$ cast send ${registry} "publishTokenModule(address)" ${factory} --value ${fee}`);
  cast([
    "send",
    registry,
    "publishTokenModule(address)",
    factory,
    "--value",
    fee,
    "--rpc-url",
    rpc,
    ...passthrough,
  ]);
  const entryId = Number(readCall(rpc, registry, "listedId(address)(uint32)", [factory]));
  console.log("");
  console.log(`published as entry ${entryId} on chain ${chainId}`);
  console.log(`the handle "${handle}" now belongs to ${developer}'s module family, and every later version of this module must come from it`);
  return 0;
}
