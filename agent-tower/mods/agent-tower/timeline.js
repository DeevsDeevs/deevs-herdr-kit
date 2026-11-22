// Timeline: work over time. One lane per agent, grouped by task (taskModel's items, in the list's
// order), what it did when, a now-line, and a column right of it for what each lane is doing now.
// History is quiet ink; only an open Needs you is loud. What was not recorded is drawn as a gap.
// A click on a stretch selects its task and sets agent-tower.moment: the Details card shows "then".
//
// The past comes from the recorder in the docked list (main.js): <towerDir>/timeline/events.json
// = {v, beat, lanes: {address: {task, taskId, taskTitle, role, name, title, machine, parent, created}},
//    events: [{a, s, turn, at, msg}], looks: [{a, at}], gaps: [{m: "herdr" | machine, from, to}]}.
// s: working | blocked | done | idle | ended. Screens are keyed "<address>@<at>" in screens.json.
// Older than events.json keeps: index.json and one file per task (timeline-long.md, Format), read
// for Week and Month.

// Through perf.js, as board.js does, so the perf log counts what Timeline builds.
import { div, v_flex, h_flex } from "./perf.js";
import { readTextFile, writeTextFile, exec, hc, appHome, shared, setShared } from "herdr";
import { WORD, wordColor, rowMark, duration } from "./marks.js";
import * as model from "./model.js";

export const MOMENT = "agent-tower.moment";
export const RECORDED = "agent-tower.recorded";
const DAY_MS = 24 * 3600e3;
export const SPANS = [
  { name: "1h", ms: 3600e3, tick: 10 * 60e3, says: "1h" },
  { name: "3h", ms: 3 * 3600e3, tick: 30 * 60e3, says: "3h" },
  { name: "8h", ms: 8 * 3600e3, tick: 3600e3, says: "8h" },
  { name: "Day", ms: DAY_MS, tick: 3 * 3600e3, says: "24h" },
  // Long spans: day ticks at local midnight, asks as ticks, workers folded into one lane.
  { name: "Week", ms: 7 * DAY_MS, tick: DAY_MS, says: "7 days", long: true },
  { name: "Month", ms: 30 * DAY_MS, tick: DAY_MS, says: "30 days", long: true },
];
const LABEL_W = 236;
const LANE_H = 24;
const HEAD_H = 24;
// Right of the now-line: what each lane is doing now.
const NOW_COL = 140;

export const EMPTY = { lanes: {}, events: [], looks: [], gaps: [] };

export function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayLabel = (ms) => `${DAYS[new Date(ms).getDay()]} ${new Date(ms).getDate()}`;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
// A stretch's time in a tooltip: hours, with the day at Week and Month.
export function rangeWords(from, to, ongoing, long) {
  if (!long) return `${clock(from)}–${ongoing ? "now" : clock(to)}`;
  if (ongoing) return `${dayLabel(from)} ${clock(from)}–now`;
  return sameDay(from, to) ? `${dayLabel(from)} ${clock(from)}–${clock(to)}` : `${dayLabel(from)} ${clock(from)}–${dayLabel(to)} ${clock(to)}`;
}

// Local midnights after start, before now (a day is 23 or 25 hours across a clock change).
export function dayTicks(start, now) {
  const d = new Date(start);
  d.setHours(24, 0, 0, 0);
  const out = [];
  while (d.getTime() < now) {
    out.push(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// A recorded file as text, checked: anything unreadable is an empty history, never a throw.
export function parseHistory(text) {
  try {
    const h = JSON.parse(text);
    const list = (x) => (Array.isArray(x) ? x : []);
    return {
      lanes: h.lanes && typeof h.lanes === "object" ? h.lanes : {},
      events: list(h.events).filter((e) => e && typeof e.a === "string" && Number.isFinite(e.at)).sort((x, y) => x.at - y.at),
      looks: list(h.looks).filter((l) => l && Number.isFinite(l.at)).sort((x, y) => x.at - y.at),
      // A file written before gaps were joined (one gap per wake of a sleeping Mac) reads joined.
      gaps: model.joinGaps(list(h.gaps).filter((g) => g && Number.isFinite(g.from))),
    };
  } catch {
    return EMPTY;
  }
}

// Each address's events, oldest first, indexed once per loaded file (keyed by its events list).
const byAddress = new WeakMap();
export function eventsOf(h, address) {
  let index = byAddress.get(h.events);
  if (!index) {
    index = new Map();
    for (const e of h.events) {
      if (!index.has(e.a)) index.set(e.a, []);
      index.get(e.a).push(e);
    }
    byAddress.set(h.events, index);
  }
  return index.get(address) ?? [];
}

// The gaps that cover a lane on this machine (null: this computer): Herdr closed, or its machine silent.
// An open gap (to: null) runs to now. start: only those that end after it.
export const gapsFor = (h, machine, now, start = -Infinity) => h.gaps
  .filter((g) => (g.m === "herdr" || (machine && g.m === machine)) && (g.to ?? now) > start)
  .map((g) => ({ ...g, to: g.to ?? now }));

// Gaps (each with its to) as times not recorded: sorted, overlaps joined. Once per gaps array.
const coverOf = new WeakMap();
function cover(gaps) {
  let out = coverOf.get(gaps);
  if (out) return out;
  out = [];
  for (const g of [...gaps].sort((x, y) => x.from - y.from)) {
    const prev = out.at(-1);
    if (prev && g.from <= prev.to) prev.to = Math.max(prev.to, g.to);
    else if (g.to > g.from) out.push({ from: g.from, to: g.to });
  }
  coverOf.set(gaps, out);
  return out;
}

// Stretches minus the gaps: nothing is drawn where nothing was recorded. One binary search per
// stretch, so a long gap list costs little more than a short one. cutFrom: a stretch that ends by then
// (before the span, never drawn or counted there) is left whole.
export function cutGaps(list, gaps, cutFrom = -Infinity) {
  if (!gaps.length) return list;
  const c = cover(gaps);
  const out = [];
  for (const st of list) {
    if (st.to <= cutFrom) {
      out.push(st);
      continue;
    }
    let lo = 0;
    let hi = c.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid].to <= st.from) lo = mid + 1;
      else hi = mid;
    }
    if (lo === c.length || c[lo].from >= st.to) {
      out.push(st);
      continue;
    }
    let from = st.from;
    for (let i = lo; i < c.length && c[i].from < st.to; i++) {
      if (c[i].from > from) out.push({ ...st, from, to: c[i].from, ongoing: false });
      from = Math.max(from, c[i].to);
    }
    if (from < st.to) out.push(from === st.from ? st : { ...st, from });
  }
  return out;
}

// A lane's stretches, oldest first: {s, from, to, msg, ongoing}. live: the model's word for a live
// terminal now; since: when it entered that word, from the one source the list and Details use (the
// sidebar's changes: hc's status_ms when first seen). The recorder only draws what came before it. cutFrom: see cutGaps.
export function stretches(h, address, now, { live = null, since = null, gaps = [], cutFrom = -Infinity } = {}) {
  const evs = eventsOf(h, address);
  // A repeated word (a new turn, a restart) continues the stretch it repeats.
  const merged = [];
  evs.forEach((e, i) => {
    const next = evs[i + 1];
    if (e.s === "ended") return;
    const st = { s: e.s, from: e.at, to: next ? next.at : now, msg: e.msg ?? null, ongoing: !next };
    const prev = merged.at(-1);
    if (prev && prev.s === st.s && prev.to === st.from) merged[merged.length - 1] = { ...st, from: prev.from, msg: prev.msg ?? st.msg };
    else merged.push(st);
  });
  if (!live) return cutGaps(merged, gaps, cutFrom);
  const last = merged.at(-1)?.ongoing ? merged.pop() : null;
  const same = last?.s === live;
  const from = Math.min(since ?? (same ? last.from : now), now);
  const past = (last ? [...merged, { ...last, ongoing: false }] : merged)
    .map((st) => (st.to > from ? { ...st, to: from, ongoing: false } : st))
    .filter((st) => st.to > st.from);
  return cutGaps([...past, { s: live, from, to: now, msg: same ? last.msg : null, ongoing: true }], gaps, cutFrom);
}

// ── Backfill: the past before the recorder, rebuilt from the agent's own transcript. ──
// read.py (agent-tower-panel, t47) gives a transcript's turns in its machine's epoch seconds, with
// that machine's now; they are kept on this computer's clock in <towerDir>/timeline/backfill.json,
// one entry per lane ("<address>@<created_ms>"): {at, covers, path, mtime, size, turns: [{start, end,
// ended, asks: [[from, to|null]]}]} or {missing: true}. Only live agents have a transcript to find.
export const BACKFILL_KEEP_MS = 7 * 86400e3;
export const backfillKey = (lane) => `${lane.a}@${lane.created ?? 0}`;

// An agent alive a minute or more before the recorder first saw it: a live one (found by its pid),
// or an ended one hc may still list (found by folder and time). Not one only a task file has.
export function wantsBackfill(lane, firstAt, now) {
  if (lane.created == null || lane.fileOnly || (!lane.ended && !lane.t)) return false;
  return lane.created < (firstAt ?? lane.since ?? now) - 60e3;
}

// read.py's terminals entry for a lane. Live: its pid. Ended: hc get's argv and cwd, with created and
// finished as seconds ago on this clock (t47's lookup). null: hc no longer lists that agent (gone, or
// its address is another agent's now). others: [{created, argv}] the machine's other lanes (argv null:
// unknown); one created within TWIN_MS with the same message (the argv's last word), or unknown, makes
// an ended one a twin: read.py then gives an ended agy nothing, since whose conversation it is can't be said.
export const TWIN_MS = 120e3;
export function turnsAsk(lane, got, now, others = []) {
  const key = backfillKey(lane);
  if (!lane.ended) return { key, pid: lane.t.pid ?? lane.t.foreground?.pid ?? null, argv: lane.t.foreground?.argv ?? lane.t.argv ?? [], cwd: lane.t.foreground?.cwd ?? lane.t.cwd ?? null };
  if (!got || got.state === "live" || got.created_ms !== lane.created) return null;
  const ago = (ms) => Math.max(0, Math.round((now - ms) / 1000));
  // An argv that is not a list is unknown, as null is.
  const argv = Array.isArray(got.argv) ? got.argv : [];
  const twin = others.some((o) => Math.abs(o.created - got.created_ms) <= TWIN_MS && (!Array.isArray(o.argv) || o.argv.at(-1) === argv.at(-1)));
  return { key, pid: null, argv, cwd: got.cwd ?? null, created_s: ago(got.created_ms), finished_s: ago(got.finished_ms ?? now), ...(twin ? { twin } : {}) };
}

// One read.py answer for one terminal (T), on this computer's clock: readAt is when the answer came.
export function toLocal(T, machineNow, readAt) {
  const at = (sec) => (sec == null ? null : readAt - (machineNow - sec) * 1000);
  return {
    at: readAt, covers: at(T.covers), path: T.path ?? null, mtime: T.mtime ?? null, size: T.size ?? null,
    turns: (T.turns ?? []).map((tr) => ({ start: at(tr.start), end: at(tr.end), ended: tr.ended ?? null, asks: (tr.asks ?? []).map(([a, b]) => [at(a), at(b)]) }))
      .filter((tr) => Number.isFinite(tr.start) && Number.isFinite(tr.end)).sort((x, y) => x.start - y.start),
  };
}

