// The perf log: off unless the settings say "perf": true. One line per render ({at, view, ms,
// elements}) and per command ({at, what, ms}) appended to <tower folder>/perf.jsonl. Lines wait in
// memory (at most KEEP_LINES) and go out together, in one sh call, only when flush() is called: on
// the mod's tick and when it closes. Never from a render: a promise started there belongs to the
// copy that rendered, and if that copy goes away it never settles. A send still unsettled after
// STUCK_MS stops blocking the next one; a line then says how many lines it carried ("unconfirmed":
// they may or may not be in the file), and how many were dropped past KEEP_LINES ("dropped").
// Past CAP_BYTES the file moves to perf.jsonl.1 (so at most twice the cap is kept). No terminal
// text: a command is named by its kind and one plain word only.
//
// One log per file: perfLog() for a file it already made returns that log (its lines and its send
// kept), only switched on or off, so the settings being read again never drops anything.
//
// The views build through the counted div / h_flex / v_flex below, so a render's elements are
// counted without walking the tree.

import { div as kitDiv, svg as kitSvg, image as kitImage } from "gpui-kit";
import { v_flex as baseV, h_flex as baseH } from "gpui-base";

export const FILE = "perf.jsonl";
export const CAP_BYTES = 1024 * 1024;
export const KEEP_LINES = 2000;
export const STUCK_MS = 20 * 1000;

let built = 0;
export const div = (...a) => (built++, kitDiv(...a));
export const svg = (...a) => (built++, kitSvg(...a));
export const image = (...a) => (built++, kitImage(...a));
export const v_flex = (...a) => (built++, baseV(...a));
export const h_flex = (...a) => (built++, baseH(...a));
// Elements built since the last call.
export function elements() {
  const n = built;
  built = 0;
  return n;
}

export const now = () => globalThis.performance?.now?.() ?? Date.now();

// Appends text to file, moving the file aside first when it is past cap.
const APPEND = 'mkdir -p "$(dirname "$1")" && if [ -f "$1" ] && [ "$(($(wc -c < "$1")))" -gt "$3" ]; then mv -f "$1" "$1.1"; fi && printf "%s" "$2" >> "$1"';

// A command's name for the log: a kind from KINDS and, when it is a plain lowercase word, the
// next one ("hc ls", "exec git", "read events.json"); anything else, such as an address, a path or
// text, is dropped, and an unknown kind is "?".
export const KINDS = ["hc", "exec", "read", "write", "watch", "shared", "run", "list", "board", "timeline", "radar", "watchlist", "details", "stage"];
export function commandName(what) {
  const [kind, next] = String(what ?? "").trim().split(/\s+/);
  if (!KINDS.includes(kind)) return "?";
  return next && /^[a-z][a-z0-9._-]{0,23}$/.test(next) ? `${kind} ${next}` : kind;
}

// log = perfLog({ on, dir, exec, clock? }); log.render("board", ms, elements); log.command("hc ls", ms);
// log.flush() sends what waits. exec: herdr's exec(program, args).
const logs = new Map();
export function perfLog({ on = false, dir, exec, clock = () => Date.now() }) {
  const file = `${dir}/${FILE}`;
  const known = logs.get(file);
  if (known) return known.set({ on, exec, clock });
  const st = { on, exec, clock, lines: [], sending: null, since: 0, sendingLines: 0, unconfirmed: 0, dropped: 0 };
  function flush() {
    if (st.sending && st.clock() - st.since < STUCK_MS) return st.sending;
    if (st.sending) {
      st.unconfirmed += st.sendingLines;
      st.sending = null;
    }
    if (st.unconfirmed || st.dropped) {
      st.lines.unshift(JSON.stringify({ at: new Date(st.clock()).toISOString(), unconfirmed: st.unconfirmed, dropped: st.dropped }) + "\n");
      st.unconfirmed = st.dropped = 0;
    }
    if (!st.lines.length) return null;
    const batch = st.lines.splice(0);
    const mine = {};
    st.since = st.clock();
    st.sendingLines = batch.length;
    const done = () => {
      if (st.sending === mine.p) st.sending = null;
    };
    try {
      mine.p = Promise.resolve(st.exec("sh", ["-c", APPEND, "perf", file, batch.join(""), String(CAP_BYTES)])).catch(() => null).then(done);
    } catch {
      mine.p = null;
    }
    st.sending = mine.p;
    return st.sending;
  }
  function add(o) {
    if (!st.on) return;
    st.lines.push(JSON.stringify({ at: new Date(st.clock()).toISOString(), ...o }) + "\n");
    if (st.lines.length > KEEP_LINES) {
      st.dropped += st.lines.length - KEEP_LINES;
      st.lines.splice(0, st.lines.length - KEEP_LINES);
    }
  }
  const log = {
    get on() {
      return st.on;
    },
    file,
    // pass: {model (ms of model passes inside, 0 when none ran), why (what made the first run: one word)}.
    render: (view, ms, elements = null, pass) => add({ view: commandName(view), ms: Math.round(ms * 100) / 100, elements, ...pass }),
    command: (what, ms) => add({ what: commandName(what), ms: Math.round(ms * 100) / 100 }),
    // Render state a cut-off render left (left: what, from a fixed few words), how many so far, and
    // where: {view ("list", "stage", "stage <view id>", "other"), step (how far it got: a fixed few words)}.
    cutOff: (left, count, where) => add({ what: "render cut off", left, count, ...where }),
    // The mod's 1 s tick ran ms later than due: the app's thread was busy with something else.
    late: (ms) => add({ what: "tick late", ms: Math.round(ms) }),
    flush,
    waiting: () => st.lines.length,
    set(next) {
      Object.assign(st, next);
      return log;
    },
  };
  logs.set(file, log);
  return log;
}
