// node shellrows.test.mjs: a task's live shells without a tab of their own (task.role=shell, no
// herdr.space: started with hc run, never placed by Herdr) are listed under the task; shells in a
// tab are not. A shell row changes nothing else: the model's states, words, needs, trees and counts
// are the same as with the shell in a tab (the guard), and it opens or folds nothing by itself.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const stubs = join(here, "io-stubs.mjs");
registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: new URL(`file://${stubs}`).href, shortCircuit: true } : next(s, c)) });

let clock = Date.UTC(2026, 10, 15, 12);
Date.now = () => clock;
const model = await import("./mods/agent-tower/model.js");
const panel = await import("./mods/agent-tower-panel/panel.js");

const claude = { key: "claude", name: "Claude Code", agent: true };
const zsh = { key: "zsh", name: "zsh", agent: false };
const term = (address, labels, extra = {}) => ({ address, state: "live", program: claude, status: "idle", ...extra, labels });
// Task k1: a working lead in space s1, a working worker, a shell started with hc run (no tab) and a
// shell in a tab of s1. Task k2: an idle lead and one shell without a tab, nothing else.
const world = (shellTab = false) => [
  term("L", { "task.id": "k1", "task.role": "lead", "task.title": "Made-up garden plan", "herdr.space": "s1", "herdr.tab": "tb1" }, { status: "working" }),
  term("w", { "task.id": "k1", "task.role": "worker" }, { parent: "L", status: "working", name: "soil-test" }),
  term("sh1", { "task.id": "k1", "task.role": "shell", ...(shellTab ? { "herdr.space": "s1", "herdr.tab": "tb9" } : {}) }, { parent: "L", program: zsh, status: null, name: "notes-shell" }),
  term("sh2", { "task.id": "k1", "task.role": "shell", "herdr.space": "s1", "herdr.tab": "tb2" }, { program: zsh, status: null }),
  term("M", { "task.id": "k2", "task.role": "lead", "task.title": "Made-up bird list", "herdr.space": "s2", "herdr.tab": "tb3" }),
  term("sh3", { "task.id": "k2", "task.role": "shell", ...(shellTab ? { "herdr.space": "s2", "herdr.tab": "tb8" } : {}) }, { parent: "M", program: { key: "bash", name: "bash", agent: false }, status: null }),
];
const spaces = [{ id: "s1", name: "garden" }, { id: "s2", name: "birds" }];
const listed = new Map([["L", "working"], ["w", "working"], ["M", "idle"]]);
// Each terminal changed a minute ago, so neither task is in Earlier (one line, nothing under it).
const changes = new Map(["L", "w", "M"].map((a) => [a, { at: clock - 60e3 }]));
const passOf = (terms) => model.taskModel({ terms, listed, spaces, config: model.DEFAULTS, changes, seen: {}, now: clock, titles: {}, reach: [], eye: null });
// What every view and count reads from an item (everything but the terminals' own objects and the shell list).
const plain = (i) => JSON.stringify({ ...i, shells: undefined, live: i.live.map((t) => t.address), lead: i.lead?.address, all: undefined,
  tree: i.tree.map((r) => [r.t.address, r.lines, r.status]), activeTree: i.activeTree.map((r) => [r.t.address, r.lines, r.status]),
  quiet: i.quiet.map((r) => [r.t.address, r.status]), space: i.space?.id, need: model.needOf(i), rows: model.displayRows(i, () => true).length,
  agents: model.agentCount(i), working: model.workingCount(i), group: i.group, state: i.state, word: i.word });

// Guard: a shell without a tab changes nothing a view, a count or a word reads.
{
  const tabless = passOf(world(false));
  const tabbed = passOf(world(true));
  assert.deepEqual(tabless.items.map(plain), tabbed.items.map(plain), "the same task either way");
  assert.deepEqual(tabless.areas, tabbed.areas);
  const sel = (m) => m.items.map((i) => ({ ...model.selectionOf(i), shells: undefined }));
  assert.deepEqual(sel(tabless), sel(tabbed), "Details gets the same members either way");
  const k2 = tabless.items.find((i) => i.taskId === "k2");
  assert.deepEqual([k2.tree.length, k2.activeTree.length, k2.state], [0, 0, "idle"], "a task with only a shell has no tree and stays idle");
}
console.log("guard ok");

