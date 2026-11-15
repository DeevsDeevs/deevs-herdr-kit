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
      if (k === "wheel") return target.wheel;
      if (k === "tip") return target.tip;
      return (...a) => {
        if (k === "id") els.set(a[0], self);
        if (k === "on_click") target.click = a[0];
        if (k === "on_scroll_wheel") target.wheel = a[0];
        if (k === "tooltip") target.tip = a[0];
        if (k === "when") return a[0] ? a[1](self) : self;
        // Herdr refuses a child that is not an element or a string (null, undefined, a number).
        const bad = (x) => x == null || (typeof x !== "string" && typeof x !== "function");
        if (k === "child" && bad(a[0])) throw new Error("child(" + a[0] + ") is not an element or a string");
        if (k === "children" && (a[0] ?? []).some(bad)) throw new Error("children() holds something that is not an element or a string");
        return self;
      };
    },
  });
  return self;
};
globalThis.__tl = { els, shared, files: new Map() };
export const div = el, svg = el, image = el, h_flex = el, v_flex = el;
export function readTextFile(p) { const v = globalThis.__tl.files.get(p); return v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? null); }
export function sharedGet(k) { return shared.get(k); }
export { sharedGet as shared };
export function setShared(k, v) { shared.set(k, v); return null; }
export function writeTextFile(p, text) { globalThis.__tl.files.set(p, text); return Promise.resolve(null); }
export function exec(...a) { return globalThis.__tl.exec(...a); }
export function hc(...a) { return globalThis.__tl.hc ? globalThis.__tl.hc(...a) : Promise.resolve({ code: 1, stdout: "" }); }
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
  assert.equal(TL.wantsBackfill({ ...lane, t: null, ended: true }, null, now), true, "an ended one hc may still list");
  assert.equal(TL.wantsBackfill({ ...lane, ended: true, fileOnly: true }, null, now), false, "not one only a task file has");
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

