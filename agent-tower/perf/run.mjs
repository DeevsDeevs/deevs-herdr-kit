// node perf/run.mjs [big|mac] [runs] [case]   the whole mod in V8 (a floor, not Herdr's number)
// cd <dir with gpui-kit, gpui-base, herdr files> && qjs --module <kit>/perf/run.mjs [big|mac] [runs]
//                                              the same in QuickJS's interpreter (Herdr's first render)
// Each of those three files holds: export * from "<kit>/perf/mod-stubs.mjs";
// Prints the table, then the rows as JSON on the last line.
import { buildFixture } from "./big-fixture.mjs";
import { benchMods, table } from "./mods-bench.mjs";

const node = typeof process !== "undefined" && process.versions?.node;
const args = node ? process.argv.slice(2) : scriptArgs.slice(1);
const kit = import.meta.url.replace(/^file:\/\//, "").replace(/\/perf\/run\.mjs$/, "");
let clock, settle, engine;
if (node) {
  const { registerHooks } = await import("node:module");
  const stubs = new URL("./mod-stubs.mjs", import.meta.url).href;
  registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: stubs, shortCircuit: true } : next(s, c)) });
  clock = () => performance.now();
  settle = () => new Promise((r) => setTimeout(r, 0));
  engine = `node ${process.version}`;
} else {
  const os = await import("os");
  clock = typeof performance !== "undefined" ? () => performance.now() : () => os.now();
  settle = () => new Promise((r) => os.setTimeout(r, 0));
  engine = "QuickJS interpreter";
}
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
const preset = args[0] ?? "big";
const only = args[2];
const { MOD_CASES } = await import("./mods-bench.mjs");
const cases = only ? MOD_CASES.filter((c) => c.case.toLowerCase().includes(only.toLowerCase())) : MOD_CASES;
const rows = await benchMods({ kit, fixture: buildFixture(preset), clock, settle, runs: Number(args[1] ?? 10), cases });
console.log(table(rows, `${engine}, ${preset} fixture`));
console.log(JSON.stringify(rows));
