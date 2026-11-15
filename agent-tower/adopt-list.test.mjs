// node adopt-list.test.mjs: adopt's wiring in the list (main.js, model.js) under perf/mod-stubs.mjs.
// The row menu's "Make a task" makes the row's space a task; a space made with "New space" leads a
// task from birth; an agent opened later in an adopted space joins its task; Earlier is A-Z.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

setTimeout(() => {
  console.error("adopt-list.test.mjs took over 30 s");
  process.exit(1);
}, 30000).unref();
const stubs = new URL("./perf/mod-stubs.mjs", import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: stubs, shortCircuit: true } : next(s, c)) });
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
const model = await import("./mods/agent-tower/model.js");
const { default: List } = await import("./mods/agent-tower/main.js");
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

// A made-up machine: "invoice parser" (one agent), "course notes" (a shell).
const claude = { key: "claude", name: "Claude Code", agent: true }, zsh = { key: "shell", name: "zsh", shell: true, agent: false };
const term = (address, space, extra = {}) => ({ address, state: "live", program: claude, status: "idle", status_ms: Date.now() - 9 * 86400e3, ...extra, labels: { "herdr.space": space, ...extra.labels } });
const spaceList = [{ id: "s1", index: 0, name: "invoice parser", named: true, folder: "~/work/invoice", machine: null, active: true },
  { id: "s2", index: 1, name: "course notes", named: true, folder: "~", machine: null, active: false }];
const fx = (globalThis.__fx = {
  fixture: { terms: [term("t1", "s1"), term("t2", "s2", { program: zsh, status: undefined })], agents: [{ address: "t1", status: "idle", pane: "p1" }], spaces: spaceList, machines: [] },
  files: {}, shared: {}, props: {}, log: [], hcCalls: [], elements: 0, calls: 0,
  layout: { id: "root", children: [{ id: "sidebar", size: { px: 300 }, children: [{ id: "tower-list", content: { mod: "agent-tower" } }] }] },
});
const timers = [];
const cx = { notify() {}, focus_handle: () => ({ focus() {} }), stop_propagation() {}, spawn: (f) => void Promise.resolve().then(() => f(cx)).catch(() => null),
  timer: { every: (ms, f) => (timers.push({ ms, f }), { cancel() {} }), after: () => ({ cancel() {} }) } };
const labelled = () => fx.hcCalls.filter((a) => a[0] === "label").map(([, address, ...pairs]) => [address, ...pairs.filter((p) => !p.startsWith("task.id="))]);
const list = new List();
list.init({}, cx);
await settle();
list.render(cx);
await settle();

// The row menu (its own popup copy): "Make a task" on the agent's row asks the list, which labels.
fx.props = { menu: true, from: list.id, keys: ["agent:t1"], space: "s1", overlay: "o1" };
const menu = new List();
menu.init(fx.props, cx);
const make = menu.menuActions().find((a) => a.label === "Make a task");
assert.ok(make, "an agent row that is not a task offers Make a task");
make.act(cx);
fx.props = {};
list.render(cx);
await settle();
assert.deepEqual(labelled(), [["t1", "task.role=lead", "task.title=invoice parser", "task.area=personal", "task.by=adopt"]]);
assert.equal(fx.log.filter((l) => l.what === "notify").length, 1, "a toast says it is a task now");
// Applied: the list shows a task row; a menu on a task row offers no Make a task.
for (const t of fx.fixture.terms) if (t.address === "t1") Object.assign(t.labels, { "task.id": "inv01", "task.role": "lead", "task.title": "invoice parser", "task.area": "personal", "task.by": "adopt" });
fx.props = { menu: true, from: list.id, keys: ["task:inv01"], space: "s1", overlay: "o1" };
assert.ok(!menu.menuActions().some((a) => a.label === "Make a task"));
// A shell space row: its own menu offers Make a task, then Herdr's space menu.
fx.props = { menu: true, from: list.id, keys: [], space: "s2", shellSpace: true, overlay: "o1" };
assert.deepEqual(menu.menuActions().map((a) => a.label), ["Make a task", "Space menu"]);
fx.props = {};

// New space: the space that appears after the click leads a task from birth, titled with its name, in
// the area shown, once its first terminal is live; then nothing more is asked.
const adopt = await import("./mods/agent-tower/adopt.js");
fx.hcCalls.length = 0;
list.born = adopt.beforeNew(spaceList, null);
fx.fixture.spaces = [...spaceList, { id: "s3", index: 2, name: "new notes", named: false, folder: "~/work/new-notes", machine: null, active: true }];
list.render(cx);
await settle();
assert.deepEqual(labelled(), [], "no terminal in it yet");
fx.fixture.terms.push(term("t3", "s3", { program: zsh, status: undefined }));
list.render(cx);
await settle();
list.render(cx);
await settle();
assert.deepEqual(labelled(), [["t3", "task.role=lead", "task.title=new notes", `task.area=${list.shownArea().id}`, "task.by=space"]]);
assert.equal(list.born, null);

// The join, on the docked list's 30 s timer: an agent opened later in a tab of the adopted space
// joins its task, once.
fx.hcCalls.length = 0;
fx.fixture.terms.push(term("t4", "s1"));
const tick = () => timers.filter((x) => x.ms === 30000).forEach((x) => x.f(cx));
tick();
await settle();
tick();
await settle();
assert.deepEqual(labelled(), [["t4", "task.role=worker"]]);
assert.equal(fx.hcCalls.find((a) => a[0] === "label")[2], "task.id=inv01");

// Earlier: A-Z by title (case aside), a directory; the other groups keep Herdr's recency order.
const old = (key, title, daysAgo) => ({ key, taskId: key, title, labelTitle: title, lead: { address: key, labels: {} }, live: [], tree: [], top: "idle", status: "idle", leftOvers: [], changedTo: daysAgo });
const items = [old("c", "zebra notes", 2), old("a", "Alpha plan", 9), old("b", "beta trip", 5)];
const changes = new Map(items.map((i) => [i.key, { at: Date.now() - i.changedTo * 86400e3 }]));
const groups = model.groupItems(items, changes, Date.now());
assert.deepEqual(groups.find((g) => g.id === "earlier").items.map((i) => i.title), ["Alpha plan", "beta trip", "zebra notes"]);

console.log("adopt-list ok");