// ── a task that lives four weeks with sixty agents: Week and Month, the task files ──
{
  const DAY = 24 * 60 * MIN;
  const c0 = now - 28 * DAY;
  const until = now - 2 * DAY;
  const thinTo = now - 7 * DAY;
  const sec = (ms, created) => Math.round((ms - created) / 1000);
  // The lead: a morning stretch each day, an ask most days, a Done near the end.
  const lead = { a: "t100", role: "lead", name: "lead", title: "Ledger export", machine: null, parent: null, created: c0, ended: null, thinTo, w: [], asks: [], done: [], events: [] };
  for (let d = 0; d < 21; d++) {
    const day = c0 + d * DAY;
    lead.w.push([sec(day + 60 * MIN, c0), sec(day + 180 * MIN, c0)]);
    if (d % 2 === 0) lead.asks.push([sec(day + 180 * MIN, c0), sec(day + 200 * MIN, c0), `Keep column ${d}?`]);
  }
  lead.done.push([sec(thinTo - 60 * MIN, c0), "First pass done."]);
  lead.events = [{ s: "working", turn: 40, at: thinTo + 10 * MIN, msg: null }, { s: "idle", turn: 40, at: thinTo + 70 * MIN, msg: null }];
  const lanes = { [`t100@${c0}`]: lead };
  const endedLanes = [];
  // 59 workers, one started every ten hours; t101–t150 lived a day each and ended, t151–t159 still live.
  for (let i = 1; i <= 59; i++) {
    const a = `t${100 + i}`;
    const created = c0 + i * 10 * 60 * MIN;
    const ended = i <= 50 ? created + DAY : null;
    lanes[`${a}@${created}`] = { a, role: "worker", name: `k7-w${i}`, title: null, machine: i % 3 ? null : "vps", parent: "t100", created, ended, thinTo,
      w: [[0, 3600], [7200, 9000]], asks: i % 10 ? [] : [[9000, 9600, "Which ledger?"]], done: [], events: [] };
    if (ended) endedLanes.push(`${a}@${created}`);
  }
  const k7 = { v: 1, task: "task:k7", taskId: "k7", title: "Ledger export rewrite", area: "work", from: c0, until, ended: null, lanes };
  const q9 = { v: 1, task: "task:q9", taskId: "q9", title: "Quarter budget sheet", area: "work", from: now - 14 * DAY, until: now - 10 * DAY, ended: now - 10 * DAY,
    lanes: { [`t90@${now - 14 * DAY}`]: { a: "t90", role: "lead", name: "lead", created: now - 14 * DAY, ended: now - 10 * DAY, thinTo: now - 10 * DAY, w: [[0, 7200]], asks: [], done: [[7200, "Sheet sent."]], events: [] } } };
  const index = { v: 1, at: now, gaps: [{ m: "herdr", from: now - 5 * DAY, to: now - 5 * DAY + 8 * 60 * MIN }], tasks: {
    "task:k7": { file: "tasks/task%3Ak7.json", taskId: "k7", title: k7.title, area: "work", from: c0, until, ended: null, agents: 60, endedLanes, bytes: 1 },
    "task:q9": { file: "tasks/task%3Aq9.json", taskId: "q9", title: q9.title, area: "work", from: q9.from, until: q9.until, ended: q9.ended, agents: 1, endedLanes: [`t90@${now - 14 * DAY}`], bytes: 1 },
    "task:old": { file: "tasks/task%3Aold.json", taskId: "old", title: "Old thing", area: "work", from: now - 50 * DAY, until: now - 40 * DAY, ended: now - 40 * DAY, agents: 2, endedLanes: [], bytes: 1 },
    "../x": { file: "../../secret.json", from: 0, until: now },
  } };

  // The day axis: local midnights; a Month has 30 of them.
  const days = T.dayTicks(now - 30 * DAY, now);
  assert.equal(days.length, 30);
  assert.ok(days.every((k) => new Date(k).getHours() === 0 && new Date(k).getMinutes() === 0));
  assert.deepEqual(T.SPANS.slice(-2).map((x) => [x.name, x.ms / DAY, !!x.long]), [["Week", 7, true], ["Month", 30, true]]);

  // The index is checked: a file outside tasks/ is dropped.
  const idx = T.parseIndex(JSON.stringify(index));
  assert.deepEqual(Object.keys(idx.tasks), ["task:k7", "task:q9", "task:old"]);
  assert.equal(T.parseTaskFile("{oops"), null);

  // A task file's lane as stretches: the thinned part in seconds from created, the raw events after thinTo.
  const ls = T.fileStretches(lead, until);
  assert.deepEqual(ls.slice(0, 2).map((x) => [x.s, (x.from - c0) / MIN, (x.to - c0) / MIN, x.msg]), [["working", 60, 180, null], ["blocked", 180, 200, "Keep column 0?"]]);
  const done = ls.find((x) => x.s === "done");
  assert.equal(done.from, thinTo - 60 * MIN);
  assert.equal(done.to, thinTo, "a Done lasts until thinTo, where the raw events take over");
  assert.deepEqual(ls.slice(-2).map((x) => [x.s, x.from, x.to]), [["working", thinTo + 10 * MIN, thinTo + 70 * MIN], ["idle", thinTo + 70 * MIN, until]]);

  // Week and Month thinning: Working across gaps under a pixel, asks within 3px as one tick, idle gone.
  const px = 30 * DAY / 700;
  const st = (s, a, b, extra = {}) => ({ s, from: a, to: b, ongoing: false, ...extra });
  const thin = T.forSpan([st("working", 0, 10 * MIN), st("idle", 10 * MIN, 20 * MIN), st("working", 20 * MIN, 30 * MIN), st("blocked", 30 * MIN, 31 * MIN, { msg: "A?" }),
    st("blocked", 60 * MIN, 61 * MIN), st("done", 100 * MIN, 120 * MIN), st("blocked", 10 * DAY, 10 * DAY + MIN)], px);
  assert.deepEqual(thin.map((x) => [x.s, x.n]), [["working", 2], ["blocked", 2], ["done", 1], ["blocked", 1]]);
  assert.equal(thin[1].one.msg, "A?", "a shared tick picks its first ask");
  assert.deepEqual(T.forSpan([st("done", 0, MIN)], px, "worker"), [], "a worker's Done is Idle, not drawn");

  // The model now: the lead, two workers busy, seven quiet; one more ended an hour ago (events.json only).
  const live = (i, status) => ({ t: term(`t${100 + i}`, { name: `k7-w${i}`, created_ms: c0 + i * 10 * 60 * MIN }), lines: ["├"], status });
  const item = { key: "task:k7", taskId: "k7", title: k7.title, area: "work", machine: null, machines: [null], word: "working", status: "working", group: "working",
    lead: term("t100", { created_ms: c0 }), leadGone: false, live: [], tree: [live(51, "working"), live(52, "working")],
    activeTree: [live(51, "working"), live(52, "working")], quiet: [53, 54, 55, 56, 57, 58, 59].map((i) => live(i, "idle")) };
  const mk = { areas: [{ id: "work", label: "Work" }], items: [item] };
  const rec = { v: 1, beat: now, lanes: {
    t100: { task: "task:k7", role: "lead", name: "lead", area: "work", created: c0 },
    t160: { task: "task:k7", role: "worker", name: "k7-w60", area: "work", created: now - 5 * 60 * MIN },
  }, events: [{ a: "t100", s: "working", at: now - 47 * 60 * MIN }, { a: "t160", s: "working", at: now - 5 * 60 * MIN }, { a: "t160", s: "ended", at: now - 60 * MIN }], looks: [], gaps: [] };

  // "N ended" counts the whole task, even at 1h where none of them did anything.
  const h = T.parseHistory(JSON.stringify(rec));
  const pastNow = { index: idx, files: { "task:k7": k7 } };
  const k7Task = T.lanesOf(mk, h, { now, start: now - 60 * MIN, past: pastNow })[0].tasks[0];
  assert.equal(k7Task.endedTotal, 51);
  assert.match(T.foldWords(k7Task), /51 ended/);
  // At Month the file's lanes join: the live ones get their past, the ended ones fold.
  const monthTask = T.lanesOf(mk, h, { now, start: now - 30 * DAY, past: pastNow })[0].tasks[0];
  assert.ok(monthTask.lanes[0].past.length > 20, "the lead's own four weeks");
  assert.equal(monthTask.folded.filter((l) => l.fileOnly).length, 50);

  // Render at Month: only the index and the task files the span overlaps are read.
  const dir = "/made/up/long";
  const files = { [`${dir}/timeline/index.json`]: JSON.stringify(index), [`${dir}/timeline/tasks/task%3Ak7.json`]: JSON.stringify(k7), [`${dir}/timeline/tasks/task%3Aq9.json`]: JSON.stringify(q9) };
  const read = [];
  tl.files.set(`${dir}/timeline/events.json`, JSON.stringify(rec));
  tl.shared.set(T.RECORDED, 10);
  const picks = [];
  const ui = { now, width: 1100, area: null, selectedKey: null, towerDir: dir, state: { span: 5, tasks: { "task:k7": true } }, select() {}, pick: (it, mo) => picks.push(mo), openTerminal() {}, notify() {},
    readPast: (p) => (read.push(p.slice(dir.length + 1)), Promise.resolve(files[p] ?? null)) };
  const theme = new Proxy({}, { get: (_, k) => `#${k}` });
  for (let i = 0; i < 4; i++) {
    tl.els.clear();
    T.render(theme, mk, ui);
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.deepEqual([...new Set(read)].sort(), ["timeline/index.json", "timeline/tasks/task%3Ak7.json", "timeline/tasks/task%3Aq9.json"], "an old task's file is not read");
  const laneIds = [...tl.els.keys()].filter((k) => k.startsWith("l-"));
  assert.deepEqual(laneIds.sort(), ["l-t100", "l-t151", "l-t152"], "sixty agents: the lead and the two busy ones on lanes");
  assert.ok(tl.els.has("w-task:k7") && [...tl.els.keys()].some((k) => k.startsWith("wb-task:k7-")), "the rest as one Workers lane");
  assert.ok(tl.els.has("f-task:k7"), "and an 'ended' fold");
  assert.ok(tl.els.has("t-task:q9"), "a task only its file still has, ten days ago, is there at Month");
  assert.ok(!tl.els.has("t-task:old"));
  assert.ok(tl.els.has(`gap-t100-${index.gaps[0].from}`), "a gap from the index");
  // The lead's asks are ticks, and a click is the moment.
  const askAt = c0 + 2 * DAY + 180 * MIN;
  assert.ok(tl.els.has(`s-t100-${askAt}`));
  tl.els.get(`s-t100-${askAt}`).click();
  assert.equal(tl.shared.get(T.MOMENT).word, "blocked");
  assert.equal(tl.shared.get(T.MOMENT).msg, "Keep column 2?");
  // A worker's ask on the Workers lane picks that worker.
  const wAsk = [...tl.els.keys()].find((k) => k.startsWith("W-t110-"));
  assert.ok(wAsk);
  tl.els.get(wAsk).click();
  assert.equal(tl.shared.get(T.MOMENT).address, "t110");
  // The fold opens to the ended ones, each on its lane.
  tl.els.get("f-task:k7").click();
  tl.els.clear();
  T.render(theme, mk, ui);
  assert.ok(tl.els.has("l-t150"), "the newest ended agent first");
  // Only the rows in view (and a margin) are built: the oldest of fifty waits below until scrolled to.
  assert.ok(!tl.els.has("l-t101"), "a row far below the view is not built");
  tl.els.get("timeline-body").wheel({ delta: { x: 0, y: -5000 } }, { notify() {} });
  tl.els.clear();
  T.render(theme, mk, ui);
  assert.ok(tl.els.has("l-t101") && !tl.els.has("t-task:k7"), "scrolled down: the bottom rows are built, the top ones are not");
  tl.els.get("timeline-body").wheel({ delta: { x: 0, y: 5000 } }, { notify() {} });
  // At Day the files are not needed and the old task is gone again.
  ui.state.span = 3;
  tl.els.clear();
  T.render(theme, mk, ui);
  assert.ok(!tl.els.has("t-task:q9") && !tl.els.has("w-task:k7"));
}

// ── ended agents hc still lists (by folder and time), and agents hc forgot (by their brief) ──
{
  const F = await import("./mods/agent-tower/timeline.js?forgot");
  // The terminals entry: a live lane by pid; an ended one by hc get, in seconds ago; gone or reused: none.
  const live = { a: "t1", created: ago(50), t: { pid: 7, argv: ["claude"], cwd: "/home/me/x" } };
  assert.deepEqual(F.turnsAsk(live, null, now), { key: `t1@${ago(50)}`, pid: 7, argv: ["claude"], cwd: "/home/me/x" });
  const gone = { a: "t71", created: ago(300), ended: true };
  const got = { state: "exited", created_ms: ago(300), finished_ms: ago(60), argv: ["claude", "brief"], cwd: "/home/me/work/e1" };
  assert.deepEqual(F.turnsAsk(gone, got, now), { key: `t71@${ago(300)}`, pid: null, argv: ["claude", "brief"], cwd: "/home/me/work/e1", created_s: 18000, finished_s: 3600 });
  assert.equal(F.turnsAsk(gone, { ...got, created_ms: ago(10) }, now), null, "the address is another agent's now");
  assert.equal(F.turnsAsk(gone, null, now), null);

  const mNow = now / 1000 + 100;
  const sec = (m) => mNow - m * 60;
  const dir = "/made/up/forgot";
  tl.files.set("/made/up/app/mods/agent-tower-panel/read.py", "print()");
  tl.files.set(`${dir}/timeline/events.json`, JSON.stringify({ v: 1, beat: now, lanes: {
    t70: { task: "task:e1", taskId: "e1", role: "lead", name: "lead", area: "work", created: ago(100) },
    t71: { task: "task:e1", taskId: "e1", role: "worker", name: "e1-fix", area: "work", created: ago(300) },
    t72: { task: "task:e1", taskId: "e1", role: "worker", name: "e1-test", area: "work", created: ago(280) },
  }, events: [{ a: "t70", s: "working", at: ago(100) }, { a: "t71", s: "working", at: ago(100) }, { a: "t71", s: "ended", at: ago(60) },
    { a: "t72", s: "working", at: ago(90) }, { a: "t72", s: "ended", at: ago(70) }], looks: [], gaps: [] }));
  tl.shared.set(F.RECORDED, 20);
  const asked = [];
  tl.hc = (args) => Promise.resolve(args[1] === "t71" ? { code: 0, stdout: JSON.stringify(got) } : { code: 1, stdout: "" });
  tl.exec = (cmd, args, opts) => {
    const req = JSON.parse(args[4]);
    asked.push([opts.on, req]);
    if (req.turns) {
      const terminals = Object.fromEntries(req.turns.terminals.map((x) => [x.key, x.created_s ? { path: "/made/up/e1-fix.jsonl", covers: sec(300), turns: [{ start: sec(290), end: sec(200), ended: null, asks: [] }] } : null]));
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ now: mNow, turns: { terminals } }) });
    }
    const turns = (a, b) => [{ start: sec(a), end: sec(b), ended: null, asks: [] }];
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ now: mNow, tasks: [
      { task: "e1", program: "claude", session: "s1", cwd: "/home/me/work/e1", first: sec(2000), last: sec(1900), name: "e1-old", path: "/made/up/s1.jsonl", mtime: 1, size: 2, covers: sec(2000), turns: turns(2000, 1950) },
      { task: "e1", program: "claude", session: "s2", cwd: "/home/me/work/e1", first: sec(299.5), last: sec(60), path: "/made/up/s2.jsonl", covers: sec(299.5), turns: turns(299, 200) },
    ] }) });
  };
  const item = { key: "task:e1", taskId: "e1", title: "Expense rules", area: "work", machine: null, machines: [null], word: "working", status: "working", group: "working",
    lead: term("t70", { created_ms: ago(100) }), leadGone: false, live: [], tree: [], activeTree: [], quiet: [] };
  const me = { areas: [{ id: "work", label: "Work" }], items: [item] };
  const ui = { now, width: 1100, area: null, selectedKey: null, towerDir: dir, state: { span: 3, tasks: { "task:e1": true }, open: { "task:e1": true } }, select() {}, pick() {}, openTerminal() {}, notify() {} };
  const theme = new Proxy({}, { get: (_, k) => `#${k}` });
  for (let i = 0; i < 5; i++) {
    F.render(theme, me, ui);
    for (let j = 0; j < 4; j++) await new Promise((r) => setTimeout(r, 0));
  }
  // (1) The ended agent hc still lists: one turns request by folder and time; the one hc forgot is remembered as gone.
  const turnsReq = asked.filter(([, r]) => r.turns);
  assert.equal(turnsReq.length, 1);
  assert.deepEqual(turnsReq[0][1].turns.terminals.map((x) => [x.key, x.created_s, x.finished_s, x.pid]), [[`t71@${ago(300)}`, 18000, 3600, null]]);
  const cache = JSON.parse(tl.files.get(`${dir}/timeline/backfill.json`));
  assert.equal(cache[`t71@${ago(300)}`].turns.length, 1);
  assert.equal(cache[`t72@${ago(280)}`].gone, true, "hc forgot it: not asked again");
  tl.els.clear();
  F.render(theme, me, ui);
  assert.ok([...tl.els.keys()].some((k) => k.startsWith("s-t71-")), "its rebuilt past is on its lane");
  assert.ok(!asked.some(([, r]) => r.tasks), "Day does not look for forgotten agents");
  // (2) Month: the task has a hole, so the transcripts naming it are asked for, once.
  ui.state.span = 5;
  for (let i = 0; i < 4; i++) {
    tl.els.clear();
    F.render(theme, me, ui);
    for (let j = 0; j < 4; j++) await new Promise((r) => setTimeout(r, 0));
  }
  const tasksReq = asked.filter(([, r]) => r.tasks);
  assert.equal(tasksReq.length, 1, "once");
  assert.deepEqual(tasksReq[0][1].tasks.ids, ["e1"]);
  assert.equal(tasksReq[0][1].tasks.since_s, 30 * 86400);
  assert.ok(tl.els.has("l-transcript:claude:s1"), "a forgotten worker joins its task, ended");
  assert.ok(!tl.els.has("l-transcript:claude:s2"), "the 2-minute rule: s2 is t71, already there");
  const forgot = JSON.parse(tl.files.get(`${dir}/timeline/backfill.json`))["transcript:claude:s1"];
  assert.deepEqual([forgot.task, forgot.name, Math.round((now - forgot.first) / MIN)], ["e1", "e1-old", 2000], "kept on this clock, for t44's writer");
  const lanesNow = F.forgottenLanes({ lanes: [], folded: [] }, "e1", F.fillCache());
  assert.deepEqual(lanesNow.map((l) => l.a).sort(), ["transcript:claude:s1", "transcript:claude:s2"]);
}