// The stretches a transcript tells between from (the lane's start) and until (where the recorder or
// hc takes over), each with how: "rebuilt" (its timestamps) or "guessed" (a turn that ended on a
// question waited for you until the next one: it may have been read and left).
// A turn is Working from its prompt to its last record; a question tool's wait inside it is Needs
// you; after a turn, quiet (Idle: whether Herdr called it Done, and when you looked, is lost).
export function rebuild(entry, { from, until }) {
  if (!entry?.turns?.length) return [];
  const out = [];
  const push = (s, a, b, how = "rebuilt") => b > a && out.push({ s, from: a, to: b, msg: null, ongoing: false, how });
  entry.turns.forEach((tr, i) => {
    const next = entry.turns[i + 1]?.start ?? until;
    let cur = tr.start;
    for (const [a, b] of tr.asks) {
      if (a == null || a < cur) continue;
      push("working", cur, Math.min(a, tr.end));
      push("blocked", a, b ?? next);
      cur = b ?? next;
    }
    if (cur < tr.end) push("working", cur, tr.end);
    const after = Math.max(cur, tr.end);
    if (tr.ended === "question") push("blocked", after, next, "guessed");
    else if (tr.ended !== "ask-tool") push("idle", after, next);
  });
  const lo = Math.max(from ?? -Infinity, entry.covers ?? -Infinity);
  return out.map((st) => ({ ...st, from: Math.max(st.from, lo), to: Math.min(st.to, until) })).filter((st) => st.to > st.from);
}

// rebuild, kept per cache entry and bounds: a cache miss redraws, it does not re-read every turn.
const rebuilt = new WeakMap();
function rebuiltOnce(entry, from, until) {
  const k = `${from}|${until}`;
  const got = rebuilt.get(entry);
  if (got?.k === k) return got.list;
  const list = rebuild(entry, { from, until });
  rebuilt.set(entry, { k, list });
  return list;
}

// The cache, read once, written by whichever copy ran read.py; a write someone else beat is merged.
// loading and each running read: since when (model.held), so one a cut-off run left lapses.
const fill = { cache: null, text: null, loading: null, asked: new Set(), running: new Map(), version: 0 };
const fillFile = (dir) => `${dir}/timeline/backfill.json`;
// Herdr refuses a file over 1 MiB to read and to write (a write reads first): one found over it is
// read through cat (exec takes 8 MiB) and moved aside to <file>.big, so the next write makes it anew
// (as main.js's readRecorderFile). {text, big}.
async function readFill(path) {
  try {
    return { text: await readTextFile(path), big: false };
  } catch (e) {
    if (!/1 MiB/.test(String(e?.message ?? e))) return { text: null, big: false };
    const r = await exec("cat", [path]).catch(() => null);
    await exec("mv", ["-f", path, `${path}.big`]).catch(() => null);
    return { text: r?.code === 0 ? r.stdout : null, big: true };
  }
}
function saveFill(dir, now, tries = 2) {
  fill.version++;
  const keep = Object.fromEntries(Object.entries(fill.cache).filter(([, e]) => now - (e.at ?? 0) < BACKFILL_KEEP_MS));
  const text = JSON.stringify(model.fitBackfill(keep));
  writeTextFile(fillFile(dir), text, fill.text).then(() => {
    fill.text = text;
  }).catch(async () => {
    if (tries <= 0) return;
    const got = await readFill(fillFile(dir));
    fill.text = got.big ? null : got.text;
    try {
      fill.cache = { ...JSON.parse(got.text ?? "{}"), ...fill.cache };
    } catch {}
    saveFill(dir, now, tries - 1);
  });
}

// The cached entries; asks read.py, once per lane and machine, for the lanes that want a past.
export function backfill(dir, lanes, firstAtOf, now, onLoad) {
  if (!dir) return {};
  if (!fill.cache) {
    if (!model.held(fill.loading)) {
      fill.loading = Date.now();
      readFill(fillFile(dir)).then(({ text, big }) => {
        fill.text = big ? null : text;
        try {
          fill.cache = JSON.parse(text ?? "{}") ?? {};
          fill.version++;
        } catch {
          fill.cache = {};
        }
        if (big) saveFill(dir, now);
        try {
          onLoad?.();
        } catch {}
      });
    }
    return {};
  }
  const want = lanes.filter((l) => !fill.asked.has(backfillKey(l)) && !(backfillKey(l) in fill.cache) && wantsBackfill(l, firstAtOf(l.a), now));
  const byMachine = new Map();
  for (const l of want) {
    const m = l.machine ?? "";
    if (model.held(fill.running.get(m))) continue;
    if (!byMachine.has(m)) byMachine.set(m, []);
    byMachine.get(m).push(l);
  }
  for (const [m, list] of byMachine) {
    const mine = Date.now();
    fill.running.set(m, mine);
    for (const l of list) fill.asked.add(backfillKey(l));
    // Back to the oldest lane's start: at most a day for live agents, a week with ended ones (hc
    // forgets them a day after they end). read.py reads backwards from the end until it passes that.
    const since_s = Math.ceil(Math.min(now - Math.min(...list.map((l) => l.created)), list.some((l) => l.ended) ? 7 * DAY_MS : DAY_MS) / 1000) + 60;
    const t0 = Date.now();
    (async () => {
      try {
        const terminals = [];
        const gets = new Map();
        const get = async (l) => {
          if (!gets.has(l.a)) {
            const r = await hc(["get", l.a, "--json"]).catch(() => null);
            let got = null;
            try {
              got = r?.code === 0 ? JSON.parse(r.stdout) : null;
            } catch {}
            gets.set(l.a, got);
          }
          return gets.get(l.a);
        };
        for (const l of list) {
          const got = l.ended ? await get(l) : null;
          // Its machine's other lanes started near it, with their run lines (unknown when hc no longer has that agent).
          const others = [];
          if (got) {
            for (const o of lanes) {
              if (o.a === l.a || (o.machine ?? "") !== m || o.created == null || Math.abs(o.created - l.created) > TWIN_MS) continue;
              const og = await get(o);
              others.push({ created: o.created, argv: og?.created_ms === o.created ? og.argv ?? null : null });
            }
          }
          const ask = turnsAsk(l, got, now, others);
          if (ask) terminals.push(ask);
          else {
            fill.version++; // before the write: a job cut after it can't leave readers on the old version
            fill.cache[backfillKey(l)] = { at: now, missing: true, gone: true };
          }
        }
        const script = terminals.length ? await readTextFile(`${appHome()}/mods/agent-tower-panel/read.py`) : null;
        if (!script) {
          saveFill(dir, now);
          return;
        }
        const r = await exec("sh", ["-c", 'python3 -c "$1" "$2"', "tower", script, JSON.stringify({ turns: { terminals, since_s } })], { on: m || null, timeout: 30000 });
        // When the answer came, on the clock the view draws by.
        const readAt = now + (Date.now() - t0);
        const out = JSON.parse(r.stdout);
        fill.version++;
        for (const t of terminals) {
          const T = out.turns?.terminals?.[t.key];
          fill.cache[t.key] = T?.path && Number.isFinite(out.now) ? toLocal(T, out.now, readAt) : { at: readAt, missing: true };
        }
        saveFill(dir, readAt);
        onLoad?.();
      } catch {
        // Not cached: it is asked again after Herdr restarts. The lanes it skipped are asked now.
        fill.version++;
        try {
          onLoad?.();
        } catch {}
      } finally {
        if (fill.running.get(m) === mine) fill.running.delete(m);
      }
    })();
  }
  return fill.cache;
}

// ── Agents hc has forgotten: a worker's transcript names its task in its brief (read.py's tasks mode). ──
// Asked once per machine and task while Herdr runs, when Week or Month first shows a task with a gap.
// Kept in backfill.json as "transcript:<program>:<session>": {at, covers, path, mtime, size, turns,
// task, cwd, program, session, name, machine, first, last}, on this clock; t44's writer copies them
// into the task files (timeline-long-t4p.md).
const lost = new Set();
export const fillCache = () => fill.cache ?? {};

// A task whose past has a hole: an agent alive before its first known moment, or a gap while it lived.
export function hasGap(task, h, now) {
  const lanes = [...task.lanes, ...task.folded];
  const firstOf = (l) => l.past?.find((st) => !st.how)?.from ?? (l.fileOnly ? null : eventsOf(h, l.a)[0]?.at ?? null);
  if (lanes.some((l) => l.created != null && !l.rebuilt && l.created < (firstOf(l) ?? now) - 60e3)) return true;
  const from = Math.min(now, ...lanes.map((l) => l.created ?? now));
  // Whether any gap ends after from: the latest end, found once per gaps list and now.
  if (gapEnds?.gaps !== h.gaps || gapEnds.now !== now) {
    let closed = -Infinity;
    let open = false;
    for (const g of h.gaps) {
      if (g.from >= now) continue;
      if (g.to == null) open = true;
      else closed = Math.max(closed, g.to);
    }
    gapEnds = { gaps: h.gaps, now, closed, open };
  }
  return gapEnds.closed > from || (gapEnds.open && now > from);
}
let gapEnds = null;

export function findForgotten(dir, { machines, ids, now, since_s, onLoad }) {
  if (!dir || !fill.cache) return;
  for (const m of machines) {
    const want = ids.filter((id) => !lost.has(`${m}|${id}`));
    if (!want.length || model.held(fill.running.get(`tasks|${m}`))) continue;
    for (const id of want) lost.add(`${m}|${id}`);
    const mine = Date.now();
    fill.running.set(`tasks|${m}`, mine);
    const have = {};
    for (const e of Object.values(fill.cache)) if (e?.session && e.path && (e.machine ?? "") === m) have[e.path] = [e.mtime, e.size];
    const t0 = Date.now();
    (async () => {
      try {
        const script = await readTextFile(`${appHome()}/mods/agent-tower-panel/read.py`);
        if (!script) return;
        const r = await exec("sh", ["-c", 'python3 -c "$1" "$2"', "tower", script, JSON.stringify({ tasks: { ids: want, since_s, have } })], { on: m || null, timeout: 30000 });
        const readAt = now + (Date.now() - t0);
        const out = JSON.parse(r.stdout);
        if (!Number.isFinite(out.now)) return;
        const at = (sec) => readAt - (out.now - sec) * 1000;
        fill.version++;
        for (const T of out.tasks ?? []) {
          if (!T?.session || !T.task) continue;
          const key = `transcript:${T.program ?? "agent"}:${T.session}`;
          if (T.same && fill.cache[key]) {
            fill.cache[key].at = readAt;
            continue;
          }
          fill.cache[key] = { ...toLocal(T, out.now, readAt), task: T.task, cwd: T.cwd ?? null, program: T.program ?? null, session: T.session, name: T.name ?? null,
            machine: m || null, first: at(T.first), last: at(T.last) };
        }
        saveFill(dir, readAt);
        onLoad?.();
      } catch {
        // Asked again after Herdr restarts.
      } finally {
        if (fill.running.get(`tasks|${m}`) === mine) fill.running.delete(`tasks|${m}`);
      }
    })();
  }
}

// The same agent as a lane the task has: started within 2 minutes, in the same folder when both are known.
const cwdOf = (l) => l.t?.foreground?.cwd ?? l.t?.cwd ?? null;
export const sameAgent = (lane, e) => lane.created != null && Math.abs(lane.created - e.first) <= 120e3 && (cwdOf(lane) == null || e.cwd == null || cwdOf(lane) === e.cwd);

// The task's forgotten agents from the cache, as ended lanes: not one it already has (same transcript,
// same lane key, or the same agent by the 2-minute rule).
// The cache's transcript entries by task, built again only when the cache changed (its version).
let byTaskId = { cache: null, version: -1, index: new Map() };
function transcriptsOf(cache, taskId) {
  if (byTaskId.cache !== cache || byTaskId.version !== fill.version) {
    const index = new Map();
    for (const [key, e] of Object.entries(cache)) {
      if (!key.startsWith("transcript:") || !e?.task) continue;
      if (!index.has(e.task)) index.set(e.task, []);
      index.get(e.task).push([key, e]);
    }
    byTaskId = { cache, version: fill.version, index };
  }
  return byTaskId.index.get(taskId) ?? [];
}

