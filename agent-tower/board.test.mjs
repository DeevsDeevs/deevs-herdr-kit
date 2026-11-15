// Board on a made-up model: lanes, columns, the question on its card, chips and clicks.
// gpui-kit and gpui-base are stubbed: an element records its text, ids and click handlers.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const stub = `
const make = () => {
  const node = { kids: [], ids: [], clicks: [] };
  const p = new Proxy(node, { get(target, k) {
    if (k in target) return target[k];
    if (k === "child") return (c) => (c != null && target.kids.push(c), p);
    if (k === "children") return (cs) => (target.kids.push(...cs.filter((c) => c != null)), p);
    if (k === "when") return (on, f) => (on ? f(p) : p);
    if (k === "id") return (v) => (target.ids.push(v), p);
    if (k === "on_click") return (f) => (target.clicks.push(f), p);
    if (k === "hover") return (f) => (f(make()), p);
    return () => p;
  } });
  return p;
};
export const div = make, v_flex = make, h_flex = make, svg = make, image = make;`;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "herdr") return { url: "data:text/javascript," + encodeURIComponent("export const shared = (k) => globalThis.__shared(k);"), shortCircuit: true };
    if (spec === "gpui-kit" || spec === "gpui-base") return { url: "data:text/javascript," + encodeURIComponent(stub), shortCircuit: true };
    return next(spec, ctx);
  },
});
let sharedState = {};
globalThis.__shared = (k) => sharedState[k];
const board = await import("./mods/agent-tower/board.js");

// The text of an element tree, and the element with an id.
const text = (el) => (typeof el === "string" ? el : el?.kids ? el.kids.map(text).join(" ") : "");
const find = (el, id) => {
  if (!el?.kids) return null;
  if (el.ids.includes(id)) return el;
  for (const k of el.kids) { const f = find(k, id); if (f) return f; }
  return null;
};

const term = (address, name, extra = {}) => ({ address, name, labels: {}, ...extra });
const lead = (a) => term(a, null);
const item = (key, area, state, more = {}) => ({
  key, taskId: key, title: `Task ${key}`, area, group: state, state, word: { needs: "blocked", working: "working", done: "done" }[state] ?? "idle",
  lead: lead(`${key}-lead`), leadGone: false, machine: null, machines: [null], tree: [], activeTree: [], quiet: [], live: [],
  need: null, changed: 0, ...more,
});
const m = {
  areas: [{ id: "work", label: "Work", home: "work-vps" }, { id: "personal", label: "Personal", home: null }, { id: "invest", label: "Investing", home: null, todo: true }],
  items: [
    item("a", "work", "needs", { machine: "work-vps", machines: ["work-vps"], need: { by: "work-vps/t9", kind: "Needs permission", text: "Run docker compose down -v?" },
      tree: [{ t: term("work-vps/t9", "repro"), status: "blocked" }], activeTree: [{ t: term("work-vps/t9", "repro"), status: "blocked" }] }),
    item("b", "work", "working", { machine: "work-vps", machines: ["work-vps", "mac"] }),
    item("c", "personal", "done"),
    item("d", "personal", "earlier"),
    item("e", "personal", "idle", { group: "pinned", state: "idle" }),
    item("f", "gone-area", "working"),
  ],
  loose: [],
};

// Lanes: every area in order, empty ones included; columns from the state group, pinned by state.
const ls = board.lanes(m);
assert.deepEqual(ls.map((l) => l.area.id), ["work", "personal", "invest"]);
assert.deepEqual(ls[0].columns.needs.map((i) => i.key), ["a"]);
assert.deepEqual(ls[0].columns.working.map((i) => i.key), ["b"]);
assert.deepEqual(ls[1].columns.idle.map((i) => i.key), ["e"]);
assert.equal(ls[1].earlier, 1);
assert.deepEqual([ls[0].todo, ls[2].todo], [false, true]);
// Inside an area's own window, its lane comes first; the others keep config order.
assert.deepEqual(board.lanes(m, "invest").map((l) => l.area.id), ["invest", "work", "personal"]);
assert.deepEqual(board.lanes(m, "gone").map((l) => l.area.id), ["work", "personal", "invest"]);
assert.equal(ls.flatMap((l) => Object.values(l.columns).flat()).some((i) => i.key === "f"), false);

// Machines named only when not the area's home.
assert.equal(board.awayFrom(m.items[1], "work-vps", "this computer"), "mac");
assert.equal(board.awayFrom(m.items[0], "work-vps", "this computer"), null);
assert.equal(board.awayFrom({ machines: [null, "mac", "work-vps"] }, null, "here"), "mac +1");
assert.equal(board.askerOf(m.items[0]), "repro");

// Render: words from marks, the question on its card, counts in the headers.
const went = [];
const menus = [];
const t = new Proxy({}, { get: (_o, k) => `#${String(k)}` });
const ui = { selectedKey: "a", goInto: (i, o) => went.push([i.key, o?.agent ?? null]), onMenu: (e, thing) => (menus.push(thing), e), here: "this computer", now: 0 };
const el = board.render(t, m, ui);
const all = text(el);
for (const w of ["Working", "Needs you", "Done", "Idle", "Todo", "Work", "Personal", "Investing", "1 earlier"]) assert.ok(all.includes(w), w);
assert.ok(!all.includes("on work-vps") && !all.includes("on this computer"), "no home beside an area");
// The list's order, Needs you first.
assert.deepEqual(board.COLUMNS.map((c) => c.id), ["needs", "done", "working", "idle"]);
assert.ok(text(find(el, "card-a")).includes("repro · Needs permission Run docker compose down -v?"));
assert.ok(!text(find(el, "card-b")).includes("Lead"), "a card not selected shows no chips");

