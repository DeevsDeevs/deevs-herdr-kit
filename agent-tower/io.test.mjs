// The list's inbox and recorder under the races a review found (rdz01 review-cache-core.md 1-3): a
// request whose batch could not be read is read on the next tick; a copy that went without closing
// holds neither lease past 20 s; a takeover reads the record again and draws no "Herdr was closed".
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const stubs = join(here, "io-stubs.mjs");
registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: new URL(`file://${stubs}`).href, shortCircuit: true } : next(s, c)) });

let clock = Date.UTC(2026, 10, 15, 12);
Date.now = () => clock;
const TOWER = "/made/up/app/agent-tower";
const INBOX = `${TOWER}/inbox`;
const OUTBOX = `${TOWER}/outbox`;
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

function world(files = {}) {
  globalThis.__fx = { files, shared: {}, elements: 0, calls: 0, props: {}, execs: [], watchers: [], failFind: 0, active: true,
    fixture: { terms: [], agents: [], spaces: [], machines: [] },
    layout: { id: "root", children: [{ id: "sidebar", size: { px: 320 } }, { id: "work-view", active: "main", children: [{ id: "main" }, { id: "tower-stage" }] }] } };
  return globalThis.__fx;
}

async function copy() {
  const { default: AgentTasks } = await import("./mods/agent-tower/main.js");
  const timers = [];
  let notified = 0;
  const cx = { focus_handle: () => ({ focus() {} }), notify() { notified++; }, stop_propagation() {},
    spawn(f) { Promise.resolve().then(() => f(cx)).catch(() => {}); },
    timer: { every: (ms, f) => (timers.push({ ms, f, next: clock + ms }), { cancel() {} }), after: () => ({ cancel() {} }) } };
  const v = new AgentTasks();
  v.init({}, cx);
  await settle();
  v.render(cx);
  await settle();
  // The clock moves on; the leases' and the recorder's timers run when due, as Herdr would run them.
  const tick = async (ms = 5000) => {
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
  // A watch batch for the inbox, as watchFolder gives it.
  const batch = async (paths) => {
    const w = globalThis.__fx.watchers.splice(0).filter((x) => x.dir === INBOX);
    for (const x of w) x.ok(paths);
    await settle();
  };
  return { v, cx, tick, batch, notified: () => notified };
}
const request = (fx, id) => {
  fx.files[`${INBOX}/${id}.json`] = JSON.stringify({ recipe: "no-such-recipe", words: "made-up words", at: clock });
  return `${INBOX}/${id}.json`;
};
const answered = (fx, id) => fx.files[`${OUTBOX}/${id}.json`] ?? null;

// 1. A batch whose find failed is not lost: the holder reads the whole folder on its next tick.
{
  const fx = world();
  const { tick, batch } = await copy();
  assert.match(fx.files[`${TOWER}/inbox.lease`], /"id"/, "the list holds the inbox lease");
  fx.failFind = 1;
  const p = request(fx, "req-1");
  await batch([p]);
  assert.equal(answered(fx, "req-1"), null, "the batch's read failed");
  await tick();
  assert.match(answered(fx, "req-1"), /no recipe/, "read on the next tick");
  // An idle inbox does nothing: no find, no read, on ticks with nothing new (the lease renews).
  await tick();
  fx.execs.length = 0;
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(fx.execs.filter((c) => c === "find"), [], "idle: no find");
  // A batch with only other files (a dotfile, a removal) reads nothing.
  await batch([`${INBOX}/.req-9.json.tmp`]);
  assert.deepEqual(fx.execs.filter((c) => c === "find"), []);
}

// 3. A copy that went without closing: its lease blocks for at most 20 s, then requests are read.
{
  const fx = world({ [`${TOWER}/inbox.lease`]: JSON.stringify({ id: "gone", at: clock }) });
  const { tick, batch } = await copy();
  const p = request(fx, "req-2");
  await batch([p]);
  assert.equal(answered(fx, "req-2"), null, "the gone copy's lease still holds");
  await tick(5000);
  await tick(5000);
  await tick(5000);
  assert.equal(answered(fx, "req-2"), null);
  await tick(16000);
  assert.match(answered(fx, "req-2"), /no recipe/, "free after 20 s, taken at the next 10 s look (about 30 s at most), then the folder is read");
  assert.ok(clock - JSON.parse(fx.files[`${TOWER}/inbox.lease`]).at <= 5000, "and holds it now");
}

// 2. The recorder after a reload: the gone copy's lease is taken within 20 s, the record is read
// again at the takeover (with a beat written after this copy started), and no gap is drawn.
{
  const T = clock;
  const events = { v: 1, beat: T - 600e3, lanes: {}, events: [], looks: [], gaps: [] };
  const fx = world({
    [`${TOWER}/recorder.lease`]: JSON.stringify({ id: "gone", at: T - 5000 }),
    [`${TOWER}/timeline/events.json`]: JSON.stringify(events),
  });
  const { v, cx, tick } = await copy();
  assert.equal(v.holdsRecorder(), false, "not while the gone copy's lease is fresh");
  // The gone copy renewed once more before it went, and wrote to the record.
  fx.files[`${TOWER}/recorder.lease`] = JSON.stringify({ id: "gone", at: clock });
  fx.files[`${TOWER}/timeline/events.json`] = JSON.stringify({ ...events, lanes: { x: { task: "agent:x" } } });
  await tick(40000);
  assert.equal(v.holdsRecorder(), false);
  await tick(25000);
  assert.equal(v.holdsRecorder(), true, "taken within a minute of the last renewal");
  assert.ok(v.rec.lanes.x, "the record read again at the takeover");
  v.render(cx);
  assert.deepEqual(v.rec.gaps.filter((g) => g.m === "herdr"), [], "renewed until a minute ago: no false Herdr gap");
  // Closing hands it over at once.
  await v.close();
  assert.equal(fx.files[`${TOWER}/recorder.lease`], "null");
}
// An idle minute asks Herdr for nothing: no redraw, no shared write; the leases cost a few writes
// and no reads (each holder renews by writing alone).
{
  const fx = world();
  const { tick, notified } = await copy();
  await tick(30000);
  const n0 = notified();
  const e0 = fx.execs.length;
  const shared0 = fx.sharedSet ?? 0;
  const files = fx.files;
  const lease = (p) => p.endsWith(".lease");
  const snap = () => Object.fromEntries(Object.entries(files).filter(([p]) => lease(p)));
  let last = snap();
  let leaseWrites = 0;
  for (let i = 0; i < 12; i++) {
    await tick(5000);
    const now = snap();
    for (const p of Object.keys(now)) if (now[p] !== last[p]) leaseWrites++;
    last = now;
  }
  assert.equal(notified() - n0, 0, "no redraw asked for");
  assert.equal((fx.sharedSet ?? 0) - shared0, 0, "no shared write");
  assert.ok(leaseWrites <= 9, `lease writes in a minute: ${leaseWrites}`);
  assert.deepEqual(fx.execs.slice(e0), [], "no command at all");
}
// The Eye's composer by area: words typed for one area's Eye come back only in that area, after an
// in-place switch and after a restart (a layout switch), and never go to another area's Eye.
{
  const config = JSON.stringify({ areas: [{ id: "Work", label: "Work" }, { id: "Personal", label: "Personal", default: true }] });
  const fx = world({ [`${TOWER}/config.json`]: config });
  fx.shared["agent-tower.area"] = "Personal";
  fx.shared["agent-tower.draft"] = { area: "Work", text: "", eyeText: "for work", at: clock };
  const { v, cx } = await copy();
  assert.equal(v.eyeInput.value(), "", "Work's words don't show in Personal");
  v.eyeInput.set_value("for personal");
  v.switchArea("Work");
  v.render(cx);
  assert.equal(v.eyeInput.value(), "for work", "Work's words come back in Work");
  v.switchArea("Personal");
  v.render(cx);
  assert.equal(v.eyeInput.value(), "for personal", "and Personal's in Personal");
  // A restart (a layout switch) keeps them for their area.
  v.composing = true;
  await v.close();
  const draft = fx.shared["agent-tower.draft"];
  assert.deepEqual([draft.area, draft.eyeText], ["Personal", "for personal"]);
}
// Earlier is open by default and opened once for folds kept from before; its fold is the shown
// area's own (closing Work's leaves Personal's open), and a close is kept.
{
  const config = JSON.stringify({ areas: [{ id: "Work", label: "Work" }, { id: "Personal", label: "Personal", default: true }] });
  world({ [`${TOWER}/config.json`]: config });
  const one = await copy();
  assert.ok(![...one.v.folded].some((f) => f.startsWith("earlier")), "open by default");
  assert.ok(one.v.folded.has("spaces"), "the other folds as before");
  const fx = world({ [`${TOWER}/config.json`]: config });
  fx.shared["agent-tower.area"] = "Work";
  fx.shared["agent-tower.folds"] = { folded: ["spaces", "earlier", "done-more", "leftover"], opened: [] };
  const two = await copy();
  assert.ok(![...two.v.folded].some((f) => f.startsWith("earlier")), "folded from before: opened once");
  two.v.folded.add(two.v.foldId("earlier"));
  two.v.render(two.cx);
  assert.ok(fx.shared["agent-tower.folds"].folded.includes("earlier:Work"), "closed in Work, kept as Work's");
  two.v.switchArea("Personal");
  assert.equal(two.v.foldId("earlier"), "earlier:Personal");
  assert.ok(!two.v.folded.has(two.v.foldId("earlier")), "Personal's Earlier stays open");
  const three = await copy();
  assert.ok(three.v.folded.has("earlier:Work"), "a close is kept in the next copy");
}
// Earlier with old quiet tasks: its own scroll area under a fixed header while open; every row on
// another machine shows the machine glyph, whatever its title's length; tooltips stay quiet while
// the list scrolls and while a row's menu is open.
{
  const fx = world();
  const old = clock - 5 * 86400e3;
  const lead = (address, id, title) => ({ address, state: "live", status: "idle", turn: 0, program: { agent: true, name: "Claude Code" },
    labels: { "task.id": id, "task.role": "lead", "task.title": title } });
  fx.fixture.terms = [lead("vps/t1", "e1", "A short one"), lead("vps/t2", "e2", "A much longer title that the row has to cut somewhere"), lead("t3", "e3", "Here")];
  fx.fixture.agents = [];
  fx.shared["agent-tower.changes"] = Object.fromEntries(fx.fixture.terms.map((t) => [t.address, { word: "idle", turn: 0, at: old, had: true }]));
  const { v, cx } = await copy();
  fx.ids = new Set();
  fx.tips = [];
  v.render(cx);
  assert.ok(fx.ids.has("at-earlier"), "an open Earlier scrolls in its own area");
  assert.ok(fx.ids.has("at-mg-task:e1") && fx.ids.has("at-mg-task:e2") && !fx.ids.has("at-mg-task:e3"), "the glyph on every row on another machine, none here");
  assert.ok(fx.tips.some(([id]) => id === "at-mg-task:e1"), "with the machine in its tooltip");
  v.folded.add(v.foldId("earlier"));
  fx.ids = new Set();
  v.render(cx);
  assert.ok(!fx.ids.has("at-earlier"), "folded: one list as before");
  v.folded.delete(v.foldId("earlier"));
  v.quietTips(cx);
  fx.tips = [];
  v.render(cx);
  assert.deepEqual(fx.tips.filter(([id]) => /^at-(title|mg)-/.test(id ?? "")), [], "no row tooltip while the list scrolls");
  v.tipsQuiet = false;
  v.menuFor = "task:e2";
  v.menuAt = Date.now();
  assert.equal(v.tipFor("task:e2"), false, "nor on the row whose menu is open");
  clock += 11000;
  assert.equal(v.tipFor("task:e2"), true, "back after ten seconds at most");
}
// A task whose lead has no pane: the first click gives the lead a real tab (a new space on its
// machine, named after the task, then shown), not a peek; a click while it comes asks nothing more;
// once it has its pane, a click goes there.
{
  const fx = world();
  fx.fixture.terms = [{ address: "t1", state: "live", status: "working", turn: 1, program: { agent: true, name: "Claude Code" },
    labels: { "task.id": "e1", "task.role": "lead", "task.title": "Made-up task" } }];
  fx.fixture.agents = [{ address: "t1", status: "working", pane: null }];
  const { v, cx } = await copy();
  const click = async () => {
    fx.shared["agent-tower.act"] = { action: "enter", key: "task:e1", how: "click", at: clock };
    v.render(cx);
    await settle();
  };
  fx.log = [];
  fx.hcCalls = [];
  await click();
  const label = fx.hcCalls.find((a) => a[0] === "label" && a[1] === "t1");
  assert.ok(label?.some((x) => /^herdr\.space=sp/.test(x)) && label.some((x) => /^herdr\.tab=tb/.test(x)), "first click: a new space and tab for the lead");
  assert.ok(!fx.log.some((x) => x.what === "openOverlay"), "no peek");
  await click();
  assert.equal(fx.hcCalls.filter((a) => a[0] === "label").length, 1, "a click while the tab comes asks nothing more");
  // Herdr adopts it: the new space with the lead's tab and pane.
  const sp = label.find((x) => x.startsWith("herdr.space=")).split("=")[1];
  const tb = label.find((x) => x.startsWith("herdr.tab=")).split("=")[1];
  fx.fixture.terms[0].labels = { ...fx.fixture.terms[0].labels, "herdr.space": sp, "herdr.tab": tb };
  fx.fixture.spaces = [{ id: sp, name: "1", machine: null, active: false, tabs: [{ id: tb, named: false }] }];
  fx.fixture.agents = [{ address: "t1", status: "working", pane: "p1" }];
  fx.log = [];
  v.render(cx);
  assert.ok(fx.log.some((x) => x.what === "run space.rename") && fx.log.some((x) => x.what === "run space.select"), "the new space is named and shown");
  fx.log = [];
  fx.hcCalls = [];
  await click();
  assert.ok(fx.log.some((x) => x.what === "run pane.focus"), "second click goes to it");
  assert.ok(!fx.log.some((x) => x.what === "openOverlay") && !fx.hcCalls.some((a) => a[0] === "label"), "no peek, no new tab");
}
console.log("io ok");