export function forgottenLanes(task, taskId, cache) {
  const found = transcriptsOf(cache, taskId);
  if (!found.length) return [];
  const known = [...task.lanes, ...task.folded];
  const paths = new Set(known.map((l) => l.rebuilt?.path).filter(Boolean));
  const out = [];
  for (const [key, e] of found) {
    if (!e.turns?.length || !Number.isFinite(e.first)) continue;
    if (paths.has(e.path) || known.some((l) => l.a === key || sameAgent(l, e))) continue;
    out.push({ a: key, role: "worker", name: e.name ?? e.program ?? "agent", machine: e.machine ?? null, live: null, created: e.first, lines: [], ended: true, fileOnly: true,
      rebuilt: e, past: rebuild(e, { from: e.first, until: e.last ?? e.first }) });
  }
  return out;
}

// When you first looked at the address within [from, to]; already on it when it started counts as at once.
export function firstLook(h, address, from, to) {
  // The looks are sorted by time: find the last at or before from by halving, then walk forward.
  const looks = h.looks;
  let lo = 0;
  let hi = looks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (looks[mid].at <= from) lo = mid + 1;
    else hi = mid;
  }
  if (looks[lo - 1]?.a === address) return from;
  for (let i = lo; i < looks.length && looks[i].at <= to; i++) if (looks[i].a === address) return looks[i].at;
  return null;
}

// Where your focus was, as stretches.
export const focusStretches = (h, now) => h.looks
  .map((l, i) => ({ a: l.a, from: l.at, to: h.looks[i + 1]?.at ?? now }))
  .filter((x) => x.a && x.to > x.from);

// The list's order: its groups (pinned, needs, done, working, idle, earlier), a stale item first,
// then the most recently changed.
const GROUPS = model.GROUPS.map((g) => g.id);
export const listOrder = (items) => items
  .map((item, i) => ({ item, i }))
  .sort((x, y) => (GROUPS.indexOf(x.item.group) - GROUPS.indexOf(y.item.group)) || (Boolean(y.item.stale) - Boolean(x.item.stale))
    || ((y.item.changed ?? 0) - (x.item.changed ?? 0)) || x.i - y.i)
  .map((x) => x.item);

// The lanes, grouped by area (all of them, in both shapes) then task, in the list's order. A task's lanes: its lead, then its
// active tree; its quiet workers (the list's fold) and members that have ended go into `folded`,
// one line until opened. A task only the recorder still knows (hc forgot it) comes last in its
// area, so the past does not vanish with the terminals.
// Each address's last event, once per loaded events list.
const lastEvents = new WeakMap();
function lastEventOf(events) {
  let map = lastEvents.get(events);
  if (!map) lastEvents.set(events, (map = new Map(events.map((e) => [e.a, e]))));
  return map;
}

export function lanesOf(m, h, { now, start, first = null, changes = {}, past = null }) {
  const recordedIn = (a) => eventsOf(h, a).some((e) => e.at >= start) || eventsOf(h, a).at(-1)?.s !== "ended";
  const taken = new Set();
  const tasks = [];
  const sinceOf = (t) => changes?.[t.address]?.at ?? t.status_ms ?? null;
  const fromRow = (row) => ({ a: row.t.address, t: row.t, role: "worker", name: row.t.name ?? row.t.address, machine: machineOf(row.t.address), live: row.status ?? null, since: sinceOf(row.t), wait: waitOf(row.t), created: row.t.created_ms ?? null, lines: row.lines ?? [] });
  const ended = (a, meta) => ({ a, role: meta.role, name: meta.role === "lead" ? "Lead" : meta.name ?? a, machine: meta.machine ?? null, live: null, created: meta.created ?? null, lines: [], ended: true });
  // The Eye is not a task (the list gives it its own row): Timeline leaves it out, live or ended.
  const isEye = (t) => t?.labels?.["tower.eye"] === "1";
  // The task files (Week and Month): the older past of lanes shown, the lanes nobody else still has,
  // and "N ended" for the whole task.
  const lastOf = lastEventOf(h.events);
  // The recorded lanes by task, once: never every lane for every task.
  const byTask = new Map();
  for (const [a, meta] of Object.entries(h.lanes)) {
    if (!meta || meta.eye) continue;
    if (!byTask.has(meta.task)) byTask.set(meta.task, []);
    byTask.get(meta.task).push([a, meta]);
  }
  const itemKeys = new Set(m.items.map((i) => i.key));
  const keyOf = (l) => `${l.a}@${l.created ?? 0}`;
  const files = past?.files ?? {};
  const index = past?.index?.tasks ?? {};
  const addPast = (task, put) => {
    const file = files[task.key];
    task.file = file ?? null;
    const mine = new Map([...task.lanes, ...task.folded].map((l) => [keyOf(l), l]));
    for (const [lk, pl] of Object.entries(file?.lanes ?? {})) {
      if (!pl || pl.eye) continue;
      const drawn = fileStretchesOnce(pl, file.until ?? now);
      if (mine.has(lk)) {
        mine.get(lk).past = drawn;
        continue;
      }
      if (!drawn.some((st) => st.to > start && st.from < now)) continue;
      const a = pl.a ?? (lk.includes("@") ? lk.slice(0, lk.lastIndexOf("@")) : lk);
      put({ a, role: pl.role ?? "worker", name: pl.role === "lead" ? "Lead" : pl.name ?? a, machine: pl.machine ?? null, live: null, created: pl.created ?? null, lines: [], ended: true, past: drawn, pastCut: preparedCut.get(pl) ?? null, fileOnly: true });
    }
    const ended = new Set([...list(index[task.key]?.endedLanes), ...[...task.lanes, ...task.folded].filter((l) => l.ended).map(keyOf)]);
    for (const [a, meta] of byTask.get(task.key) ?? []) if (lastOf.get(a)?.s === "ended") ended.add(`${a}@${meta.created ?? 0}`);
    for (const [lk, pl] of Object.entries(file?.lanes ?? {})) if (pl?.ended != null) ended.add(lk);
    task.endedTotal = ended.size;
  };
  for (const item of listOrder(m.items)) {
    if (isEye(item.lead)) continue;
    const lanes = [];
    const folded = [];
    const add = (list, lane) => {
      if (taken.has(lane.a)) return;
      taken.add(lane.a);
      list.push(lane);
    };
    if (item.lead && !item.leadGone) add(lanes, { a: item.lead.address, t: item.lead, role: "lead", name: "Lead", machine: item.machine ?? null, live: item.status ?? item.lead.status ?? null, since: sinceOf(item.lead), wait: waitOf(item.lead), created: item.lead.created_ms ?? null, lines: [] });
    for (const row of item.activeTree ?? item.tree ?? []) add(lanes, fromRow(row));
    for (const row of item.quiet ?? []) add(folded, { ...fromRow(row), lines: [] });
    for (const [a, meta] of byTask.get(item.key) ?? []) {
      if (recordedIn(a)) add(folded, ended(a, meta));
    }
    const task = { key: item.key, item, area: item.area ?? null, title: item.title, lanes, folded, quiet: item.quiet ?? [] };
    addPast(task, (l) => folded.push(l));
    tasks.push(task);
  }
  // Tasks the model no longer has.
  const gone = new Map();
  for (const [a, meta] of Object.entries(h.lanes)) {
    if (meta.eye || taken.has(a) || !meta.task || itemKeys.has(meta.task) || !eventsOf(h, a).some((e) => e.at >= start)) continue;
    if (!gone.has(meta.task)) gone.set(meta.task, { key: meta.task, item: null, area: meta.area ?? null, title: meta.taskTitle ?? meta.name ?? meta.task, lanes: [], folded: [], quiet: [] });
    gone.get(meta.task).lanes.push(ended(a, meta));
  }
  // Tasks only a task file still has.
  for (const [key, e] of Object.entries(index)) {
    if (gone.has(key) || !files[key] || itemKeys.has(key)) continue;
    gone.set(key, { key, item: null, area: e.area ?? null, title: e.title ?? key, lanes: [], folded: [], quiet: [] });
  }
  for (const task of gone.values()) addPast(task, (l) => task.lanes.push(l));
  for (const task of gone.values()) task.lanes.sort((x, y) => (x.role === "lead" ? -1 : y.role === "lead" ? 1 : 0));
  const all = [...tasks, ...gone.values()].filter((task) => task.lanes.length + task.folded.length);
  // Every area: those with an open ask first (what needs you leads the screen), then the shown one
  // (the window's own, or the list's switch), then config order.
  const ids = [...(m.areas ?? []).map((a) => a.id), null];
  const groups = [];
  for (const id of ids) {
    const these = all.filter((task) => (ids.includes(task.area) ? task.area : null) === id);
    if (these.length) groups.push({ area: id, label: m.areas?.find((a) => a.id === id)?.label ?? "Other", tasks: these });
  }
  const asks = (g) => g.tasks.some(hasAsk);
  return groups.map((g, i) => ({ g, i })).sort((x, y) => asks(y.g) - asks(x.g) || (y.g.area === first) - (x.g.area === first) || x.i - y.i).map((x) => x.g);
}

// A task with an agent waiting on you now.
export const hasAsk = (task) => [...task.lanes, ...task.folded].some((l) => l.live === "blocked");

// The fold's words, the list's ("2 done · 10 idle"), and how many ended.
export function foldWords(task) {
  const endedCount = Math.max(task.endedTotal ?? 0, task.folded.filter((l) => l.ended).length);
  return [model.quietWords(task.quiet), endedCount ? `${endedCount} ended` : null].filter(Boolean).join(" · ");
}

// What a wait is, in the list's words ("Needs permission", "Asks you", …).
const waitOf = (t) => model.waitWords(t);

const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

// A task's one line: at each moment the most urgent thing any of its agents did (Needs you, Working,
// the lead's Done, Idle; a worker's Done counts as Idle, as in the list). Recorded beats rebuilt.
const RANK_OF = { blocked: 4, working: 3, done: 2, idle: 1 };
export function summaryOf(task, from = -Infinity, to = Infinity) {
  // Only what the span shows, in one sweep over the cuts: at each, the most urgent piece active (the
  // first, among equals). A day of rebuilt past is hundreds of pieces; never compare all with all.
  const rank = (st, lane) => 2 * (RANK_OF[st.s === "done" && lane.role !== "lead" ? "idle" : st.s] ?? 0) + (st.how ? 0 : 1);
  const edges = [];
  let i = 0;
  for (const lane of [...task.lanes, ...task.folded]) {
    for (const st of lane.stretches ?? []) {
      if (st.to <= st.from || st.to <= from || st.from >= to) continue;
      const p = { st, lane: st.lane ?? lane, r: rank(st, lane), i: i++ };
      edges.push([st.from, 1, p], [st.to, -1, p]);
    }
  }
  edges.sort((x, y) => x[0] - y[0]);
  const active = Array.from({ length: 10 }, () => new Set());
  const out = [];
  for (let k = 0; k < edges.length;) {
    const a = edges[k][0];
    for (; k < edges.length && edges[k][0] === a; k++) {
      const [, d, p] = edges[k];
      if (d > 0) active[p.r].add(p);
      else active[p.r].delete(p);
    }
    if (k >= edges.length) break;
    const b = edges[k][0];
    let best = null;
    for (let r = 9; r >= 0 && !best; r--) for (const p of active[r]) if (!best || p.i < best.i) best = p;
    if (!best) continue;
    const s = best.st.s === "done" && best.lane.role !== "lead" ? "idle" : best.st.s;
    const prev = out.at(-1);
    const ongoing = Boolean(best.st.ongoing) && b === best.st.to;
    if (prev && prev.to === a && prev.s === s && prev.how === best.st.how) Object.assign(prev, { to: b, ongoing });
    else out.push({ s, from: a, to: b, how: best.st.how, msg: best.st.msg, ongoing, lane: best.lane });
  }
  return out;
}

// A task that did nothing in the shown span and needs nothing: it folds into its area's quiet line.
export const isQuiet = (task, start) => !task.lanes.some((l) => l.live === "blocked")
  && task.item?.group !== "needs" && task.item?.group !== "done"
  && ![...task.lanes, ...task.folded].some((l) => (l.stretches ?? []).some((st) => st.from >= start && st.s !== "idle"));

