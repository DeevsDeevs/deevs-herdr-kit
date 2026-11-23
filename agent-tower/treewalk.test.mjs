// node treewalk.test.mjs: the sub-agent tree (model.workItems' tree and activeTree, built by treeOf)
// and the rows the list draws under an open task (model.displayRows) keep their rows, order, folds and
// tree lines; and building them leaves nothing for QuickJS's cycle collector.
// Already pinned elsewhere: a worker started outside the item hangs off the lead and nesting under a
// worker (model.test.mjs, task x1's tree), the top level's last row when the quiet fold follows
// (activeTree of task "top"), nothing active (calm). The cost of the list's draw and of the model pass:
// listperf.test.mjs and perf.test.mjs's "model" case. displayRows, already pinned in model.test.mjs: a
// sub-lead's quiet workers fold under it, an open fold, a fold keeps its rows' own workers under it
// (calm), a shell gets no row, done and idle fold apart.
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as model from "./mods/agent-tower/model.js";

const agent = { key: "claude", name: "Claude Code", agent: true };
const term = (address, parent, labels = {}, extra = {}) => ({ address, parent, state: "live", program: agent, status: "idle", ...extra, labels: { "task.id": "k1", "task.role": "worker", ...labels } });
const lead = (extra = {}) => term("L", undefined, { "task.role": "lead", "herdr.space": "s1" }, extra);
const spaces = [{ id: "s1", name: "made-up", machine: null }];
const rows = (tree) => tree.map((r) => `${r.t.address}:${r.lines.join(".")}`);
const itemOf = (terms) => {
  const items = model.workItems(terms, new Map(), spaces);
  assert.equal(items.length, 1, "one item");
  return items[0];
};

// Nesting three deep, siblings at each level: the last of each level "└", the lines below a last row blank.
const deep = itemOf([lead(), term("a", "L"), term("b", "L"), term("a1", "a"), term("a2", "a"), term("a2x", "a2"), term("b1", "b")]);
assert.deepEqual(rows(deep.tree), ["a:├", "a1:│.├", "a2:│.└", "a2x:│..└", "b:└", "b1:.└"]);

// Several roots under a lead that has ended: each worker of it is a top row, in terminal order.
const roots = itemOf([lead({ state: "ended" }), term("r1", "L"), term("r2", "L"), term("r1a", "r1"), term("r3", "L")]);
assert.ok(roots.leadGone);
assert.deepEqual(rows(roots.tree), ["r1:├", "r1a:│.└", "r2:├", "r3:└"]);

// A member is placed once: its own parent, and a parent loop that never reaches the lead (shown once
// each after the rest; x keeps "├" because y was still in its list when x was drawn).
const loops = itemOf([lead(), term("w1", "L"), term("me", "me"), term("x", "y"), term("y", "x")]);
assert.deepEqual(rows(loops.tree), ["w1:├", "me:└", "x:├", "y:│.└"]);
assert.equal(new Set(loops.tree.map((r) => r.t.address)).size, loops.tree.length, "no member twice");

// The last rule with the quiet fold below: an active top row is not "└" when quiet rows follow it.
const busy = itemOf([lead(), term("q1", "L"), term("w", "L", {}, { status: "working" }), term("w1", "w", {}, { status: "working" }), term("q2", "L")]);
assert.deepEqual(rows(busy.tree), ["q1:├", "w:├", "w1:│.└", "q2:└"]);
assert.deepEqual(rows(busy.activeTree), ["w:├", "w1:│.└"]);
assert.deepEqual(busy.quiet.map((r) => r.t.address), ["q1", "q2"]);

// An empty task: a lead alone has no rows.
const alone = itemOf([lead()]);
assert.deepEqual([alone.tree, alone.activeTree, alone.quiet], [[], [], []]);
console.log("tree rows ok");

