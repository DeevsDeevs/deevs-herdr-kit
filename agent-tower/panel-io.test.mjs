// node panel-io.test.mjs: the Details card's commands on the perf fixture (perf/). Reads have a
// floor however fast a task changes, nothing runs while Herdr is in the background, the rarely
// changing parts (ended members, the chain link) are read less often, and the kept screens file is
// read again only when it can hold something new. A change inside the floor is read at its end; a
// member that ends, or a lead that stops, brings its list or chain link at once. Each check also proves the result still updates.
// gpui-kit, gpui-base and herdr are perf/mod-stubs.mjs.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

setTimeout(() => {
  console.error("panel-io.test.mjs took over 60 s");
  process.exit(1);
}, 60000).unref();
const stubs = new URL("./perf/mod-stubs.mjs", import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: stubs, shortCircuit: true } : next(s, c)) });
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
const { buildFixture, TOWER } = await import("./perf/big-fixture.mjs");
const { benchMods } = await import("./perf/mods-bench.mjs");
const kit = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const fixture = buildFixture("mac");
const settle = () => new Promise((r) => setTimeout(r, 0));
const panelCase = { mod: "agent-tower-panel", props: {}, busy: true };
const chainOf = (inst) => [...inst.cache.values()].flatMap((i) => Object.values(i.machines)).map((st) => st.data?.chain).find(Boolean) ?? null;
const count = (row, what) => Object.entries(row.idle.commands).filter(([k]) => k.startsWith(what)).reduce((n, [, v]) => n + v, 0);

const [busy, longer, back] = await benchMods({ kit, fixture, clock: () => performance.now(), settle, runs: 1, cases: [
  { case: "busy minute", ...panelCase },
  { case: "busy six minutes", ...panelCase, seconds: 360, after: (inst) => chainOf(inst) },
  { case: "background, then back after 30 s", ...panelCase, active: false, activeAt: 30, after: (_inst, fx) => fx.log.filter((l) => l.what.startsWith("exec read.py")).map((l) => l.at) },
] });

// A task whose agents change every second: a read at most every READ_FLOOR_MS (it was one a second),
// and still at least one per floor, so the card keeps up.
const reads = count(busy, "exec read.py");
assert.ok(reads >= 3 && reads <= 5, `reads in a busy minute: ${reads}`);
assert.ok(count(busy, "hc ls --all") <= 1, "ended members: at most once per LIST_EVERY_MS");
// Over six minutes: ended members read again every 2 min, the chain link every 5 min, and the link
// stays shown between its reads.
const lists = count(longer, "hc ls --all");
assert.ok(lists >= 2 && lists <= 4, `hc ls --all in six minutes: ${lists}`);
const chains = count(longer, "exec read.py panel +chain");
assert.ok(chains >= 1 && chains <= 2, `chain reads in six minutes: ${chains}`);
assert.match(longer.after?.title ?? "", /^Link of /, "the last link read stays while the next reads skip it");
// In the background nothing is read; back in front, the card reads within the floor.
const backAt = fixture.now + 30000;
assert.ok(back.after.length >= 1, "back in front: read again");
assert.ok(back.after.every((at) => at >= backAt), "nothing read while Herdr was in the background");

// Three seconds after a read, something changes on the shown task. The card must follow at the
// floor's end (15 s), not at the next 30 s redraw, and not 2 minutes later.
const sel = (fx) => fx.shared["agent-tower.selected"];
const timesOf = (fx, what) => fx.log.filter((l) => l.what.startsWith(what)).map((l) => ({ at: l.at - fixture.now, what: l.what }));
let gone = null;
const [stopped, ended] = await benchMods({ kit, fixture, clock: () => performance.now(), settle, runs: 1, cases: [
  { case: "the lead stops", mod: "agent-tower-panel", props: {}, seconds: 40,
    events: { 3: (fx) => {
      const lead = fx.fixture.terms.find((t) => t.address === sel(fx).lead);
      Object.assign(lead, { status: "idle", turn: lead.turn + 1, status_ms: Date.now() });
    } },
    after: (_inst, fx) => timesOf(fx, "exec read.py") },
  { case: "a worker ends and Herdr drops it", mod: "agent-tower-panel", props: {}, seconds: 40,
    events: { 3: (fx) => {
      const w = fx.fixture.terms.find((t) => t.labels?.["task.id"] === sel(fx).ids[0] && t.labels?.["task.role"] === "worker" && t.state === "live");
      gone = w.address;
      fx.fixture.terms = fx.fixture.terms.filter((t) => t !== w);
      fx.fixture.gone = [{ ...w, state: "ended", status: "done" }];
    } },
    after: (inst, fx) => ({ lists: timesOf(fx, "hc ls --all"), ended: [...inst.cache.values()].flatMap((i) => (i.ended ?? []).map((t) => t.address)) }) },
] });
const firstRead = stopped.after.find((r) => r.at > 3000);
assert.ok(firstRead && firstRead.at <= 17000, `a change 3 s after a read is read at the floor's end: ${JSON.stringify(stopped.after)}`);
assert.match(firstRead.what, /\+chain/, "the lead stopped: its chain link is read with it, not 5 minutes later");
const firstList = ended.after.lists.find((r) => r.at > 3000);
assert.ok(firstList && firstList.at <= 17000, `a member gone from terminals(): ended members listed again: ${JSON.stringify(ended.after.lists)}`);
assert.ok(ended.after.ended.includes(gone), "the card still has the worker that ended");

// The kept screens: read once for every moment it holds; read again only for a screen it lacks, and
// only after the recorder wrote (agent-tower.recorded).
{
  const fx = (globalThis.__fx = { fixture, files: { ...fixture.files }, shared: { "agent-tower.recorded": 1 }, props: {}, layout: {}, log: [], elements: 0, calls: 0 });
  const { default: Panel } = await import("./mods/agent-tower-panel/main.js");
  const p = new Panel();
  const cx = { notify() {}, spawn: (f) => void Promise.resolve().then(() => f(cx)), focus_handle: () => ({}), timer: { every() {}, after() {} } };
  p.init({}, cx);
  const path = `${TOWER}/timeline/screens.json`;
  const screens = JSON.parse(fixture.files[path]);
  const [k1, k2] = Object.keys(screens);
  const at = (screen) => ({ screen, to: 1 });
  const reads = () => fx.log.filter((l) => l.what === "read timeline/screens.json").length;
  assert.equal(p.screenOf(at(k1), cx), undefined, "reading");
  for (let i = 0; i < 3; i++) await settle();
  assert.equal(p.screenOf(at(k1), cx), screens[k1]);
  assert.equal(p.screenOf(at(k2), cx), screens[k2], "another moment from the same file");
  assert.equal(p.screenOf(at("t9@1"), cx), null, "not in the file, and the file has not changed");
  assert.equal(reads(), 1);
  fx.files[path] = JSON.stringify({ ...screens, "t9@1": "a new screen" });
  fx.shared["agent-tower.recorded"] = 2;
  assert.equal(p.screenOf(at("t9@1"), cx), undefined, "the recorder wrote: read again");
  for (let i = 0; i < 3; i++) await settle();
  assert.equal(p.screenOf(at("t9@1"), cx), "a new screen");
  assert.equal(reads(), 2);
}
console.log("panel-io ok");