// Every Needs-you stretch in the shown lanes since `since`: how long it waited, how soon you looked.
export function attention(h, lanes, since, now) {
  const all = [];
  for (const lane of lanes) {
    // A lane's asks (all of them, with when you first looked) are kept with its memo while its
    // stretches and the looks hold; the span's start only filters them.
    const k = `${h.looks.length}|${h.looks.at(-1)?.at ?? 0}`;
    if (lane.memo?.asksKey === k && lane.memo.asksOf === lane.stretches) {
      for (const x of lane.memo.asks) if (x.to >= since) all.push({ ...x, lane });
      continue;
    }
    const mine = [];
    for (const st of lane.stretches) {
      if (st.s !== "blocked" || st.how === "guessed") continue;
      const seen = firstLook(h, lane.a, st.from, st.to);
      mine.push({ ...st, waited: st.to - st.from, seenAfter: seen == null ? null : seen - st.from });
    }
    if (lane.memo) Object.assign(lane.memo, { asksKey: k, asksOf: lane.stretches, asks: mine });
    for (const x of mine) if (x.to >= since) all.push({ ...x, lane });
  }
  return {
    count: all.length,
    open: all.filter((x) => x.ongoing),
    waited: all.reduce((sum, x) => sum + x.to - Math.max(x.from, since), 0),
    longest: all.reduce((best, x) => (!best || x.waited > best.waited ? x : best), null),
  };
}

// What the Details card is told about a picked stretch (shape agreed with t47).
export function momentOf(key, address, st, h) {
  const seen = firstLook(h, address, st.from, st.to);
  // A Working stretch's screen is the one taken where it stopped.
  const at = st.s === "working" ? (st.ongoing ? null : st.to) : st.from;
  return { key, address, at: st.from, to: st.ongoing ? null : st.to, word: st.s, msg: st.msg, screen: at == null ? null : `${address}@${at}`, looked: seen == null ? null : seen - st.from };
}

// The recorded file, loaded again on each write the recorder announces (shared RECORDED), and at
// least once a minute, since another window's recorder announces nothing here. One cache for every copy.
const store = { h: EMPTY, stamp: undefined, loading: null, at: 0, version: 0 };
export function history(dir, onLoad, now = Date.now()) {
  const stamp = shared(RECORDED) ?? null;
  if ((stamp !== store.stamp || now - store.at > 60e3) && !model.held(store.loading) && dir) {
    const mine = (store.loading = Date.now());
    store.at = now;
    readTextFile(`${dir}/timeline/events.json`).catch(() => null).then((text) => {
      const h = text ? parseHistory(text) : EMPTY;
      Object.assign(store, { h, stamp, version: store.version + 1 });
      if (store.loading === mine) store.loading = null;
      try {
        onLoad?.();
      } catch {}
    });
  }
  return store.h;
}

// ── The long past (timeline-long.md, Format): index.json, then only the task files the span overlaps. ──
const list = (x) => (Array.isArray(x) ? x : []);
const PAST_RELOAD_MS = 5 * 60e3;

export function parseIndex(text) {
  try {
    const x = JSON.parse(text ?? "null");
    const tasks = {};
    for (const [k, e] of Object.entries(x?.tasks ?? {})) {
      if (e && /^tasks\/[^/]+\.json$/.test(e.file ?? "") && Number.isFinite(e.from) && Number.isFinite(e.until)) tasks[k] = e;
    }
    return { tasks, gaps: model.joinGaps(list(x?.gaps).filter((g) => g && Number.isFinite(g.from))) };
  } catch {
    return { tasks: {}, gaps: [] };
  }
}

export function parseTaskFile(text) {
  try {
    const x = JSON.parse(text ?? "null");
    return x && x.lanes && typeof x.lanes === "object" ? x : null;
  } catch {
    return null;
  }
}

// One lane of a task file as stretches on this clock: the thinned part (w, asks, done: seconds from
// created) before thinTo, the raw events after it, and before both a frozen rebuilt past.
export function fileStretches(pl, until) {
  const c = pl.created ?? 0;
  const at = (sec) => c + sec * 1000;
  const thin = pl.thinTo ?? until;
  const st = (s, from, to, msg = null) => ({ s, from, to, msg, ongoing: false });
  const out = [];
  for (const [a, b] of list(pl.w)) out.push(st("working", at(a), at(b)));
  for (const [a, b, msg] of list(pl.asks)) out.push(st("blocked", at(a), b == null ? thin : at(b), msg ?? null));
  // A Done lasts until the next thing starts, as in the recorder.
  const starts = out.map((x) => x.from).sort((x, y) => x - y);
  for (const [a, msg] of list(pl.done)) out.push(st("done", at(a), Math.min(thin, starts.find((x) => x > at(a)) ?? thin), msg ?? null));
  const events = list(pl.events).filter((e) => e && Number.isFinite(e.at)).map((e) => ({ ...e, a: "" })).sort((x, y) => x.at - y.at);
  const raw = stretches({ events }, "", until).map((x) => ({ ...x, ongoing: false }));
  const known = [...out, ...raw].filter((x) => x.to > x.from).sort((x, y) => x.from - y.from);
  const rebuilt = pl.rebuilt?.turns ? rebuild(pl.rebuilt, { from: c, until: known[0]?.from ?? pl.ended ?? until }) : [];
  // Marked: the task's line takes these from the file's own summary (prepareFile), not again per lane.
  return [...rebuilt, ...known].map((x) => ({ ...x, file: true }));
}

// A task file's line as marks, per pixel size (lineMarks in render; the first in the file's load job).
const fileMarks = new WeakMap();
export function fileMarksFor(file, pxMs, long, spanMs) {
  let byPx = fileMarks.get(file);
  if (!byPx) fileMarks.set(file, (byPx = new Map()));
  const k = `${pxMs}|${long}`;
  if (!byPx.has(k)) {
    const cut = file.until ?? 0;
    const spans = Math.max(1, Math.ceil((cut - (file.from ?? cut)) / spanMs));
    byPx.set(k, toPixels(long ? forSpan(file.summary ?? [], pxMs) : file.summary ?? [], pxMs, MAX_MARKS * spans));
  }
  return byPx.get(k);
}
// A file lane's stretches minus the index's gaps, cut when the file loads (prepareFile).
const preparedCut = new WeakMap();
// Marks (and asks) of such a lane, per pixel size and span.
const preparedMemo = new WeakMap();

// A lane's file past up to where the recorder takes over, minus its gaps: kept per list while those
// hold (the same gaps array: gapsOnce keeps it while its gaps are the same), and for any later cutFrom.
const olderMemo = new WeakMap();
function olderOnce(list, first, gaps, cutFrom) {
  if (!list?.length) return [];
  const got = olderMemo.get(list);
  if (got?.first === first && got.gaps === gaps && got.cutFrom <= cutFrom) return got.out;
  const out = cutGaps(list.map((st) => (st.to > first ? { ...st, to: first } : st)).filter((st) => st.to > st.from), gaps, cutFrom);
  olderMemo.set(list, { first, gaps, cutFrom, out });
  return out;
}

// A file lane's stretches, converted once per loaded file (a file read again is a new object).
const converted = new WeakMap();
function fileStretchesOnce(pl, until) {
  const got = converted.get(pl);
  if (got?.until === until) return got.list;
  const list = fileStretches(pl, until);
  converted.set(pl, { until, list });
  return list;
}

// Done once when a task file loads, in its promise job (Herdr gives those 500 ms, a render 50): every
// lane converted, and the whole file's line, so a render never walks a month of past.
export function prepareFile(file, gaps = []) {
  // One until for this and lanesOf (a file without one gets the time it loaded).
  file.until ??= Date.now();
  const until = file.until;
  const byMachine = new Map();
  const lanes = Object.entries(file.lanes ?? {}).filter(([, pl]) => pl && !pl.eye).map(([lk, pl]) => {
    const a = pl.a ?? (lk.includes("@") ? lk.slice(0, lk.lastIndexOf("@")) : lk);
    const gm = pl.machine ?? "";
    if (!byMachine.has(gm)) byMachine.set(gm, gaps.filter((g) => g.m === "herdr" || (pl.machine && g.m === pl.machine)).map((g) => ({ ...g, to: g.to ?? until })));
    const cut = cutGaps(fileStretchesOnce(pl, until), byMachine.get(gm));
    preparedCut.set(pl, cut);
    return { a, role: pl.role ?? "worker", name: pl.name ?? a, stretches: cut };
  });
  file.summary = summaryOf({ lanes, folded: [] }).map((x) => ({ ...x, file: true }));
  return file;
}

// loading (here and per file): since when (model.held), so one a cut-off run left lapses.
const past = { dir: null, index: null, at: 0, loading: null, files: {}, version: 0 };
const gapsKey = (gaps) => (gaps ?? []).map((g) => `${g.m}:${g.from}-${g.to}`).join(",");
// {index, files: {task key: parsed file}}: the index always (small; "N ended" needs it), the task
// files only at Week and Month, and only those overlapping [start, now]. read: the files' reader.
export function longPast(dir, { start, now, long, onLoad, read = readTextFile, prepare = null }) {
  if (!dir) return { index: null, files: {} };
  if (past.dir !== dir) Object.assign(past, { dir, index: null, at: 0, loading: null, files: {}, version: past.version + 1 });
  const loaded = () => {
    try {
      onLoad?.();
    } catch {}
  };
  past.prepare = prepare;
  // Read again on each recorder write (the hourly move rewrites the index and announces it so), and at
  // least every 5 minutes for any other writer. An unchanged index changes nothing.
  const stamp = shared(RECORDED) ?? null;
  if (!model.held(past.loading) && (!past.index || stamp !== past.stamp || now - past.at > PAST_RELOAD_MS)) {
    const mine = (past.loading = Date.now());
    past.at = now;
    past.stamp = stamp;
    Promise.resolve().then(() => read(`${dir}/timeline/index.json`)).catch(() => null).then((text) => {
      if (past.loading === mine) past.loading = null;
      if (past.index && text === past.indexText) return;
      const index = parseIndex(text);
      // New gaps: the files already loaded are cut again, here in the job, not in a render. The new
      // index is kept only after that, so a job cut off on the way is done again on the next reload.
      if (gapsKey(index.gaps) !== gapsKey(past.index?.gaps)) {
        for (const f of Object.values(past.files)) {
          if (!f.data) continue;
          prepareFile(f.data, index.gaps);
          fileMarks.delete(f.data);
          try {
            past.prepare?.(f.data);
          } catch {}
        }
      }
      Object.assign(past, { index, indexText: text, version: past.version + 1 });
      loaded();
    });
  }
  const files = {};
  for (const [key, e] of Object.entries(past.index?.tasks ?? {})) {
    if (!long || e.from > now || e.until < start) continue;
    let f = past.files[key];
    // Any rewrite shows in the entry (bytes at least): read the file again then, not only on a new until.
    const sig = `${e.until}|${e.bytes ?? ""}|${e.thinned ?? ""}|${e.ended ?? ""}`;
    // A load still marked but lapsed was cut off: it is read again too.
    if (!f || ((f.sig !== sig || f.loading != null) && !model.held(f.loading))) {
      f = past.files[key] = { sig, loading: Date.now(), data: f?.data ?? null };
      const mine = f;
      Promise.resolve().then(() => read(`${dir}/timeline/${e.file}`)).catch(() => null).then((text) => {
        const data = parseTaskFile(text);
        if (data) {
          prepareFile(data, past.index?.gaps ?? []);
          try {
            past.prepare?.(data);
          } catch {}
        }
        Object.assign(mine, { loading: null, data });
        past.version++;
        loaded();
      });
    }
    if (f.data) files[key] = f.data;
  }
  return { index: past.index, files };
}

