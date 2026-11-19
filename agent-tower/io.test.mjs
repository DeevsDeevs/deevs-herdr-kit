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

async function copy({ draw = true } = {}) {
  const { default: AgentTasks } = await import("./mods/agent-tower/main.js");
  const timers = [];
  let notified = 0;
  const cx = { focus_handle: () => ({ focus() {} }), notify() { notified++; }, stop_propagation() {},
    spawn(f) { Promise.resolve().then(() => f(cx)).catch(() => {}); },
    timer: { every: (ms, f) => (timers.push({ ms, f, next: clock + ms }), { cancel() {} }), after: () => ({ cancel() {} }) } };
  const v = new AgentTasks();
  v.init({}, cx);
  await settle();
  if (draw) v.render(cx);
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
const agentTerm = (address, status, turn, labels = {}) => ({ address, state: "live", status, turn, program: { agent: true, name: "Claude Code" },
  labels: { "task.id": `k-${address}`, "task.role": "lead", "task.title": `Made-up task ${address}`, ...labels } });
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
// The same idle minute with a task whose names are already right: the naming pass (every 2 s)
// adds no hc call, no redraw and no shared write.
{
  const fx = world();
  fx.fixture.terms = [{ address: "t1", state: "live", status: "idle", program: { agent: true, name: "Claude Code" },
    labels: { "task.id": "i1", "task.role": "lead", "task.title": "Made-up idle task", "herdr.space": "sp1", "herdr.tab": "tb1",
      "tower.space-name": "Made-up idle task", "tower.tab-name": "lead" } }];
  fx.fixture.spaces = [{ id: "sp1", name: "Made-up idle task", named: true, machine: null, active: true, tabs: [{ id: "tb1", name: "lead", named: true }] }];
  const { v, cx, tick, notified } = await copy();
  v.render(cx);
  await tick(30000);
  const n0 = notified();
  const shared0 = fx.sharedSet ?? 0;
  fx.hcCalls = [];
  fx.log = [];
  await tick(60000);
  assert.equal(notified() - n0, 0, "no redraw asked for");
  assert.equal((fx.sharedSet ?? 0) - shared0, 0, "no shared write");
  // The machines' refresh (every 30 s, older than names) is the only hc call.
  assert.deepEqual(fx.hcCalls.filter((a) => a[0] !== "machine"), [], "no hc call from the naming pass");
  assert.deepEqual(fx.log.filter((x) => /^(run|notify)/.test(x.what)), [], "no command, no notification");
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
  const { v, cx, tick } = await copy();
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
  fx.hcCalls = [];
  v.render(cx);
  assert.ok(fx.log.some((x) => x.what === "run space.select"), "the new space is shown");
  // The naming pass (every 2 s): the task's title for the space, "lead" for its tab, each label first.
  await tick(2500);
  const named = fx.hcCalls.filter((a) => a[0] === "label").map((a) => a.slice(1).join(" "));
  assert.deepEqual(named, [`t1 tower.space-name=Made-up task`, `t1 tower.tab-name=lead`]);
  assert.ok(fx.log.some((x) => x.what === "run space.rename") && fx.log.some((x) => x.what === "run tab.rename"), "then renamed");
  fx.log = [];
  fx.hcCalls = [];
  await click();
  assert.ok(fx.log.some((x) => x.what === "run pane.focus"), "second click goes to it");
  assert.ok(!fx.log.some((x) => x.what === "openOverlay") && !fx.hcCalls.some((a) => a[0] === "label"), "no peek, no new tab");
}
// Names in Herdr's own screens: the inbox holder sets the names that are ours, each label first;
// a name someone typed afterwards is never set again; while the name is ours, it follows the title.
// tower-names' dry run changes nothing.
{
  const fx = world();
  const t1 = { address: "t1", state: "live", status: "idle", program: { agent: true, name: "Claude Code" },
    labels: { "task.id": "n1", "task.role": "lead", "task.title": "Made-up plan", "herdr.space": "sp1", "herdr.tab": "tb1" } };
  fx.fixture.terms = [t1];
  fx.fixture.spaces = [{ id: "sp1", name: "~", named: false, machine: null, active: true, tabs: [{ id: "tb1", name: "1", named: false }] }];
  const { v, cx, tick, batch } = await copy();
  const labelled = () => fx.hcCalls.filter((a) => a[0] === "label").map((a) => a.slice(1).join(" "));
  fx.hcCalls = [];
  fx.log = [];
  await tick(2500);
  assert.deepEqual(labelled(), ["t1 tower.space-name=Made-up plan", "t1 tower.tab-name=lead"]);
  assert.deepEqual(fx.log.filter((x) => x.what.startsWith("run ")).map((x) => x.what), ["run space.rename", "run tab.rename"]);
  // Herdr has them; then someone renames the space: it stays theirs.
  t1.labels = { ...t1.labels, "tower.space-name": "Made-up plan", "tower.tab-name": "lead" };
  fx.fixture.spaces = [{ id: "sp1", name: "My plan", named: true, machine: null, active: true, tabs: [{ id: "tb1", name: "lead", named: true }] }];
  fx.hcCalls = [];
  v.render(cx);
  await tick(2500);
  // The space no longer says the task, so its lead's tab (still ours) does; the space is left alone.
  assert.deepEqual(labelled(), ["t1 tower.tab-name=lead · Made-up plan"]);
  t1.labels = { ...t1.labels, "tower.tab-name": "lead · Made-up plan" };
  fx.fixture.spaces[0].tabs[0].name = "lead · Made-up plan";
  fx.hcCalls = [];
  v.render(cx);
  await tick(70000);
  assert.deepEqual(labelled(), [], "a typed name is never set again");
  // A space whose name is still ours follows a new title.
  t1.labels = { ...t1.labels, "tower.tab-name": "lead" };
  fx.fixture.spaces = [{ id: "sp1", name: "Made-up plan", named: true, machine: null, active: true, tabs: [{ id: "tb1", name: "lead", named: true }] }];
  t1.labels = { ...t1.labels, "task.title": "Better made-up plan" };
  v.render(cx);
  await tick(2500);
  assert.deepEqual(labelled(), ["t1 tower.space-name=Better made-up plan"]);
  // tower-names: a dry run answers with the mapping and changes nothing.
  fx.fixture.spaces = [{ id: "sp1", name: "My plan", named: true, machine: null, active: true, tabs: [{ id: "tb1", name: "Mine", named: true }] }];
  v.render(cx);
  fx.hcCalls = [];
  fx.files[`${INBOX}/req-names.json`] = JSON.stringify({ names: { apply: false, named: false }, at: clock });
  await batch([`${INBOX}/req-names.json`]);
  const a = JSON.parse(answered(fx, "req-names"));
  assert.ok(a.ok && a.text.includes('sp1  "My plan"  kept: "My plan"  |  with --named: "Better made-up plan"\n  tab tb1  "Mine"  kept: "Mine"  |  with --named: "lead"'), a.text);
  assert.deepEqual(labelled(), [], "a dry run labels nothing");
}
// tower-eye: start answers with the Eye's address once it is labelled; status lists each area.
{
  const fx = world();
  const { tick, batch } = await copy();
  fx.hcCalls = [];
  fx.files[`${INBOX}/req-eye.json`] = JSON.stringify({ eye: { do: "start", area: "personal" }, at: clock });
  await batch([`${INBOX}/req-eye.json`]);
  await settle();
  assert.equal(answered(fx, "req-eye"), null, "not before the Eye shows");
  fx.fixture.spaces = [{ id: "spE", name: "Eye · Personal", named: true, machine: null, active: true, tabs: [{ id: "tbE", name: "1", named: false }] }];
  fx.fixture.terms = [{ address: "t4", state: "live", status: "idle", program: { agent: true, name: "Claude Code" }, labels: { "herdr.space": "spE", "herdr.tab": "tbE" } }];
  await tick(2000);
  const a = JSON.parse(answered(fx, "req-eye"));
  assert.deepEqual([a.ok, a.address], [true, "t4"], JSON.stringify(a));
  assert.deepEqual(fx.hcCalls.find((x) => x[0] === "label"), ["label", "t4", "tower.eye=1", "tower.area=personal", "tower.space-name=Eye · Personal"]);
  fx.fixture.terms[0].labels = { ...fx.fixture.terms[0].labels, "tower.eye": "1", "tower.area": "personal" };
  fx.files[`${INBOX}/req-st.json`] = JSON.stringify({ eye: { do: "status" }, at: clock });
  await batch([`${INBOX}/req-st.json`]);
  assert.equal(JSON.parse(answered(fx, "req-st")).text, "Work: none\nPersonal: t4, idle");
}
// A start never names the space with the words typed: "New task" and "lead" at birth, recorded as ours
// in the lead's one label call, in a folder of its own (<taskRoot>/<slug>-<id>), never the shown space's;
// the space takes the namer's title when it comes.
{
  const fx = world();
  const { v, cx, tick, batch } = await copy();
  fx.runs = [];
  fx.made = [];
  fx.hcCalls = [];
  const words = "so garden plan task - i want to sort the seed list into a planting calendar we will share ";
  fx.files[`${INBOX}/req-new.json`] = JSON.stringify({ recipe: "personal-lead", words, at: clock });
  await batch([`${INBOX}/req-new.json`]);
  await settle();
  const a = JSON.parse(answered(fx, "req-new"));
  assert.ok(a.ok && a.starting, JSON.stringify(a));
  const [cmd, args] = fx.runs.find((r) => r[0] === "space.new");
  assert.equal(cmd, "space.new");
  assert.deepEqual([args.name, args.tab, args.folder], ["New task", "lead", `/home/me/tasks/so-garden-plan-task-${a.task}`]);
  assert.deepEqual(fx.made, [[null, `~/tasks/so-garden-plan-task-${a.task}`]], "made on the lead's machine");
  // Herdr makes it; the lead is labelled once it shows.
  fx.fixture.spaces = [{ id: "sp9", name: "New task", named: true, machine: null, active: true, tabs: [{ id: "tb9", name: "lead", named: true }] }];
  const t9 = { address: "t9", state: "live", status: "working", turn: 1, cwd: args.folder, program: { agent: true, name: "Claude Code" }, labels: { "herdr.space": "sp9", "herdr.tab": "tb9" } };
  fx.fixture.terms = [t9];
  await tick(1600);
  const label = fx.hcCalls.find((x) => x[0] === "label" && x[1] === "t9");
  assert.ok(label.includes("task.by=raw") && label.includes("tower.space-name=New task") && label.includes("tower.tab-name=lead"), label.join(" "));
  t9.labels = Object.fromEntries([...Object.entries(t9.labels), ...label.slice(2).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)])]);
  // The words are the title until the namer answers: nothing is renamed meanwhile.
  fx.hcCalls = [];
  fx.log = [];
  v.render(cx);
  await tick(2500);
  assert.deepEqual(fx.hcCalls.filter((x) => x[0] === "label"), [], "no name from the words");
  assert.ok(!fx.log.some((x) => /rename/.test(x.what)));
  // The namer's title: the space follows it at once.
  t9.labels = { ...t9.labels, "task.title": "Garden planting calendar", "task.by": "llm" };
  v.render(cx);
  await tick(2500);
  assert.deepEqual(fx.hcCalls.filter((x) => x[0] === "label").map((x) => x.slice(1).join(" ")), ["t9 tower.space-name=Garden planting calendar"]);
  // A folder that can't be made: no start, and never the shown space's folder.
  fx.noMkdir = true;
  fx.runs = [];
  fx.files[`${INBOX}/req-nofolder.json`] = JSON.stringify({ recipe: "personal-lead", words: "made-up words", at: clock });
  await batch([`${INBOX}/req-nofolder.json`]);
  await settle();
  assert.match(answered(fx, "req-nofolder"), /folder could not be made/);
  assert.deepEqual(fx.runs, []);
}
// A new lead inside a task whose lead has ended (its pane a shell now): a new "lead" tab in the
// task's own space, in its folder, with its task.id and title; the old lead becomes a shell; one row.
{
  const fx = world();
  const old = { address: "t1", state: "live", status: null, cwd: "/home/me/tasks/garden-plan-j1", program: { agent: false, name: "zsh" },
    labels: { "task.id": "j1", "task.role": "lead", "task.title": "Garden plan", "task.by": "llm", "task.recipe": "personal-lead", "task.area": "personal",
      "herdr.space": "sp1", "herdr.tab": "tb1", "tower.space-name": "Garden plan", "tower.tab-name": "lead" } };
  fx.fixture.terms = [old];
  fx.fixture.spaces = [{ id: "sp1", name: "Garden plan", named: true, machine: null, active: true, tabs: [{ id: "tb1", name: "lead", named: true }] }];
  const { v, cx, tick, batch } = await copy();
  fx.runs = [];
  fx.made = [];
  fx.hcCalls = [];
  fx.files[`${INBOX}/req-none.json`] = JSON.stringify({ recipe: "personal-lead", words: "made-up", task: "zz9", at: clock });
  await batch([`${INBOX}/req-none.json`]);
  assert.match(answered(fx, "req-none"), /there is no task \\"zz9\\"/);
  fx.files[`${INBOX}/req-join.json`] = JSON.stringify({ recipe: "personal-lead", words: "make a planting calendar", task: "j1", at: clock });
  await batch([`${INBOX}/req-join.json`]);
  await settle();
  const a = JSON.parse(answered(fx, "req-join"));
  assert.deepEqual([a.ok, a.task, a.as, a.starting], [true, "j1", "lead", true], JSON.stringify(a));
  assert.ok(!fx.runs.some((r) => r[0] === "space.new"), "no new task, no new space");
  const [, args] = fx.runs.find((r) => r[0] === "tab.new");
  assert.deepEqual([args.space, args.name, args.folder], ["sp1", "lead", "/home/me/tasks/garden-plan-j1"]);
  assert.deepEqual(fx.made, [], "the task's own folder");
  assert.ok(args.argv.includes("TOWER_TASK=j1") && args.task.includes('You are the new lead of task j1, "Garden plan"'), args.task);
  // Herdr makes the tab; the new lead is labelled, then the old one becomes a shell.
  fx.fixture.spaces[0].tabs.push({ id: "tb2", name: "lead", named: true });
  const t2 = { address: "t2", state: "live", status: "working", turn: 1, cwd: args.folder, program: { agent: true, name: "Claude Code" }, labels: { "herdr.space": "sp1", "herdr.tab": "tb2" } };
  fx.fixture.terms = [old, t2];
  await tick(1600);
  const labels = fx.hcCalls.filter((x) => x[0] === "label").map((x) => x.slice(1).join(" "));
  assert.deepEqual(labels, ["t2 task.id=j1 task.role=lead task.title=Garden plan task.by=llm task.recipe=personal-lead task.area=personal task.lead=claude-fable tower.tab-name=lead tower.space-name=Garden plan",
    "t1 task.role=shell"]);
  old.labels = { ...old.labels, "task.role": "shell" };
  t2.labels = { ...t2.labels, "task.id": "j1", "task.role": "lead", "task.title": "Garden plan", "task.by": "llm", "task.area": "personal", "tower.tab-name": "lead", "tower.space-name": "Garden plan" };
  fx.hcCalls = [];
  v.render(cx);
  assert.deepEqual(v.items.filter((i) => i.taskId === "j1").map((i) => i.lead.address), ["t2"], "one row, led by the new lead");
  // The naming pass: the old lead's tab is a shell's now; the space keeps the task's title.
  await tick(2500);
  assert.deepEqual(fx.hcCalls.filter((x) => x[0] === "label").map((x) => x.slice(1).join(" ")), ["t1 tower.tab-name=shell"]);
}
// The row menu's New lead, taken in a render (where Herdr's cx.notify throws): the composer opens on
// that task as its new lead, with the "in <title>" chip and lead | worker.
{
  const fx = world();
  fx.fixture.terms = [{ address: "t1", state: "live", status: "idle", program: { agent: true, name: "Claude Code" },
    labels: { "task.id": "g1", "task.role": "lead", "task.title": "Garden plan", "task.area": "personal", "task.recipe": "personal-lead" } }];
  const { v, cx } = await copy();
  fx.shared["agent-tower.request"] = { from: v.id, keys: ["task:g1"], action: "newLead" };
  v.render({ ...cx, notify() { throw new Error("cx.notify in a render"); } });
  assert.deepEqual([v.composing, v.composeTo, v.into, v.intoAs], [true, "lead", "g1", "lead"]);
  fx.ids = new Set();
  v.render(cx);
  assert.ok(["at-into", "at-into-lead", "at-into-worker"].every((id) => fx.ids.has(id)));
  // Rename from the menu, also taken in a render.
  fx.shared["agent-tower.request"] = { from: v.id, keys: ["task:g1"], action: "rename" };
  v.render({ ...cx, notify() { throw new Error("cx.notify in a render"); } });
  assert.equal(v.renaming, "task:g1");
}

