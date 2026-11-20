// qjs --module <kit>/perf/qjs.mjs <mod folder> <runs>, from a folder holding gpui-kit, gpui-base and
// herdr (each `export * from "<this folder>/stubs.mjs"`): the bench in QuickJS's interpreter, which
// is what Herdr runs a view's first render on. Prints the rows as JSON.
import * as os from "os";
import { buildFixture } from "./fixture.mjs";
import { bench, CASES, GAP_CASES } from "./bench.mjs";
const clock = () => (typeof performance !== "undefined" ? performance.now() : os.now());
const settle = () => new Promise((r) => os.setTimeout(r, 5));
const rows = await bench({ kit: scriptArgs[1], fixture: buildFixture(scriptArgs[3] ?? "big"), clock, settle, runs: Number(scriptArgs[2] ?? 15),
  cases: /^gaps/.test(scriptArgs[3] ?? "") ? GAP_CASES : CASES });
console.log(JSON.stringify(rows));