// At Week and Month a pixel is 11 to 48 minutes: Working merges across gaps under a pixel, asks
// within 3px share one tick (n of them; one keeps the first), a worker's Done is Idle, Idle is not drawn.
export function forSpan(stretchList, pxMs, role = "lead") {
  const out = [];
  const last = {};
  for (const st of stretchList) {
    const s = st.s === "done" && role !== "lead" ? "idle" : st.s;
    if (s === "idle" && !st.ongoing) continue;
    const near = s === "blocked" ? 3 * pxMs : s === "done" ? 2 * pxMs : pxMs;
    const k = `${s}|${st.how ?? ""}`;
    const prev = last[k];
    if (prev && !st.ongoing && !prev.ongoing && st.from - prev.to < near) {
      prev.to = Math.max(prev.to, st.to);
      prev.n += 1;
      continue;
    }
    out.push((last[k] = { ...st, s, n: 1, one: st }));
  }
  return out;
}

// What a row's pixels can show. Marks of one word less than two pixels apart join (asks only with
// asks: "3× Needs you"); a run of other marks under two pixels wide becomes one with the most urgent
// word (n of them; one keeps the most urgent). Past the cap the reach doubles until the row fits.
export const MAX_MARKS = 10;
// An open lane shows one agent, and only a few are on screen: it may draw more.
export const LANE_MARKS = 48;
const URGENT = { blocked: 4, done: 3, working: 2, idle: 1 };
// Marks are always new objects: segment writes its words (tip, took) on a mark, never on a stretch
// that other spans and widths share.
const fresh = (st, extra) => ({ ...st, tip: undefined, took: undefined, wordsAt: undefined, ...extra });
function pixelPass(stretchList, minMs, pack) {
  const out = [];
  for (const st of stretchList) {
    const prev = out.at(-1);
    const near = prev && !st.ongoing && !prev.ongoing && st.from - prev.to < minMs;
    if (near && prev.s === st.s && prev.how === st.how) {
      if (!prev.joined) out[out.length - 1] = fresh(prev, { joined: true, n: prev.n ?? 1, one: prev.one ?? prev });
      const p = out.at(-1);
      p.to = Math.max(p.to, st.to);
      p.n += st.n ?? 1;
      continue;
    }
    const small = pack && !st.ongoing && st.to - st.from < minMs;
    if (small && near && prev.packed) {
      prev.to = Math.max(prev.to, st.to);
      prev.n += st.n ?? 1;
      if ((URGENT[st.s] ?? 0) > (URGENT[prev.s] ?? 0)) Object.assign(prev, { s: st.s, msg: st.msg ?? null, how: st.how, lane: st.lane ?? prev.lane, one: st.one ?? st });
      continue;
    }
    out.push(small ? fresh(st, { packed: true, n: st.n ?? 1, one: st.one ?? st }) : fresh(st));
  }
  return out;
}
// Asks and the rest go through apart, asks drawn last (on top).
export function toPixels(stretchList, pxMs, cap = MAX_MARKS) {
  const asks = stretchList.filter((st) => st.s === "blocked");
  const rest = stretchList.filter((st) => st.s !== "blocked");
  for (let minMs = 2 * pxMs; ; minMs *= 2) {
    const out = [...pixelPass(rest, minMs, true), ...pixelPass(asks, minMs, false)];
    if (out.length <= cap || minMs > 1e12) return out;
  }
}

function storedSpan() {
  try {
    const i = Number(localStorage.getItem("agent-tower.timeline.span"));
    return SPANS[i] ? i : 2;
  } catch {
    return 2;
  }
}

// The record with the index's gaps (older than events.json keeps) joined in: once per pair of files.
let joinedLast = null;
function withIndexGaps(recorded, indexGaps = []) {
  if (joinedLast?.recorded !== recorded || joinedLast.indexGaps !== indexGaps) {
    joinedLast = { recorded, indexGaps, h: { ...recorded, gaps: model.joinGaps([...indexGaps, ...recorded.gaps]) } };
  }
  return joinedLast.h;
}

// The gaps that cut one machine's lanes: every gap of the history, whatever the span start, so a
// stretch that crosses the start is cut by a gap before it too. Those less than a pixel apart are
// joined (what lies between could not show). Kept as the same array while they are the same, so a
// lane's memo and cutGaps' cover hold across rebuilds. Once per machine per rebuild. An open gap (a
// machine not answering) runs to Infinity: nothing after its start was recorded, so it cuts the same
// as one to now, and the list doesn't change as now moves. Its band is drawn to the now-line.
// Kept per machine and pixel size, so views at different spans (every copy shares this module) keep
// their own; the GAPS_KEPT used last stay.
const GAPS_KEPT = 32;
const gapsKept = new Map();
const closedJoined = new WeakMap();
function gapsOnce(h, machine, pxMs) {
  // The closed ones joined once per gaps list, machine and pixel size; the open ones each rebuild.
  let byKey = closedJoined.get(h.gaps);
  if (!byKey) closedJoined.set(h.gaps, (byKey = new Map()));
  const ck = `${machine ?? ""}|${pxMs}`;
  if (!byKey.has(ck)) byKey.set(ck, model.joinGaps(gapsFor({ gaps: h.gaps.filter((g) => g.to != null) }, machine, Infinity), pxMs));
  const closed = byKey.get(ck);
  const open = gapsFor({ gaps: h.gaps.filter((g) => g.to == null) }, machine, Infinity);
  const openKey = open.map((g) => `${g.m}:${g.from}`).join(",");
  const was = gapsKept.get(ck);
  // Compared by value only when the file was read again or an open gap came or went.
  const kept = was?.closed === closed && was.openKey === openKey ? was : (() => {
    const all = open.length ? model.joinGaps([...closed, ...open], pxMs) : closed;
    const key = all.map((g) => `${g.m}:${g.from}-${g.to}`).join(",");
    return { closed, openKey, key, all: was?.key === key ? was.all : all };
  })();
  // Moved to the end (most recently used) with nothing between: a render cut off here keeps the slot.
  gapsKept.delete(ck);
  gapsKept.set(ck, kept);
  if (gapsKept.size > GAPS_KEPT) gapsKept.delete(gapsKept.keys().next().value);
  return kept.all;
}

// The gaps drawn in the span.
function bandsOf(gaps, start) {
  return gaps.filter((g) => g.to > start);
}

// What of the model Timeline draws from, as one string: a new model object each frame is not a change.
const modelKey = (m) => (m.areas ?? []).map((a) => `${a.id}:${a.label}`).join(",") + "\n" + (m.items ?? []).map((i) => [i.key, i.area, i.title, i.word, i.status, i.group, i.changed, i.stale ? 1 : 0, i.leadGone ? 1 : 0,
  (i.machines ?? []).join(","), i.lead?.address, i.lead?.status, i.lead?.status_ms, i.lead?.report?.kind, i.lead?.labels?.["tower.eye"],
  ...[...(i.activeTree ?? i.tree ?? []), ...(i.quiet ?? [])].map((r) => `${r.t.address}:${r.t.name ?? ""}:${r.status}:${r.t.status_ms}:${r.t.report?.kind ?? ""}:${(r.lines ?? []).join("")}`)].join("|")).join("\n");

