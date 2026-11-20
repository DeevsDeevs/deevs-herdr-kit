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
// io-stubs, with agents() and watch reads that spin while fx.spin is set (where the cut lands).
const stubs = `data:text/javascript,${encodeURIComponent(`
import * as s from ${JSON.stringify(io)};
export * from ${JSON.stringify(io)};
export const agents = () => { if (globalThis.__fx.spin) for (;;) {} return s.agents(); };
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

async function copy(files = {}) {
  globalThis.__fx = { files, shared: {}, elements: 0, calls: 0, props: {}, execs: [], execArgs: [], watchers: [], failFind: 0, active: true,
    fixture: { terms: [term("t1")], agents: [], spaces: [], machines: [] },
    layout: { id: "root", children: [{ id: "sidebar", size: { px: 320 } }, { id: "work-view", active: "main", children: [{ id: "main" }, { id: "tower-stage" }] }] } };
  const timers = [];
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {},
    spawn(f) { Promise.resolve().then(() => f(cx)).catch(() => {}); },
    timer: { every: (ms, f) => (timers.push({ ms, f }), { cancel() {} }), after: () => ({ cancel() {} }) } };
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
  return { v, cx, second: () => fire(1000), fire, fx: globalThis.__fx };
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
console.log("cutoff ok");
