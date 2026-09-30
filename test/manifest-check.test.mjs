// cd sdk && node --test test/manifest-check.test.mjs
//
// These mirror ModuleManifestCheckLib.sol's own rules (see
// src/manifest-check.mjs's own header comment) against the same shape
// abi.mjs's `decode()` hands back off a real `manifest()` call: numeric
// leaves as decimal strings, bytes4/bytes32 as lowercase hex strings, structs
// as plain objects, dynamic arrays as arrays. Every test here needs `cast` on
// PATH (selectors and event topics are computed by shelling out to `cast
// keccak`, never reimplemented) and is skipped without one, exactly like
// abi.test.mjs's own cast-backed tests.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

import { checkManifest, eventCanonicalForm, selectorOf, topicOf } from "../src/manifest-check.mjs";

const cast = (() => {
  try {
    execFileSync("cast", ["--version"], { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

const NONE = "0x00000000";

function field(name, abiType) {
  return { name, abiType, label: name, unit: "0", help: "", optional: false, options: [] };
}

function condition(selector = NONE, label = "") {
  return { selector, withViewer: false, label };
}

function baseManifest() {
  return {
    name: "Vault",
    handle: "vault",
    version: "1.0.0",
    summary: "Holds ETH until released",
    description: "",
    config: [field("beneficiary", "address")],
    sections: [
      {
        title: "Vault",
        role: "0",
        visibleWhen: condition(),
        columns: "1",
        views: [
          { widget: "0", label: "Held", selectors: [selectorOf("held()")], withViewer: false, unit: "10", labels: [], tones: [], visibleWhen: condition(), headline: false },
        ],
        actions: [
          { name: "release", description: "Release", selector: selectorOf("release()"), preview: NONE, previewUnit: "0", minOutInput: "0", deadlineInput: "0", flow: "0", isExit: false, inputs: [], isPayable: false, visibleWhen: condition(), amount: NONE, amountUnit: "0", formValues: NONE, target: NONE },
        ],
        lists: [],
        items: [
          { kind: "0", span: "0", index: "0" },
          { kind: "1", span: "0", index: "0" },
        ],
      },
    ],
    events: [
      {
        topic0: topicOf("Released(address,uint256)"),
        signature: "Released(address indexed to, uint256 amount)",
        role: "3",
        walletArg: "0",
        amountArg: "1",
        keyArg: "255",
        flagArg: "255",
        textArg: "255",
        amountUnit: "10",
        tone: "1",
        label: "Released",
      },
    ],
    errors: [{ selector: "0xb10205ed", text: "Nothing is held" }],
  };
}

test("eventCanonicalForm drops parameter names and 'indexed', keeping only types", { skip: cast ? false : "no cast on PATH" }, () => {
  const parsed = eventCanonicalForm("Released(address indexed to, uint256 amount)");
  assert.deepEqual(parsed, { canonical: "Released(address,uint256)", args: 2 });
  assert.equal(topicOf(parsed.canonical), topicOf("Released(address,uint256)"));
});

test("eventCanonicalForm refuses a signature with no name before '('", () => {
  assert.equal(eventCanonicalForm("(address)"), null);
});

test("eventCanonicalForm refuses a trailing comma", () => {
  assert.equal(eventCanonicalForm("Foo(address,)"), null);
});

test("a well-formed manifest passes with no problems", { skip: cast ? false : "no cast on PATH" }, () => {
  assert.deepEqual(checkManifest(baseManifest()), []);
});

test("an over-length manifest is refused by its encoded byte count", { skip: cast ? false : "no cast on PATH" }, () => {
  const problems = checkManifest(baseManifest(), 20_000);
  assert.ok(problems.some((p) => p.includes("16384")));
});

test("an empty name is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.name = "";
  assert.ok(checkManifest(m).some((p) => p.startsWith("name length 0")));
});

test("a handle with an uppercase letter is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.handle = "Vault";
  assert.ok(checkManifest(m).some((p) => p.includes('handle "Vault"')));
});

test("a handle starting with '-' is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.handle = "-vault";
  assert.ok(checkManifest(m).some((p) => p.includes('handle "-vault"')));
});

test("a handle with a double hyphen is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.handle = "vault--one";
  assert.ok(checkManifest(m).some((p) => p.includes('handle "vault--one"')));
  m.handle = "vault-one";
  assert.deepEqual(checkManifest(m), []);
});

test("a handle shorter than three characters is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.handle = "ab";
  assert.ok(checkManifest(m).some((p) => p.includes('handle "ab"')));
  m.handle = "abc";
  assert.deepEqual(checkManifest(m), []);
});

test("a handle may start with a digit", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.handle = "1vault";
  assert.deepEqual(checkManifest(m), []);
});

test("a version with an underscore is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.version = "1_0_0";
  assert.ok(checkManifest(m).some((p) => p.includes('version "1_0_0"')));
});

test("a config field with an unsupported type is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.config = [field("amount", "uint7")];
  assert.ok(checkManifest(m).some((p) => p.includes('unsupported abiType "uint7"')));
});

test("a config field may not repeat a valid uint width, but uint256[] is refused (no lists in config)", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.config = [field("amounts", "uint256[]")];
  assert.ok(checkManifest(m).some((p) => p.includes("amounts")));
});

test("an action input may be a list (uint256[] is fine there)", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.sections[0].actions[0].inputs = [field("amounts", "uint256[]")];
  m.sections[0].actions[0].selector = selectorOf("release(uint256[])");
  assert.deepEqual(checkManifest(m), []);
});

test("an action selector that does not match its name+inputs is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.sections[0].actions[0].selector = "0xdeadbeef";
  assert.ok(checkManifest(m).some((p) => p.includes("does not match release()")));
});

test("a view with zero selectors is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.sections[0].views[0].selectors = [];
  assert.ok(checkManifest(m).some((p) => p.includes("1..4 selectors are required")));
});

test("an item referencing an out-of-range view index is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.sections[0].items[0].index = "5";
  assert.ok(checkManifest(m).some((p) => p.includes("out of range")));
});

test("a view declared but never referenced by an item is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.sections[0].items = m.sections[0].items.filter((item) => item.kind !== "0");
  assert.ok(checkManifest(m).some((p) => p.includes("view 0 is declared but no item")));
});

test("a repeated event topic0 is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.events.push({ ...m.events[0], label: "Released again" });
  assert.ok(checkManifest(m).some((p) => p.includes("declared by another event")));
});

test("an event whose declared topic0 does not match its signature is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.events[0].topic0 = "0x" + "11".repeat(32);
  assert.ok(checkManifest(m).some((p) => p.includes("topic0 does not match")));
});

test("an error with a zero selector is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.errors[0].selector = NONE;
  assert.ok(checkManifest(m).some((p) => p.includes("may not be zero")));
});

test("a description over the byte ceiling is refused", { skip: cast ? false : "no cast on PATH" }, () => {
  const m = baseManifest();
  m.description = "x".repeat(1_001);
  assert.ok(checkManifest(m).some((p) => p.includes("description length 1001")));
});
