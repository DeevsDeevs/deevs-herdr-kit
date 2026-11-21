// Herdr cuts a render off past 50 ms (a timer or task past 500 ms) with QuickJS's interrupt, which no
// catch or finally sees: nothing after the cut runs (stuck-frame.md). Node's vm timeout ends a run
// the same way (V8's termination skips catch and finally too), from inside any function, so a cut
// here is a real one: the same code path, stopped at an instruction the test chooses.
import assert from "node:assert/strict";
import vm from "node:vm";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const io = pathToFileURL(join(here, "io-stubs.mjs")).href;
// io-stubs, with an agents() that spins while fx.spin is set (where the cut lands) or throws, and read.py's answers.
const stubs = `data:text/javascript,${encodeURIComponent(`
import * as s from ${JSON.stringify(io)};
export * from ${JSON.stringify(io)};
export const agents = () => {
  if (globalThis.__fx.spin) for (;;) {}
  if (globalThis.__fx.throwAgents) throw new Error("a made-up failure");
  return s.agents();
};
// fx.py(args): what read.py answers.
export const exec = (cmd, args, opts) => (globalThis.__fx.py && cmd === "sh" && args?.[2] === "tower" ? Promise.resolve(globalThis.__fx.py(args)) : s.exec(cmd, args, opts));
`)}`;
registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: stubs, shortCircuit: true } : next(s, c)) });

let clock = Date.UTC(2026, 10, 15, 12);
Date.now = () => clock;
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};
// Runs f until it ends or is cut off after ms: whether it was cut.
const cut = (f, ms = 30) => {
  try {
    vm.runInNewContext("f()", { f }, { timeout: ms });
    return false;
  } catch (e) {
    assert.equal(e.code, "ERR_SCRIPT_EXECUTION_TIMEOUT", String(e));
    return true;
  }
};
const term = (address, status = "working") => ({ address, state: "live", status, turn: 1, program: { agent: true, name: "Claude Code" },
  labels: { "task.id": `k-${address}`, "task.role": "lead", "task.title": `Made-up task ${address}` } });

const model = await import("./mods/agent-tower/model.js");
const { default: AgentTasks } = await import("./mods/agent-tower/main.js");

async function copy(files = {}, { hold = {}, props = {} } = {}) {
  globalThis.__fx = { files, hold, shared: {}, elements: 0, calls: 0, props, execs: [], execArgs: [], watchers: [], failFind: 0, active: true,
    fixture: { terms: [term("t1")], agents: [], spaces: [], machines: [] },
    layout: { id: "root", children: [{ id: "sidebar", size: { px: 320 } }, { id: "work-view", active: "main", children: [{ id: "main" }, { id: "tower-stage" }] }] } };
  const timers = [];
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {},
    spawn(f) { Promise.resolve().then(() => f(cx)).catch(() => {}); },
    timer: { every: (ms, f) => (timers.push({ ms, f, next: clock + ms }), { cancel() {} }), after: () => ({ cancel() {} }) } };
  const v = new AgentTasks();
  v.init({}, cx);
  await settle();
  v.render(cx);
  await settle();
  // The timers of one period (1000: the list's tick), as Herdr runs them: between renders.
  const fire = async (ms) => {
    clock += ms;
    for (const t of timers.filter((x) => x.ms === ms)) t.f(cx);
    await settle();
  };
  // The clock moves on ms, every timer of 30 s or less running when due (as io.test).
  const tick = async (ms) => {
    const to = clock + ms;
    for (;;) {
      const due = timers.filter((x) => x.ms <= 30000 && x.next <= to).sort((x, y) => x.next - y.next)[0];
      if (!due) break;
      clock = Math.max(clock, due.next);
      due.next += due.ms;
      due.f(cx);
      await settle();
    }
    clock = to;
    await settle();
  };
  return { v, cx, second: () => fire(1000), fire, tick, fx: globalThis.__fx };
}
const changed = (fx) => Object.keys(fx.shared["agent-tower.changes"] ?? {}).sort();

