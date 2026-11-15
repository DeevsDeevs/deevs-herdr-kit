// The docked list's render time (perf/list-qjs.mjs) in QuickJS on the big made-up record, with every
// host read a fresh copy as Herdr converts it. A guard against it getting slower. Calibration: the
// owner's Mac logged the list at 13.5 ms median on the code this harness times at 5.44-5.60 ms (the
// 15:51 snapshot), about ×2.45; by that, it now projects to about 7 ms with nothing new and 11 with a
// terminal changing (views use ×8, which would say 23 and 37). Skipped without qjs.
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const qjs = process.env.QJS || (spawnSync("sh", ["-c", "command -v qjs"], { encoding: "utf8" }).stdout.trim() || null);
if (!qjs) {
  console.log("listperf skipped (no qjs)");
  process.exit(0);
}
// QuickJS ms per render on the big record, over which this fails (about 15% above what it takes now).
const CEILING = { "list, nothing new": 3.3, "list, a terminal changes": 5.3 };
const MAC = 2.45;
const root = mkdtempSync(join(tmpdir(), "tower-listperf-"));
let rows;
try {
  for (const name of ["gpui-kit", "gpui-base", "herdr"]) writeFileSync(join(root, name), `export * from ${JSON.stringify(join(here, "perf/mod-stubs.mjs"))};\n`);
  const run = () => JSON.parse(execFileSync(qjs, ["--module", join(here, "perf/list-qjs.mjs"), here, "15", "big"], { cwd: root, encoding: "utf8" }).trim().split("\n").at(-1));
  rows = run();
  // One slow run is not a failure: over the ceiling, timed again, and the faster counts.
  if (rows.some((r) => r.median > CEILING[r.case])) rows = run().map((r, i) => (r.median < rows[i].median ? r : rows[i]));
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`listperf: ${rows.map((r) => `${r.case} ${r.median} ms in quickjs (×${MAC} ${(r.median * MAC).toFixed(1)} on the Mac), ${r.calls} builder calls`).join("; ")}`);
for (const r of rows) assert.ok(r.median <= CEILING[r.case], `${r.case}: ${r.median} ms in quickjs, over ${CEILING[r.case]}`);
console.log("listperf ok");
