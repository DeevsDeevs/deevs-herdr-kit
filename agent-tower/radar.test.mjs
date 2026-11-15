// Radar on a made-up model and on a real taskModel(): rings by word, Needs you creeps in, a sector
// per area, Earlier off the scope, clicks select. gpui-kit, gpui-base and herdr are stubbed.
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
const url = (src) => ({ url: "data:text/javascript," + encodeURIComponent(src), shortCircuit: true });
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "gpui-kit" || spec === "gpui-base") return url(stub);
    if (spec === "herdr") return url("export const shared = () => undefined;");
    return next(spec, ctx);
  },
});
const radar = await import("./mods/agent-tower/radar.js");
const model = await import("./mods/agent-tower/model.js");

const text = (el) => (typeof el === "string" ? el : el?.kids ? el.kids.map(text).join(" ") : "");
const find = (el, id) => {
  if (!el?.kids) return null;
  if (el.ids.includes(id)) return el;
  for (const k of el.kids) { const f = find(k, id); if (f) return f; }
  return null;
};

const MIN = 60 * 1000;
const now = 100 * MIN;
const item = (key, area, word, changed, more = {}) => ({
  key, title: `Task ${key}`, area, word, state: { blocked: "needs", working: "working", done: "done" }[word] ?? "idle",
  changed, need: null, live: [], ...more,
});
const m = {
  areas: [{ id: "work", label: "Work" }, { id: "personal", label: "Personal" }],
  items: [
    item("a", "work", "blocked", now - 25 * MIN, { need: { by: "t1", kind: "Asks you", text: "Ship to everyone or beta first?" } }),
    item("b", "work", "blocked", now - 1 * MIN, { need: { by: "t2", kind: "Needs permission", text: "Run docker compose down -v?" } }),
    item("c", "work", "working", now - 2 * MIN),
    item("d", "personal", "idle", now - 20 * MIN),
    item("e", "personal", "done", now - 1 * MIN),
    item("f", "personal", "idle", now - 3 * 24 * 60 * MIN, { state: "earlier" }),
  ],
};
const dist = (b) => Math.hypot(b.x, b.y);
const bs = Object.fromEntries(radar.blips(m, now).map((b) => [b.item.key, b]));

// Rings by word; Earlier is off the scope.
assert.deepEqual(["a", "b", "c", "d", "e"].map((k) => bs[k].ring), ["needs", "needs", "working", "quiet", "quiet"]);
assert.equal(bs.f, undefined);
// Closer is more urgent: every Needs you inside every working task, every working inside the quiet.
assert.ok(Math.max(dist(bs.a), dist(bs.b)) < dist(bs.c) && dist(bs.c) < Math.min(dist(bs.d), dist(bs.e)));
// The longer it waits, the closer; the longer it is quiet, the farther out.
assert.ok(dist(bs.a) < dist(bs.b));
assert.ok(dist(bs.d) > dist(bs.e));
// Two areas, two halves: Work starts at the top and goes clockwise (right side), Personal the left.
assert.ok(bs.a.x > 0 && bs.c.x > 0 && bs.d.x < 0 && bs.e.x < 0);
// The two Needs you of Work are not neighbours in their sector: something lies between them by angle.
const ang = (b) => Math.atan2(b.y, b.x);
const [lo, hi] = [ang(bs.a), ang(bs.b)].sort((x, y) => x - y);
assert.ok(ang(bs.c) > lo && ang(bs.c) < hi);
// Questions: longest wait first.
assert.deepEqual(radar.asks(m).map((i) => i.key), ["a", "b"]);

// Labels on one side never overlap; the other side is stacked on its own.
const tops = radar.stackLabels([{ key: "x", y: 100, right: true }, { key: "y", y: 105, right: true }, { key: "z", y: 104, right: false }]);
assert.deepEqual([tops.get("x"), tops.get("y"), tops.get("z")], [91, 121, 95]);

// Render: centre count, ring words, area names, the question column; clicks select.
const picked = [];
const menus = [];
const t = new Proxy({}, { get: (_o, k) => `#${String(k)}` });
const ui = { now, width: 1000, height: 700, selectedKey: "a", goInto: (i, o) => picked.push(o?.agent ? `${i.key}>${o.agent}` : i.key), onMenu: (e, thing) => (menus.push(thing), e), hideText: false };
const el = radar.render(t, m, ui);
const all = text(el);
for (const w of ["2 Needs you", "Working", "Done · Idle", "Work", "Personal", "Ship to everyone or beta first?", "1 earlier"]) assert.ok(all.includes(w), w);
assert.ok(!all.includes("Closer is more urgent") && !all.includes("not shown"), "no explaining caption on screen");
find(el, "blip-c").clicks[0]({}, { stop_propagation() {} });
find(el, "dot-d").clicks[0]({}, { stop_propagation() {} });
find(el, "ask-b").clicks[0]({}, { stop_propagation() {} });
// A blip or its label goes into the task; a question opens the agent who asks.
assert.deepEqual(picked, ["c", "d", "b>t2"]);
const menuKeys = menus.map((x) => x.task?.key ?? `area:${x.area}`);
for (const k of ["a", "c", "d", "area:work", "area:personal"]) assert.ok(menuKeys.includes(k), k);
// Narrow (beside the list): no question column; Hide text drops the words.
assert.ok(!text(radar.render(t, m, { ...ui, width: 600 })).includes("beta first"));
assert.ok(!text(radar.render(t, m, { ...ui, hideText: true })).includes("beta first"));

// From the real model: a lead that asks sits in the needs ring of its area.
const live = (address, status, labels, parent = null) => ({ address, state: "live", status, labels, parent, program: { agent: true } });
const real = model.taskModel({
  terms: [
    live("t1", "blocked", { "task.id": "x1", "task.role": "lead", "task.title": "Fix billing export", "task.area": "work" }),
    live("t3", "working", { "task.id": "x2", "task.role": "lead", "task.title": "Plan the trip", "task.area": "personal" }),
  ],
  listed: new Map(), spaces: [], config: model.DEFAULTS, changes: new Map(), now,
});
const rb = radar.blips(real, now);
assert.deepEqual(rb.map((b) => [b.item.taskId, b.ring]).sort(), [["x1", "needs"], ["x2", "working"]]);
assert.ok(text(radar.render(t, real, { ...ui, selectedKey: null })).includes("Fix billing export"));

console.log("ok");