// A card goes into its task; a chip or the question goes in with that agent open.
find(el, "card-b").clicks[0]({}, { stop_propagation() {} });
find(el, "chip-work-vps/t9").clicks[0]({}, { stop_propagation() {} });
find(el, "ask-a").clicks[0]({}, { stop_propagation() {} });
assert.deepEqual(went, [["b", null], ["a", "work-vps/t9"], ["a", "work-vps/t9"]]);
// Right-click: a card has its task's menu, a chip its agent's, a lane name its area's.
const menuKeys = menus.map((x) => x.task?.key ?? x.agent ?? `area:${x.area}`);
for (const k of ["a", "b", "work-vps/t9", "area:work", "area:invest"]) assert.ok(menuKeys.includes(k), k);
assert.ok(text(find(el, "chip-a-lead")).includes("Lead"));
assert.ok(text(find(el, "chip-work-vps/t9")).includes("repro"));

// Idle is a column in every shape, beside the list too.
const narrow = text(board.render(t, m, { ...ui, width: 640 }));
assert.ok(narrow.includes("Idle") && narrow.includes("Task e"));
// The selected card folds its quiet members in the list's words.
const quietItem = { ...m.items[0], quiet: [{ t: term("w/t5", "a"), status: "done" }, { t: term("w/t6", "b"), status: "idle" }] };
const folded = text(board.render(t, { ...m, items: [quietItem] }, ui));
assert.ok(folded.includes("1 done · 1 idle") && !folded.includes("quiet"));

// Hide text keeps the kind and drops the agent's words.
const hidden = text(board.render(t, m, { ...ui, hideText: true }));
assert.ok(hidden.includes("Needs permission") && !hidden.includes("docker"));

// From the real taskModel: a task with a remote worker that asks lands in Needs you, in its area.
const model = await import("./mods/agent-tower/model.js");
const live = (address, status, labels, parent = null) => ({ address, state: "live", status, labels, parent, program: { agent: true } });
const terms = [
  live("t1", "working", { "task.id": "x1", "task.role": "lead", "task.title": "Fix billing export", "task.area": "work" }),
  live("work-vps/t2", "blocked", { "task.id": "x1", "task.role": "worker" }, "t1"),
  live("t3", "working", { "task.id": "x2", "task.role": "lead", "task.title": "Plan the trip", "task.area": "personal" }),
];
const real = model.taskModel({ terms, listed: new Map(), spaces: [], config: model.parseConfig({}).config ?? model.DEFAULTS, changes: new Map(), now: 0 });
const realLanes = board.lanes(real);
assert.deepEqual(realLanes.map((l) => l.area.id), ["work", "personal"]);
assert.deepEqual(realLanes[0].columns.needs.map((i) => i.taskId), ["x1"]);
assert.deepEqual(realLanes[1].columns.working.map((i) => i.taskId), ["x2"]);
assert.ok(text(board.render(t, real, { ...ui, selectedKey: null })).includes("Fix billing export"));

console.log("ok");
