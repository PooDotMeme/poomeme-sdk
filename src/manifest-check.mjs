import { execFileSync } from "node:child_process";

// A JavaScript mirror of ModuleManifestCheckLib.sol — every constant, every
// rule, in the same order the Solidity checks them — so a module author sees
// a refusal by name before `poo publish` (or a real `directory.publish`) ever
// spends gas on it. Kept in step with the library by hand: a change there
// that is not mirrored here is a check this command silently stops covering,
// not a compile error, so `sdk/CLAUDE.md` names re-reading the Solidity
// whenever ModuleManifestCheckLib.sol changes.

export const MAX_MANIFEST_BYTES = 16_384;
export const MAX_NAME_BYTES = 48;
export const MIN_HANDLE_BYTES = 3;
export const MAX_HANDLE_BYTES = 32;
export const MAX_VERSION_BYTES = 16;
export const MAX_SUMMARY_BYTES = 120;
export const MAX_DESCRIPTION_BYTES = 1_000;
export const MAX_CONDITION_LABEL_BYTES = 80;
export const MAX_ERROR_TEXT_BYTES = 200;
export const MAX_SIGNATURE_BYTES = 256;
export const MAX_SECTIONS = 4;
export const MAX_SECTION_ENTRIES = 16;
export const MAX_ITEMS = 32;
export const MAX_FIELDS = 8;
export const MAX_VIEW_SELECTORS = 4;
export const MAX_EVENTS = 16;
export const MAX_ERRORS = 24;
export const MAX_COLUMNS = 4;
export const NO_EVENT_ARG = 255;
export const NO_LIST_EVENT = 65_535;

const ZERO_SELECTOR = "0x00000000";

function byteLength(text) {
  return Buffer.byteLength(text ?? "", "utf8");
}

function isHandle(handle) {
  const bytes = Buffer.from(handle ?? "", "utf8");
  if (bytes.length < MIN_HANDLE_BYTES || bytes.length > MAX_HANDLE_BYTES) return false;
  if (bytes[0] === 0x2d || bytes[bytes.length - 1] === 0x2d) return false;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0x2d) {
      if (bytes[i - 1] === 0x2d) return false;
    } else if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39))) {
      return false;
    }
  }
  return true;
}

