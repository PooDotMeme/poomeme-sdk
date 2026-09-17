import { execFileSync } from "node:child_process";

const ARRAY = /\[\d*\]$/;

// cast --json answers an envelope from Foundry 1.8 on, and answered the bare
// value before it. Measured here on cast 1.8.3 (cae51ad4):
//
//   $ cast abi-decode 'decoded()((uint256,address))' 0x…2a…01 --json
//   {"schema_version":1,"success":true,
//    "data":[["42","0x0000000000000000000000000000000000000001"]],
//    "errors":[],"warnings":[]}
//
//   $ cast abi-decode 'decoded()((uint256,address))' 0x2a --json    # exits 1
//   {"schema_version":1,"success":false,"data":null,
//    "errors":[{"level":"error","code":"cast.error",
//               "message":"ABI decoding failed: buffer overrun while deserializing"}],
//    "warnings":[]}
//
// An older cast answers `[["42","0x…01"]]` — the envelope's `data`, and nothing
// around it. Two consequences the rest of this file is built on:
//
//   - Read the shape that came back, never the version that produced it. This
//     repository pins solc; it does not pin a contributor's Foundry.
//   - A refusal is legible only through the envelope: under --json a failing
//     cast prints it on stdout and leaves stderr empty, so reaching for stderr
//     alone reports the crash with no reason attached.
const ENVELOPE = ["schema_version", "success", "data"];

function isEnvelope(value) {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && ENVELOPE.every((key) => key in value)
  );
}

function why(envelope) {
  const messages = (Array.isArray(envelope.errors) ? envelope.errors : [])
    .map((entry) => (typeof entry?.message === "string" ? entry.message.trim() : ""))
    .filter((message) => message !== "");
  return [...new Set(messages)].join("; ");
}

function abbreviate(text) {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  return line.length <= 300 ? line : `${line.slice(0, 300)}…`;
}

// The one door every `--json` answer from a Foundry tool comes through: an
// envelope is unwrapped and a refusal inside it is named, a bare answer from an
// older tool passes straight through, and anything else fails saying what came
// back instead of indexing into it.
export function toolJson(out, command) {
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`${command} answered something that is not JSON: ${abbreviate(out)}`);
  }
  if (!isEnvelope(parsed)) return parsed;
  if (parsed.success !== true) {
    const said = why(parsed);
    throw new Error(`${command} refused: ${said === "" ? abbreviate(out) : said}`);
  }
  if (parsed.data === null || parsed.data === undefined) {
    throw new Error(`${command} answered success carrying no data: ${abbreviate(out)}`);
  }
  return parsed.data;
}

// What a non-zero exit actually said, wherever the running version put it.
export function toolRefusal(error) {
  let envelope = null;
  try {
    const parsed = JSON.parse(error?.stdout ?? "");
    if (isEnvelope(parsed)) envelope = parsed;
  } catch {
    /* an older tool fails with plain text on stderr and prints no envelope */
  }
  const said = envelope === null ? "" : why(envelope);
  if (said !== "") return said;
  const stderr = abbreviate(error?.stderr);
  if (stderr !== "") return stderr;
  const stdout = abbreviate(error?.stdout);
  if (stdout !== "") return stdout;
  return abbreviate(error?.message ?? "it exited non-zero and said nothing");
}

function typeOf(component) {
  if (!component.type.startsWith("tuple")) return component.type;
  return `(${component.components.map(typeOf).join(",")})${component.type.slice("tuple".length)}`;
}

export function outputOf(abi, name, index = 0) {
  const found = abi.find((entry) => entry.type === "function" && entry.name === name);
  if (found === undefined) throw new Error(`the compiled ABI declares no ${name}()`);
  const output = found.outputs[index];
  if (output === undefined) throw new Error(`${name}() returns nothing at position ${index}`);
  return output;
}

// cast answers a decoded value as nested positional arrays. The same ABI entry
// that gave us the type carries the names, so the shape a command renders is
// the shape the compiler emitted — it follows a struct change on its own.
function name(component, value) {
  if (ARRAY.test(component.type)) {
    const element = { ...component, type: component.type.replace(ARRAY, "") };
    return value.map((item) => name(element, item));
  }
  if (component.type !== "tuple") return value;
  const out = {};
  component.components.forEach((member, index) => {
    out[member.name] = name(member, value[index]);
  });
  return out;
}

export function decode(component, data) {
  if (typeof data !== "string" || !data.startsWith("0x") || data.length <= 2) {
    throw new Error("nothing to decode — the call answered no data");
  }
  let out;
  try {
    out = execFileSync("cast", ["abi-decode", `decoded()(${typeOf(component)})`, data, "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`cast could not decode the answer: ${toolRefusal(error)}`);
  }
  const values = toolJson(out, "cast abi-decode");
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`cast abi-decode answered no decoded value: ${abbreviate(out)}`);
  }
  return name(component, values[0]);
}

// forge holds every error a contract declares, with its selector, so a refusal
// can be named without reaching for a public 4-byte directory.
export function refusalCatalogue(project, contracts) {
  const known = new Map();
  for (const contract of contracts) {
    let declared;
    try {
      // forge 1.8.3 answers the bare `{"Refusal()": "…"}` map here, with no
      // envelope around it — but this goes through the same door as cast's
      // answer so a later envelope is unwrapped rather than iterated as four
      // fields called schema_version, success, data and errors. A catalogue is
      // only ever used to put a name to a refusal that already happened, so a
      // contract it cannot read is skipped rather than raised.
      const out = execFileSync("forge", ["inspect", contract, "errors", "--json"], { cwd: project, encoding: "utf8" });
      declared = toolJson(out, `forge inspect ${contract} errors`);
    } catch {
      continue;
    }
    if (typeof declared !== "object" || declared === null) continue;
    for (const [signature, selector] of Object.entries(declared)) {
      if (typeof selector !== "string") continue;
      known.set(`0x${selector.replace(/^0x/, "")}`, signature);
    }
  }
  return known;
}

export function nameRefusal(known, data) {
  const selector = data.slice(0, 10).toLowerCase();
  const signature = known.get(selector);
  if (signature === undefined) return { selector, text: `an error this project does not declare (${selector})` };
  try {
    const out = execFileSync("cast", ["decode-error", "--sig", signature, data], { encoding: "utf8" }).trim();
    const args = out.split("\n").map((line) => line.trim()).filter(Boolean);
    return { selector, signature, text: args.length === 0 ? signature : `${signature.slice(0, signature.indexOf("("))}(${args.join(", ")})` };
  } catch {
    return { selector, signature, text: signature };
  }
}