// ── speed: Herdr cuts a render off after 50 ms (gpui-kit shell sandbox.rs). The cache, and a guard. ──
{
  const P = await import("./mods/agent-tower/timeline.js?perf");
  // A made-up record three times a busy real one: 120 tasks, ~250 lanes, ~1250 events in a day, and
  // rebuilt pasts (one busy task with hundreds of short turns).
  let seed = 5;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const items = [];
  const lanes = {};
  const events = [];
  const fill = {};
  let n = 1;
  for (let k = 0; k < 120; k++) {
    const key = `task:p${k}`;
    const mk = (role) => {
      const address = `t${n++}`;
      const created = now - (60 + Math.floor(r() * 1500)) * MIN;
      lanes[address] = { task: key, taskId: `p${k}`, taskTitle: `Made-up task ${k}`, area: k % 3 ? "work" : "home", role, name: `${role}-${n}`, created };
      return { address, name: `${role}-${n}`, created_ms: created, status_ms: now - 5 * MIN, status: "idle", state: "live", pid: 1000 + n };
    };
    const lead = mk("lead");
    const workers = Array.from({ length: k < 18 ? 3 : k % 2 }, () => mk("worker"));
    if (k < 6) workers.push(...Array.from({ length: 4 }, () => mk("worker")));
    items.push({ key, taskId: `p${k}`, title: `Made-up task ${k}`, area: k % 3 ? "work" : "home", machine: null, machines: [null], lead, leadGone: false, status: "idle", word: "idle", group: "idle",
      tree: workers.map((t) => ({ t, lines: ["├"], status: "idle" })), activeTree: [], quiet: workers.map((t) => ({ t, lines: ["├"], status: "idle" })), live: [lead, ...workers], changed: now - 5 * MIN, stale: false });
    for (const t of [lead, ...workers]) {
      const recFrom = now - 8 * 60 * MIN;
      let at = recFrom + Math.floor(r() * 60) * MIN;
      for (let i = 0; i < 5 && at < now; i++) {
        events.push({ a: t.address, s: i % 2 ? "idle" : r() < 0.2 ? "blocked" : "working", turn: i, at, msg: null });
        at += (5 + Math.floor(r() * 90)) * MIN;
      }
      const turns = [];
      for (let ts = t.created_ms; ts < recFrom && turns.length < (k < 3 ? 40 : 1);) {
        const len = (k < 3 ? 0.3 + r() * 2 : 5 + r() * 40) * MIN;
        turns.push({ start: ts, end: Math.min(recFrom, ts + len), ended: r() < 0.1 ? "question" : "answer", asks: [] });
        ts += len + (k < 3 ? 0.2 + r() * 1.5 : 10 + r() * 60) * MIN;
      }
      if (turns.length) fill[`${t.address}@${t.created_ms}`] = { at: now, covers: t.created_ms, path: "/made/up.jsonl", turns };
    }
  }
  events.sort((x, y) => x.at - y.at);
  const big = { areas: [{ id: "work", label: "Work" }, { id: "home", label: "Home" }], items };
  const dir = "/made/up/speed";
  tl.files.set(`${dir}/timeline/events.json`, JSON.stringify({ v: 1, beat: now, lanes, events, looks: [], gaps: [] }));
  tl.files.set(`${dir}/timeline/backfill.json`, JSON.stringify(fill));
  tl.exec = () => Promise.resolve({ code: 1, stdout: "" });
  tl.shared.set(P.RECORDED, 30);
  const theme = new Proxy({}, { get: (_, k) => `#${k}` });
  const timed = async (span) => {
    const ui = { now, width: 1100, area: null, selectedKey: null, towerDir: dir, state: { span, quiet: { work: true, home: true } }, select() {}, pick() {}, openTerminal() {}, notify() {} };
    for (let i = 0; i < 3; i++) {
      P.render(theme, big, ui);
      await new Promise((res) => setTimeout(res, 0));
    }
    // node's JIT warms up first (Herdr's first render runs interpreted, which the 5x below covers).
    for (let i = 0; i < 15; i++) {
      ui.state.cache = undefined;
      P.render(theme, big, ui);
    }
    const misses = [];
    for (let i = 0; i < 11; i++) {
      ui.state.cache = undefined;
      const t0 = performance.now();
      P.render(theme, big, ui);
      misses.push(performance.now() - t0);
    }
    return misses.sort((x, y) => x - y)[5];
  };
  // Half the budget is 25 ms in Herdr's QuickJS, which runs this about 5 times slower than node: so a
  // render that misses every cache must stay under 5 ms here (measured: about 1 to 2 ms).
  for (const span of [0, 3, 4, 5]) {
    // Over the line once may be the shared box's load: measure again and keep the lower.
    let ms = await timed(span);
    if (ms >= 5) ms = Math.min(ms, await timed(span));
    assert.ok(ms < 5, `${P.SPANS[span].name}: a full render took ${ms.toFixed(1)} ms in node (about ${(ms * 5).toFixed(0)} ms in Herdr)`);
  }
  // No row makes more marks than MAX_MARKS, however much past it holds.
  const many = Array.from({ length: 2000 }, (_, i) => ({ s: i % 2 ? "idle" : "working", from: ago(2000 - i), to: ago(1999 - i), ongoing: false }));
  assert.ok(P.toPixels(many, 24 * 3600e3 / 700).length <= P.MAX_MARKS);
  const asksToo = [...many.slice(0, 10), { s: "blocked", from: ago(1990), to: ago(1989.9), ongoing: false }, ...many.slice(11, 20)];
  assert.ok(P.toPixels(asksToo, 24 * 3600e3 / 700).some((x) => x.s === "blocked" && !x.packed), "an ask keeps its own mark");

  // The cache updates: a recorder write, a change in the model, the now-line moving a pixel.
  const small = { areas: [{ id: "work", label: "Work" }], items: [{ ...billing, area: "work" }] };
  const cdir = "/made/up/cache";
  tl.files.set(`${cdir}/timeline/events.json`, JSON.stringify(recorded));
  tl.shared.set(P.RECORDED, 31);
  const ui = { now, width: 1100, area: null, selectedKey: null, towerDir: cdir, state: { span: 2, tasks: { "task:b1": true } }, select() {}, pick() {}, openTerminal() {}, notify() {} };
  const draw = async () => {
    tl.els.clear();
    P.render(theme, small, ui);
    await new Promise((res) => setTimeout(res, 0));
    tl.els.clear();
    P.render(theme, small, ui);
  };
  await draw();
  assert.ok(!tl.els.has(`s-t10-${ago(15)}`));
  tl.files.set(`${cdir}/timeline/events.json`, JSON.stringify({ ...recorded, events: [...recorded.events, { a: "t10", s: "working", at: ago(15) }] }));
  tl.shared.set(P.RECORDED, 32);
  await draw();
  assert.ok(tl.els.has(`s-t10-${ago(15)}`), "a recorder write is drawn");
  assert.ok(!tl.els.has("n-t11"));
  small.items[0] = { ...small.items[0], tree: [{ ...billing.tree[0], status: "blocked", t: { ...billing.tree[0].t, status: "blocked" } }, billing.tree[1]] };
  await draw();
  assert.ok(tl.els.has("n-t11"), "a model change (a worker now asks) is drawn");
  const before = ui.state.cache.key;
  ui.now = now + 10 * MIN;
  await draw();
  assert.notEqual(ui.state.cache.key, before, "the now-line moved: drawn again");
  assert.equal(ui.state.cache.groups[0].tasks[0].lanes.find((l) => l.a === "t11").stretches.at(-1).to, now + 10 * MIN);
}