// The model lists them: k1's shell started with hc run, k2's; never the one in a tab.
{
  const m = passOf(world(false));
  const shellsOf = (id) => m.items.find((i) => i.taskId === id).shells.map((t) => t.address);
  assert.deepEqual([shellsOf("k1"), shellsOf("k2")], [["sh1"], ["sh3"]]);
  assert.deepEqual(passOf(world(true)).items.map((i) => i.shells.length), [0, 0], "shells in a tab: none");
  // Details gets them apart from its members (its workers, counts and reads stay as they were).
  const k1 = m.items.find((i) => i.taskId === "k1");
  assert.deepEqual(model.selectionOf(k1).shells, ["sh1"]);
  const d = panel.detailOf(model.selectionOf(k1), world(false), listed, spaces, {});
  assert.deepEqual([d.workers.map((w) => w.t.address), d.shells.map((t) => t.address)], [["w"], ["sh1"]]);
  // A task whose lead has ended and only its shells are left: Details lists them once, as members.
  const left = passOf(world(false).filter((t) => t.address !== "M")).items.find((i) => i.taskId === "k2");
  const dl = panel.detailOf(model.selectionOf(left), world(false), listed, spaces, {});
  assert.deepEqual([dl.workers.map((w) => w.t.address), dl.shells.map((t) => t.address)], [["sh3"], []]);
  // Two more ways to have no tab: parked (Herdr's Park leaves herdr.space empty) and on another
  // machine (its own labels, no tab there).
  const more = passOf([...world(false),
    term("sh4", { "task.id": "k1", "task.role": "shell", "herdr.space": "", "herdr.tab": "" }, { parent: "L", program: zsh, status: null }),
    term("m/sh9", { "task.id": "k1", "task.role": "shell" }, { parent: "L", program: zsh, status: null })]);
  assert.deepEqual(more.items.find((i) => i.taskId === "k1").shells.map((t) => t.address), ["sh1", "sh4", "m/sh9"], "parked and remote shells too");
}
console.log("model ok");

// The list: under an open task, a row per shell without a tab, named by its hc name, else its
// program, with "shell" where a worker shows its status. A task with only a shell has a fold chip
// and stays folded until opened.
{
  globalThis.__fx = { files: {}, shared: {}, elements: 0, calls: 0, props: {}, execs: [], watchers: [], failFind: 0, active: true,
    fixture: { terms: world(false), agents: [...listed].map(([address, status]) => ({ address, status })), spaces, machines: [] },
    layout: { id: "root", children: [{ id: "sidebar", size: { px: 320 } }, { id: "work-view", active: "main", children: [{ id: "main" }, { id: "tower-stage" }] }] } };
  const fx = globalThis.__fx;
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };
  const { default: AgentTasks } = await import("./mods/agent-tower/main.js");
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, spawn(f) { Promise.resolve().then(() => f(cx)).catch(() => {}); },
    timer: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) } };
  const v = new AgentTasks();
  v.init({}, cx);
  await settle();
  const draw = async () => {
    fx.ids = new Set();
    fx.texts = [];
    v.render(cx);
    await settle();
  };
  await draw();
  assert.ok(fx.ids.has("at-item-task:k1") && fx.ids.has("at-item-task:k2"), "both tasks listed");
  assert.ok(fx.ids.has("at-sub-w") && fx.ids.has("at-sub-sh1"), "k1 is open (its worker works): its worker and its shell without a tab");
  assert.ok(!fx.ids.has("at-sub-sh2"), "the shell in a tab has no row");
  assert.ok(fx.texts.includes("notes-shell") && fx.texts.includes("shell"), "named by its hc name, the word shell");
  assert.ok(fx.ids.has("at-fold-task:k2") && !fx.ids.has("at-sub-sh3"), "k2 has a fold chip and stays folded: a shell opens nothing");
  v.toggle("task:k2", false);
  await draw();
  assert.ok(fx.ids.has("at-sub-sh3") && fx.texts.includes("bash"), "opened: its shell, named by its program");
  // Moved into a tab (Herdr labels it with its space): the row goes.
  fx.fixture.terms = world(true);
  await draw();
  assert.ok(!fx.ids.has("at-sub-sh1") && !fx.ids.has("at-sub-sh3"), "in a tab: no rows");
}
console.log("list ok");

// Details (the panel mod): the shell without a tab in a Shells block after the workers; none for a
// shell in a tab.
{
  const fx = globalThis.__fx;
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };
  const { default: Panel } = await import("./mods/agent-tower-panel/main.js");
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, spawn(f) { Promise.resolve().then(() => f(cx)).catch(() => {}); },
    timer: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) } };
  const card = async (shellTab) => {
    fx.fixture.terms = world(shellTab);
    const k1 = passOf(world(shellTab)).items.find((i) => i.taskId === "k1");
    fx.shared["agent-tower.selected"] = model.selectionOf(k1);
    const p = new Panel();
    p.init({}, cx);
    await settle();
    fx.ids = new Set();
    fx.texts = [];
    p.render(cx);
    await settle();
    fx.ids = new Set();
    fx.texts = [];
    p.render(cx);
    return { ids: fx.ids, texts: fx.texts };
  };
  const a = await card(false);
  assert.ok(a.ids.has("tp-w-w") && a.ids.has("tp-sh-sh1") && a.texts.includes("Shells") && a.texts.includes("notes-shell"), [...a.ids].join(" "));
  const b = await card(true);
  assert.ok(b.ids.has("tp-w-w") && ![...b.ids].some((x) => x.startsWith("tp-sh-")) && !b.texts.includes("Shells"), "a shell in a tab: no Shells block");
}
console.log("details ok");
