// sdk/ is outside the pnpm workspace and no CI job reaches it, so nothing runs
// this on its own. It is Node's own runner and needs no dependency:
//
//   cd sdk && node --test test/abi.test.mjs
//
// What it pins is the one thing that broke `poo dev` at its final step: the
// shape a Foundry tool's --json answer arrives in. Foundry 1.8 wrapped that
// answer in an envelope and `JSON.parse(out)[0]` started reading `[0]` off an
// object. Both shapes are here, and the bare one stays here for as long as a
// contributor may be running a cast older than 1.8 — this repository pins solc,
// not Foundry.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

import { decode, toolJson, toolRefusal } from "../src/abi.mjs";

// Verbatim from cast 1.8.3 (cae51ad4), `cast abi-decode
// 'decoded()((uint256,address))' <32 bytes of 42, 32 bytes of 0x…01> --json`.
const ENVELOPE = `{"schema_version":1,"success":true,"data":[["42","0x0000000000000000000000000000000000000001"]],"errors":[],"warnings":[]}`;

// Verbatim from the same cast, decoding `0x2a` against that signature. It exits
// 1 and prints this on stdout, leaving stderr empty.
const REFUSED = `{"schema_version":1,"success":false,"data":null,"errors":[{"level":"error","code":"cast.error","message":"ABI decoding failed: buffer overrun while deserializing"},{"level":"error","code":"cast.error.context","message":"ABI decoding failed: buffer overrun while deserializing"}],"warnings":[]}`;

// What cast answered before 1.8, and what a contributor's older cast still
// answers: the envelope's `data`, with nothing around it.
const BARE = `[["42","0x0000000000000000000000000000000000000001"]]`;

const TUPLE = {
  name: "graph",
  type: "tuple",
  components: [
    { name: "count", type: "uint256" },
    { name: "token", type: "address" },
  ],
};

const DECODED = { count: "42", token: "0x0000000000000000000000000000000000000001" };

test("toolJson unwraps the 1.8 envelope", () => {
  assert.deepEqual(toolJson(ENVELOPE, "cast abi-decode"), [["42", "0x0000000000000000000000000000000000000001"]]);
});

test("toolJson passes an older cast's bare answer straight through", () => {
  assert.deepEqual(toolJson(BARE, "cast abi-decode"), [["42", "0x0000000000000000000000000000000000000001"]]);
});

test("toolJson passes a bare object through — forge inspect errors answers one", () => {
  assert.deepEqual(toolJson(`{"Locked()":"0f2e5b6c"}`, "forge inspect X errors"), { "Locked()": "0f2e5b6c" });
});

test("toolJson names what cast refused, rather than reaching past success", () => {
  assert.throws(
    () => toolJson(REFUSED, "cast abi-decode"),
    (error) =>
      error.message.includes("cast abi-decode refused") &&
      error.message.includes("buffer overrun while deserializing") &&
      // the two error rows carry the same text, and it is said once
      error.message.indexOf("buffer overrun") === error.message.lastIndexOf("buffer overrun"),
  );
});

test("toolJson names a success carrying no data", () => {
  assert.throws(
    () => toolJson(`{"schema_version":1,"success":true,"data":null,"errors":[],"warnings":[]}`, "cast abi-decode"),
    /answered success carrying no data/,
  );
});

test("toolJson names an answer that is not JSON at all", () => {
  assert.throws(() => toolJson("cast: command not found", "cast abi-decode"), /is not JSON: cast: command not found/);
});

test("toolRefusal reads the envelope cast puts on stdout when stderr is empty", () => {
  const said = toolRefusal({ status: 1, stdout: REFUSED, stderr: "" });
  assert.equal(said, "ABI decoding failed: buffer overrun while deserializing");
});

test("toolRefusal falls back to an older tool's plain stderr", () => {
  const said = toolRefusal({ status: 1, stdout: "", stderr: "Error: ABI decoding failed\n" });
  assert.equal(said, "Error: ABI decoding failed");
});

test("toolRefusal never answers an empty string", () => {
  assert.equal(toolRefusal({ message: "spawn cast ENOENT" }), "spawn cast ENOENT");
  assert.notEqual(toolRefusal({}), "");
});

// The shapes above are transcribed; this one asks the installed cast. It is the
// only check that would notice Foundry changing the envelope again.
const cast = (() => {
  try {
    execFileSync("cast", ["--version"], { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

test("decode reads the installed cast's real answer", { skip: cast ? false : "no cast on PATH" }, () => {
  const data = execFileSync(
    "cast",
    ["abi-encode", "f((uint256,address))", "(42,0x0000000000000000000000000000000000000001)"],
    { encoding: "utf8" },
  ).trim();
  assert.deepEqual(decode(TUPLE, data), DECODED);
});

test("decode names cast's reason when the data is not that tuple", { skip: cast ? false : "no cast on PATH" }, () => {
  assert.throws(() => decode(TUPLE, "0x2a"), /cast could not decode the answer: .*ABI decoding failed/);
});

test("decode refuses an empty answer before it ever reaches cast", () => {
  assert.throws(() => decode(TUPLE, "0x"), /the call answered no data/);
});
