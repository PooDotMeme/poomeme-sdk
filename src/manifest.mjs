import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENUM = /\benum\s+([A-Za-z0-9_]+)\s*\{([^}]*)\}/g;
const CEILING = /\buint32\s+constant\s+([A-Z]+)_GAS_CEILING\s*=\s*([0-9_]+)\s*;/g;
const NO_SEED_FIELD = 255;
const WIDTH = 76;

// The enum names come out of the very ManifestTypes.sol the project compiles
// against, so the words this prints cannot fall behind the standard: a member
// added upstream shows up here the next time poo assemble runs.
export function vocabularyOf(packageDir) {
  const source = readFileSync(join(packageDir, "src", "standard", "ManifestTypes.sol"), "utf8");
  const out = {};
  for (const [, name, body] of source.matchAll(ENUM)) {
    out[name] = body.split(",").map((member) => member.trim()).filter(Boolean);
  }
  return out;
}

// The ceiling per hook is a constant in the very TokenModuleTypes.sol the
// project compiles against, so a ceiling the platform moves is printed here the
// next time poo assemble runs, and the number is never typed twice.
export function ceilingsOf(packageDir) {
  const source = readFileSync(join(packageDir, "src", "token-module", "TokenModuleTypes.sol"), "utf8");
  const out = {};
  for (const [, hook, amount] of source.matchAll(CEILING)) {
    out[hook.toLowerCase()] = Number(amount.replaceAll("_", ""));
  }
  return out;
}

function words(text) {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

const thousands = (amount) => Number(amount).toLocaleString("en-US");

const member = (vocabulary, kind, value) => vocabulary[kind]?.[value] ?? `${kind.toLowerCase()} ${value}`;
const unitWords = (vocabulary, value) => words(member(vocabulary, "Unit", value));

function wrap(text, width) {
  if (text === "") return [];
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line === "") line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

const pad = (text, width) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width));

// #region The grid a section declares

const WIDE_WIDGETS = ["Text", "Progress", "Rows", "Series"];

// The platform's own default span, mirrored: a wide widget or a table takes the
// row, a form takes two columns of however many there are, everything else
// takes one. An item that names a span of its own overrides all of it.
function spanOf(vocabulary, section, item) {
  const columns = Math.max(1, section.columns);
  if (item.span > 0) return Math.min(item.span, columns);
  const kind = member(vocabulary, "ItemKind", item.kind);
  if (kind === "Gap") return 1;
  if (kind === "View") {
    const widget = member(vocabulary, "Widget", section.views[item.index]?.widget ?? 0);
    return WIDE_WIDGETS.includes(widget) ? columns : 1;
  }
  if (kind === "List") return columns;
  if (kind === "Action" && columns === 2) return 2;
  return Math.min(2, columns);
}

