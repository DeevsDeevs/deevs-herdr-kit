// qjs --module <kit>/perf/list-qjs.mjs <kit> <runs> [preset], from a folder holding gpui-kit, gpui-base
// and herdr (each `export * from "<kit>/perf/mod-stubs.mjs"`): the docked list's whole render in
// QuickJS's interpreter on a fixture, with nothing new and with one terminal changing every render
// (every host read is a fresh copy, as Herdr converts it). Prints the rows as JSON.
import * as os from "os";
import { buildFixture } from "./big-fixture.mjs";
const kit = scriptArgs[1];
const runs = Number(scriptArgs[2] ?? 15);
const fixture = buildFixture(scriptArgs[3] ?? "big");
globalThis.__fx = { files: { ...fixture.files }, shared: {}, elements: 0, calls: 0, props: {}, fixture, active: true,
  layout: { id: "root", children: [{ id: "sidebar", size: { px: 320 } }, { id: "work-view", active: "main", children: [{ id: "main" }, { id: "tower-stage" }] }] } };
const { default: AgentTasks } = await import(`${kit}/mods/agent-tower/main.js`);
const settle = () => new Promise((r) => os.setTimeout(r, 5));
const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, spawn(f) { Promise.resolve().then(() => f(cx)).catch(() => {}); },
  timer: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) } };
const v = new AgentTasks();
v.init({}, cx);
for (let i = 0; i < 20; i++) await settle();
const time = (label, before) => {
  const times = [];
  for (let i = 0; i < runs + 3; i++) {
    before?.(i);
    __fx.elements = 0;
    __fx.calls = 0;
    const t0 = performance.now();
    v.render(cx);
    if (i >= 3) times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { case: label, median: +times[times.length >> 1].toFixed(2), max: +times.at(-1).toFixed(2), elements: __fx.elements, calls: __fx.calls };
};
const rows = [time("list, nothing new"), time("list, a terminal changes", (i) => {
  fixture.terms = fixture.terms.map((t, j) => (j === 0 ? { ...t, turn: (t.turn ?? 0) + 1 + i } : t));
})];
console.log(JSON.stringify(rows));
