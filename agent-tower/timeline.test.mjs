// node timeline.test.mjs: Timeline's folding of the recorded past, and one render against a made-up
// model with its clicks. gpui-kit, gpui-base and herdr are stubbed: elements record their id and click.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const stub = `
const els = new Map();
const shared = new Map();
const el = () => {
  const target = function () {};
  const self = new Proxy(target, {
    get(_, k) {
      if (k === "then") return undefined;
      if (k === "click") return target.click;
      return (...a) => {
        if (k === "id") els.set(a[0], self);
        if (k === "on_click") target.click = a[0];
        if (k === "when") return a[0] ? a[1](self) : self;
        return self;
      };
    },
  });
  return self;
};
globalThis.__tl = { els, shared, files: new Map() };
export const div = el, svg = el, image = el, h_flex = el, v_flex = el;
export function readTextFile(p) { return Promise.resolve(globalThis.__tl.files.get(p) ?? null); }
export function sharedGet(k) { return shared.get(k); }
export { sharedGet as shared };
export function setShared(k, v) { shared.set(k, v); return null; }
export function writeTextFile(p, text) { globalThis.__tl.files.set(p, text); return Promise.resolve(null); }
export function exec(...a) { return globalThis.__tl.exec(...a); }
export function appHome() { return "/made/up/app"; }
`;
const url = `data:text/javascript,${encodeURIComponent(stub)}`;
registerHooks({
  resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url, shortCircuit: true } : next(s, c)),
});

const T = await import("./mods/agent-tower/timeline.js");
const TL = T;
const T2 = (entry, from, until) => TL.rebuild(entry, { from, until }).map((s) => [s.s, (now - s.from) / MIN, (now - s.to) / MIN, s.how]);
const tl = globalThis.__tl;
const MIN = 60e3;
const now = Date.UTC(2026, 10, 15, 12);
const ago = (m) => now - m * MIN;

// ── stretches: merging, the live tail, gaps ──
{
  const h = T.parseHistory(JSON.stringify({
    lanes: {},
    events: [
      { a: "t1", s: "working", at: ago(100) },
      { a: "t1", s: "working", turn: 2, at: ago(90) },
      { a: "t1", s: "blocked", at: ago(60), msg: "Ship it?" },
      { a: "t1", s: "working", at: ago(30) },
    ],
    looks: [], gaps: [{ m: "herdr", from: ago(80), to: ago(70) }],
  }));
  const list = T.stretches(h, "t1", now, { gaps: T.gapsFor(h, null, now) });
  assert.deepEqual(list.map((s) => [s.s, (now - s.from) / MIN, (now - s.to) / MIN]),
    [["working", 100, 80], ["working", 70, 60], ["blocked", 60, 30], ["working", 30, 0]], "a new turn continues; the Herdr gap is cut out");
  assert.equal(list.at(-1).ongoing, true);
  assert.equal(list[2].msg, "Ship it?");
  // The model says blocked now and the recorder has not written it: a live tail from status_ms.
  const live = T.stretches(h, "t1", now, { live: "blocked", since: ago(2) });
  assert.deepEqual(live.slice(-2).map((s) => [s.s, (now - s.from) / MIN, s.ongoing]), [["working", 30, false], ["blocked", 2, true]]);
  // One source for "since" (the list's and Details'): the recorder noticed the ask at 10m, hc says 25m.
  const asked = { ...h, events: [...h.events, { a: "t1", s: "blocked", at: ago(10) }], gaps: [] };
  assert.deepEqual(T.stretches(asked, "t1", now, { live: "blocked", since: ago(25) }).slice(-2).map((s) => [s.s, (now - s.from) / MIN, (now - s.to) / MIN, s.ongoing]),
    [["working", 30, 25, false], ["blocked", 25, 0, true]]);
  // No since: the recorded start stands.
  assert.equal(T.stretches(asked, "t1", now, { live: "blocked" }).at(-1).from, ago(10));
  // A machine gap covers only that machine's lanes; an open one runs to now.
  const g = { ...h, gaps: [{ m: "vps", from: ago(10), to: null }] };
  assert.equal(T.gapsFor(g, null, now).length, 0);
  assert.equal(T.stretches(g, "t1", now, { gaps: T.gapsFor(g, "vps", now) }).at(-1).to, ago(10));
  // Ended: no stretch after it.
  const e = { ...h, events: [...h.events, { a: "t1", s: "ended", at: ago(5) }], gaps: [] };
  assert.equal(T.stretches(e, "t1", now).at(-1).to, ago(5));
  assert.equal(T.stretches(e, "t1", now).at(-1).ongoing, false);
}

// ── parseHistory never throws ──
assert.deepEqual(T.parseHistory("{oops"), T.EMPTY);
assert.deepEqual(T.parseHistory('{"events":[{"a":1}]}').events, []);

// ── looks and the moment ──
{
  const h = T.parseHistory(JSON.stringify({ events: [], looks: [{ a: "x", at: ago(50) }, { a: "t1", at: ago(41) }, { a: null, at: ago(40) }] }));
  assert.equal(T.firstLook(h, "t1", ago(60), ago(30)), ago(41));
  assert.equal(T.firstLook(h, "x", ago(45), ago(30)), ago(45), "already on it counts as at once");
  assert.deepEqual(T.focusStretches(h, now).map((f) => f.a), ["x", "t1"]);
  const st = { s: "blocked", from: ago(60), to: ago(30), msg: "Ship it?", ongoing: false };
  assert.deepEqual(T.momentOf("task:a", "t1", st, h), { key: "task:a", address: "t1", at: ago(60), to: ago(30), word: "blocked", msg: "Ship it?", screen: `t1@${ago(60)}`, looked: 19 * MIN });
  // A Working stretch's screen is the one taken where it stopped; still going, there is none.
  assert.equal(T.momentOf("k", "t1", { s: "working", from: ago(30), to: ago(10), ongoing: false }, h).screen, `t1@${ago(10)}`);
  assert.equal(T.momentOf("k", "t1", { s: "working", from: ago(30), to: now, ongoing: true }, h).screen, null);
}

// ── a made-up model and recording: lanes, order, ended and forgotten tasks ──
const term = (address, extra = {}) => ({ address, name: address, status_ms: ago(5), created_ms: ago(200), ...extra });
const billing = {
  key: "task:b1", title: "Invoice CSV export", area: "work", machine: null, machines: [null], word: "blocked", status: "blocked",
  lead: term("t10"), leadGone: false, live: [],
  tree: [{ t: term("t11", { name: "b1-schema" }), lines: ["├"], status: "working" }, { t: term("vps/t3", { name: "b1-load" }), lines: ["└"], status: "idle" }],
};
const kyoto = { key: "task:k1", title: "Kyoto trip", area: "personal", machine: null, machines: [null], word: "done", status: "done", lead: term("t20"), leadGone: false, live: [], tree: [] };
const m = { areas: [{ id: "work", label: "Work" }, { id: "personal", label: "Personal" }], items: [billing, kyoto] };
const recorded = {
  v: 1, beat: ago(1),
  lanes: {
    t10: { task: "task:b1", role: "lead", name: "b1-lead", area: "work" },
    t12: { task: "task:b1", role: "worker", name: "b1-old", area: "work" },
    t30: { task: "task:gone", taskTitle: "Photo backup", role: "lead", name: "p-lead", area: "personal" },
    t40: { task: "agent:t40", taskTitle: "eye", role: "lead", name: "eye", area: "personal", eye: true },
  },
  events: [
    { a: "t10", s: "working", at: ago(300) },
    { a: "t10", s: "blocked", at: ago(262), msg: "Dates in ISO?" },
    { a: "t10", s: "working", at: ago(205) },
    { a: "t10", s: "blocked", at: ago(31), msg: "Ship to everyone?" },
    { a: "t12", s: "working", at: ago(150) },
    { a: "t12", s: "ended", at: ago(120) },
    { a: "t30", s: "working", at: ago(200) },
    { a: "t30", s: "ended", at: ago(100) },
    { a: "t40", s: "working", at: ago(90) },
    { a: "t40", s: "ended", at: ago(50) },
    { a: "t20", s: "done", at: ago(25), msg: "Booked." },
  ],
  looks: [{ a: "t10", at: ago(12) }, { a: null, at: ago(10) }],
  gaps: [{ m: "herdr", from: ago(240), to: ago(220) }, { m: "vps", from: ago(20), to: null }],
};
{
  const h = T.parseHistory(JSON.stringify(recorded));
  const groups = T.lanesOf(m, h, { now, start: ago(480), changes: { t10: { at: ago(31) } } });
  // since: the sidebar's changes first, else hc's status_ms; a wait in the list's words.
  assert.deepEqual(groups[0].tasks[0].lanes.map((l) => [l.a, (now - l.since) / MIN]), [["t10", 31], ["t11", 5], ["vps/t3", 5]]);
  const perm = { ...billing, lead: term("t10", { report: { kind: "permission" } }) };
  assert.equal(T.lanesOf({ ...m, items: [perm] }, h, { now, start: ago(480) })[0].tasks[0].lanes[0].wait, "Needs permission");
  assert.deepEqual(groups.map((g) => g.label), ["Work", "Personal"]);
  assert.deepEqual(groups[0].tasks[0].lanes.map((l) => [l.a, l.role]), [["t10", "lead"], ["t11", "worker"], ["vps/t3", "worker"]]);
  assert.deepEqual(groups[0].tasks[0].folded.map((l) => [l.a, !!l.ended]), [["t12", true]], "an ended member folds");
  assert.equal(T.foldWords(groups[0].tasks[0]), "1 ended");
  // The list's quiet rows fold too, in its words.
  const quietItem = { ...billing, activeTree: billing.tree.slice(0, 1), quiet: [{ ...billing.tree[1], status: "idle" }] };
  const q = T.lanesOf({ ...m, items: [quietItem] }, h, { now, start: ago(480) })[0].tasks[0];
  assert.deepEqual([q.lanes.map((l) => l.a), q.folded.map((l) => l.a), T.foldWords(q)], [["t10", "t11"], ["vps/t3", "t12"], "1 idle · 1 ended"]);
  assert.deepEqual(groups[1].tasks.map((tk) => [tk.title, !!tk.item]), [["Kyoto trip", true], ["Photo backup", false]], "a task hc forgot keeps its past");
  assert.equal(T.lanesOf(m, h, { now, start: ago(60) })[1].tasks.length, 1, "an ended task outside the span is not drawn");
  // The Eye is not a task: an ended one (recorded with eye: true) and a live one are left out.
  assert.ok(!groups.flatMap((g) => g.tasks).some((tk) => tk.key === "agent:t40"));
  const eyeItem = { ...kyoto, key: "agent:t41", lead: term("t41", { labels: { "tower.eye": "1" } }) };
  assert.ok(!T.lanesOf({ ...m, items: [...m.items, eyeItem] }, h, { now, start: ago(480) }).flatMap((g) => g.tasks).some((tk) => tk.key === "agent:t41"));
  assert.deepEqual(T.lanesOf(m, h, { now, start: ago(480), first: "personal" }).map((g) => g.label), ["Work", "Personal"], "an area with an open ask leads, even before the shown one");
  const calm = { ...m, items: [{ ...billing, status: "working", tree: [] }, kyoto] };
  assert.deepEqual(T.lanesOf(calm, h, { now, start: ago(480), first: "personal" }).map((g) => g.label), ["Personal", "Work"], "no asks: the shown area first, every area kept");
  const lanes = groups.flatMap((g) => g.tasks.flatMap((tk) => [...tk.lanes, ...tk.folded])).map((l) => ({ ...l, stretches: T.stretches(h, l.a, now, { live: l.live }) }));
  const att = T.attention(h, lanes, ago(480), now);
  assert.equal(att.count, 2);
  assert.equal(att.open.length, 1);
  assert.equal(att.longest.waited, 57 * MIN);
  assert.equal(att.waited, 88 * MIN);
}

// ── the list's order: group, stale first, newest change ──
{
  const it = (key, group, changed, stale = false) => ({ key, group, changed, stale });
  assert.deepEqual(T.listOrder([it("a", "working", 5), it("b", "needs", 1), it("c", "working", 9), it("d", "working", 1, true), it("e", "pinned", 0)]).map((i) => i.key), ["e", "b", "d", "c", "a"]);
}

// ── render: draws, and its clicks select, pick a moment and open a terminal ──
{
  const dir = "/made/up/agent-tower";
  tl.files.set(`${dir}/timeline/events.json`, JSON.stringify(recorded));
  tl.shared.set(T.RECORDED, 1);
  const calls = [];
  const ui = { now, width: 1100, height: 600, area: null, selectedKey: null, towerDir: dir, state: {},
    select: (item) => calls.push(["select", item.key]), pick: (item) => calls.push(["pick", item.key]), openTerminal: (a) => calls.push(["open", a]), notify: () => calls.push(["notify"]) };
  const theme = new Proxy({}, { get: (_, k) => `#${k}` });
  T.render(theme, m, ui);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.length >= 1 && calls.every(([c]) => c === "notify"), "the recorded file (and the backfill cache) load, then redraw");
  T.render(theme, m, ui);
  // A task is one line until opened: its summary carries the past ask and the open one's now cell.
  assert.ok(tl.els.has(`S-t10-${ago(262)}`), "a past ask is drawn on the task's line");
  assert.ok(tl.els.has("n-task:b1"), "the open ask has its now cell on the task's line");
  assert.ok(!tl.els.has("l-t10"), "lanes stay closed");
  tl.els.get("c-task:b1").click();
  T.render(theme, m, ui);
  assert.ok(tl.els.has(`s-t10-${ago(262)}`), "opened: the lead's own lane");
  assert.ok(tl.els.has("n-t10"), "the open ask has its now cell");
  assert.ok(tl.els.has(`gap-t10-${ago(240)}`), "the Herdr gap is drawn");
  assert.ok(tl.els.has(`gap-vps/t3-${ago(20)}`), "the silent machine's gap is drawn on its lane");
  calls.length = 0;
  tl.els.get(`s-t10-${ago(262)}`).click();
  assert.deepEqual(calls, [["pick", "task:b1"]], "a stretch selects and stays in Timeline");
  assert.equal(tl.shared.get(T.MOMENT).msg, "Dates in ISO?");
  assert.equal(tl.shared.get(T.MOMENT).key, "task:b1");
  tl.els.get("l-t11").click();
  tl.els.get("t-task:k1").click();
  assert.deepEqual(calls.slice(1), [["open", "t11"], ["select", "task:k1"]]);
  assert.ok(!tl.els.has("l-t12"), "folded until opened");
  tl.els.get("f-task:b1").click();
  T.render(theme, m, ui);
  assert.ok(tl.els.has("l-t12"), "the fold opens");
  tl.els.get("span-1h").click();
  assert.equal(ui.state.span, 0, "zoom is the view's own state");
  // Area chips: one click shows one area, All shows them all again.
  tl.els.get("area-personal").click();
  tl.els.clear();
  T.render(theme, m, ui);
  assert.ok(tl.els.has("t-task:k1") && !tl.els.has("t-task:b1"), "only Personal");
  tl.els.get("area-all").click();
  tl.els.clear();
  T.render(theme, m, ui);
  assert.ok(tl.els.has("t-task:k1") && tl.els.has("t-task:b1"), "All again");
  // "N Needs you" shows only the tasks waiting on you; again, all.
  tl.els.get("needs").click();
  tl.els.clear();
  T.render(theme, m, ui);
  assert.ok(tl.els.has("t-task:b1") && !tl.els.has("t-task:k1"), "only what needs you");
  tl.els.get("needs").click();
  // A clicked stretch keeps its task open; closing is yours, by the chevron.
  tl.els.get("c-task:b1").click();
  tl.els.clear();
  T.render(theme, m, ui);
  assert.ok(!tl.els.has("l-t10"), "closed by the chevron");
  // (zoomed to 1h above: whichever of the lead's marks is on its task's line)
  tl.els.get([...tl.els.keys()].find((k) => k.startsWith("S-t10-"))).click();
  tl.els.clear();
  T.render(theme, m, ui);
  assert.ok(tl.els.has("l-t10") && ui.state.tasks["task:b1"], "the clicked stretch's task opens and stays");
  // The click grammar through the stage's helpers: a title goes in (rule 1); a lane name and the ask's
  // cell go in with that agent open (rules 2, 3); a stretch only picks, with its moment; menus wrap labels.
  const went = [];
  const menus = [];
  const g = { ...ui, state: { span: 2, tasks: { "task:b1": true } }, goInto: (item, opts) => went.push([item.key, opts.agent ?? null]), pick: (item, mo) => went.push(["pick", item.key, mo.address, mo.word]),
    onMenu: (el, thing) => (menus.push(thing.task?.key ?? thing.agent), el) };
  tl.els.clear();
  T.render(theme, m, g);
  tl.els.get("t-task:k1").click();
  tl.els.get("l-t11").click();
  tl.els.get("n-t10").click();
  tl.els.get(`s-t10-${ago(262)}`).click();
  assert.deepEqual(went, [["task:k1", null], ["task:b1", "t11"], ["task:b1", "t10"], ["pick", "task:b1", "t10", "blocked"]], "the pick carries the whole moment (its state word too)");
  assert.ok(menus.includes("task:b1") && menus.includes("t11"), "right-click: the list's menu for the task and for the agent");
  // A broken file is an empty past, not a broken view.
  tl.files.set(`${dir}/timeline/events.json`, "{oops");
  tl.shared.set(T.RECORDED, 2);
  T.render(theme, m, ui);
  await new Promise((r) => setTimeout(r, 0));
  T.render(theme, m, ui);
}

