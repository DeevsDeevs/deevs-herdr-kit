// Speed guard and the perf log. Every view renders (taskModel, then the view, as the stage does) on
// t47's made-up records, timed as the median of several renders, and its time on the owner's Mac is
// projected: QuickJS's interpreter (what Herdr runs a first render on) × MAC_FACTOR, or V8 ×
// V8_RATIO × MAC_FACTOR without qjs ($QJS, else on PATH). Fails when a projection passes its
// record's limit in two runs out of two, or a view builds more elements than its ceiling.
// Then perf.js (off by default, lines, names, cap) and that Watchlist's cache updates.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const mods = join(here, "mods/agent-tower");
const stubs = join(here, "perf/stubs.mjs");
registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: new URL(`file://${stubs}`).href, shortCircuit: true } : next(s, c)) });

export const BUDGET_MS = 50;
// The owner's Mac against this harness on a record its size (perf log, snapshots 15:38/15:44, against the
// 15:46 snapshot here in QuickJS): Timeline 16.1 ms median there, 1.6-2.1 here without the model
// (×7.7-10); the stage, model and view, 20.6 against 2.1-2.6 (×7.9-9.8, the stage's own work
// included); the list 13.5 against 2.43 in t47's harness (×5.6). Host calls per builder call are
// not in the harness, so the factor carries them.
export const MAC_FACTOR = 8;
// QuickJS's interpreter against V8 here, per view on both records: 4.5 to 10.6, median 7.55.
export const V8_RATIO = 8;
// Per record, the projected Mac ms a view may take: half the budget on his size; on the much
// bigger record, the whole budget (past it Herdr cuts the render off).
export const LIMITS = { mac: BUDGET_MS / 2, big: BUDGET_MS };
// Elements per render on the big record: about twice what each built at 15:40, except Timeline Week
// and Month, which then built 11,600 and 9,900 (the over-budget renders) and must come down.
const CEILING = { model: 0, "timeline Day": 3500, "timeline Week": 5000, "timeline Month": 5000, "timeline Day, all open": 5000, board: 700, radar: 800, watchlist: 700 };
const RUNS = 15;
const PRESETS = (process.env.PERF_PRESET ?? "mac,big").split(",");

