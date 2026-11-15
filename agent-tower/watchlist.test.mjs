// Watchlist on a made-up model: the file's shape, which tasks name a ticker, and the drawn view
// (tickers with their tasks, the notes, a click that selects). gpui-kit, gpui-base and herdr are
// stubbed as in board.test.mjs.
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
const herdr = `export const shared = () => null;
export const home = () => "/home/me";
export const window = () => ({ platform: "linux" });
export const exec = async () => ({ code: 0 });
export const readTextFile = async (p) => globalThis.__files[p] ?? null;`;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "herdr") return { url: "data:text/javascript," + encodeURIComponent(herdr), shortCircuit: true };
    if (spec === "gpui-kit" || spec === "gpui-base") return { url: "data:text/javascript," + encodeURIComponent(stub), shortCircuit: true };
    return next(spec, ctx);
  },
});
globalThis.__files = {};
const w = await import("./mods/agent-tower/watchlist.js");

const text = (el) => (typeof el === "string" ? el : el?.kids ? el.kids.map(text).join(" ") : "");
const find = (el, id) => {
  if (!el?.kids) return null;
  if (el.ids.includes(id)) return el;
  for (const k of el.kids) { const f = find(k, id); if (f) return f; }
  return null;
};

// The file: a list of tickers; a broken or missing one says so.
assert.deepEqual(w.parse('{"tickers":[{"symbol":" VWCE ","note":"core ETF"},{"symbol":""},{"name":"no symbol"}]}').tickers, [{ symbol: "VWCE", name: null, note: "core ETF" }]);
assert.match(w.parse("{nope").error, /isn't valid JSON/);
assert.match(w.parse('{"list":[]}').error, /"tickers"/);
assert.equal(w.parse(null).missing, true);

// Which tasks name a ticker: a whole word in the title, or the lead's task.topic; Needs you first.
const item = (key, title, word, more = {}) => ({ key, title, word, area: "investing", changed: 0, lead: { labels: {} }, need: null, ...more });
const items = [
  item("a", "Research ASML before results", "idle", { changed: 5 }),
  item("b", "Weekly portfolio review", "blocked", { lead: { labels: { "task.topic": "vwce, asml" } }, need: { text: "Sell ASML or hold?" } }),
  item("c", "CASMLX is not ASML", "working", { changed: 9 }),
  item("d", "Kyoto trip", "done"),
];
assert.deepEqual(w.tasksFor("ASML", items).map((i) => i.key), ["b", "c", "a"]);
assert.deepEqual(w.tasksFor("VWCE", items).map((i) => i.key), ["b"]);
assert.deepEqual(w.tasksFor("NVDA", items), []);
assert.equal(w.lastLines("a\nb\nc\n\n", 2), "b\nc");

// Drawn: the files are read (once, then the stage is told), tickers show their tasks, a click selects.
globalThis.__files = {
  "/tower/watchlist.json": JSON.stringify({ tickers: [{ symbol: "ASML", name: "ASML Holding", note: "wait for results" }, { symbol: "NVDA" }] }),
  "/tower/investing-notes.md": "# Memos\n\nASML: hold until 22 Jan.\n",
};
let notified = 0;
let picked = null;
const ui = { now: 100, width: 900, state: {}, towerDir: "/tower", selectedKey: null, hideText: false, rowMark: "state", notify: () => notified++, select: (i) => (picked = i) };
const m = { areas: [{ id: "investing", label: "Investing" }], items };
assert.match(text(w.render({}, m, ui)), /Reading…/);
await new Promise((r) => setTimeout(r, 10));
assert.equal(notified, 1);
const view = w.render({}, m, ui);
const words = text(view);
assert.match(words, /ASML ASML Holding wait for results/);
assert.match(words, /Weekly portfolio review/);
assert.match(words, /Sell ASML or hold\?/, "the question of a task that waits");
assert.match(words, /NVDA No tasks/);
assert.match(words, /ASML: hold until 22 Jan\./, "the notes");
find(view, "watch-b").clicks[0]({}, { stop_propagation() {} });
assert.equal(picked.key, "b");
// Hide text: notes, ticker notes, titles and questions go.
const hidden = text(w.render({}, m, { ...ui, hideText: true }));
assert.ok(!/wait for results|Sell ASML|hold until|Weekly portfolio/.test(hidden), hidden);
// No file yet: says where to put one.
const empty = { ...ui, state: {}, towerDir: "/none" };
w.render({}, m, empty);
await new Promise((r) => setTimeout(r, 10));
assert.match(text(w.render({}, m, empty)), /No watchlist/);

console.log("watchlist ok");