function rowsOf(vocabulary, section) {
  const columns = Math.max(1, section.columns);
  const rows = [];
  let row = [];
  let filled = 0;
  for (const item of section.items) {
    const span = spanOf(vocabulary, section, item);
    if (filled + span > columns && row.length > 0) {
      rows.push(row);
      row = [];
      filled = 0;
    }
    row.push({ item, span });
    filled += span;
    if (filled >= columns) {
      rows.push(row);
      row = [];
      filled = 0;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

// #endregion

// #region What one seat says

function conditionWords(condition) {
  if (condition === undefined || /^0x0{8}$/.test(condition.selector)) return null;
  return condition.label === "" ? "only sometimes" : `only when ${condition.label}`;
}

function seatOf(vocabulary, section, item, selectors) {
  const kind = member(vocabulary, "ItemKind", item.kind);
  if (kind === "Gap") return { title: "", notes: ["empty seat"] };
  if (kind === "View") {
    const view = section.views[item.index];
    if (view === undefined) return { title: `view ${item.index}`, notes: ["no such view"] };
    const notes = [words(member(vocabulary, "Widget", view.widget))];
    if (view.unit !== 0) notes.push(unitWords(vocabulary, view.unit));
    if (view.withViewer) notes.push("per wallet");
    if (view.headline) notes.push("headline");
    const where = conditionWords(view.visibleWhen);
    if (where !== null) notes.push(where);
    return { title: view.label, notes, calls: view.selectors.map((one) => selectors.get(one) ?? one) };
  }
  if (kind === "List") {
    const list = section.lists[item.index];
    if (list === undefined) return { title: `list ${item.index}`, notes: ["no such list"] };
    const notes = ["table", words(member(vocabulary, "ListShape", list.shape))];
    if (list.role !== 0) notes.push(words(member(vocabulary, "ListRole", list.role)));
    return { title: list.label, notes };
  }
  const action = section.actions[item.index];
  if (action === undefined) return { title: `action ${item.index}`, notes: ["no such action"] };
  const notes = ["button"];
  const flow = member(vocabulary, "ActionFlow", action.flow);
  if (flow === "WalletPays") notes.push("the wallet pays");
  if (flow === "WalletReceives") notes.push("the wallet receives");
  if (action.isPayable) notes.push("payable");
  if (action.isExit) notes.push("exit");
  if (action.inputs.length > 0) notes.push(`${action.inputs.length} input${action.inputs.length === 1 ? "" : "s"}`);
  const where = conditionWords(action.visibleWhen);
  if (where !== null) notes.push(where);
  return {
    title: action.name,
    notes,
    body: action.description,
    calls: [selectors.get(action.selector) ?? action.selector],
  };
}

// #endregion

// #region Drawing

function drawRow(cells, columns) {
  const inner = WIDTH - 4;
  const unit = Math.floor((inner - (columns - 1) * 3) / columns);
  const widths = cells.map(({ span }) => unit * span + (span - 1) * 3);
  widths[widths.length - 1] += inner - (widths.reduce((a, b) => a + b, 0) + (cells.length - 1) * 3);

  const texts = cells.map(({ text }, index) => {
    const width = widths[index];
    const lines = [];
    for (const line of text) lines.push(...(line === "" ? [""] : wrap(line, width)));
    return lines;
  });
  const height = Math.max(...texts.map((lines) => lines.length));

  const bar = (left, join, right) => left + widths.map((width) => "─".repeat(width + 2)).join(join) + right;
  const out = [bar("┌", "┬", "┐")];
  for (let line = 0; line < height; line += 1) {
    out.push(`│ ${texts.map((lines, index) => pad(lines[line] ?? "", widths[index])).join(" │ ")} │`);
  }
  out.push(bar("└", "┴", "┘"));
  return out;
}

function drawSection(vocabulary, section, index, total, selectors) {
  const role = words(member(vocabulary, "SectionRole", section.role));
  const columns = Math.max(1, section.columns);
  const head = `${section.title || "(untitled)"}`;
  const tail = `section ${index + 1}/${total} · ${role} · ${columns} column${columns === 1 ? "" : "s"}`;
  const out = [`${head}${" ".repeat(Math.max(1, WIDTH - head.length - tail.length))}${tail}`];
  const when = conditionWords(section.visibleWhen);
  if (when !== null) out.push(`  ${when}`);
  out.push("");

  if (section.items.length === 0) {
    out.push("  this section seats nothing");
    return out;
  }
  for (const row of rowsOf(vocabulary, section)) {
    const cells = row.map(({ item, span }) => {
      const seat = seatOf(vocabulary, section, item, selectors);
      const text = [seat.title];
      if (seat.notes.length > 0) text.push(seat.notes.join(" · "));
      if (seat.body) text.push(seat.body);
      if (seat.calls?.length) text.push(seat.calls.join("  "));
      return { span, text };
    });
    out.push(...drawRow(cells, columns));
  }
  return out;
}

// #endregion

// #region The whole page

function fieldLine(vocabulary, field) {
  const notes = [field.abiType];
  if (field.unit !== 0) notes.push(unitWords(vocabulary, field.unit));
  if (field.optional) notes.push("optional");
  if (field.options.length > 0) notes.push(`one of ${field.options.join(", ")}`);
  if (field.multiline) notes.push("multiline");
  return `${pad(field.name, 18)} ${pad(field.label, 24)} ${notes.join(" · ")}`;
}

const TAX_ROW = {
  None: "takes no tax row",
  Quote: "takes a tax row paid in the quote asset",
  Token: "takes a tax row paid in the token",
};

function requiresParts(vocabulary, requires) {
  const quote = member(vocabulary, "QuoteKind", requires.quote);
  const parts = [quote === "Any" ? "any quote asset" : `a ${words(quote)} quote asset`];
  const taxAsset = member(vocabulary, "TaxAsset", requires.taxAsset);
  let tax = TAX_ROW[taxAsset] ?? `takes a tax row paid in ${words(taxAsset)}`;
  if (requires.minTotalBps > 0) tax += `, at least ${requires.minTotalBps} bps`;
  parts.push(tax);
  let supply = requires.acceptsSupply ? "takes a supply share" : "takes no supply share";
  if (requires.minSupplyBps > 0) supply += `, at least ${requires.minSupplyBps / 100} %`;
  parts.push(supply);
  if (requires.unique) parts.push("one instance per token");
  return parts;
}

// A seed either names a fixed amount or points at a config field the creator
// fills in, never both, so a field-fed seed has an amount of 0 that means
// nothing on its own.
function seedWords(vocabulary, config, seed) {
  const asset = words(member(vocabulary, "SeedAsset", seed.asset));
  const field = Number(seed.amountField);
  if (field === NO_SEED_FIELD) return `${asset} ${seed.amount}`;
  return `${asset} from ${config[field]?.name ?? `config field ${field}`}`;
}

function hookParts(manifest, ceilings) {
  const parts = ["gate", "track", "receive", "operate", "work"]
    .map((hook) => [hook, manifest[`${hook}Gas`]])
    .filter(([, cap]) => Number(cap) > 0)
    .map(([hook, cap]) => {
      const ceiling = ceilings[hook];
      return ceiling === undefined
        ? `${hook} ${thousands(cap)}`
        : `${hook} ${thousands(cap)} of ${thousands(ceiling)}`;
    });
  return parts.length === 0 ? ["none — this module hears nothing a token does"] : parts;
}

function labelled(label, parts) {
  const lead = label.padEnd(11);
  const lines = [];
  let line = "";
  for (const part of parts) {
    const next = line === "" ? part : `${line} · ${part}`;
    if (line !== "" && lead.length + next.length > WIDTH) {
      lines.push(line);
      line = part;
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines.map((text, index) => `${index === 0 ? lead : " ".repeat(lead.length)}${text}`);
}

export function render(manifest, vocabulary, { selectors = new Map(), ceilings = {}, verdict = null } = {}) {
  const out = [];
  const head = manifest.name || "(unnamed)";
  const tail = `handle ${manifest.handle || "(none)"}`;
  out.push(`${head}${" ".repeat(Math.max(1, WIDTH - head.length - tail.length))}${tail}`);
  out.push("─".repeat(WIDTH));
  out.push(...wrap(manifest.summary, WIDTH));
  out.push("");
  out.push(...wrap(manifest.description, WIDTH));
  out.push("");

  out.push(...labelled("requires", requiresParts(vocabulary, manifest.requires)));
  out.push(...labelled("hooks", hookParts(manifest, ceilings)));
  if (manifest.seeds.length > 0) {
    out.push(...labelled("seeds", manifest.seeds.map((seed) => seedWords(vocabulary, manifest.config, seed))));
  }
  out.push("");

  out.push(`config     ${manifest.config.length} field${manifest.config.length === 1 ? "" : "s"} the creator fills in`);
  for (const field of manifest.config) out.push(`  ${fieldLine(vocabulary, field)}`);
  out.push("");

  out.push("═".repeat(WIDTH));
  out.push(`the token page, as this manifest asks for it`);
  out.push("═".repeat(WIDTH));
  out.push("");
  if (manifest.sections.length === 0) out.push("this module draws nothing on the token page");
  manifest.sections.forEach((section, index) => {
    out.push(...drawSection(vocabulary, section, index, manifest.sections.length, selectors));
    out.push("");
  });

  out.push(`events     ${manifest.events.length} the page reads off the chain`);
  for (const event of manifest.events) {
    const notes = [words(member(vocabulary, "EventRole", event.role)), words(member(vocabulary, "Tone", event.tone))];
    out.push(`  ${pad(event.label, 24)} ${notes.join(" · ")}`);
    out.push(`  ${" ".repeat(24)} ${event.signature}`);
  }
  out.push("");
  out.push(`errors     ${manifest.errors.length} this module puts in words`);
  for (const error of manifest.errors) out.push(`  ${pad(error.selector, 12)} ${error.text}`);

  if (verdict !== null) {
    out.push("");
    out.push("─".repeat(WIDTH));
    out.push(verdict);
  }
  return out.join("\n");
}

// #endregion
