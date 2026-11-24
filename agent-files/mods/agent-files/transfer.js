// agent-files transfers without Herdr: the hc line that starts one, how transfer.sh's answers
// read, progress from either rsync, plain reasons. `node agent-files/transfer.test.mjs` tests it.

// The hidden folder a copy is made in, beside where it lands; the list leaves these out.
export const STAGE = ".agent-files-";

// A transfer's id: also its hc terminal's name (`files-<id>`) and its folder's name.
export const newId = (now = Date.now(), rand = Math.random) =>
  now.toString(36) + Math.floor(rand() * 46656).toString(36).padStart(3, "0");

// `hc` arguments that start one transfer as a terminal of its own, no parent, gone once it exits.
export function runArgs({ script, root, id, from, src, to, dest }) {
  return ["run", "--bg", "--rm", "--no-notify", "--no-parent", "--name", `files-${id}`, "--label", "agent-files=transfer",
    "--", "sh", script, "run", root, id, from ?? "", src, to ?? "", dest];
}

// How ssh reaches a machine, from `hc machine ls --json`: its target; null for one reached `via`
// a command, or not listed.
export function sshTarget(list, name) {
  const m = (list?.machines ?? []).find((m) => m.name === name);
  return m && !m.via ? m.target : null;
}

// `transfer.sh read`: six NUL-ended fields per transfer.
export function parseRead(stdout) {
  const f = stdout.split("\0"), out = [];
  for (let i = 0; i + 5 < f.length; i += 6) {
    let info = null;
    try { info = JSON.parse(f[i + 1]); } catch {}
    if (info) out.push({ id: f[i], info, status: f[i + 2], alive: f[i + 3], size: Number(f[i + 4]) || 0, chunk: f[i + 5] });
  }
  return out;
}

// rsync 3:   "      3,000,000 100%    2.76GB/s    0:00:00 (xfr#1, to-chk=0/3)"
// openrsync: "       3000000 100%    2.76GB/s   00:00:00 (xfer#1, to-check=1/3)" (no rate under 1 KB/s)
const PROGRESS = /^\s*([\d,]+)\s+(\d+)%(?:\s+([\d.]+)([kKMGT]?B)\/s)?/;
const FINISHED = /\(xf(?:e)?r#\d+/;

export const START = { carry: "", done: 0, cur: 0, rate: null, size: null };

// Folds more of the log into the progress so far. `done`: bytes of files finished, `cur`: of the
// one under way, `size`: what du counted (bytes), `carry`: a line not ended yet.
export function advance(p, chunk) {
  const parts = (p.carry + chunk).split(/[\r\n]/);
  const carry = parts.pop();
  let { done, cur, rate, size } = p;
  for (const line of parts) {
    const s = /^size (\d+)$/.exec(line);
    if (s) { size = Number(s[1]) * 1024; continue; }
    const m = PROGRESS.exec(line);
    if (!m) continue;
    const bytes = Number(m[1].replace(/,/g, ""));
    if (m[3]) rate = speed(m[3], m[4]);
    if (FINISHED.test(line)) { done += bytes; cur = 0; } else cur = bytes;
  }
  // rsync 3 starts an update with \r: the newest one waits in carry for the next.
  const last = PROGRESS.exec(carry);
  if (last) {
    cur = Number(last[1].replace(/,/g, ""));
    if (last[3]) rate = speed(last[3], last[4]);
  }
  return { carry, done, cur, rate, size };
}

function speed(n, unit) {
  const v = Number(n);
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${unit.replace("KB", "kB")}/s`;
}

// Whole percent, never 100 before it is done (du counts blocks, not bytes); null before du answers.
export function percent(p) {
  if (!p.size) return null;
  return Math.min(99, Math.floor(((p.done + p.cur) / p.size) * 100));
}

// The line a person reads from what failed: the first message that says why, without the tool's
// name, rsync's error codes or ssh's host key notes.
export function plainReason(err) {
  const lines = String(err ?? "").split("\n").map((l) => l.trim())
    .filter((l) => l && !/^rsync error:/.test(l) && !/^Warning: Permanently added/.test(l) && !/^rsync: connection unexpectedly closed/.test(l));
  const line = (lines[0] ?? "")
    .replace(/^(?:open)?rsync(?:\(\d+\))?: (?:\[\w+\] )?/, "")
    .replace(/^(?:ssh|du|mv|sh|rmdir|mkdir): /, "")
    .replace(/ \[\w+=[\w.]+\]$/, "")
    .replace(/ \(\d+\)$/, "")
    // rsync names its own function and the path ("send_files failed to open "/a/b": Permission
    // denied"): the row already names the file.
    .replace(/^.*"[^"]*"[^":]*: (?=[^"]+$)/, "");
  if (!line) return "Failed";
  return line[0].toUpperCase() + line.slice(1);
}

// What a transfer is now. `started`: when the mod asked hc for it (ms).
export function stateOf(rec, now) {
  const [word, ...rest] = rec.status.split("\n");
  if (word === "done") return { state: "done", name: rest[0] || rec.info.name };
  if (word === "failed") return { state: "failed", reason: rest.join("\n").trim() === "stopped" ? "Stopped" : plainReason(rest.join("\n")) };
  if (rec.alive === "0") return { state: "failed", reason: "Stopped" };
  if (rec.alive === "" && now - (rec.info.started ?? 0) > 30000) return { state: "failed", reason: "Did not start" };
  return { state: "running" };
}

// A path as a shell reads it, the way Herdr types a dropped file into a terminal.
export function quotePath(p) {
  return /^[A-Za-z0-9/._\-+=:@%~,]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`;
}

// Absolute paths from clipboard text: one per line, plain or file:// URLs.
export function clipboardPaths(text) {
  const out = [];
  for (let line of String(text ?? "").split(/\r?\n/)) {
    line = line.trim();
    if (line.startsWith("file://")) {
      line = line.slice(7).replace(/^localhost(?=\/)/, "");
      try { line = decodeURIComponent(line); } catch { continue; }
    }
    if (line.startsWith("/") && !/[\0-\x1f]/.test(line)) out.push(line.length > 1 ? line.replace(/\/+$/, "") : line);
  }
  return out;
}

// macOS: the files a Finder copy put on the clipboard, one path per line (Herdr's mod API reads
// only the clipboard's text, which for copied files is just their names).
export const MAC_CLIPBOARD = `ObjC.import("AppKit");
var items = $.NSPasteboard.generalPasteboard.pasteboardItems, out = [];
for (var i = 0; i < items.count; i++) {
  var u = items.objectAtIndex(i).stringForType("public.file-url");
  if (u && u.js) out.push($.NSURL.URLWithString(u).path.js);
}
out.join("\\n");`;