// 1. A render cut off mid-draw leaves no read cache: the next render and the reads between renders
//    see a terminal started after the cut (on the Mac: no new terminal and no status change for hours).
{
  const { v, cx, second, fx } = await copy();
  assert.deepEqual(changed(fx), ["t1"]);
  fx.spin = true;
  assert.ok(cut(() => v.render(cx)), "the render was cut off");
  fx.spin = false;
  fx.fixture.terms.push(term("t2"));
  clock += 200;
  v.trackTick(cx); // a timer's read, outside any render, with no tick having cleared anything
  await settle();
  assert.deepEqual(changed(fx), ["t1", "t2"], "a read after the cut sees the new terminal");
  fx.fixture.terms.push(term("t3"));
  v.render(cx);
  await second();
  assert.deepEqual(changed(fx), ["t1", "t2", "t3"], "and so do the next render and tick");
}

// 2. The tick finds what a cut-off render left, drops it and writes one line to the perf log; a render
//    that comes first counts it instead.
{
  const files = { "/made/up/app/agent-tower/config.json": JSON.stringify({ perf: true }) };
  const { v, cx, second, fire, fx } = await copy(files);
  fx.spin = true;
  assert.ok(cut(() => v.render(cx)));
  fx.spin = false;
  await second();
  await second();
  v.render(cx); // a clean render after it leaves nothing for the tick
  await second();
  // A cut with a render right after it, before any tick: that render counts it.
  fx.spin = true;
  assert.ok(cut(() => v.render(cx)));
  fx.spin = false;
  v.render(cx);
  await second();
  await fire(30000); // the perf log's flush
  const logged = fx.execArgs.filter((a) => a[2] === "perf").map((a) => a[4]).join("");
  const lines = logged.split("\n").filter((l) => l.includes("render cut off")).map((l) => JSON.parse(l));
  // count: every cut since the module loaded (test 1's too: copies share one module, as in Herdr).
  assert.deepEqual(lines.map((l) => [l.left, l.count - lines[0].count]), [[["frame"], 0], [["frame"], 1]], `one line per cut: ${logged}`);
}

// 3. A model pass cut off before its end leaves no memo another call can hit: changedAt asked later,
//    with the list's own (since changed) map, answers from the map as it is now.
{
  const changes = new Map([["a1", { at: 1000 }]]);
  const spinning = { address: "x1", state: "live", get labels() { for (;;) {} } };
  assert.ok(cut(() => model.taskModel({ terms: [spinning], listed: new Map(), spaces: [], config: model.DEFAULTS, changes, now: 5000 })));
  const item = { lead: { address: "a1" }, live: [] };
  assert.equal(model.changedAt(item, changes), 1000);
  changes.set("a1", { at: 2000 });
  assert.equal(model.changedAt(item, changes), 2000, "not the memo of a dead pass");
  assert.ok(model.passLeft(), "the tick can tell it was left");
  model.clearPass();
  assert.ok(!model.passLeft());
}

// 4. A busy mark a cut-off run left lapses by itself.
{
  assert.ok(model.held(clock - 1000, 60000, clock));
  assert.ok(!model.held(clock - 61000, 60000, clock), "left by a run that never ended");
  assert.ok(!model.held(true, 60000, clock) && !model.held(null, 60000, clock));
  assert.ok(!model.held(clock + 5000, 60000, clock), "a clock that went back frees it");
}

// 5. The inbox lease: a step that never settles (an async function Herdr cut off leaves its promise
//    pending for good) holds the chain only as long as a lease.
{
  let now = 0;
  const files = {};
  let stall = true;
  const keeper = model.leaseKeeper({ path: "/l", id: "me", now: () => now, ms: 20000,
    read: (p) => (stall ? new Promise(() => {}) : Promise.resolve(files[p] ?? null)),
    write: (p, text) => Promise.resolve((files[p] = text)) });
  let first = null;
  keeper.take().then((ok) => (first = ok));
  await settle();
  stall = false;
  now = 21000;
  const second = await keeper.take();
  assert.ok(second, "taken once the stuck step is older than the lease");
  assert.equal(first, null, "the stuck step itself never ends");
}

// ── Review round 1 (build2/cutoff-review.md): one test per fixed finding, R<n> after its number. ──
const TOWER = "/made/up/app/agent-tower";
const INBOX = `${TOWER}/inbox`;
const OUTBOX = `${TOWER}/outbox`;
const never = () => new Promise(() => {});
const perfLines = (fx) => fx.execArgs.filter((a) => a[2] === "perf").map((a) => a[4]).join("").split("\n")
  .filter((l) => l.includes("render cut off")).map((l) => JSON.parse(l));