// track-fix 1: a change tracked with no draw. The list is never drawn after its first frame (a
// covered window), yet a flip gets its time within the second, and the list is asked to redraw.
{
  const fx = world();
  fx.fixture.terms = [agentTerm("p1", "working", 0)];
  const { tick, notified } = await copy();
  await tick(3000);
  const n0 = notified();
  const flipped = clock;
  fx.fixture.terms = [agentTerm("p1", "done", 1)];
  await tick(1000);
  const c = fx.shared["agent-tower.changes"].p1;
  assert.deepEqual([c.word, c.turn], ["done", 1], "tracked without a draw");
  assert.ok(c.at - flipped <= 1000, `its time is the flip's, within a second: ${c.at - flipped} ms`);
  assert.ok(notified() > n0, "and a redraw is asked for");
}

// track-fix 2: the recorder's holder records though it is never drawn (the hidden child of a stack).
{
  const fx = world();
  fx.fixture.terms = [agentTerm("p2", "working", 0)];
  const { v, cx, tick } = await copy({ draw: false });
  await tick(2000);
  assert.equal(v.holdsRecorder(), true, "holds the recorder");
  const flipped = clock;
  fx.fixture.terms = [agentTerm("p2", "done", 1)];
  await tick(6000);
  const rec = JSON.parse(fx.files[`${TOWER}/timeline/events.json`]);
  const done = rec.events.find((e) => e.a === "p2" && e.s === "done");
  assert.ok(done && done.at - flipped <= 1000, "the finish is in events.json with its time");
  assert.ok(rec.events.some((e) => e.a === "p2" && e.s === "working"), "and the working before it");
  assert.deepEqual(rec.gaps, [], "a holder starting with the copy draws no gap");
  // A tick that comes five minutes late (the computer slept) marks that time as not recorded.
  const before = clock;
  clock += 300e3;
  v.trackTick(cx);
  assert.deepEqual(v.rec.gaps.map((g) => [g.from, g.to]), [[before, clock]], "a late tick's time is a gap");
}