// ── one line per task: the most urgent thing at each moment; quiet tasks ──
{
  const st = (s, a, b, extra = {}) => ({ s, from: ago(a), to: ago(b), ongoing: b === 0, ...extra });
  const task = {
    lanes: [
      { a: "L", role: "lead", stretches: [st("working", 60, 0)] },
      { a: "W", role: "worker", stretches: [st("blocked", 40, 30), st("done", 20, 10)] },
    ],
    folded: [{ a: "R", role: "worker", stretches: [st("working", 90, 60, { how: "rebuilt" })] }],
  };
  assert.deepEqual(T.summaryOf(task).map((x) => [x.s, (now - x.from) / MIN, (now - x.to) / MIN, x.how ?? "", x.lane.a, x.ongoing]), [
    ["working", 90, 60, "rebuilt", "R", false],
    ["working", 60, 40, "", "L", false], ["blocked", 40, 30, "", "W", false], ["working", 30, 0, "", "L", true],
  ], "a worker's Done does not outrank the lead's Working");
  const quiet = { item: { group: "idle" }, lanes: [{ live: "idle", stretches: [st("working", 600, 500), st("idle", 500, 0)] }], folded: [] };
  assert.equal(T.isQuiet(quiet, ago(480)), true);
  assert.equal(T.isQuiet({ ...quiet, lanes: [{ live: "blocked", stretches: [] }] }, ago(480)), false);
  assert.equal(T.isQuiet({ ...quiet, lanes: [{ live: "idle", stretches: [st("working", 100, 90)] }] }, ago(480)), false, "it moved in the span");
}