// displayRows: rows as "address:lines:status", folds as "fold key:its rows:lines[:open]".
const drawn = (item, open) => model.displayRows(item, open).map((r) => (r.fold ? `fold ${r.key}:${r.rows.map((x) => x.t.address).join(",")}:${r.lines.join(".")}${r.open ? ":open" : ""}` : `${r.t.address}:${r.lines.join(".")}:${r.status}`));
const shut = () => false;
const open = () => true;
const W = { status: "working" };
// A shut fold hides what its rows started, three levels down; open, each is walked under it.
const deepFold = itemOf([lead(W), term("a", "L"), term("b", "L"), term("a1", "a"), term("a1x", "a1"), term("a1y", "a1x"), term("b1", "b")]);
assert.deepEqual(drawn(deepFold, shut), ["fold task:k1:quiet:L:idle:a,b:└"]);
assert.deepEqual(drawn(deepFold, open), ["fold task:k1:quiet:L:idle:a,b:└:open", "a:.├:idle", "a1:.│.└:idle", "a1x:.│..└:idle", "a1y:.│...└:idle", "b:.└:idle", "b1:..└:idle"]);
// A working great-grandchild keeps its whole chain listed; one done and one idle row are just listed.
const chain = itemOf([lead(), term("s", "L"), term("s1", "s"), term("s2", "s1", {}, W), term("q", "L"), term("q2", "L", {}, { status: "done" })]);
assert.deepEqual(drawn(chain, shut), ["s:├:idle", "s1:│.└:idle", "s2:│..└:working", "q2:├:done", "q:└:idle"]);
// A row listed because a worker under it works: its quiet workers are listed after the working one.
const mixed = itemOf([lead(W), term("f1", "L"), term("f2", "L"), term("f1a", "f1", {}, W), term("f1b", "f1"), term("f2a", "f2")]);
assert.deepEqual(drawn(mixed, shut), ["f1:├:idle", "f1a:│.├:working", "f1b:│.└:idle", "f2:└:idle", "f2a:.└:idle"]);
// A lead that has ended: its fold's key has no address.
const gone = itemOf([lead({ state: "ended" }), term("g1", "L"), term("g2", "L"), term("g3", "L", {}, W)]);
assert.deepEqual(drawn(gone, shut), ["g3:├:working", "fold task:k1:quiet::idle:g1,g2:└"]);
assert.deepEqual(drawn(gone, open), ["g3:├:working", "fold task:k1:quiet::idle:g1,g2:└:open", "g1:.├:idle", "g2:.└:idle"]);
// A parent loop never reaches the lead: each of it once, after the rest.
const loop = itemOf([lead(W), term("w", "L", {}, W), term("x", "y"), term("y", "x", {}, W)]);
assert.deepEqual(drawn(loop, shut), ["w:└:working", "x:└:idle", "y:└:working"]);
// A blocked row stays listed like a working one; a worker that is its own parent sits at the top, its kid
// under it (and the walk ends, though the parent chain loops).
const ownParent = itemOf([lead(), term("o", "o"), term("o1", "o"), term("b", "L", {}, { status: "blocked" })]);
assert.deepEqual(drawn(ownParent, shut), ["b:├:blocked", "o:└:idle", "o1:.└:idle"]);
console.log("display rows ok");

// Collector-only garbage: in QuickJS (Herdr's engine) an object nothing refers to is freed at once,
// unless a reference cycle holds it, such as a closure that calls itself through its own binding.
// Those wait for the cycle collector, which runs inside whatever render allocates past its threshold
// (build2/memo-key.md). perf/garbage-qjs.mjs builds the items, drops them, and reports which
// terminals are still alive without a collection. Skipped without qjs (snap.sh sets QJS).
const here = fileURLToPath(new URL(".", import.meta.url));
const qjs = process.env.QJS || (spawnSync("sh", ["-c", "command -v qjs"], { encoding: "utf8" }).stdout.trim() || null);
if (!qjs) {
  console.log("garbage check skipped (no qjs)");
} else {
  const out = JSON.parse(execFileSync(qjs, ["--module", join(here, "perf/garbage-qjs.mjs"), join(here, "mods/agent-tower/model.js")], { encoding: "utf8" }).trim().split("\n").at(-1));
  assert.ok(out.terms > 5, "the check saw the terminals");
  assert.deepEqual(out.alive, [], `terminals still held after the tree was dropped (a cycle holds them): ${out.alive.join(" ")}`);
  assert.deepEqual(out.afterCollection, [], "a collection frees them all");
  console.log("garbage ok");
}