function findQjs() {
  if (process.env.QJS) return process.env.QJS;
  const r = spawnSync("sh", ["-c", "command -v qjs"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const qjs = findQjs();
const engine = qjs ? "quickjs" : "v8";
const scale = MAC_FACTOR * (qjs ? 1 : V8_RATIO);

async function timeViews(preset) {
  if (qjs) {
    const root = mkdtempSync(join(tmpdir(), "tower-perf-"));
    for (const name of ["gpui-kit", "gpui-base", "herdr"]) writeFileSync(join(root, name), `export * from ${JSON.stringify(stubs)};\n`);
    try {
      const out = execFileSync(qjs, ["--module", join(here, "perf/qjs.mjs"), mods, String(RUNS), preset], { cwd: root, encoding: "utf8" });
      return JSON.parse(out.trim().split("\n").at(-1));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const { buildFixture } = await import("./perf/fixture.mjs");
  const { bench } = await import("./perf/bench.mjs");
  return bench({ kit: mods, fixture: buildFixture(preset), clock: () => performance.now(),
    settle: () => new Promise((r) => setTimeout(r, 5)), runs: RUNS });
}

const mac = (r) => +(r.median * scale).toFixed(1);
for (const preset of PRESETS) {
  const limit = LIMITS[preset];
  let rows = await timeViews(preset);
  // One slow run is not a failure: a view over the limit is timed again, and its faster median counts.
  if (rows.some((r) => mac(r) > limit)) {
    const again = await timeViews(preset);
    rows = rows.map((r) => ({ ...r, median: Math.min(r.median, again.find((x) => x.case === r.case)?.median ?? r.median) }));
  }
  console.log(`${preset} record, ${engine} × ${scale} = projected Mac ms (limit ${limit}): ${rows.map((r) => `${r.case} ${mac(r)}`).join(", ")}`);
  assert.deepEqual(rows.map((r) => r.case).filter((c) => /board|radar|watchlist|timeline/.test(c)).length, 7, "every view timed");
  for (const r of rows) {
    assert.ok(mac(r) <= limit, `${preset} record, ${r.case}: projected ${mac(r)} ms on the Mac (${r.median} ms in ${engine}), over ${limit}`);
    if (preset === "big") assert.ok(r.elements <= (CEILING[r.case] ?? 700), `${r.case}: ${r.elements} elements, over ${CEILING[r.case] ?? 700}`);
  }
}

// ── perf.js ──
const perf = await import("./mods/agent-tower/perf.js");

// Off by default: nothing kept, nothing run.
const calls = [];
const exec = (program, args) => (calls.push([program, args]), Promise.resolve({ code: 0 }));
const off = perf.perfLog({ dir: "/tower", exec });
off.render("board", 3, 10);
off.command("hc ls", 4);
assert.equal(off.waiting(), 0);
assert.equal(calls.length, 0);

// On: a line per render and per command, kept until flush() and sent together in one sh call.
let clock = 1_000_000;
const log = perf.perfLog({ on: true, dir: "/tower", exec, clock: () => clock });
assert.equal(log, off, "one log per file: the same one, switched on");
log.render("timeline", 12.3456, 900);
log.command("hc read work-vps/t9 --lines 18", 30);
assert.equal(log.waiting(), 2);
assert.equal(calls.length, 0);
for (let i = 0; i < 500; i++) log.render("board", 1, 1);
assert.equal(calls.length, 0, "a render never starts a send");
await log.flush();
assert.equal(calls.length, 1);
const [program, args] = calls[0];
assert.equal(program, "sh");
assert.equal(args[3], "/tower/perf.jsonl");
const sent = args[4].trim().split("\n").map((l) => JSON.parse(l));
assert.equal(sent.length, 502);
assert.deepEqual(sent.slice(0, 2).map(({ at, ...rest }) => rest), [{ view: "timeline", ms: 12.35, elements: 900 }, { what: "hc read", ms: 30 }]);
// No terminal text: only a known kind and one plain word survive.
assert.equal(perf.commandName("exec /home/me/secret.txt"), "exec");
assert.equal(perf.commandName("hc send -- t9 rm -rf"), "hc send");
assert.equal(perf.commandName("Ship it? yes"), "?");

// The settings read again (every 30 s), unchanged: the log made again is the same one, its waiting
// lines kept, and it goes on writing.
const sends = [];
const exec2 = (program, a) => (sends.push(a[4]), Promise.resolve({ code: 0 }));
let log2 = perf.perfLog({ on: true, dir: "/t2", exec: exec2 });
log2.render("list", 10, 51);
for (let k = 0; k < 3; k++) {
  log2 = perf.perfLog({ on: true, dir: "/t2", exec: exec2 });
  log2.render("list", 11 + k, 51);
}
await log2.flush();
assert.equal(sends.length, 1);
assert.equal(sends[0].trim().split("\n").length, 4, "nothing dropped across the re-reads");
log2.render("board", 3, 100);
await perf.perfLog({ on: true, dir: "/t2", exec: exec2 }).flush();
assert.equal(sends.length, 2, "still writing after them");

// Turned off and on again: off keeps nothing new; on writes again.
const offAgain = perf.perfLog({ on: false, dir: "/t2", exec: exec2 });
assert.equal(offAgain.on, false);
offAgain.render("list", 9, 51);
assert.equal(offAgain.waiting(), 0);
const onAgain = perf.perfLog({ on: true, dir: "/t2", exec: exec2 });
onAgain.render("list", 9, 51);
await onAgain.flush();
assert.equal(sends.length, 3);
assert.equal(JSON.parse(sends[2]).view, "list");

// A send that never settles (its copy went away) blocks the next one only for STUCK_MS; then the
// next send goes, and says how many lines the stuck one carried.
let t3 = 0;
const sends3 = [];
const stuck = perf.perfLog({ on: true, dir: "/t3", exec: (p, a) => (sends3.push(a[4]), new Promise(() => {})), clock: () => t3 });
stuck.render("list", 1, 1);
stuck.render("list", 1, 1);
stuck.flush();
stuck.render("stage", 2, 2);
stuck.flush();
assert.equal(sends3.length, 1, "waits on the send in flight");
t3 += perf.STUCK_MS;
stuck.flush();
assert.equal(sends3.length, 2);
const after = sends3[1].trim().split("\n").map((l) => JSON.parse(l));
assert.deepEqual([after[0].unconfirmed, after[0].dropped, after[1].view], [2, 0, "stage"]);
// An exec that throws at once doesn't stop the log either.
const thrower = perf.perfLog({ on: true, dir: "/t4", exec: () => { throw new Error("no"); } });
thrower.render("list", 1, 1);
assert.equal(thrower.flush(), null);
thrower.render("list", 1, 1);
assert.equal(thrower.flush(), null);
// Nothing flushed for long: the oldest lines go past KEEP_LINES, and the next send counts them.
const many = [];
const full = perf.perfLog({ on: true, dir: "/t5", exec: (p, a) => (many.push(a[4]), Promise.resolve()) });
for (let i = 0; i < perf.KEEP_LINES + 5; i++) full.render("list", 1, 1);
assert.equal(full.waiting(), perf.KEEP_LINES);
await full.flush();
assert.equal(JSON.parse(many[0].split("\n")[0]).dropped, 5);

// The append script: appends, and moves the file aside past the cap (run for real in sh).
const dir = mkdtempSync(join(tmpdir(), "tower-perf-log-"));
const real = (p, a) => Promise.resolve(execFileSync(p, a.map((x, i) => (i === 5 ? "100" : x))));
const capped = perf.perfLog({ on: true, dir, exec: real });
capped.render("board", 1, 1);
await capped.flush();
capped.render("radar", 1, 1);
await capped.flush();
assert.equal(readFileSync(join(dir, "perf.jsonl"), "utf8").trim().split("\n").length, 2);
capped.render("list", 1, 1);
await capped.flush();
assert.ok(existsSync(join(dir, "perf.jsonl.1")), "rolled past the cap");
assert.ok(statSync(join(dir, "perf.jsonl")).size < 100);
rmSync(dir, { recursive: true, force: true });

// Elements: counted as the views build them.
globalThis.__fx = { files: {}, shared: {}, elements: 0, calls: 0, log: [] };
perf.elements();
perf.div();
perf.h_flex();
perf.v_flex();
assert.equal(perf.elements(), 3);
assert.equal(perf.elements(), 0);

// ── Watchlist's cache: parsed once per read, redrawn only when a file changed, and updated when one does. ──
const w = await import("./mods/agent-tower/watchlist.js");
globalThis.__fx = { files: { "/t/watchlist.json": JSON.stringify({ tickers: [{ symbol: "ABC" }] }), "/t/investing-notes.md": "one\ntwo\n" }, shared: {}, elements: 0, calls: 0, log: [] };
let notified = 0;
const ui = { now: Date.now(), state: {}, towerDir: "/t", notify: () => notified++ };
await w.load(ui);
assert.equal(notified, 1);
assert.equal(ui.state.notes, "one\ntwo");
const parsed = ui.state.own;
ui.now += 20000;
await w.load(ui);
assert.equal(notified, 1, "same files: no redraw");
assert.equal(ui.state.own, parsed, "same file: not parsed again");
globalThis.__fx.files["/t/investing-notes.md"] = "one\ntwo\nthree\n";
ui.now += 20000;
await w.load(ui);
assert.equal(notified, 2, "a changed file redraws");
assert.equal(ui.state.notes, "one\ntwo\nthree");
globalThis.__fx.files["/t/watchlist.json"] = JSON.stringify({ tickers: [{ symbol: "XYZ" }] });
ui.now += 20000;
await w.load(ui);
assert.equal(notified, 3);
assert.deepEqual(ui.state.own.tickers.map((x) => x.symbol), ["XYZ"]);
// A load that throws (here the file read itself) doesn't stop the next one.
const files = globalThis.__fx.files;
globalThis.__fx.files = new Proxy(files, { get: (o, k) => { if (k === "/t/watchlist.json") throw new Error("read failed"); return o[k]; } });
ui.now += 20000;
await w.load(ui);
assert.equal(ui.state.reading, false, "a failed load is over");
globalThis.__fx.files = { ...files, "/t/investing-notes.md": "after\n" };
ui.now += 20000;
await w.load(ui);
assert.equal(ui.state.notes, "after", "the next load runs");

console.log(`perf ok (${engine})`);