// ── backfill: a transcript's turns, before the recorder ──
{
  // read.py's answer is in the machine's seconds; the machine's clock runs 100 s ahead of ours.
  const mNow = now / 1000 + 100;
  const sec = (m) => mNow - m * 60;
  const T = { path: "/x.jsonl", covers: sec(300), turns: [
    { start: sec(240), end: sec(200), ended: null, asks: [[sec(230), sec(220)]] },
    { start: sec(150), end: sec(140), ended: "question", asks: [] },
    { start: sec(100), end: sec(90), ended: null, asks: [] },
  ] };
  const entry = TL.toLocal(T, mNow, now);
  assert.equal(entry.turns[0].start, ago(240), "machine seconds become our clock");
  assert.deepEqual(T2(entry, ago(260), ago(60)), [
    ["working", 240, 230, "rebuilt"], ["blocked", 230, 220, "rebuilt"], ["working", 220, 200, "rebuilt"], ["idle", 200, 150, "rebuilt"],
    ["working", 150, 140, "rebuilt"], ["blocked", 140, 100, "guessed"], ["working", 100, 90, "rebuilt"], ["idle", 90, 60, "rebuilt"],
  ]);
  // Clipped to the lane's start and to the transcript's covered part.
  assert.equal(T2(entry, ago(235), ago(60))[0][1], 235);
  assert.equal(T2({ ...entry, covers: ago(145) }, ago(260), ago(60))[0][1], 145);
  // An open question tool at the end waits until the recorder takes over.
  const open = TL.toLocal({ path: "/y", turns: [{ start: sec(50), end: sec(40), ended: "ask-tool", asks: [[sec(45), null]] }] }, mNow, now);
  assert.deepEqual(T2(open, ago(60), ago(10)), [["working", 50, 45, "rebuilt"], ["blocked", 45, 10, "rebuilt"]]);
  // Who wants it: a live agent alive a minute before the recorder first saw it.
  const lane = { a: "t1", t: {}, created: ago(300), since: ago(5) };
  assert.equal(TL.wantsBackfill(lane, ago(100), now), true);
  assert.equal(TL.wantsBackfill(lane, ago(299.5), now), false);
  assert.equal(TL.wantsBackfill({ ...lane, ended: true }, null, now), false);
  assert.equal(TL.wantsBackfill(lane, null, now), true, "no recorder yet: up to hc's since");
  // One read.py run per machine, cached in backfill.json; the next render draws it outlined.
  const dir = "/made/up/agent-tower";
  tl.files.set("/made/up/app/mods/agent-tower-panel/read.py", "print()");
  const sent = [];
  tl.exec = (cmd, args, opts) => {
    const req = JSON.parse(args[4]);
    sent.push([opts.on, req.turns.terminals.map((x) => x.key), req.turns.since_s]);
    const terminals = Object.fromEntries(req.turns.terminals.map((x) => [x.key, x.key.startsWith("t10@") ? T : {}]));
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ now: mNow, turns: { terminals, folders: {} } }) });
  };
  tl.files.set(`${dir}/timeline/events.json`, JSON.stringify({ ...recorded, events: recorded.events.filter((e) => e.at > ago(40)) }));
  tl.shared.set(TL.RECORDED, 3);
  const ui = { now, width: 1100, area: null, selectedKey: null, towerDir: dir, state: {}, select() {}, pick() {}, openTerminal() {}, notify() {} };
  const theme = new Proxy({}, { get: (_, k) => `#${k}` });
  // Fresh keys (created times) so the render test above has not asked for them already.
  const old = { ...billing, lead: term("t10", { created_ms: ago(260), pid: 42 }), tree: [{ t: term("vps/t3", { created_ms: ago(210) }), lines: [], status: "idle" }] };
  const mm = { ...m, items: [old] };
  for (let i = 0; i < 4; i++) {
    TL.render(theme, mm, ui);
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.deepEqual(sent.map(([on]) => on).sort(), ["vps", null].sort(), "one run per machine");
  assert.ok(sent.some(([on, keys]) => on === null && keys.includes(`t10@${ago(260)}`)));
  assert.equal(sent.find(([on]) => on === null)[2], 260 * 60 + 60, "read back to the lane's start");
  const cached = JSON.parse(tl.files.get(`${dir}/timeline/backfill.json`));
  assert.equal(cached[`t10@${ago(260)}`].turns.length, 3);
  assert.equal(cached[`vps/t3@${ago(210)}`].missing, true, "not found: remembered, not asked again");
  // The second turn, at about 150m ago (the first falls in the recorded Herdr gap, 240–220m, and is cut
  // like any stretch there); the answer's few ms of latency may move it a hair.
  const drawn = [...tl.els.keys()].filter((k) => k.startsWith("S-t10-")).map((k) => (now - Number(k.split("-").pop())) / MIN);
  assert.ok(drawn.some((m) => Math.abs(m - 150) < 0.01), "the rebuilt past is drawn");
  assert.ok(!drawn.some((m) => Math.abs(m - 240) < 0.01), "not inside a gap");
  TL.render(theme, mm, ui);
  assert.equal(sent.length, 2, "cached: read.py is not run again");
}

console.log("timeline ok");
