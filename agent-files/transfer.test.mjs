// node agent-files/transfer.test.mjs: transfer.js, and transfer.sh run for real (rsync, sh) with a
// stand-in for ssh that runs the "remote" side here.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as T from "./mods/agent-files/transfer.js";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "mods/agent-files/transfer.sh");
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };

const feed = (text, cut = 7) => {
  let p = T.START;
  for (let i = 0; i < text.length; i += cut) p = T.advance(p, text.slice(i, i + cut));
  return p;
};

await test("openrsync progress (no commas, xfer#, to-check, no rate under 1 KB/s)", () => {
  // client.c rsync_progress: " %14llu %3.0f%% %7.2fMB/s   hh:mm:ss" then "\r", or " (xfer#N, to-check=i/n)\n".
  const log = "size 256\ndir/\ndir/a.bin\n" +
    "          65536  50%    1.00MB/s   00:00:01\r" +
    "         131072 100%    1.00MB/s   00:00:01 (xfer#1, to-check=1/3)\n" +
    "dir/b.txt\n" +
    "            100 100%   00:00:00 (xfer#2, to-check=2/3)\n" +
    "dir/c.bin\n" +
    "          32768  25%   12.50MB/s   00:00:02\r";
  const p = feed(log);
  assert.equal(p.size, 262144);
  assert.equal(p.done, 131172);
  assert.equal(p.cur, 32768);
  assert.equal(p.rate, "13 MB/s");
  assert.equal(T.percent(p), 62);
});

await test("rsync 3 progress (commas, xfr#, to-chk, update starts with \\r)", () => {
  const log = "size 2932\nsending incremental file list\nmy dir/\nmy dir/sub/big.bin\n" +
    "\r         32,768   1%    0.00kB/s    0:00:00" +
    "\r      1,500,000  50%    2.76GB/s    0:00:00";
  let p = feed(log, 5);
  assert.equal(p.cur, 1500000);
  assert.equal(p.rate, "2.8 GB/s");
  assert.equal(T.percent(p), 49);
  p = T.advance(p, "\r      3,000,000 100%    2.76GB/s    0:00:00 (xfr#1, to-chk=0/3)\n");
  assert.equal(p.done, 3000000);
  assert.equal(p.cur, 0);
  assert.equal(T.percent(p), 99, "never 100 before done");
  assert.equal(T.percent(T.START), null);
  assert.equal(T.advance(T.START, "\r  1,024  10%  512.00kB/s  0:00:01").rate, "512 kB/s");
});

await test("plain reasons", () => {
  assert.equal(T.plainReason("ssh: Could not resolve hostname box: Name or service not known\nrsync: connection unexpectedly closed (0 bytes received so far) [Receiver]\nrsync error: unexplained error (code 255) at io.c(232) [Receiver=3.4.1]\n"),
    "Could not resolve hostname box: Name or service not known");
  assert.equal(T.plainReason("rsync: [sender] change_dir \"/x\" failed: No such file or directory (2)\nrsync error: some files/attrs were not transferred (see previous errors) (code 23) at main.c(1338) [Receiver=3.4.1]"),
    "No such file or directory");
  assert.equal(T.plainReason('rsync: [sender] send_files failed to open "/p/secret.key": Permission denied (13)\n'), "Permission denied");
  assert.equal(T.plainReason("du: cannot access '/x/nope': No such file or directory\n"), "Cannot access '/x/nope': No such file or directory");
  assert.equal(T.plainReason("Warning: Permanently added 'h' (ED25519) to the list of known hosts.\nme@h: Permission denied (publickey).\n"), "Me@h: Permission denied (publickey).");
  assert.equal(T.plainReason(""), "Failed");
});

await test("states", () => {
  const info = { name: "a.txt", started: 1000 };
  assert.deepEqual(T.stateOf({ status: "done\na 2.txt", info }, 0), { state: "done", name: "a 2.txt" });
  assert.deepEqual(T.stateOf({ status: "failed\nstopped", info }, 0), { state: "failed", reason: "Stopped" });
  assert.deepEqual(T.stateOf({ status: "", alive: "1", info }, 1e9), { state: "running" });
  assert.deepEqual(T.stateOf({ status: "", alive: "0", info }, 0), { state: "failed", reason: "Stopped" });
  assert.deepEqual(T.stateOf({ status: "", alive: "", info }, 2000), { state: "running" });
  assert.deepEqual(T.stateOf({ status: "", alive: "", info }, 60000), { state: "failed", reason: "Did not start" });
});