const PERF = { [`${TOWER}/config.json`]: JSON.stringify({ perf: true }) };
const spinningTerm = { address: "x1", state: "live", get labels() { for (;;) {} } };

// R15. A render that throws an ordinary error is no cut: nothing logged, nothing left.
{
  const { v, cx, second, fire, fx } = await copy({ ...PERF });
  fx.throwAgents = true;
  assert.throws(() => v.render(cx));
  fx.throwAgents = false;
  await second();
  v.render(cx);
  await second();
  await fire(30000);
  assert.deepEqual(perfLines(fx), [], "a throw is not reported as a cut");
  assert.throws(() => model.taskModel({ terms: null, listed: new Map(), spaces: [], config: model.DEFAULTS, changes: new Map(), now: 1 }));
  assert.ok(!model.passLeft(), "a model pass that throws leaves no memo");
}

// R11. One cut that leaves both a frame and a model pass is logged once.
{
  const { v, cx, second, fire, fx } = await copy({ ...PERF });
  await second();
  fx.spin = true;
  assert.ok(cut(() => v.render(cx)));
  fx.spin = false;
  assert.ok(cut(() => model.taskModel({ terms: [spinningTerm], listed: new Map(), spaces: [], config: model.DEFAULTS, changes: new Map(), now: 1 })));
  v.render(cx);
  await second();
  await second();
  await fire(30000);
  assert.deepEqual(perfLines(fx).map((l) => l.left), [["frame", "model pass"]]);
}

// R3. A pass of the inbox read that never ends (cut off) doesn't end the watch loop, and a request
//     that came meanwhile is read once that pass's mark lapses.
{
  const { tick, fx } = await copy();
  await tick(6000);
  const r1 = `${INBOX}/r1.json`;
  fx.files[r1] = JSON.stringify({ recipe: "no-such-recipe", words: "made-up words", at: clock });
  fx.hold = { [r1]: never() };
  const fireWatch = async (paths) => {
    for (const x of fx.watchers.splice(0).filter((w) => w.dir === INBOX)) x.ok(paths);
    await settle();
  };
  await fireWatch([r1]);
  assert.ok(fx.watchers.some((w) => w.dir === INBOX), "the watch loop waits for the next batch");
  const r2 = `${INBOX}/r2.json`;
  fx.files[r2] = JSON.stringify({ recipe: "no-such-recipe", words: "other made-up words", at: clock });
  await fireWatch([r2]);
  assert.equal(fx.files[`${OUTBOX}/r2.json`], undefined, "not while the stuck pass's mark holds");
  clock += 11 * 60000;
  await tick(6000);
  assert.ok(fx.files[`${OUTBOX}/r2.json`], "answered after it lapsed");
}

// R14. A request an earlier pass took is not answered again: its "starting" stays.
{
  const { v, cx, tick, fx } = await copy();
  await tick(6000);
  v.handled.add("r9");
  fx.files[`${INBOX}/r9.json`] = JSON.stringify({ recipe: "no-such-recipe", words: "made-up words", at: clock });
  fx.files[`${OUTBOX}/r9.json`] = `${JSON.stringify({ ok: true, task: "k9", starting: true })}\n`;
  await v.readInboxOnce(cx);
  await settle();
  assert.equal(JSON.parse(fx.files[`${OUTBOX}/r9.json`]).ok, true);
  assert.equal(fx.files[`${INBOX}/r9.json`], undefined, "and the request is gone");
}

// R9/R14. A run that outlived its mark leaves the newer run's mark alone when it ends.
{
  const { v, cx, fx } = await copy();
  const conf = `${TOWER}/config.json`;
  let release;
  fx.hold = { [conf]: new Promise((r) => (release = r)) };
  v.checkSettings(cx);
  await settle();
  clock += 3 * 60000;
  fx.hold = { [conf]: never() };
  v.checkSettings(cx);
  await settle();
  const newer = v.checkingSettings;
  assert.ok(model.held(newer), "a second run started after the first one's mark lapsed");
  release();
  await settle();
  assert.equal(v.checkingSettings, newer);
}

// R2/R16. The recorder lease held while its record load never ended: loaded again, then recording.
{
  const events = `${TOWER}/timeline/events.json`;
  const { v, tick, fx } = await copy({}, { hold: { [events]: never() } });
  await tick(2000);
  assert.ok(!v.holdsRecorder(), "the load hangs");
  delete fx.hold[events];
  await tick(70000);
  assert.ok(v.holdsRecorder(), "a holder whose load never ended loads again");
}