function isVersion(version) {
  const bytes = Buffer.from(version ?? "", "utf8");
  if (bytes.length === 0 || bytes.length > MAX_VERSION_BYTES) return false;
  for (const c of bytes) {
    const ok =
      (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x2e || c === 0x2d ||
      c === 0x2b;
    if (!ok) return false;
  }
  return true;
}

function isUint(type) {
  if (type.length < 5 || type.length > 7 || !type.startsWith("uint")) return false;
  if (type[4] === "0") return false;
  for (let i = 4; i < type.length; i += 1) {
    const c = type.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  const width = Number(type.slice(4));
  return width >= 8 && width <= 256 && width % 8 === 0;
}

function supportedFieldType(abiType, listsAllowed) {
  let type = abiType;
  let list = false;
  if (type.length > 2 && type.endsWith("[]")) {
    if (!listsAllowed) return false;
    list = true;
    type = type.slice(0, -2);
  }
  return type === "address" || type === "bool" || type === "bytes32" || type === "string" || (!list && type === "bytes") ||
    isUint(type);
}

// The exact byte-level parser ModuleManifestCheckLib.eventTopic runs: the
// event name is everything before the first "(", each parameter's type is
// the first whitespace-delimited token in its comma-separated segment (so
// "address indexed holder" reads as just "address"), and any "(" or ")"
// found inside a parameter — nested types, which this manifest shape does
// not support — invalidates the whole signature.
export function eventCanonicalForm(signature) {
  const text = signature ?? "";
  const length = text.length;
  if (length < 3 || length > MAX_SIGNATURE_BYTES || text[length - 1] !== ")") return null;
  let open = 0;
  while (open < length && text[open] !== "(") open += 1;
  if (open === 0) return null;
  let name = "";
  for (let i = 0; i < open; i += 1) {
    const c = text[i];
    if (c === " " || c === ")" || c === ",") return null;
    name += c;
  }
  const end = length - 1;
  let cursor = open + 1;
  while (cursor < end && text[cursor] === " ") cursor += 1;
  const types = [];
  while (cursor < end) {
    const start = cursor;
    let type = "";
    while (cursor < end && text[cursor] !== " " && text[cursor] !== ",") {
      if (text[cursor] === "(" || text[cursor] === ")") return null;
      type += text[cursor];
      cursor += 1;
    }
    if (cursor === start) return null;
    types.push(type);
    while (cursor < end && text[cursor] !== ",") {
      if (text[cursor] === "(" || text[cursor] === ")") return null;
      cursor += 1;
    }
    if (cursor === end) break;
    cursor += 1;
    while (cursor < end && text[cursor] === " ") cursor += 1;
    if (cursor === end) return null;
  }
  return { canonical: `${name}(${types.join(",")})`, args: types.length };
}

function keccak(text) {
  return execFileSync("cast", ["keccak", text], { encoding: "utf8" }).trim();
}

export function selectorOf(signature) {
  return keccak(signature).slice(0, 10);
}

export function topicOf(signature) {
  return keccak(signature);
}

function argFits(arg, args) {
  return arg === NO_EVENT_ARG || arg < args;
}

function checkFields(fields, listsAllowed, where, problems) {
  if (fields.length > MAX_FIELDS) problems.push(`${where}: ${fields.length} fields exceeds the ceiling of ${MAX_FIELDS}`);
  const seen = new Set();
  for (const field of fields) {
    if (!supportedFieldType(field.abiType, listsAllowed)) {
      problems.push(`${where}: field "${field.name}" has an unsupported abiType "${field.abiType}"`);
    }
    if (seen.has(field.name)) problems.push(`${where}: field name "${field.name}" is repeated`);
    seen.add(field.name);
  }
}

function checkCondition(condition, where, problems) {
  const selector = (condition?.selector ?? ZERO_SELECTOR).toLowerCase();
  const length = byteLength(condition?.label);
  if (selector === ZERO_SELECTOR) {
    if (length !== 0) problems.push(`${where}: condition has no selector but carries a label`);
  } else if (length === 0 || length > MAX_CONDITION_LABEL_BYTES) {
    problems.push(`${where}: condition label length ${length} is out of range (1..${MAX_CONDITION_LABEL_BYTES})`);
  }
}

function checkAction(sectionIndex, actionIndex, action, problems) {
  const where = `section ${sectionIndex} action ${actionIndex} (${action.name || "(unnamed)"})`;
  const nameLength = byteLength(action.name);
  if (nameLength === 0 || nameLength > MAX_NAME_BYTES) problems.push(`${where}: name length ${nameLength} is out of range (1..${MAX_NAME_BYTES})`);
  checkFields(action.inputs ?? [], true, where, problems);
  const signature = `${action.name}(${(action.inputs ?? []).map((f) => f.abiType).join(",")})`;
  const expected = selectorOf(signature);
  if ((action.selector ?? "").toLowerCase() !== expected) {
    problems.push(`${where}: selector ${action.selector} does not match ${signature} (${expected})`);
  }
  const inputCount = (action.inputs ?? []).length;
  if (Number(action.minOutInput) > inputCount || Number(action.deadlineInput) > inputCount) {
    problems.push(`${where}: minOutInput/deadlineInput points past its ${inputCount} input(s)`);
  }
  checkCondition(action.visibleWhen, `${where} visibleWhen`, problems);
}

function checkItems(sectionIndex, section, problems) {
  const where = `section ${sectionIndex}`;
  if (Number(section.columns) > MAX_COLUMNS) problems.push(`${where}: columns ${section.columns} exceeds the ceiling of ${MAX_COLUMNS}`);
  const widest = Number(section.columns) === 0 ? MAX_COLUMNS : Number(section.columns);
  const seenByKind = { 0: new Array(section.views.length).fill(false), 1: new Array(section.actions.length).fill(false), 2: new Array(section.lists.length).fill(false) };
  for (const [index, item] of section.items.entries()) {
    const kind = Number(item.kind);
    if (Number(item.span) > widest) problems.push(`${where} item ${index}: span ${item.span} exceeds ${widest} columns`);
    if (kind === 3) {
      if (Number(item.index) !== 0) problems.push(`${where} item ${index}: a Gap must carry index 0`);
      continue;
    }
    const seen = seenByKind[kind];
    if (seen === undefined || Number(item.index) >= seen.length) {
      problems.push(`${where} item ${index}: index ${item.index} is out of range for its kind`);
      continue;
    }
    if (seen[Number(item.index)]) problems.push(`${where} item ${index}: index ${item.index} is referenced twice`);
    seen[Number(item.index)] = true;
  }
  const KIND_NAMES = { 0: "view", 1: "action", 2: "list" };
  for (const [kind, seen] of Object.entries(seenByKind)) {
    seen.forEach((hit, index) => {
      if (!hit) problems.push(`${where}: ${KIND_NAMES[kind]} ${index} is declared but no item on the grid points at it`);
    });
  }
}

function checkSection(index, section, eventCount, problems) {
  const where = `section ${index}`;
  if (
    section.views.length > MAX_SECTION_ENTRIES || section.actions.length > MAX_SECTION_ENTRIES ||
    section.lists.length > MAX_SECTION_ENTRIES || section.items.length > MAX_ITEMS
  ) {
    problems.push(`${where}: too many views, actions, lists or items`);
  }
  checkCondition(section.visibleWhen, `${where} visibleWhen`, problems);
  section.views.forEach((view, i) => {
    if (view.selectors.length === 0 || view.selectors.length > MAX_VIEW_SELECTORS || view.selectors[0] === ZERO_SELECTOR) {
      problems.push(`${where} view ${i}: 1..${MAX_VIEW_SELECTORS} selectors are required, and the first may not be zero`);
    }
    checkCondition(view.visibleWhen, `${where} view ${i} visibleWhen`, problems);
  });
  section.actions.forEach((action, i) => checkAction(index, i, action, problems));
  section.lists.forEach((list, i) => {
    if (Number(list.eventIndex) >= eventCount) problems.push(`${where} list ${i}: eventIndex ${list.eventIndex} is out of range`);
    if (Number(list.removeEventIndex) !== NO_LIST_EVENT && Number(list.removeEventIndex) >= eventCount) {
      problems.push(`${where} list ${i}: removeEventIndex ${list.removeEventIndex} is out of range`);
    }
  });
  checkItems(index, section, problems);
}

function checkEvents(events, problems) {
  const seenTopics = new Set();
  events.forEach((event, i) => {
    const where = `event ${i} (${event.label || event.signature})`;
    const parsed = eventCanonicalForm(event.signature);
    const topic = parsed === null ? null : topicOf(parsed.canonical);
    if (parsed === null || topic !== (event.topic0 ?? "").toLowerCase()) {
      problems.push(`${where}: topic0 does not match "${event.signature}"${parsed ? ` (expected ${topic})` : " (signature could not be parsed)"}`);
    }
    const args = parsed?.args ?? 0;
    for (const [field, value] of [["walletArg", event.walletArg], ["amountArg", event.amountArg], ["keyArg", event.keyArg], ["flagArg", event.flagArg], ["textArg", event.textArg]]) {
      if (!argFits(Number(value), args)) problems.push(`${where}: ${field} ${value} is out of range for ${args} argument(s)`);
    }
    const topicKey = (event.topic0 ?? "").toLowerCase();
    if (seenTopics.has(topicKey)) problems.push(`${where}: topic0 ${event.topic0} is declared by another event too`);
    seenTopics.add(topicKey);
  });
}

function checkErrors(errors, problems) {
  const seenSelectors = new Set();
  errors.forEach((error, i) => {
    const where = `error ${i} (${error.selector})`;
    if ((error.selector ?? ZERO_SELECTOR).toLowerCase() === ZERO_SELECTOR) problems.push(`${where}: selector may not be zero`);
    const length = byteLength(error.text);
    if (length === 0 || length > MAX_ERROR_TEXT_BYTES) problems.push(`${where}: text length ${length} is out of range (1..${MAX_ERROR_TEXT_BYTES})`);
    const key = (error.selector ?? "").toLowerCase();
    if (seenSelectors.has(key)) problems.push(`${where}: selector is declared by another error too`);
    seenSelectors.add(key);
  });
}

// Mirrors ModuleManifestCheckLib.check(ModuleManifest, encodedLength). Pass
// the manifest exactly as decoded off manifest() (see abi.mjs's `decode`) and
// the byte length of its raw ABI encoding (the return calldata's own length —
// `forge script`'s raw `manifest.value` hex already is that encoding).
export function checkManifest(manifest, encodedBytesLength) {
  const problems = [];
  if (typeof encodedBytesLength === "number" && encodedBytesLength > MAX_MANIFEST_BYTES) {
    problems.push(`manifest is ${encodedBytesLength} bytes ABI-encoded, over the ceiling of ${MAX_MANIFEST_BYTES}`);
  }
  const nameLength = byteLength(manifest.name);
  if (nameLength === 0 || nameLength > MAX_NAME_BYTES) problems.push(`name length ${nameLength} is out of range (1..${MAX_NAME_BYTES})`);
  if (!isHandle(manifest.handle)) problems.push(`handle "${manifest.handle}" is not ${MIN_HANDLE_BYTES}-${MAX_HANDLE_BYTES} characters of a-z, 0-9 and -, with no - at either end or twice in a row`);
  if (!isVersion(manifest.version)) problems.push(`version "${manifest.version}" is not 1-16 characters of a-z, A-Z, 0-9, ".", "-" and "+"`);
  const summaryLength = byteLength(manifest.summary);
  if (summaryLength === 0 || summaryLength > MAX_SUMMARY_BYTES) problems.push(`summary length ${summaryLength} is out of range (1..${MAX_SUMMARY_BYTES})`);
  const descriptionLength = byteLength(manifest.description);
  if (descriptionLength > MAX_DESCRIPTION_BYTES) problems.push(`description length ${descriptionLength} exceeds ${MAX_DESCRIPTION_BYTES}`);
  if (manifest.sections.length > MAX_SECTIONS) problems.push(`${manifest.sections.length} sections exceeds the ceiling of ${MAX_SECTIONS}`);
  if (manifest.events.length > MAX_EVENTS) problems.push(`${manifest.events.length} events exceeds the ceiling of ${MAX_EVENTS}`);
  if (manifest.errors.length > MAX_ERRORS) problems.push(`${manifest.errors.length} errors exceeds the ceiling of ${MAX_ERRORS}`);

  checkFields(manifest.config, false, "config", problems);
  manifest.sections.forEach((section, i) => checkSection(i, section, manifest.events.length, problems));
  checkEvents(manifest.events, problems);
  checkErrors(manifest.errors, problems);

  return problems;
}