await test("paths: quoting, clipboard, hc line, ssh target", () => {
  assert.equal(T.quotePath("/tmp/shot.png"), "/tmp/shot.png");
  assert.equal(T.quotePath("/tmp/my shot.png"), "'/tmp/my shot.png'");
  assert.equal(T.quotePath("/tmp/it's.png"), "'/tmp/it'\\''s.png'");
  assert.deepEqual(T.clipboardPaths("file:///Users/x/My%20File.pdf\r\nfile://localhost/tmp/a/\nreport.pdf\n/abs/b\n"), ["/Users/x/My File.pdf", "/tmp/a", "/abs/b"]);
  assert.deepEqual(T.clipboardPaths(undefined), []);
  const args = T.runArgs({ script: "/m/transfer.sh", root: "/r", id: "abc", from: "box", src: "/s/a b", to: null, dest: "/d" });
  assert.deepEqual(args.slice(-9), ["sh", "/m/transfer.sh", "run", "/r", "abc", "box", "/s/a b", "", "/d"]);
  assert.ok(args.includes("--rm") && args.includes("--no-parent") && args.includes("files-abc"));
  assert.match(T.newId(0, () => 0.5), /^[a-z0-9]+$/);
  const list = { machines: [{ name: "box", target: "me@box", via: false }, { name: "wsl", target: "wsl.exe -e sh -c", via: true }] };
  assert.equal(T.sshTarget(list, "box"), "me@box");
  assert.equal(T.sshTarget(list, "wsl"), null);
  assert.equal(T.sshTarget(list, "gone"), null);
});

// transfer.sh for real: "far" is a machine whose ssh runs the line here.
const dir = mkdtempSync(join(tmpdir(), "agent-files-"));
const fake = join(dir, "fake-ssh");
writeFileSync(fake, '#!/bin/sh\nshift\n[ -n "$SLOW" ] && sleep "$SLOW"\nexec sh -c "$*"\n');
chmodSync(fake, 0o755);
const src = join(dir, "src"), down = join(dir, "Downloads"), there = join(dir, "far folder"), root = join(dir, "state");
for (const d of [join(src, "a dir/sub"), down, there]) mkdirSync(d, { recursive: true });
writeFileSync(join(src, "a dir/sub/big.bin"), Buffer.alloc(300000, 7));
writeFileSync(join(src, "it's.txt"), "hi\n");
writeFileSync(join(src, ".env"), "X=1\n");
let n = 0;
const transfer = (from, path, to, dest, env = {}) => {
  const id = `t${n++}`;
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "info.json"), JSON.stringify({ name: path.split("/").pop(), started: Date.now() }));
  try { execFileSync("sh", [SCRIPT, "run", root, id, from, path, to, dest], { env: { ...process.env, HC_SSH: fake, ...env }, stdio: "pipe" }); } catch {}
  return { id, status: readFileSync(join(root, id, "status"), "utf8") };
};
const staged = (d) => readdirSync(d).filter((f) => f.startsWith(T.STAGE));

await test("download and upload never overwrite: the next free name", () => {
  assert.equal(transfer("far", join(src, "a dir"), "", down).status, "done\na dir\n");
  assert.equal(transfer("far", join(src, "a dir") + "/", "", down).status, "done\na dir 2\n");
  assert.equal(transfer("", join(src, "it's.txt"), "far", there).status, "done\nit's.txt\n");
  assert.equal(transfer("", join(src, "it's.txt"), "far", there).status, "done\nit's 2.txt\n");
  assert.equal(transfer("", join(src, ".env"), "", there).status, "done\n.env\n");
  assert.equal(transfer("", join(src, ".env"), "", there).status, "done\n.env 2\n");
  assert.equal(readFileSync(join(down, "a dir 2/sub/big.bin")).length, 300000);
  assert.deepEqual(staged(down), []);
  assert.deepEqual(staged(there), []);
});

await test("a failure says why and leaves no staging folder", () => {
  const r = transfer("far", join(src, "nope"), "", down);
  assert.match(r.status, /^failed\n/);
  assert.match(T.plainReason(r.status.slice(7)), /No such file or directory/);
  const ro = join(dir, "read-only");
  mkdirSync(ro);
  chmodSync(ro, 0o555);
  const w = transfer("", join(src, "it's.txt"), "far", ro);
  chmodSync(ro, 0o755);
  assert.match(w.status, /^failed\n/);
  assert.deepEqual(staged(ro), []);
});

await test("a stopped transfer says so and cleans up", async () => {
  const id = "stop";
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "info.json"), JSON.stringify({ name: "a dir", started: Date.now() }));
  const child = spawn("sh", [SCRIPT, "run", root, id, "far", join(src, "a dir"), "", down], { env: { ...process.env, HC_SSH: fake, SLOW: "3" }, detached: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 500));
  process.kill(-child.pid, "SIGTERM");
  await new Promise((r) => child.on("exit", r));
  assert.equal(readFileSync(join(root, id, "status"), "utf8"), "failed\nstopped\n");
  assert.deepEqual(staged(down), []);
});

await test("read: every transfer, its log from an offset", () => {
  const all = T.parseRead(execFileSync("sh", [SCRIPT, "read", root, "t0=5"], { encoding: "utf8" }));
  assert.equal(all.length, n + 1);
  const t0 = all.find((r) => r.id === "t0"), t1 = all.find((r) => r.id === "t1");
  assert.equal(t0.alive, "0");
  assert.equal(T.stateOf(t0, Date.now()).state, "done");
  assert.ok(t0.chunk.length === t0.size - 5 && !t0.chunk.startsWith("size"));
  const p = T.advance(T.START, t1.chunk);
  assert.equal(p.size > 0 && p.done, 300000);
  assert.equal(T.stateOf(all.find((r) => r.id === "stop"), Date.now()).reason, "Stopped");
  assert.equal(execFileSync("sh", [SCRIPT, "read", join(dir, "none")], { encoding: "utf8" }), "");
});

execFileSync("rm", ["-rf", dir]);
console.log(`${passed} passed`);
