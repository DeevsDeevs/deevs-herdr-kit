// qjs --module perf/garbage-qjs.mjs <model.js>: builds the work items of a made-up task (nested
// workers, a parent loop, a second task with the active tree and its quiet fold) and the rows the list
// draws under each (displayRows, folds shut and open), drops them, and prints {terms, alive,
// afterCollection}: the addresses whose terminal is still alive with no collection run since (held
// by a reference cycle), and after one. A WeakRef reads it at once: an object freed by its count is
// gone, one a cycle holds stays until the collector runs.
import * as std from "std";

const model = await import(scriptArgs[1]);
const agent = { key: "claude", name: "Claude Code", agent: true };
const term = (address, parent, id, labels = {}, extra = {}) => ({ address, parent, state: "live", program: agent, status: "idle", ...extra, labels: { "task.id": id, "task.role": "worker", ...labels } });

let refs;
function build() {
  const terms = [
    term("L", undefined, "k1", { "task.role": "lead", "herdr.space": "s1" }),
    term("a", "L", "k1"), term("a1", "a", "k1"), term("a2", "a", "k1"), term("b", "L", "k1"), term("x", "y", "k1"), term("y", "x", "k1"),
    term("M", undefined, "k2", { "task.role": "lead", "herdr.space": "s2" }),
    term("w", "M", "k2", {}, { status: "working" }), term("w1", "w", "k2", {}, { status: "working" }), term("q", "M", "k2"),
  ];
  refs = terms.map((t) => [t.address, new WeakRef(t)]);
  const items = model.workItems(terms, new Map([["w", "working"]]), [{ id: "s1", name: "one" }, { id: "s2", name: "two" }]);
  if (items.length !== 2 || !items.every((i) => i.tree.length)) throw new Error(`unexpected items: ${items.map((i) => i.key)}`);
  for (const i of items) for (const open of [() => false, () => true]) if (!model.displayRows(i, open).length) throw new Error(`no rows for ${i.key}`);
}

// A collection first, so only live objects are left from loading the module.
std.gc();
build();
const alive = () => refs.filter(([, r]) => r.deref() !== undefined).map(([a]) => a);
const before = alive();
std.gc();
console.log(JSON.stringify({ terms: refs.length, alive: before, afterCollection: alive() }));