// ── stale caches (review-cache-tl.md): each one updates ──
{
  const DAY = 24 * 60 * MIN;
  const tick = () => new Promise((res) => setTimeout(res, 0));
  const theme = new Proxy({}, { get: (_, k) => `#${k}` });
  // 3. A mark's words follow its span: ten rebuilt 3-minute turns, drawn at 3h, then at Day, say what a
  // fresh render at Day says (not the 3h words of the turn the merged mark starts with).
  {
    const A = await import("./mods/agent-tower/timeline.js?words");
    const dir = "/made/up/words";
    const created = ago(600);
    const turns = Array.from({ length: 10 }, (_, i) => ({ start: ago(170 - i * 5), end: ago(167 - i * 5), ended: "answer", asks: [] }));
    const files = { [`${dir}/timeline/backfill.json`]: JSON.stringify({ [`t10@${created}`]: { at: now, covers: created, path: "/made/up/x.jsonl", turns } }),
      [`${dir}/timeline/events.json`]: JSON.stringify({ v: 1, lanes: { t10: { task: "task:a", role: "lead", created } }, events: [{ a: "t10", s: "working", at: ago(20) }], looks: [], gaps: [] }) };
    for (const [k, v] of Object.entries(files)) tl.files.set(k, v);
    tl.shared.set(A.RECORDED, 40);
    const item = { key: "task:a", title: "Made-up task", area: "work", machine: null, machines: [null], word: "working", status: "working", group: "working",
      lead: term("t10", { created_ms: created, pid: 7, status: "working" }), leadGone: false, tree: [], activeTree: [], quiet: [] };
    const mw = { areas: [{ id: "work", label: "Work" }], items: [item] };
    const tips = async (Mod, ui) => {
      for (let i = 0; i < 4; i++) {
        tl.els.clear();
        Mod.render(theme, mw, ui);
        await tick();
      }
      return [...tl.els.entries()].filter(([k]) => k.startsWith("s-t10-")).map(([k, e]) => [k, e.tip]).sort();
    };
    const ui = { now, width: 1100, towerDir: dir, state: { span: 1, tasks: { "task:a": true } }, notify() {} };
    await tips(A, ui);
    ui.state.span = 3;
    const switched = await tips(A, ui);
    const B = await import("./mods/agent-tower/timeline.js?words-fresh");
    const fresh = await tips(B, { ...ui, state: { span: 3, tasks: { "task:a": true } } });
    assert.deepEqual(switched, fresh, "after a span switch the marks say what a fresh render says");
    assert.ok(fresh.some(([, tip]) => /Rebuilt · \d+× Working/.test(tip)), "the merged turns say how many");
  }
  // 1. The hourly move: the index is read again on the recorder's stamp, so the slice that moved into the
  // task file is drawn at once (the pruned events.json no longer has it).
  {
    const A = await import("./mods/agent-tower/timeline.js?move");
    const dir = "/made/up/move";
    const c0 = now - 4 * DAY;
    const askAt = now - 2.5 * DAY;
    const events = [{ a: "t100", s: "working", at: c0 + 60 * MIN }, { a: "t100", s: "blocked", at: askAt, msg: "Keep it?" }, { a: "t100", s: "working", at: askAt + 30 * MIN }, { a: "t100", s: "idle", at: now - 1.5 * DAY }];
    const lanesRec = { t100: { task: "task:k", role: "lead", name: "lead", area: "work", created: c0 } };
    const lane1 = { a: "t100", role: "lead", name: "lead", created: c0, ended: null, thinTo: null, w: [], asks: [], done: [], events: [events[0]] };
    const v1 = { v: 1, task: "task:k", taskId: "k", title: "Made-up", area: "work", from: c0 + 60 * MIN, until: now - 3 * DAY, ended: null, lanes: { [`t100@${c0}`]: lane1 }, looks: [] };
    const entry = (f, bytes) => ({ file: "tasks/task%3Ak.json", taskId: "k", title: "Made-up", area: "work", from: f.from, until: f.until, ended: null, agents: 1, endedLanes: [], bytes });
    const files = { [`${dir}/timeline/index.json`]: JSON.stringify({ v: 1, at: 0, gaps: [], tasks: { "task:k": entry(v1, 1) } }), [`${dir}/timeline/tasks/task%3Ak.json`]: JSON.stringify(v1) };
    tl.files.set(`${dir}/timeline/events.json`, JSON.stringify({ v: 1, lanes: lanesRec, events, looks: [], gaps: [] }));
    tl.shared.set(A.RECORDED, 100);
    const item = { key: "task:k", taskId: "k", title: "Made-up", area: "work", machine: null, machines: [null], word: "idle", status: "idle", group: "idle",
      lead: term("t100", { created_ms: c0, status: "idle" }), leadGone: false, tree: [], activeTree: [], quiet: [] };
    const mk = { areas: [{ id: "work", label: "Work" }], items: [item] };
    const reads = [];
    const ui = { now, width: 1100, towerDir: dir, state: { span: 5, tasks: { "task:k": true } }, notify() {}, readPast: (p) => (reads.push(p.slice(dir.length + 1)), Promise.resolve(files[p] ?? null)) };
    const askShown = () => ui.state.cache.groups[0].tasks[0].lanes[0].stretches.some((st) => st.s === "blocked" && st.from === askAt);
    const draw = async (n = 4) => {
      for (let i = 0; i < n; i++) {
        tl.els.clear();
        A.render(theme, mk, ui);
        await tick();
      }
    };
    await draw();
    assert.ok(askShown(), "before the move");
    const v2 = { ...v1, until: askAt + 30 * MIN, lanes: { [`t100@${c0}`]: { ...lane1, events: events.slice(0, 3) } } };
    files[`${dir}/timeline/tasks/task%3Ak.json`] = JSON.stringify(v2);
    files[`${dir}/timeline/index.json`] = JSON.stringify({ v: 1, at: now, gaps: [], tasks: { "task:k": entry(v2, 2) } });
    tl.files.set(`${dir}/timeline/events.json`, JSON.stringify({ v: 1, lanes: lanesRec, events: events.slice(2), looks: [], gaps: [] }));
    tl.shared.set(A.RECORDED, 101);
    ui.now = now + MIN;
    await draw();
    assert.ok(askShown(), "a minute after the move the ask is still drawn, from the file");
    // 2b. The file rewritten with the same until (a rebuilt past copied in): its new bytes have it read again.
    reads.length = 0;
    const v3 = { ...v2, lanes: { [`t100@${c0}`]: { ...v2.lanes[`t100@${c0}`], rebuilt: { covers: c0, turns: [{ start: c0 + 10 * MIN, end: c0 + 40 * MIN, ended: "answer", asks: [] }] } } } };
    files[`${dir}/timeline/tasks/task%3Ak.json`] = JSON.stringify(v3);
    files[`${dir}/timeline/index.json`] = JSON.stringify({ v: 1, at: now, gaps: [], tasks: { "task:k": entry(v3, 3) } });
    tl.shared.set(A.RECORDED, 102);
    ui.now = now + 2 * MIN;
    await draw();
    assert.ok(reads.includes("timeline/tasks/task%3Ak.json"), "same until, new bytes: read again");
    assert.ok(ui.state.cache.groups[0].tasks[0].lanes[0].stretches.some((st) => st.how === "rebuilt" && st.from === c0 + 10 * MIN), "its rebuilt past is drawn");
  }
  // 2a. A closed task's line holds older work its file does not: a forgotten worker's two days.
  {
    const A = await import("./mods/agent-tower/timeline.js?line");
    const dir = "/made/up/line";
    const c0 = now - 12 * DAY;
    const until = now - 8 * DAY;
    const file = { v: 1, task: "task:q", taskId: "q", title: "Made-up ended", area: "work", from: c0 + 60 * MIN, until, ended: until,
      lanes: { [`t200@${c0}`]: { a: "t200", role: "lead", name: "lead", created: c0, ended: until, thinTo: null, w: [], asks: [], done: [],
        events: [{ s: "working", at: c0 + 60 * MIN }, { s: "idle", at: c0 + 120 * MIN }, { s: "ended", at: until }] } }, looks: [] };
    const files = { [`${dir}/timeline/index.json`]: JSON.stringify({ v: 1, at: 0, gaps: [], tasks: { "task:q": { file: "tasks/task%3Aq.json", taskId: "q", title: file.title, area: "work", from: file.from, until, ended: until, agents: 1, endedLanes: [`t200@${c0}`], bytes: 1 } } }),
      [`${dir}/timeline/tasks/task%3Aq.json`]: JSON.stringify(file) };
    const first = now - 10 * DAY;
    tl.files.set(`${dir}/timeline/backfill.json`, JSON.stringify({ "transcript:claude:s9": { at: now, covers: first, path: "/made/up/s9.jsonl", turns: [{ start: first, end: first + 2 * DAY, ended: "answer", asks: [] }], task: "q", cwd: null, program: "claude", session: "s9", name: "q-worker", machine: null, first, last: first + 2 * DAY } }));
    tl.files.set(`${dir}/timeline/events.json`, JSON.stringify({ v: 1, lanes: {}, events: [], looks: [], gaps: [] }));
    tl.shared.set(A.RECORDED, 200);
    const ui = { now, width: 1100, towerDir: dir, state: { span: 5 }, notify() {}, readPast: (p) => Promise.resolve(files[p] ?? null) };
    for (let i = 0; i < 5; i++) {
      tl.els.clear();
      A.render(theme, { areas: [{ id: "work", label: "Work" }], items: [] }, ui);
      await tick();
    }
    const line = [...tl.els.entries()].filter(([k]) => k.startsWith("S-")).map(([k]) => Number(k.split("-").pop()));
    assert.ok(line.some((at) => at >= first && at < first + 2 * DAY), "the closed line has a mark inside the forgotten worker's two days");
  }
}

// ── backfill.json over Herdr's 1 MiB: read through cat, moved aside, written anew trimmed ──
{
  const B = await import("./mods/agent-tower/timeline.js?big");
  const dir = "/made/up/big";
  const path = `${dir}/timeline/backfill.json`;
  tl.files.set(path, new Error("Text file exceeds 1 MiB"));
  const ran = [];
  tl.exec = (cmd, args) => {
    ran.push([cmd, ...args]);
    if (cmd === "cat") return Promise.resolve({ code: 0, stdout: JSON.stringify({ "t1@1": { at: now, missing: true } }) });
    if (cmd === "mv") tl.files.delete(args[0]);
    return Promise.resolve({ code: 0, stdout: "" });
  };
  let loaded = 0;
  B.backfill(dir, [], () => null, now, () => loaded++);
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ran.map((r) => r[0]), ["cat", "mv"]);
  assert.equal(ran[1].at(-1), `${path}.big`);
  assert.equal(loaded, 1);
  assert.deepEqual(JSON.parse(tl.files.get(path)), { "t1@1": { at: now, missing: true } }, "kept, and written anew");
}

console.log("timeline ok");