// R6/R16. A start cut off before its end refuses the same words, and starts that Eye, only for a while.
{
  const { v, cx, fx } = await copy();
  fx.hold = { [`${TOWER}/config.json`]: never() };
  const replies = [];
  const start = () => {
    const n = replies.length;
    v.startTask(cx, { id: "r1", machine: null }, "made-up words", null, { reply: (a) => replies.push(a) });
    return replies.slice(n).some((a) => /still starting/.test(a.why ?? ""));
  };
  assert.ok(!start());
  await settle();
  assert.ok(start(), "refused while the first may still be starting");
  v.startEye(cx, "work");
  await settle();
  assert.ok(v.eyeStarting("work"));
  clock += 3 * 60000;
  assert.ok(!start(), "not for good");
  assert.ok(!v.eyeStarting("work"), "the Eye neither");
}

// R7. A recorder step cut off is taken again: its event is recorded and written.
{
  const { v, cx, tick } = await copy();
  await tick(2000);
  assert.ok(v.holdsRecorder());
  const t = term("r7");
  const all = [{ key: "k-r7", taskId: "k-r7", lead: t, live: [t], title: "Made-up r7" }];
  const spinning = { ...t, get status() { for (;;) {} } };
  assert.ok(cut(() => v.recordTick([spinning], all, clock, [], null, cx)));
  v.recDirty = false;
  v.recordTick([t], all, clock, [], null, cx);
  assert.ok(v.rec.events.some((e) => e.a === "r7" && e.s === "working"), "recorded");
  assert.ok(v.recDirty, "and to be written");
}

// R8. A change tracked by a track cut off before it was published is published by the next one.
{
  const { v, fx } = await copy();
  const a = term("t8a");
  const b = { ...term("t8b"), get status() { for (;;) {} } };
  assert.ok(cut(() => v.track([...fx.fixture.terms, a, b], clock, null)));
  v.track([...fx.fixture.terms, a], clock, null);
  assert.ok(changed(fx).includes("t8a"));
}

// R13. A lease whose renewal never settles is not held past the lease; one that slept with nothing
//      pending still is.
{
  let now = 1000;
  let stall = false;
  const files = {};
  const io = { read: (p) => (stall ? never() : Promise.resolve(files[p] ?? null)), write: (p, text) => (stall ? never() : Promise.resolve((files[p] = text))) };
  const keeper = model.leaseKeeper({ path: "/l", id: "me", now: () => now, ms: 20000, ...io });
  assert.ok(await keeper.take());
  now = 300000;
  assert.ok(keeper.held(), "slept, nothing pending");
  assert.ok(await keeper.take());
  stall = true;
  now = 310000;
  keeper.take();
  now = 321000;
  assert.ok(!keeper.held(), "a renewal stuck past the lease");
}

// A job stopped by an ordinary throw here rejects with nobody to catch it, as in Herdr: not a test failure.
process.on("unhandledRejection", (e) => {
  if (e?.message !== "stopped") throw e;
});
// Timeline: its module state is shared, so each case uses a folder of its own.
const tl = await import("./mods/agent-tower/timeline.js");

// R1. A task file load that never ended is read again once its mark lapses.
{
  await copy();
  const dir = "/made/up/tl1";
  let reads = 0;
  const index = JSON.stringify({ tasks: { k1: { file: "tasks/k1.json", from: 0, until: clock } }, gaps: [] });
  const read = (p) => (p.endsWith("index.json") ? Promise.resolve(index) : (reads++, never()));
  const call = () => tl.longPast(dir, { start: 0, now: clock, long: true, read });
  call();
  await settle();
  call();
  await settle();
  assert.equal(reads, 1);
  clock += 3 * 60000;
  call();
  await settle();
  assert.equal(reads, 2, "read again");
}