// track-fix 5: two list copies (the docked list and the window) end with the same time: the later
// one folds in the earlier's map before it tracks, and never stamps the flip with its own clock.
{
  const fx = world();
  fx.fixture.terms = [agentTerm("p3", "working", 0)];
  const a = await copy();
  const b = await copy();
  const flipped = clock;
  fx.fixture.terms = [agentTerm("p3", "done", 1)];
  clock = flipped + 300;
  b.v.trackTick(b.cx);
  clock = flipped + 900;
  a.v.trackTick(a.cx);
  const at = (x) => x.v.changes.get("p3").at;
  assert.deepEqual([at(a), at(b), fx.shared["agent-tower.changes"].p3.at], [flipped + 300, flipped + 300, flipped + 300], "one time in both copies and the shared map");
  // Each had stamped it alone (neither saw the other): the earlier wins in both.
  fx.fixture.terms = [agentTerm("p3", "working", 1)];
  clock += 1000;
  const t0 = clock;
  a.v.changes.set("p3", { word: "working", turn: 1, at: t0, had: true });
  b.v.changes.set("p3", { word: "working", turn: 1, at: t0 + 700, had: true });
  fx.shared["agent-tower.changes"] = { p3: b.v.changes.get("p3") };
  fx.shared["agent-tower.changesV"] = `${b.v.id}:99`;
  a.v.trackTick(a.cx);
  b.v.trackTick(b.cx);
  assert.deepEqual([at(a), at(b), fx.shared["agent-tower.changes"].p3.at], [t0, t0, t0], "the earlier time for the same word and turn wins");
}
// track-fix R1 1: a change another list copy saw first (the window ticks first and writes the map)
// is recorded by the holder at its next tick, not up to 30 s later.
{
  const fx = world();
  fx.fixture.terms = [agentTerm("p4", "working", 0)];
  const a = await copy({ draw: false });
  await a.tick(2000);
  const b = await copy({ draw: false });
  assert.ok(a.v.holdsRecorder() && !b.v.holdsRecorder());
  const flipped = clock;
  fx.fixture.terms = [agentTerm("p4", "done", 1)];
  clock = flipped + 300;
  b.v.trackTick(b.cx);
  clock = flipped + 600;
  a.v.trackTick(a.cx);
  assert.ok(a.v.rec.events.some((e) => e.a === "p4" && e.s === "done"), "recorded at the holder's next tick");
}