// ui (t44's stage): {now, width, height, area, selectedKey, select(item) (goes into the task), pick(item)
// (selects only), openTerminal(address), notify(),
// state (kept per view across renders: the zoom), towerDir, here, shape}.
export function render(t, m, ui) {
  const view = (ui.state ??= {});
  view.span ??= storedSpan();
  const now = ui.now ?? Date.now();
  const W = ui.width ?? 1000;
  const trackW = Math.max(240, W - LABEL_W - 16);
  const pastW = trackW - NOW_COL;
  const span = SPANS[view.span] ?? SPANS[2];
  const start = now - span.ms;
  const long = Boolean(span.long);
  const pxMs = span.ms / pastW;
  // A task file is prepared in its load job, for this pixel size too, so no render walks its month.
  const old = longPast(ui.towerDir, { start, now, long, onLoad: ui.notify, read: ui.readPast, prepare: (file) => fileMarksFor(file, pxMs, long, span.ms) });
  // Gaps older than events.json keeps live only in the index.
  const h = withIndexGaps(history(ui.towerDir, ui.notify, now), old.index?.gaps);
  const x = (ms) => ((ms - start) / span.ms) * pastW;
  const moment = shared(MOMENT) ?? null;

  // Everything drawn from data is kept until the data, the span, the width or the now-line's pixel
  // changes: a frame then only builds elements (Herdr cuts a render off after 50 ms).
  const changes = shared("agent-tower.changes") ?? {};
  const cacheKey = [view.span, pastW, Math.floor(now / pxMs), store.version, fill.version, past.version, ui.towerDir, ui.area ?? "", view.area ?? "", view.needs ? 1 : 0,
    JSON.stringify(changes), modelKey(m)].join("\u0001");
  if (view.cache?.key !== cacheKey) {
    const groups = lanesOf(m, h, { now, start, first: ui.area ?? null, changes, past: old });
    if (long) {
      // Week and Month: agents hc forgot, from their transcripts, for the tasks with a hole in their past.
      const taskIdOf = (task) => task.item?.taskId ?? old.index?.tasks?.[task.key]?.taskId ?? (task.key.startsWith("task:") ? task.key.slice(5) : null);
      const ids = [];
      const machines = new Set([""]);
      for (const task of groups.flatMap((g) => g.tasks)) {
        const id = taskIdOf(task);
        if (!id) continue;
        if (hasGap(task, h, now)) {
          ids.push(id);
          for (const l of [...task.lanes, ...task.folded]) machines.add(l.machine ?? "");
        }
        const extra = forgottenLanes(task, id, fillCache());
        (task.item ? task.folded : task.lanes).push(...extra);
        task.endedTotal = (task.endedTotal ?? 0) + extra.length;
      }
      findForgotten(ui.towerDir, { machines: [...machines], ids, now, since_s: Math.ceil(SPANS.at(-1).ms / 1000), onLoad: ui.notify });
    }
    // Before the recorder: what each agent's transcript tells, where one is found.
    const firstAtOf = (a) => eventsOf(h, a)[0]?.at ?? null;
    const allLanes = groups.flatMap((g) => g.tasks.flatMap((task) => [...task.lanes, ...task.folded]));
    const filled = backfill(ui.towerDir, allLanes, firstAtOf, now, ui.notify);
    // Each lane's stretches (and, in render, its marks) are kept across rebuilds while its own inputs
    // hold: one agent's change redraws that agent, not all of them. A lane is kept the moment it is
    // worked out, so a rebuild cut off half-way (Herdr's 50 ms) leaves the next one less to do; what
    // it kept answers only the same inputs. The map is pruned to the shown lanes when a rebuild ends.
    const laneMemo = (view.laneMemo ??= new Map());
    const nextMemo = new Map();
    const bucket = `${Math.floor(now / pxMs)}|${view.span}|${pastW}`;
    // Per machine: its gaps to cut with, and those to draw in the span.
    const gapsBy = new Map();
    const bandsBy = new Map();
    for (const lane of allLanes) {
      const gm = lane.machine ?? "";
      if (!gapsBy.has(gm)) {
        gapsBy.set(gm, gapsOnce(h, lane.machine, pxMs));
        bandsBy.set(gm, bandsOf(gapsBy.get(gm), start));
      }
      lane.gaps = gapsBy.get(gm);
      lane.bands = bandsBy.get(gm);
      // A lane only a task file has, prepared when the file loaded: nothing to work out per rebuild.
      if (lane.fileOnly && lane.pastCut) {
        lane.stretches = lane.pastCut;
        let m = preparedMemo.get(lane.pastCut);
        if (!m || m.bucket !== bucket) preparedMemo.set(lane.pastCut, (m = { bucket, stretches: lane.pastCut }));
        lane.memo = m;
        continue;
      }
      const evs = lane.fileOnly ? null : eventsOf(h, lane.a);
      const entry = filled[backfillKey(lane)];
      const sig = `${lane.live}|${lane.since}|${evs?.length ?? -1}|${evs?.at(-1)?.at ?? 0}`;
      const key = backfillKey(lane);
      let was = laneMemo.get(key);
      // Stretches that nothing ongoing ties to now hold across the now-line's pixels; only their marks
      // are worked out again. So a rebuild spread over cut-off frames still ends at 1h, where a pixel is seconds.
      // Only stretches reaching past cutFrom were cut: kept for a span that starts no earlier.
      if (was && was.sig === sig && was.gaps === lane.gaps && was.past === lane.past && was.pastCut === lane.pastCut && was.entry === entry
        && was.cutFrom <= start && (was.bucket === bucket || was.timeless)) {
        if (was.bucket !== bucket) laneMemo.set(key, (was = { ...was, bucket, marks: null }));
        lane.stretches = was.stretches;
        if (entry?.turns) lane.rebuilt = entry;
        lane.memo = was;
        nextMemo.set(key, was);
        continue;
      }
      // A lane only a task file has: its address may be another agent's in events.json now.
      const recent = lane.fileOnly ? [] : stretches(h, lane.a, now, { live: lane.live, since: lane.since, gaps: lane.gaps, cutFrom: start });
      const first = recent[0]?.from ?? Infinity;
      // A lane only a file has was cut by the index's gaps when the file loaded.
      lane.stretches = lane.fileOnly && lane.pastCut ? lane.pastCut : [...olderOnce(lane.past, first, lane.gaps, start), ...recent];
      const timeless = !lane.live && lane.stretches.length > 0 && !lane.stretches.some((st) => st.ongoing);
      if (entry?.turns) {
        lane.rebuilt = entry;
        if (!lane.fileOnly && !lane.stretches.some((st) => st.how)) {
          const until = lane.stretches[0]?.from ?? now;
          lane.stretches = [...cutGaps(rebuiltOnce(entry, lane.created, until), lane.gaps, start), ...lane.stretches];
        }
      }
      lane.memo = { sig, bucket, timeless, cutFrom: start, gaps: lane.gaps, past: lane.past, pastCut: lane.pastCut, entry, stretches: lane.stretches };
      laneMemo.set(key, lane.memo);
      nextMemo.set(key, lane.memo);
    }
    view.laneMemo = nextMemo;
    // The view's own area chips: every area (the shown one first), or one.
    const byArea = view.area && groups.some((g) => g.area === view.area) ? groups.filter((g) => g.area === view.area) : groups;
    // "N Needs you" shows only the tasks waiting on you, in every area.
    const shownGroups = view.needs ? byArea.map((g) => ({ ...g, tasks: g.tasks.filter(hasAsk) })).filter((g) => g.tasks.length) : byArea;
    const shown = shownGroups.flatMap((g) => g.tasks.flatMap((task) => [...task.lanes, ...task.folded]));
    const att = attention(h, shown, start, now);
    const herdrBands = bandsBy.get("") ?? bandsOf(gapsOnce(h, null, pxMs), start);
    view.cache = { key: cacheKey, groups, byArea, shownGroups, shown, att, herdrBands };
  }
  const { groups, byArea, shownGroups, shown, att, herdrBands } = view.cache;

  // The click grammar (paths-grammar.md), through the stage's helpers: a task goes in (rule 1); an
  // agent goes in with that agent open (rules 2, 3); a stretch stays here and shows its moment.
  // Before the helpers land: the older select and peek.
  const goInto = (item, agent) => (ui.goInto ? ui.goInto(item, agent ? { agent } : {}) : agent ? ui.openTerminal?.(agent) : ui.select?.(item));
  const openAgent = (task, address) => (task.item ? goInto(task.item, address) : ui.open ? ui.open(address) : ui.openTerminal?.(address));
  // Rule 5: the list's own menu for the same thing.
  const withMenu = (el, thing) => (ui.onMenu ? ui.onMenu(el, thing) : el);
  const pick = (task, lane, st) => {
    // The clicked mark stays on screen: its task opens, and its lane if folded. Nothing closes.
    view.tasks = { ...view.tasks, [task.key]: true };
    if (task.folded.includes(lane)) view.open = { ...view.open, [task.key]: true };
    // A moment stays in Timeline: select only (ui.pick), never go into the task.
    // The whole moment goes with the pick: the list writes it after selecting, so a partial one
    // would replace this (Details then lost the state word).
    const mo = momentOf(task.key, lane.a, st, h);
    if (task.item && task.key !== ui.selectedKey) (ui.pick ?? ui.select)?.(task.item, mo);
    setShared(MOMENT, mo);
  };

  const ticks = [];
  if (long) ticks.push(...dayTicks(start, now));
  else for (let k = Math.ceil(start / span.tick) * span.tick; k < now; k += span.tick) ticks.push(k);
  // Weekends, faint, at Week and Month.
  const weekend = (hgt) => (long ? ticks.filter((k) => new Date(k).getDay() === 6).map((k) => {
    const x0 = Math.max(0, x(k));
    const x1 = Math.min(pastW, x(k + 2 * DAY_MS));
    return x1 > x0 ? div().absolute().left(x0).top(0).w(x1 - x0).h(hgt).bg(t.dim).opacity(0.05) : null;
  }) : []);
  const grid = (hgt) => [...weekend(hgt), ...ticks.map((k) => div().absolute().left(x(k)).top(0).w(1).h(hgt).bg(t.border).opacity(0.45))];
  const nowLine = (hgt) => div().absolute().left(pastW).top(0).w(2).h(hgt).bg(t.accent);
  const band = (key, from, to, why, hgt = LANE_H) => {
    const x0 = Math.max(0, x(from));
    const x1 = Math.min(pastW, x(to));
    return x1 - x0 < 1 ? null : div().id(`gap-${key}-${from}`).absolute().left(x0).top(0).w(x1 - x0).h(hgt).bg(t.dim).opacity(0.12).tooltip(why);
  };

  // A guess: faint dashes in the ask's colour (the least certain fact draws the least ink).
  const guessMark = (w, alpha) => h_flex().w(w).h(2).gap(3).overflow_hidden().opacity(alpha)
    .children(Array.from({ length: Math.min(200, Math.ceil(w / 7)) }, () => div().w(4).h(2).flex_none().bg(wordColor(t, "blocked"))));
  // History is quiet ink; only an ask still open is loud.
  // A colour at an alpha: one call when the theme gives hex (#rrggbb), else with opacity.
  const hexA = (c, a) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, "0") : null);
  const tinted = (el, c, a) => (hexA(c, a) ? el.bg(hexA(c, a)) : el.bg(c).opacity(a));
  const tint = (c, a) => hexA(c, a) ?? c;
  const tipOf = (st, took, many) => `${st.how === "guessed" ? "Guessed · " : st.how ? "Rebuilt · " : ""}${many ? `${st.n}× ` : ""}${WORD[st.s] ?? st.s} · ${rangeWords(st.from, st.to, st.ongoing, long)}${many ? "" : ` · ${took}`}`;
  const segment = (task, lane, st, prefix = "s") => {
    const x0 = Math.max(0, x(st.from));
    const x1 = Math.min(pastW, x(st.to));
    if (x1 <= 0 || x0 >= pastW) return null;
    // Asks joined into one mark ("3× Needs you") are a tick where the first began: never a block
    // that reads as days of waiting.
    const w = st.s === "blocked" && st.joined ? 3
      : long && st.s === "blocked" && !st.ongoing ? Math.max(3, x1 - x0) : long && st.s === "done" ? 2 : Math.max(st.s === "blocked" ? 4 : 2, x1 - x0);
    const color = wordColor(t, st.s);
    const picked = moment?.address === lane.a && moment?.at === st.from;
    const many = (st.n ?? 1) > 1;
    // Words are kept on the mark (marks live as long as the cache): QuickJS makes dates slowly.
    // An ongoing mark's words use this render's now (kept for the minute they show), not the now its
    // memo was made at.
    const minute = Math.floor(now / 60e3);
    if (st.ongoing && st.wordsAt !== minute) Object.assign(st, { wordsAt: minute, took: undefined, tip: undefined });
    const took = st.ongoing ? (st.took ??= duration(now - st.from)) : (st.took ??= duration(st.to - st.from));
    // Idle is the quiet between: one hairline element, no hover box of its own (the cheapest mark).
    if (st.s === "idle" && !st.how && !picked) return div().absolute().left(x0).top(LANE_H / 2).h(1).w(w).bg(t.border);
    // The mark is drawn inside a hit box the lane's full height (and at least 6px wide), so a thin
    // bar at 8h or Day can still be hovered and clicked.
    const hit = div().id(`${prefix}-${lane.a}-${st.from}`).absolute().left(x0).top(0).h(LANE_H).w(Math.max(6, w))
      .tooltip(st.tip ??= tipOf(st, took, many))
      .on_click(() => pick(task, lane, st.one ?? st));
    let el = div().absolute();
    // Rebuilt from a transcript: the same shape, outlined instead of filled.
    if (st.how && st.s === "working") el = el.top(10).h(4).w(w).rounded(2).border(1).border_color(color).opacity(0.55);
    else if (st.how === "guessed") el = el.top(LANE_H / 2 - 1).h(2).w(w).child(guessMark(w, 0.6));
    else if (st.how && st.s === "blocked") el = el.top(4).h(LANE_H - 8).w(w).rounded(3).border(1).border_color(color).opacity(0.8);
    // Week and Month: an ask is a red tick, however short; a lead's Done a blue one.
    else if ((long || st.joined) && st.s === "blocked" && !st.ongoing) el = tinted(el.top(4).h(LANE_H - 8).w(w).rounded(1), color, 0.85);
    else if (long && st.s === "done") el = tinted(el.top(6).h(LANE_H - 12).w(w), color, 0.75);
    else if (st.s === "working") el = tinted(el.top(10).h(4).w(w), color, picked ? 0.8 : 0.3);
    else if (st.s === "blocked" && st.ongoing) {
      el = el.top(2).h(LANE_H - 4).w(w).rounded(4).bg(color).overflow_hidden();
      // Solid until you first looked, pale after: seen, and still left waiting.
      const seen = firstLook(h, lane.a, st.from, st.to);
      const sx = seen == null ? w : Math.max(0, x(seen) - x0);
      if (sx < w - 1) el = el.child(div().absolute().left(sx).top(0).h(LANE_H - 4).w(w - sx).bg("#ffffff").opacity(0.42));
    } else if (st.s === "blocked") {
      el = el.top(4).h(LANE_H - 8).w(w).rounded(3).bg(color + "33").overflow_hidden().flex().items_center();
      if (w > 30) el = el.child(div().pl(5).text_size(11).text_color(color).whitespace_nowrap().child(took));
    } else if (st.s === "done") el = tinted(el.top(10).h(4).w(w), color, st.ongoing ? 0.75 : 0.4);
    else el = el.top(LANE_H / 2).h(1).w(w).bg(t.border);
    if (picked) el = el.border(2).border_color(t.foreground);
    return hit.child(el);
  };

  // What the lane is doing now, beside the now-line: the loudest thing on screen when it needs you.
  const nowCell = (task, lane, real = lane) => {
    const st = lane.stretches.at(-1);
    if (!st?.ongoing) return null;
    // The same "since" as the list and Details (a gap may have cut the drawn stretch).
    const took = duration(now - (lane.since != null && lane.live === st.s ? lane.since : st.from));
    if (st.s === "blocked") {
      return div().id(`n-${lane.a}`).absolute().left(pastW + 8).top(2).h(LANE_H - 4).px(7).rounded(4).bg(wordColor(t, "blocked"))
        .flex().items_center().cursor_pointer().tooltip(real.name ?? "").on_click(() => openAgent(task, real.a))
        .child(div().text_size(11).font_semibold().text_color("#ffffff").whitespace_nowrap().child(`${lane.wait ?? WORD.blocked} ${took}`));
    }
    // Done counts only while nobody has looked (the model's word), as in the list.
    if (st.s === "done" && lane.role === "lead" && task.item?.word === "done") {
      return div().absolute().left(pastW + 10).top(4).text_size(11).text_color(wordColor(t, "done")).whitespace_nowrap().child(`${WORD.done} ${took}`);
    }
    return null;
  };

  // The body's rows share one grid and now-line (drawn once behind them); the You row draws its own.
  // A task's line as marks. With a task file: the file's part is merged once per file and pixel size
  // (it does not change while the file stays), and only what is newer than the file is summed now.
  const lineMarks = (task) => {
    const file = task.file;
    if (!file?.summary) {
      const line = summaryOf(task, start, now);
      return toPixels(long ? forSpan(line, pxMs) : line, pxMs);
    }
    const cut = file.until ?? now;
    const older = fileMarksFor(file, pxMs, long, span.ms).filter((st) => st.to > start && st.from < cut);
    // Not in the file: the recorder's newer stretches (clipped at the file's until, which holds the
    // rest), and anything rebuilt or guessed (a transcript's past, a forgotten agent), at any age.
    let rebuiltOld = false;
    const recentOnly = (l) => ({ ...l, stretches: (l.stretches ?? []).flatMap((st) => {
      if (st.file) return [];
      if (st.how) {
        if (st.from < cut) rebuiltOld = true;
        return [st];
      }
      if (st.to <= cut) return [];
      return [st.from < cut ? { ...st, from: cut } : st];
    }) });
    const recent = summaryOf({ lanes: task.lanes.map(recentOnly), folded: task.folded.map(recentOnly) }, start, now);
    // The row's cap is shared: the recent part gets its share of the span (all of it with old rebuilt work).
    const share = rebuiltOld ? MAX_MARKS : Math.max(4, Math.ceil((MAX_MARKS * (now - Math.max(start, cut))) / span.ms));
    return [...older, ...toPixels(long ? forSpan(recent, pxMs) : recent, pxMs, share)];
  };
  // A lane's marks, merged to what its pixels can show; kept with the cached lanes.
  // Only what the span shows is merged (the cap is for what is on screen); a lane, open on its own,
  // gets three times a task line's marks.
  const marksOf = (lane) => {
    if (lane.marks) return lane.marks;
    if (lane.memo?.marks) return (lane.marks = lane.memo.marks);
    const shown = lane.stretches.filter((st) => st.to > start && st.from < now);
    lane.marks = toPixels(long ? forSpan(shown, pxMs, lane.role) : shown, pxMs, LANE_MARKS);
    if (lane.memo) lane.memo.marks = lane.marks;
    return lane.marks;
  };
  // A task's line, kept across rebuilds while every one of its lanes kept its stretches.
  const taskMemo = (view.taskMemo ??= new Map());
  const lineOnce = (task) => {
    const refs = [...task.lanes, ...task.folded].map((l) => l.stretches);
    const k = `${Math.floor(now / pxMs)}|${view.span}|${pastW}`;
    const was = taskMemo.get(task.key);
    if (was && was.k === k && was.file === task.file && was.refs.length === refs.length && was.refs.every((r, i) => r === refs[i])) return was.marks;
    const marks = lineMarks(task);
    taskMemo.set(task.key, { k, file: task.file, refs, marks });
    return marks;
  };
  const track = (children, hgt = LANE_H, lines = false) => div().relative().w(trackW).h(hgt).flex_none()
    .children(lines ? [...grid(hgt), ...children.filter(Boolean), nowLine(hgt)] : children.filter(Boolean));

  const laneRow = (task, lane) => {
    const firstAt = Math.min(lane.past?.find((st) => !st.how)?.from ?? Infinity, lane.fileOnly ? Infinity : eventsOf(h, lane.a)[0]?.at ?? Infinity);
    // A lane in a task file was recorded from its start: before its first stretch it was quiet, not unknown.
    const firstKnown = lane.past?.length && !lane.past[0].how && lane.created != null ? lane.created : Number.isFinite(firstAt) ? firstAt : null;
    // Alive before the recorder first saw it (before install, or before it ran): unknown, said so.
    // A transcript's turns cover part of it: the band shrinks to what is before them.
    const knownFrom = lane.rebuilt || lane.stretches[0]?.how ? (lane.stretches[0]?.from ?? firstKnown ?? now) : firstKnown ?? now;
    const unknown = lane.created != null && (firstKnown == null ? lane.live : true) && lane.created < knownFrom - 1000
      ? band(lane.a, lane.created, knownFrom, firstKnown == null && !lane.rebuilt ? "Not recorded yet" : "Before recording") : null;
    const gaps = (lane.bands ?? []).map((g) => band(lane.a, g.from, g.to, g.m === "herdr" ? "Not recorded: Herdr was closed" : `Not recorded: ${g.m} did not answer`));
    const asking = lane.live === "blocked";
    // Hover names it: the agent and where it runs.
    const label = h_flex().id(`l-${lane.a}`).w(LABEL_W).flex_none().h(LANE_H).items_center().gap(6).pl(30).pr(10)
      .when(ui.menuFor !== lane.a, (e) => e.tooltip([lane.name, lane.machine ?? (lane.role === "lead" ? ui.here : null)].filter(Boolean).join(" · ")))
      .on_hover((on) => !on && ui.menuFor === lane.a && ui.leftMenuFor?.())
      .when(!lane.ended, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openAgent(task, lane.a)))
      .when(lane.lines.length > 0, (e) => e.child(div().flex_none().text_size(12).text_color(t.dim).child(lane.lines.join(" "))))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(asking ? wordColor(t, "blocked") : t.muted).child(lane.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(lane.ended ? "ended" : lane.machine ?? (lane.role === "lead" ? ui.here ?? "" : "")));
    return h_flex().h(LANE_H).flex_none().opacity(lane.ended ? 0.55 : 1)
      .child(lane.ended ? label : withMenu(label, { agent: lane.a })).child(track([unknown, ...gaps, ...marksOf(lane).map((st) => segment(task, lane, st)), nowCell(task, lane)]));
  };

  const variant = shared("agent-tower.rowMark") ?? "state";
  // A task is one line (its summary) until you open it; what you opened stays open.
  const isOpen = (task) => Boolean(view.tasks?.[task.key]);
  const taskRow = (task) => {
    const on = task.key === ui.selectedKey;
    const open = isOpen(task);
    const machines = (task.item?.machines ?? []).filter(Boolean).join(", ");
    // Opened, its lanes say it all: the task's own line keeps only its name.
    const summary = open ? [] : (task.marks ??= lineOnce(task));
    const asking = [...task.lanes, ...task.folded].find((l) => l.stretches?.at(-1)?.ongoing && l.stretches.at(-1).s === "blocked");
    const lead = task.lanes.find((l) => l.role === "lead");
    const label = h_flex().id(`tl-${task.key}`).w(LABEL_W).flex_none().h(HEAD_H).items_center().gap(4).pl(4).pr(8)
      .child(div().id(`c-${task.key}`).w(16).h(HEAD_H).flex_none().flex().items_center().justify_center().cursor_pointer()
        .text_size(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          view.tasks = { ...view.tasks, [task.key]: !open };
          cx?.notify();
        })
        .child(open ? "⌄" : "›"))
      .child(task.item ? rowMark(t, task.item, task.item.word, variant) : div().w(18).flex_none())
      // While its menu is open the tooltip waits, so it never covers the menu (back once the pointer leaves).
      .child(div().id(`t-${task.key}`).when(ui.menuFor !== task.key, (e) => e.tooltip([task.title ?? task.key, machines].filter(Boolean).join(" · ")))
        .on_hover((on) => !on && ui.menuFor === task.key && ui.leftMenuFor?.()).flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(task.item ? t.foreground : t.muted)
        .when(!!task.item, (e) => e.cursor_pointer().hover((s) => s.text_color(t.accent)).on_click(() => {
          // Back from the task, it is open here.
          view.tasks = { ...view.tasks, [task.key]: true };
          goInto(task.item);
        }))
        .child(task.title ?? task.key))
      .when(!task.item, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child("ended")));
    const cell = open ? null : asking ? nowCell(task, { ...asking, a: task.key, stretches: asking.stretches }, asking)
      : lead && task.item?.word === "done" ? nowCell(task, { ...lead, a: task.key }, lead) : null;
    // Machines go past the now-line when nothing else is there, so the title gets the room.
    const where = machines && !cell ? div().absolute().left(pastW + 10).top(5).text_size(11).text_color(t.dim).whitespace_nowrap().child(machines) : null;
    if (machines && cell) label.child(div().flex_none().text_size(11).text_color(t.dim).child(machines));
    return h_flex().h(HEAD_H).flex_none().bg(on ? t.selected : "#00000000")
      .child(task.item ? withMenu(label, { task: task.item }) : label)
      .child(track([...summary.map((st) => segment(task, st.lane, st, "S")), cell, where], HEAD_H));
  };

  // Week and Month: every agent not shown on its own lane, as one. Each column says how many were
  // working (a bar in three heights: 1, 2 to 4, 5 or more); their asks stay red ticks.
  const B = 4;
  const step = (n) => (n >= 5 ? 12 : n >= 2 ? 8 : 4);
  // The Workers lane's columns and asks, kept with the cached task.
  const workersOf = (task, group) => {
    const cols = new Map();
    for (const lane of group) for (const st of lane.stretches) {
      if (st.s !== "working" || st.to <= start) continue;
      const b1 = Math.min(Math.floor((pastW - 1) / B), Math.floor(x(st.to) / B));
      for (let b = Math.max(0, Math.floor(x(st.from) / B)); b <= b1; b++) {
        if (!cols.has(b)) cols.set(b, new Set());
        cols.get(b).add(lane.name);
      }
    }
    const runs = [];
    for (const b of [...cols.keys()].sort((p, q) => p - q)) {
      const names = cols.get(b);
      const prev = runs.at(-1);
      if (prev && prev.b1 === b - 1 && step(prev.n) === step(names.size)) {
        prev.b1 = b;
        prev.n = Math.max(prev.n, names.size);
        for (const n of names) prev.names.add(n);
      } else runs.push({ b0: b, b1: b, n: names.size, names: new Set(names) });
    }
    for (const r of runs) {
      const ns = [...r.names];
      r.tip = ns.slice(0, 6).join(", ") + (ns.length > 6 ? ", …" : "");
    }
    const asks = group.flatMap((lane) => toPixels(forSpan(lane.stretches.filter((st) => st.s === "blocked" && st.to > start), pxMs, lane.role), pxMs).map((st) => [lane, st]));
    return { runs, asks };
  };
  const workersRow = (task, group) => {
    const { runs, asks: askMarks } = (task.workers ??= workersOf(task, group));
    const bars = runs.map((r) => div().id(`wb-${task.key}-${r.b0}`).absolute().left(r.b0 * B).top((LANE_H - step(r.n)) / 2).w((r.b1 - r.b0 + 1) * B).h(step(r.n)).rounded(2)
      .bg(wordColor(t, "working")).opacity(0.3).tooltip(r.tip));
    const asks = askMarks.map(([lane, st]) => segment(task, lane, st, "W"));
    return h_flex().id(`w-${task.key}`).h(LANE_H).flex_none()
      .child(h_flex().w(LABEL_W).flex_none().h(LANE_H).items_center().gap(6).pl(30).pr(10)
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child("Workers"))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(String(group.length))))
      .child(track([...bars, ...asks]));
  };

  const rows = [];
  let bodyH = 0;
  // Rows are made only when on screen: each is its height and a function that builds it.
  const push = (hgt, make) => {
    rows.push({ hgt, make });
    bodyH += hgt;
  };
  const pushTask = (task) => {
    push(HEAD_H, () => taskRow(task));
    if (!isOpen(task)) return;
    if (long) {
      // The lead, and who is busy or waiting now, each on a lane; the rest as Workers; then "N ended".
      const solo = task.lanes.filter((l) => l.role === "lead" || (l.live && l.live !== "idle"));
      for (const lane of solo) push(LANE_H, () => laneRow(task, lane));
      const rest = [...task.lanes, ...task.folded].filter((l) => !solo.includes(l) && l.stretches.some((st) => st.to > start));
      if (rest.length) push(LANE_H, () => workersRow(task, rest));
    } else for (const lane of task.lanes) push(LANE_H, () => laneRow(task, lane));
    const foldLanes = long ? task.folded.filter((l) => l.ended) : task.folded;
    if (foldLanes.length || task.endedTotal) {
      const open = Boolean(view.open?.[task.key]);
      push(LANE_H - 2, () => h_flex().id(`f-${task.key}`).h(LANE_H - 2).flex_none().items_center().gap(6).pl(30).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          view.open = { ...view.open, [task.key]: !open };
          cx?.notify();
        })
        .child(div().text_size(12).text_color(t.dim).child(open ? "⌄" : "›"))
        .child(div().text_size(12).text_color(t.muted).child(long ? `${Math.max(task.endedTotal ?? 0, foldLanes.length)} ended` : foldWords(task))));
      if (open) for (const lane of long ? [...foldLanes].sort((p, q) => (q.stretches.at(-1)?.to ?? 0) - (p.stretches.at(-1)?.to ?? 0)) : foldLanes) push(LANE_H, () => laneRow(task, lane));
    }
  };
  for (const g of shownGroups) {
    const n = g.tasks.reduce((c, task) => c + task.lanes.filter((l) => l.live === "blocked").length, 0);
    push(26, () => h_flex().h(26).flex_none().items_end().pb(3).pl(12).gap(8)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(g.label.toUpperCase()))
      .when(n > 0, (e) => e.child(div().text_size(11).text_color(wordColor(t, "blocked")).child(`${n} ${WORD.blocked}`))));
    const quiet = g.tasks.filter((task) => task.key !== ui.selectedKey && isQuiet(task, start));
    for (const task of g.tasks) if (!quiet.includes(task)) pushTask(task);
    if (quiet.length) {
      const open = Boolean(view.quiet?.[g.area]);
      push(HEAD_H, () => h_flex().id(`q-${g.area}`).h(HEAD_H).flex_none().items_center().gap(4).pl(4).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          view.quiet = { ...view.quiet, [g.area]: !open };
          cx?.notify();
        })
        .child(div().w(16).flex_none().text_size(12).text_color(t.dim).flex().justify_center().child(open ? "⌄" : "›"))
        .tooltip(quiet.slice(0, 12).map((task) => task.title ?? task.key).join(", ") + (quiet.length > 12 ? ", …" : ""))
        .child(div().text_size(12).text_color(t.muted).child(`${quiet.length} quiet`)));
      if (open) for (const task of quiet) pushTask(task);
    }
  }
  if (!rows.length) push(48, () => div().p(16).text_size(13).text_color(t.muted).child("No agents"));

  // Where your focus was, in Herdr with its window in front. One ink; the tooltip names the agent.
  // Worked out once per rebuild (a month of looks is thousands), kept with the cache.
  const looked = (view.cache.looked ??= lookedMarks());
  function lookedMarks() {
    const names = new Map(shown.map((l) => [l.a, l]));
    // Looks less than two pixels apart are one mark (naming up to three agents), at most MAX_MARKS.
    const looked = [];
    for (const f of focusStretches(h, now)) {
      if (!names.has(f.a) || f.to <= start) continue;
      const prev = looked.at(-1);
      if (prev && f.from - prev.to < 2 * pxMs) {
        prev.to = f.to;
        if (!prev.who.includes(names.get(f.a).name)) prev.who.push(names.get(f.a).name);
      } else looked.push({ from: f.from, to: f.to, who: [names.get(f.a).name] });
    }
    for (let reach = 4 * pxMs; looked.length > MAX_MARKS; reach *= 2) {
      for (let i = looked.length - 1; i > 0; i--) {
        if (looked[i].from - looked[i - 1].to >= reach) continue;
        looked[i - 1].to = looked[i].to;
        for (const w of looked[i].who) if (!looked[i - 1].who.includes(w)) looked[i - 1].who.push(w);
        looked.splice(i, 1);
      }
    }
    return looked;
  }
  const youSegs = looked.map((f) => {
    const x0 = Math.max(0, x(f.from));
    const x1 = Math.min(pastW, x(f.to));
    if (x1 <= 0 || x0 >= pastW) return null;
    return div().id(`y-${f.from}`).absolute().left(x0).top(8).h(8).w(Math.max(2, x1 - x0)).bg(tint(t.foreground, 0.3))
      .tooltip(`You on ${f.who.slice(0, 3).join(", ")}${f.who.length > 3 ? ", …" : ""} · ${rangeWords(f.from, f.to, false, long)}`);
  });
  const herdrGaps = herdrBands.map((g) => band("you", g.from, g.to, "Not recorded: Herdr was closed"));

  const swatch = (el, word) => h_flex().gap(4).items_center().child(el).child(word);
  const legend = h_flex().h(22).flex_none().px(12).gap(12).items_center().text_size(10).text_color(t.dim).border_t(1).border_color(t.border)
    .child(swatch(div().w(12).h(4).rounded(2).bg(wordColor(t, "working")).opacity(0.3), WORD.working))
    .child(swatch(div().w(10).h(10).rounded(2).bg(wordColor(t, "blocked")), WORD.blocked))
    .child(swatch(div().w(10).h(10).rounded(2).bg(wordColor(t, "blocked")).opacity(0.5), "seen"))
    .child(swatch(div().w(12).h(4).rounded(2).bg(wordColor(t, "done")).opacity(0.75), WORD.done))
    .child(swatch(div().w(12).h(4).rounded(2).border(1).border_color(wordColor(t, "working")).opacity(0.55), "rebuilt"))
    .child(swatch(guessMark(12, 1), "guess"))
    .child(swatch(div().w(10).h(10).rounded(2).bg(t.dim).opacity(0.25), "not recorded"));
  // The chips in the config's order, always: you learn where each is.
  const chipOrder = [...(m.areas ?? []).map((a) => groups.find((g) => g.area === a.id)).filter(Boolean), ...groups.filter((g) => g.area == null)];
  const chip = (id, label, on, onClick) => div().id(id).px(8).h(22).flex().items_center().rounded(5).text_size(12).cursor_pointer()
    .bg(on ? t.selected : "#00000000").text_color(on ? t.foreground : t.muted).font_medium()
    .hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
  const header = h_flex().h(38).flex_none().px(12).gap(4).items_center().border_b(1).border_color(t.border)
    .child(att.open.length || view.needs
      ? div().id("needs").px(6).h(24).flex().items_center().rounded(5).cursor_pointer().bg(view.needs ? t.selected : "#00000000").hover((s) => s.bg(t.hover))
        .text_size(13).font_semibold().text_color(wordColor(t, "blocked"))
        .on_click((_e, cx) => {
          view.needs = !view.needs;
          cx?.notify();
        })
        .child(`${att.open.length} ${WORD.blocked}`)
      : div().text_size(13).text_color(t.muted).child(`Nothing ${WORD.blocked.toLowerCase()}`))
    // Every area one click away: All, or one area (with what needs you there).
    .when(groups.length > 1, (e) => e.child(div().w(12)).children([{ area: null, label: "All", tasks: [] }, ...chipOrder].map((g) => {
      const n = g.tasks.reduce((c, task) => c + task.lanes.filter((l) => l.live === "blocked").length, 0);
      const on = (view.area ?? null) === g.area || (!g.area && !byArea.some((x) => x.area === view.area));
      return h_flex().id(`area-${g.area ?? "all"}`).px(8).h(22).gap(4).items_center().rounded(5).text_size(12).cursor_pointer().font_medium()
        .bg(on ? t.selected : "#00000000").text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          view.area = g.area;
          cx?.notify();
        })
        .child(g.label)
        .when(n > 0, (e) => e.child(div().text_size(11).text_color(wordColor(t, "blocked")).child(String(n))));
    })))
    .child(div().flex_1())
    .children(SPANS.map((s, i) => chip(`span-${s.name}`, s.name, view.span === i, (_e, cx) => {
      view.span = i;
      try {
        localStorage.setItem("agent-tower.timeline.span", String(i));
      } catch {}
      cx?.notify();
    })));

  // The waits over the shown span sit in the axis row's empty name column: there in both shapes.
  const stats = h_flex().w(LABEL_W).flex_none().pl(12).pr(8).gap(8).text_size(10.5).text_color(t.dim).items_center().whitespace_nowrap().overflow_hidden()
      .child(div().child(`${att.count}× ${WORD.blocked} in ${span.says}`))
      .when(!!att.longest, (e) => e.child(div().id("longest").cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click(() => {
          const task = groups.flatMap((g) => g.tasks).find((tk) => [...tk.lanes, ...tk.folded].includes(att.longest.lane));
          pick(task, att.longest.lane, att.longest);
        })
        .child(`longest ${duration(att.longest.waited)}`)));

  const axis = h_flex().h(22).flex_none()
    .child(stats)
    .child(div().relative().w(trackW).h(22).flex_none().children([
      // Labels at least 44px apart: on a narrow track every second or third hour.
      ...ticks.filter((k, i) => pastW - x(k) > 44 && i % Math.ceil(44 / ((span.tick / span.ms) * pastW)) === 0).map((k) => div().absolute().left(x(k) + 3).top(4).text_size(10).text_color(t.dim).child(long ? dayLabel(k) : clock(k))),
      div().absolute().left(pastW - 14).top(2).px(4).rounded(3).bg(t.accent).text_size(10).font_semibold().text_color(t.accent_foreground).child("now"),
    ]));
  const you = h_flex().h(LANE_H).flex_none().border_b(1).border_color(t.border)
    .child(h_flex().id("you").w(LABEL_W).flex_none().items_center().pl(12).tooltip("Where you looked")
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("You")))
    .child(track([...herdrGaps, ...youSegs], LANE_H, true));

  // The body scrolls itself and builds only the rows in view (a scroll draws again): a big record
  // then costs what a screen shows. The grid and the now-line are drawn once, the view's height.
  const viewH = Math.max(120, (ui.height ?? 720) - 38 - 22 - LANE_H - 22);
  const maxY = Math.max(0, bodyH + 8 - viewH);
  view.scrollY = Math.min(Math.max(0, view.scrollY ?? 0), maxY);
  const visible = [];
  let y = 0;
  let firstTop = null;
  for (const r of rows) {
    if (y + r.hgt > view.scrollY && y < view.scrollY + viewH) {
      visible.push(r.make());
      firstTop ??= y;
    }
    y += r.hgt;
  }
  const lineH = Math.min(viewH, bodyH - view.scrollY);
  const body = v_flex().id("timeline-body").relative().flex_1().min_h(0).overflow_hidden()
    .on_scroll_wheel((e, cx) => {
      const next = Math.min(Math.max(0, (view.scrollY ?? 0) - (e?.delta?.y ?? 0)), maxY);
      if (next === view.scrollY) return;
      view.scrollY = next;
      cx?.notify();
    })
    // Herdr closed is a band once, down the whole view, behind the rows (not one per task row).
    .child(div().absolute().left(LABEL_W).top(0).w(trackW).h(Math.max(0, lineH)).children([...grid(Math.max(0, lineH)),
      ...herdrBands.map((g) => band("body", g.from, g.to, "Not recorded: Herdr was closed", Math.max(0, lineH))), nowLine(Math.max(0, lineH))].filter(Boolean)))
    .child(v_flex().absolute().left(0).right(0).top((firstTop ?? 0) - view.scrollY).children(visible));
  return v_flex().id("timeline").size_full().bg(t.surface)
    .child(header).child(axis).child(you)
    .child(body)
    .child(legend);
}