// R4. An index reload that stopped half-way (here an ordinary throw, which skips the same tail) is
//     done again on the next reload: the loaded file is cut by the new gaps.
{
  const { fx } = await copy();
  const dir = "/made/up/tl2";
  let index = JSON.stringify({ tasks: { k2: { file: "tasks/k2.json", from: 0, until: clock } }, gaps: [] });
  const read = (p) => Promise.resolve(p.endsWith("index.json") ? index : JSON.stringify({ lanes: {} }));
  let prepared = 0;
  const call = () => tl.longPast(dir, { start: 0, now: clock, long: true, read, prepare: () => prepared++ });
  call();
  await settle();
  const file = call().files.k2;
  await settle();
  assert.ok(call().files.k2 ?? file);
  const data = call().files.k2;
  const lanes = data.lanes;
  data.lanes = new Proxy({}, { ownKeys() { throw new Error("stopped"); } });
  index = JSON.stringify({ tasks: { k2: { file: "tasks/k2.json", from: 0, until: clock } }, gaps: [{ m: "herdr", from: 1, to: 2 }] });
  fx.shared["agent-tower.recorded"] = 1;
  call();
  await settle();
  data.lanes = lanes;
  prepared = 0;
  fx.shared["agent-tower.recorded"] = 2;
  call();
  await settle();
  assert.equal(prepared, 1, "the loaded file is cut again by the reload that follows");
  assert.equal(call().index.gaps.length, 1);
}

// R10. Backfill entries written by a job that stopped half-way are seen by the transcripts index.
{
  const { fx } = await copy();
  const dir = "/made/up/tl3";
  fx.files["/made/up/app/mods/agent-tower-panel/read.py"] = "made-up script";
  tl.backfill(dir, [], () => null, clock, () => null);
  await settle();
  const task = { lanes: [], folded: [] };
  assert.deepEqual(tl.forgottenLanes(task, "q1", tl.fillCache()), []);
  const good = { session: "s1", task: "q1", program: "claude", path: "/made/up/s1.jsonl", first: 100, last: 200, turns: [{ start: 100, end: 200 }] };
  const bad = { session: "s2", task: "q1", program: "claude", path: "/made/up/s2.jsonl", first: 100, last: 200, turns: 5 };
  fx.py = () => ({ code: 0, stdout: JSON.stringify({ now: 1000, tasks: [good, bad] }), stderr: "" });
  tl.findForgotten(dir, { machines: [""], ids: ["q1"], now: clock, since_s: 3600, onLoad: () => null });
  await settle();
  fx.py = null;
  assert.equal(tl.forgottenLanes(task, "q1", tl.fillCache()).length, 1);
}

// R5. The panel's read of screens.json that never ended is asked again after 30 s.
{
  await copy();
  const { default: Panel } = await import("./mods/agent-tower-panel/main.js");
  const screens = `${TOWER}/timeline/screens.json`;
  let reads = 0;
  globalThis.__fx.hold = new Proxy({}, { get: (_, k) => (k === screens ? (reads++, never()) : undefined) });
  const p = Object.create(Panel.prototype);
  const pcx = { spawn(f) { Promise.resolve().then(() => f(pcx)).catch(() => {}); }, notify() {} };
  const moment = { screen: "a1@1", to: 5 };
  p.screenOf(moment, pcx);
  await settle();
  p.screenOf(moment, pcx);
  await settle();
  assert.equal(reads, 1);
  clock += 31000;
  p.screenOf(moment, pcx);
  await settle();
  assert.equal(reads, 2, "asked again");
}