// track-fix R1 5: a copy that takes the recorder back records nothing into its old record while it
// reads the files again.
{
  const fx = world();
  fx.fixture.terms = [agentTerm("p5", "working", 0)];
  const { v, cx, tick } = await copy({ draw: false });
  await tick(2000);
  assert.ok(v.holdsRecorder());
  const LEASE = `${TOWER}/recorder.lease`;
  // Another copy takes the lease (this one was asleep): the next renewal finds it lost.
  fx.files[LEASE] = JSON.stringify({ id: "other", at: clock + 20000 });
  await tick(20000);
  assert.equal(v.holdsRecorder(), false, "lost");
  // It is free again; the record's read is slow.
  fx.files[LEASE] = "null";
  let release;
  fx.hold = { [`${TOWER}/timeline/events.json`]: new Promise((r) => (release = r)) };
  const old = v.rec;
  const n0 = old.events.length;
  await tick(20000);
  assert.equal(v.recKeeper.held(), true, "taken back");
  fx.fixture.terms = [agentTerm("p5", "done", 1)];
  clock += 1000;
  v.trackTick(cx);
  assert.equal(v.holdsRecorder(), false, "not ready while the record is read again");
  assert.equal(old.events.length, n0, "nothing went into the old record");
  release();
  await tick(1000);
  assert.ok(v.holdsRecorder() && v.rec !== old, "ready on the record just read");
  fx.hold = null;
}

