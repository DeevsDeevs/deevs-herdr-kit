// node test.mjs [file …]: runs every *.test.mjs here (or the files named) with plain node, one at a
// time. A file fails when it exits with an error, when it is still alive HANG_MS after its last
// output once it has printed an "ok" line, or when it prints nothing for SILENT_MS, both in awake
// time (a sleeping machine doesn't count). A file that hangs is killed and run again with
// test-hang.mjs preloaded, which prints what keeps it alive. The seconds shown are wall time.
// Exits 1 when any file failed. Node 20 or newer.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
export const HANG_MS = 2000;
const SILENT_MS = 300000;
const MAX_TICK_MS = 250;
const OK = /(^|\s)ok(\s|\(|$)/;
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort();

// One run: { code, hung, out }. hung: "after ok" or "silent".
function run(file, args = []) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [...args, file], { cwd: here, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    // Awake time: each tick adds its gap, capped, so a machine that dozed (the runner suspended
    // with its child) never counts as the child hanging.
    let awake = 0;
    let tick = performance.now();
    let last = 0;
    let okSeen = false;
    let hung = null;
    const seen = (chunk) => {
      out += chunk;
      last = awake;
      okSeen ||= String(chunk).split("\n").some((l) => OK.test(l.trimEnd()));
    };
    child.stdout.on("data", seen);
    child.stderr.on("data", seen);
    const watch = setInterval(() => {
      const now = performance.now();
      awake += Math.min(now - tick, MAX_TICK_MS);
      tick = now;
      if (okSeen && awake - last > HANG_MS) hung = "still alive after its ok line";
      else if (awake - last > SILENT_MS) hung = `no output for ${SILENT_MS / 1000} s`;
      if (hung) child.kill("SIGKILL");
    }, 100);
    // On exit, not on close: a process the test started may hold its output pipes open after it.
    child.on("exit", (code) => {
      clearInterval(watch);
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        done({ code, hung, out });
      }, 100);
    });
  });
}

let failed = 0;
for (const file of files) {
  const t0 = Date.now();
  const r = await run(file);
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.hung && r.code === 0) {
    console.log(`ok   ${file} (${s} s)`);
    continue;
  }
  failed++;
  console.log(`FAIL ${file} (${s} s): ${r.hung ?? `exit ${r.code}`}`);
  process.stdout.write(r.out.replace(/^/gm, "     "));
  if (r.hung) {
    const again = await run(file, ["--import", pathToFileURL(join(here, "test-hang.mjs")).href]);
    console.log(`     what keeps ${file} alive:`);
    process.stdout.write(again.out.split("\n").filter((l) => l.startsWith("[hang]")).join("\n").replace(/^/gm, "     ") + "\n");
  }
}
console.log(failed ? `${failed} of ${files.length} failed` : `all ${files.length} ok`);
process.exitCode = failed ? 1 : 0;