// R12. The watchlist's notes and the text they come from are kept together (an ordinary throw at the
//      notes stands in for a cut there).
{
  await copy();
  const w = await import("./mods/agent-tower/watchlist.js");
  globalThis.__fx.files["/made/up/w/watchlist.json"] = JSON.stringify({ tickers: [] });
  globalThis.__fx.files["/made/up/w/investing-notes.md"] = "one\n";
  let fail = true;
  const state = new Proxy({}, { set(o, k, v) { if (k === "notes" && fail) { fail = false; throw new Error("stopped"); } o[k] = v; return true; } });
  const ui = { state, now: clock, towerDir: "/made/up/w", notify() {} };
  await w.load(ui);
  ui.now += 60000;
  await w.load(ui);
  assert.equal(state.notes, "one");
}
// R17. A cut-off render is drawn again within a quarter of a second (Herdr's banner stays until it
//      is): every copy with a clock asks once per cut (the cut one can't be told apart) on its 250 ms
//      tick, and at most once a second.
{
  // Made in this order so the copies' shared fixture ends with the list's props.
  const s = await copy({}, { props: { stage: true } });
  const a = await copy();
  const b = await copy();
  const asked = (c) => {
    let n = 0;
    c.cx.notify = () => n++;
    return () => [n, (n = 0)][0];
  };
  const [na, nb, ns] = [asked(a), asked(b), asked(s)];
  // A copy's first ticks may redraw once for cuts from before it started.
  const quarter = async () => {
    await a.fire(250);
    await b.fire(250);
    await s.fire(250);
  };
  await quarter();
  clock += 1000;
  [na, nb, ns].forEach((n) => n());
  b.fx.spin = true;
  assert.ok(cut(() => a.v.render(a.cx)), "the render was cut off");
  b.fx.spin = false;
  await a.fire(250);
  assert.equal(na(), 1, "the list asks within a quarter of a second");
  await b.fire(250);
  await s.fire(250);
  assert.deepEqual([nb(), ns()], [1, 1], "each copy asks for a redraw");
  await quarter();
  assert.deepEqual([na(), nb(), ns()], [0, 0, 0], "no new cut: none");
  // Every render cut (each next render's start counts the cut before): the stage's and the list's
  // 250 ms ticks ask once a second, not four times.
  for (const [c, n] of [[s, ns], [a, na]]) {
    clock += 1000;
    const counts = [];
    for (let i = 0; i < 8; i++) {
      b.fx.spin = true;
      assert.ok(cut(() => a.v.render(a.cx)));
      b.fx.spin = false;
      await c.fire(250);
      counts.push(n());
    }
    assert.ok(counts.every((x, i) => counts.slice(Math.max(0, i - 3), i + 1).reduce((p, q) => p + q, 0) <= 1), `at most once a second: ${counts}`);
    assert.ok(counts.filter(Boolean).length >= 2, `but again while cuts go on: ${counts}`);
  }
}

// R18. The 1 s tick clears a cut render's frame before its reads: a terminal started 60 ms after the
//      cut, before any 250 ms tick, is tracked by that tick (the dead frame's list doesn't answer).
{
  const { v, cx, fire, fx } = await copy();
  fx.spin = true;
  assert.ok(cut(() => v.render(cx)));
  fx.spin = false;
  fx.fixture.terms.push(term("t7"));
  clock -= 940; // fire(1000) adds 1000: the tick runs 60 ms after the cut
  await fire(1000);
  assert.ok(changed(fx).includes("t7"), `the new terminal is tracked: ${changed(fx)}`);
}

// F1-F3 (build2/cut-facts.md): the perf log says where a draw's time went.
const perfAll = (fx) => fx.execArgs.filter((a) => a[2] === "perf").map((a) => a[4]).join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
// F1. A list draw's line carries the model pass inside it and what made it run; 0 when none ran.
{
  const { v, cx, fire, fx } = await copy({ ...PERF });
  v.render(cx);
  v.render(cx); // nothing new: the model is reused
  fx.fixture.terms.push(term("t9"));
  v.render(cx);
  await fire(30000);
  const draws = perfAll(fx).filter((l) => l.view === "list").slice(-2);
  assert.deepEqual(draws.map((l) => [l.model > 0, l.why ?? null]), [[false, null], [true, "terminals"]], JSON.stringify(draws));
  assert.equal(draws[0].model, 0);
}
// F2. A cut line says which render was cut (list, stage) and how far it got.
{
  const s = await copy({ ...PERF }, { props: { stage: true } });
  s.fx.spin = true;
  assert.ok(cut(() => s.v.render(s.cx)));
  s.fx.spin = false;
  await s.fire(250);
  const l = await copy({ ...PERF });
  l.fx.spin = true;
  assert.ok(cut(() => l.v.render(l.cx)));
  l.fx.spin = false;
  await l.fire(250);
  await l.fire(30000);
  const cuts = perfLines(l.fx).slice(-2);
  assert.deepEqual(cuts.map((c) => [c.view, c.step]), [["stage", "reads"], ["list", "reads"]], JSON.stringify(cuts));
}
// F3. The 1 s tick running more than 300 ms late writes how late; on time, nothing.
{
  const { second, fire, fx } = await copy({ ...PERF });
  await second();
  await second();
  clock += 700;
  await second();
  await fire(30000);
  assert.deepEqual(perfAll(fx).filter((l) => l.what === "tick late").map((l) => l.ms), [700]);
}
console.log("cutoff ok");