// track-fix R1 6: a copy that only corrects the shared map (an earlier time) writes a new version,
// so readers that saw its last one convert the map again.
{
  const fx = world();
  fx.fixture.terms = [agentTerm("p6", "working", 0)];
  const { v, cx } = await copy({ draw: false });
  fx.fixture.terms = [agentTerm("p6", "done", 1)];
  clock += 1000;
  v.trackTick(cx);
  const first = fx.shared["agent-tower.changesV"];
  const mine = v.changes.get("p6");
  fx.shared["agent-tower.changes"] = { p6: { ...mine, at: mine.at + 500 } };
  fx.shared["agent-tower.changesV"] = "other:1";
  clock += 1000;
  v.trackTick(cx);
  assert.equal(fx.shared["agent-tower.changes"].p6.at, mine.at, "the earlier time written back");
  assert.notEqual(fx.shared["agent-tower.changesV"], first, "under a new version");
}

// track-fix R1 7: a draw right after a flip shows the new word with its time, before any tick, and
// asks for no redraw while drawing.
{
  const fx = world();
  fx.fixture.terms = [agentTerm("p7", "working", 0)];
  const { v, cx, notified } = await copy();
  fx.fixture.terms = [agentTerm("p7", "done", 1)];
  clock += 300;
  const n0 = notified();
  v.render(cx);
  assert.deepEqual([v.changes.get("p7").word, v.changes.get("p7").at], ["done", clock], "tracked by the draw");
  assert.equal(notified(), n0, "no redraw asked for inside the draw");
}
console.log("io ok");
