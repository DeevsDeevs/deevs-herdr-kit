// Timeline: work over time. One lane per agent, grouped by task (taskModel's items, in the list's
// order), what it did when, a now-line, and a column right of it for what each lane is doing now.
// History is quiet ink; only an open Needs you is loud. What was not recorded is drawn as a gap.
// A click on a stretch selects its task and sets agent-tower.moment: the Details card shows "then".
//
// The past comes from the recorder in the docked list (main.js): <towerDir>/timeline/events.json
// = {v, beat, lanes: {address: {task, taskId, taskTitle, role, name, title, machine, parent, created}},
//    events: [{a, s, turn, at, msg}], looks: [{a, at}], gaps: [{m: "herdr" | machine, from, to}]}.
// s: working | blocked | done | idle | ended. Screens are keyed "<address>@<at>" in screens.json.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { readTextFile, writeTextFile, exec, appHome, shared, setShared } from "herdr";
import { WORD, wordColor, rowMark, duration } from "./marks.js";
import * as model from "./model.js";

export const MOMENT = "agent-tower.moment";
export const RECORDED = "agent-tower.recorded";
export const SPANS = [
  { name: "1h", ms: 3600e3, tick: 10 * 60e3 },
  { name: "3h", ms: 3 * 3600e3, tick: 30 * 60e3 },
  { name: "8h", ms: 8 * 3600e3, tick: 3600e3 },
  { name: "Day", ms: 24 * 3600e3, tick: 3 * 3600e3 },
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

// A recorded file as text, checked: anything unreadable is an empty history, never a throw.
export function parseHistory(text) {
  try {
    const h = JSON.parse(text);
    const list = (x) => (Array.isArray(x) ? x : []);
    return {
      lanes: h.lanes && typeof h.lanes === "object" ? h.lanes : {},
      events: list(h.events).filter((e) => e && typeof e.a === "string" && Number.isFinite(e.at)).sort((x, y) => x.at - y.at),
      looks: list(h.looks).filter((l) => l && Number.isFinite(l.at)),
      gaps: list(h.gaps).filter((g) => g && Number.isFinite(g.from)),
    };
  } catch {
    return EMPTY;
  }
}

// The gaps that cover a lane on this machine (null: this computer): Herdr closed, or its machine silent.
// An open gap (to: null) runs to now.
export const gapsFor = (h, machine, now) => h.gaps
  .filter((g) => g.m === "herdr" || (machine && g.m === machine))
  .map((g) => ({ ...g, to: g.to ?? now }));

// Stretches minus the gaps: nothing is drawn where nothing was recorded.
export function cutGaps(list, gaps) {
  let out = list;
  for (const g of gaps) {
    out = out.flatMap((st) => {
      if (g.to <= st.from || g.from >= st.to) return [st];
      const parts = [];
      if (st.from < g.from) parts.push({ ...st, to: g.from, ongoing: false });
      if (st.to > g.to) parts.push({ ...st, from: g.to });
      return parts;
    });
  }
  return out;
}

// A lane's stretches, oldest first: {s, from, to, msg, ongoing}. live: the model's word for a live
// terminal now; since: when it entered that word, from the one source the list and Details use (the
// sidebar's changes: hc's status_ms when first seen). The recorder only draws what came before it.
export function stretches(h, address, now, { live = null, since = null, gaps = [] } = {}) {
  const evs = h.events.filter((e) => e.a === address);
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
  if (!live) return cutGaps(merged, gaps);
  const last = merged.at(-1)?.ongoing ? merged.pop() : null;
  const same = last?.s === live;
  const from = Math.min(since ?? (same ? last.from : now), now);
  const past = (last ? [...merged, { ...last, ongoing: false }] : merged)
    .map((st) => (st.to > from ? { ...st, to: from, ongoing: false } : st))
    .filter((st) => st.to > st.from);
  return cutGaps([...past, { s: live, from, to: now, msg: same ? last.msg : null, ongoing: true }], gaps);
}

// ── Backfill: the past before the recorder, rebuilt from the agent's own transcript. ──
// read.py (agent-tower-panel, t47) gives a transcript's turns in its machine's epoch seconds, with
// that machine's now; they are kept on this computer's clock in <towerDir>/timeline/backfill.json,
// one entry per lane ("<address>@<created_ms>"): {at, covers, path, mtime, size, turns: [{start, end,
// ended, asks: [[from, to|null]]}]} or {missing: true}. Only live agents have a transcript to find.
export const BACKFILL_KEEP_MS = 7 * 86400e3;
export const backfillKey = (lane) => `${lane.a}@${lane.created ?? 0}`;

// A live agent that was alive a minute or more before the recorder first saw it.
export function wantsBackfill(lane, firstAt, now) {
  if (lane.ended || !lane.t || lane.created == null) return false;
  return lane.created < (firstAt ?? lane.since ?? now) - 60e3;
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

// The cache, read once, written by whichever copy ran read.py; a write someone else beat is merged.
const fill = { cache: null, text: null, loading: false, asked: new Set(), running: new Set() };
const fillFile = (dir) => `${dir}/timeline/backfill.json`;
function saveFill(dir, now, tries = 2) {
  const keep = Object.fromEntries(Object.entries(fill.cache).filter(([, e]) => now - (e.at ?? 0) < BACKFILL_KEEP_MS));
  const text = JSON.stringify(keep);
  writeTextFile(fillFile(dir), text, fill.text).then(() => {
    fill.text = text;
  }).catch(async () => {
    if (tries <= 0) return;
    fill.text = await readTextFile(fillFile(dir)).catch(() => null);
    try {
      fill.cache = { ...JSON.parse(fill.text ?? "{}"), ...fill.cache };
    } catch {}
    saveFill(dir, now, tries - 1);
  });
}

// The cached entries; asks read.py, once per lane and machine, for the lanes that want a past.
export function backfill(dir, lanes, firstAtOf, now, onLoad) {
  if (!dir) return {};
  if (!fill.cache) {
    if (!fill.loading) {
      fill.loading = true;
      readTextFile(fillFile(dir)).catch(() => null).then((text) => {
        fill.text = text;
        try {
          fill.cache = JSON.parse(text ?? "{}") ?? {};
        } catch {
          fill.cache = {};
        }
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
    if (fill.running.has(m)) continue;
    if (!byMachine.has(m)) byMachine.set(m, []);
    byMachine.get(m).push(l);
  }
  for (const [m, list] of byMachine) {
    fill.running.add(m);
    for (const l of list) fill.asked.add(backfillKey(l));
    const terminals = list.map((l) => ({ key: backfillKey(l), pid: l.t.pid ?? l.t.foreground?.pid ?? null, argv: l.t.foreground?.argv ?? l.t.argv ?? [], cwd: l.t.foreground?.cwd ?? l.t.cwd ?? null }));
    // Back to the oldest lane's start, at most Timeline's longest span (Day): read.py reads backwards
    // from the end until it passes that, once per agent.
    const since_s = Math.ceil(Math.min(now - Math.min(...list.map((l) => l.created)), SPANS.at(-1).ms) / 1000) + 60;
    const t0 = Date.now();
    (async () => {
      try {
        const script = await readTextFile(`${appHome()}/mods/agent-tower-panel/read.py`);
        if (!script) return;
        const r = await exec("sh", ["-c", 'python3 -c "$1" "$2"', "tower", script, JSON.stringify({ turns: { terminals, since_s } })], { on: m || null, timeout: 30000 });
        // When the answer came, on the clock the view draws by.
        const readAt = now + (Date.now() - t0);
        const out = JSON.parse(r.stdout);
        for (const t of terminals) {
          const T = out.turns?.terminals?.[t.key];
          fill.cache[t.key] = T?.path && Number.isFinite(out.now) ? toLocal(T, out.now, readAt) : { at: readAt, missing: true };
        }
        saveFill(dir, readAt);
        onLoad?.();
      } catch {
        // Not cached: it is asked again after Herdr restarts.
      } finally {
        fill.running.delete(m);
      }
    })();
  }
  return fill.cache;
}

// When you first looked at the address within [from, to]; already on it when it started counts as at once.
export function firstLook(h, address, from, to) {
  const before = h.looks.filter((l) => l.at <= from).at(-1);
  if (before?.a === address) return from;
  return h.looks.find((l) => l.a === address && l.at > from && l.at <= to)?.at ?? null;
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
export function lanesOf(m, h, { now, start, first = null, changes = {} }) {
  const recordedIn = (a) => h.events.some((e) => e.a === a && e.at >= start) || h.events.filter((e) => e.a === a).at(-1)?.s !== "ended";
  const taken = new Set();
  const tasks = [];
  const sinceOf = (t) => changes?.[t.address]?.at ?? t.status_ms ?? null;
  const fromRow = (row) => ({ a: row.t.address, t: row.t, role: "worker", name: row.t.name ?? row.t.address, machine: machineOf(row.t.address), live: row.status ?? null, since: sinceOf(row.t), wait: waitOf(row.t), created: row.t.created_ms ?? null, lines: row.lines ?? [] });
  const ended = (a, meta) => ({ a, role: meta.role, name: meta.role === "lead" ? "Lead" : meta.name ?? a, machine: meta.machine ?? null, live: null, created: meta.created ?? null, lines: [], ended: true });
  // The Eye is not a task (the list gives it its own row): Timeline leaves it out, live or ended.
  const isEye = (t) => t?.labels?.["tower.eye"] === "1";
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
    for (const [a, meta] of Object.entries(h.lanes)) {
      if (!meta.eye && meta.task === item.key && recordedIn(a)) add(folded, ended(a, meta));
    }
    tasks.push({ key: item.key, item, area: item.area ?? null, title: item.title, lanes, folded, quiet: item.quiet ?? [] });
  }
  // Tasks the model no longer has.
  const gone = new Map();
  for (const [a, meta] of Object.entries(h.lanes)) {
    if (meta.eye || taken.has(a) || !meta.task || m.items.some((i) => i.key === meta.task) || !h.events.some((e) => e.a === a && e.at >= start)) continue;
    if (!gone.has(meta.task)) gone.set(meta.task, { key: meta.task, item: null, area: meta.area ?? null, title: meta.taskTitle ?? meta.name ?? meta.task, lanes: [], folded: [], quiet: [] });
    gone.get(meta.task).lanes.push(ended(a, meta));
  }
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
  const endedCount = task.folded.filter((l) => l.ended).length;
  return [model.quietWords(task.quiet), endedCount ? `${endedCount} ended` : null].filter(Boolean).join(" · ");
}

// What a wait is, in the list's words ("Needs permission", "Asks you", …).
const waitOf = (t) => model.waitWords(t);

const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

// A task's one line: at each moment the most urgent thing any of its agents did (Needs you, the
// lead's Done, Working, Idle; a worker's Done counts as Idle, as in the list). Recorded beats rebuilt.
const RANK_OF = { blocked: 4, done: 3, working: 2, idle: 1 };
export function summaryOf(task) {
  const pieces = [...task.lanes, ...task.folded].flatMap((lane) => (lane.stretches ?? []).map((st) => ({ st, lane })));
  const rank = ({ st, lane }) => 2 * (RANK_OF[st.s === "done" && lane.role !== "lead" ? "idle" : st.s] ?? 0) + (st.how ? 0 : 1);
  const cuts = [...new Set(pieces.flatMap(({ st }) => [st.from, st.to]))].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    let best = null;
    for (const p of pieces) if (p.st.from <= a && p.st.to >= b && (!best || rank(p) > rank(best))) best = p;
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
    for (const st of lane.stretches) {
      if (st.s !== "blocked" || st.how === "guessed" || st.to < since) continue;
      const seen = firstLook(h, lane.a, st.from, st.to);
      all.push({ lane, ...st, waited: st.to - st.from, seenAfter: seen == null ? null : seen - st.from });
    }
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
const store = { h: EMPTY, stamp: undefined, loading: false, at: 0 };
export function history(dir, onLoad, now = Date.now()) {
  const stamp = shared(RECORDED) ?? null;
  if ((stamp !== store.stamp || now - store.at > 60e3) && !store.loading && dir) {
    store.loading = true;
    store.at = now;
    readTextFile(`${dir}/timeline/events.json`).catch(() => null).then((text) => {
      store.h = text ? parseHistory(text) : EMPTY;
      store.stamp = stamp;
      store.loading = false;
      try {
        onLoad?.();
      } catch {}
    });
  }
  return store.h;
}

function storedSpan() {
  try {
    const i = Number(localStorage.getItem("agent-tower.timeline.span"));
    return SPANS[i] ? i : 2;
  } catch {
    return 2;
  }
}

// ui (t44's stage): {now, width, height, area, selectedKey, select(item) (goes into the task), pick(item)
// (selects only), openTerminal(address), notify(),
// state (kept per view across renders: the zoom), towerDir, here, shape}.
export function render(t, m, ui) {
  const view = (ui.state ??= {});
  view.span ??= storedSpan();
  const now = ui.now ?? Date.now();
  const h = history(ui.towerDir, ui.notify, now);
  const W = ui.width ?? 1000;
  const trackW = Math.max(240, W - LABEL_W - 16);
  const pastW = trackW - NOW_COL;
  const span = SPANS[view.span];
  const start = now - span.ms;
  const x = (ms) => ((ms - start) / span.ms) * pastW;
  const moment = shared(MOMENT) ?? null;

  const groups = lanesOf(m, h, { now, start, first: ui.area ?? null, changes: shared("agent-tower.changes") ?? {} });
  for (const g of groups) for (const task of g.tasks) for (const lane of [...task.lanes, ...task.folded]) {
    lane.gaps = gapsFor(h, lane.machine, now);
    lane.stretches = stretches(h, lane.a, now, { live: lane.live, since: lane.since, gaps: lane.gaps });
  }
  // Before the recorder: what each agent's transcript tells, where one is found.
  const firstAtOf = (a) => h.events.find((e) => e.a === a)?.at ?? null;
  const allLanes = groups.flatMap((g) => g.tasks.flatMap((task) => [...task.lanes, ...task.folded]));
  const filled = backfill(ui.towerDir, allLanes, firstAtOf, now, ui.notify);
  for (const lane of allLanes) {
    const entry = filled[backfillKey(lane)];
    if (!entry?.turns) continue;
    lane.rebuilt = entry;
    const until = lane.stretches[0]?.from ?? now;
    lane.stretches = [...cutGaps(rebuild(entry, { from: lane.created, until }), lane.gaps), ...lane.stretches];
  }
  // The view's own area chips: every area (the shown one first), or one.
  const byArea = view.area && groups.some((g) => g.area === view.area) ? groups.filter((g) => g.area === view.area) : groups;
  // "N Needs you" shows only the tasks waiting on you, in every area.
  const shownGroups = view.needs ? byArea.map((g) => ({ ...g, tasks: g.tasks.filter(hasAsk) })).filter((g) => g.tasks.length) : byArea;
  const shown = shownGroups.flatMap((g) => g.tasks.flatMap((task) => [...task.lanes, ...task.folded]));
  const att = attention(h, shown, start, now);

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
  for (let k = Math.ceil(start / span.tick) * span.tick; k < now; k += span.tick) ticks.push(k);
  const grid = (hgt) => ticks.map((k) => div().absolute().left(x(k)).top(0).w(1).h(hgt).bg(t.border).opacity(0.45));
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
  const segment = (task, lane, st, prefix = "s") => {
    const x0 = Math.max(0, x(st.from));
    const x1 = Math.min(pastW, x(st.to));
    if (x1 <= 0 || x0 >= pastW) return null;
    const w = Math.max(st.s === "blocked" ? 4 : 2, x1 - x0);
    const color = wordColor(t, st.s);
    const picked = moment?.address === lane.a && moment?.at === st.from;
    const took = duration(st.to - st.from);
    // The mark is drawn inside a hit box the lane's full height (and at least 6px wide), so a thin
    // bar at 8h or Day can still be hovered and clicked.
    const hit = div().id(`${prefix}-${lane.a}-${st.from}`).absolute().left(x0).top(0).h(LANE_H).w(Math.max(6, w)).cursor_pointer()
      .tooltip(`${st.how === "guessed" ? "Guessed · " : st.how ? "Rebuilt · " : ""}${WORD[st.s] ?? st.s} · ${clock(st.from)}–${st.ongoing ? "now" : clock(st.to)} · ${took}`)
      .on_click(() => pick(task, lane, st));
    let el = div().absolute().left(0);
    // Rebuilt from a transcript: the same shape, outlined instead of filled.
    if (st.how && st.s === "working") el = el.top(10).h(4).w(w).rounded(2).border(1).border_color(color).opacity(0.55);
    else if (st.how === "guessed") el = el.top(LANE_H / 2 - 1).h(2).w(w).child(guessMark(w, 0.6));
    else if (st.how && st.s === "blocked") el = el.top(4).h(LANE_H - 8).w(w).rounded(3).border(1).border_color(color).opacity(0.8);
    else if (st.s === "working") el = el.top(10).h(4).w(w).rounded(2).bg(color).opacity(picked ? 0.8 : 0.3);
    else if (st.s === "blocked" && st.ongoing) {
      el = el.top(2).h(LANE_H - 4).w(w).rounded(4).bg(color).overflow_hidden();
      // Solid until you first looked, pale after: seen, and still left waiting.
      const seen = firstLook(h, lane.a, st.from, st.to);
      const sx = seen == null ? w : Math.max(0, x(seen) - x0);
      if (sx < w - 1) el = el.child(div().absolute().left(sx).top(0).h(LANE_H - 4).w(w - sx).bg("#ffffff").opacity(0.42));
    } else if (st.s === "blocked") {
      el = el.top(4).h(LANE_H - 8).w(w).rounded(3).bg(color + "33").overflow_hidden().flex().items_center();
      if (w > 30) el = el.child(div().pl(5).text_size(11).text_color(color).whitespace_nowrap().child(took));
    } else if (st.s === "done") el = el.top(10).h(4).w(w).rounded(2).bg(color).opacity(st.ongoing ? 0.75 : 0.4);
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

  const track = (children, hgt = LANE_H) => div().relative().w(trackW).h(hgt).flex_none().children([...grid(hgt), ...children.filter(Boolean), nowLine(hgt)]);

  const laneRow = (task, lane) => {
    const firstAt = h.events.find((e) => e.a === lane.a)?.at ?? null;
    // Alive before the recorder first saw it (before install, or before it ran): unknown, said so.
    // A transcript's turns cover part of it: the band shrinks to what is before them.
    const knownFrom = lane.rebuilt ? (lane.stretches[0]?.from ?? firstAt ?? now) : firstAt ?? now;
    const unknown = lane.created != null && (firstAt == null ? lane.live : true) && lane.created < knownFrom - 1000
      ? band(lane.a, lane.created, knownFrom, firstAt == null && !lane.rebuilt ? "Not recorded yet" : "Before recording") : null;
    const gaps = lane.gaps.map((g) => band(lane.a, g.from, g.to, g.m === "herdr" ? "Not recorded: Herdr was closed" : `Not recorded: ${g.m} did not answer`));
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
      .child(lane.ended ? label : withMenu(label, { agent: lane.a })).child(track([unknown, ...gaps, ...lane.stretches.map((st) => segment(task, lane, st)), nowCell(task, lane)]));
  };

  const variant = shared("agent-tower.rowMark") ?? "state";
  // A task is one line (its summary) until you open it; what you opened stays open.
  const isOpen = (task) => Boolean(view.tasks?.[task.key]);
  const taskRow = (task) => {
    const on = task.key === ui.selectedKey;
    const open = isOpen(task);
    const machines = (task.item?.machines ?? []).filter(Boolean).join(", ");
    // Opened, its lanes say it all: the task's own line keeps only its name.
    const summary = open ? [] : summaryOf(task);
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
      .child(track([...(open ? [] : gapsFor(h, null, now).map((g) => band(`t-${task.key}`, g.from, g.to, "Not recorded: Herdr was closed", HEAD_H))),
        ...summary.map((st) => segment(task, st.lane, st, "S")), cell, where], HEAD_H));
  };

  const rows = [];
  const pushTask = (task) => {
    rows.push(taskRow(task));
    if (!isOpen(task)) return;
    for (const lane of task.lanes) rows.push(laneRow(task, lane));
    if (task.folded.length) {
      const open = Boolean(view.open?.[task.key]);
      rows.push(h_flex().id(`f-${task.key}`).h(LANE_H - 2).flex_none().items_center().gap(6).pl(30).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          view.open = { ...view.open, [task.key]: !open };
          cx?.notify();
        })
        .child(div().text_size(12).text_color(t.dim).child(open ? "⌄" : "›"))
        .child(div().text_size(12).text_color(t.muted).child(foldWords(task))));
      if (open) for (const lane of task.folded) rows.push(laneRow(task, lane));
    }
  };
  for (const g of shownGroups) {
    const n = g.tasks.reduce((c, task) => c + task.lanes.filter((l) => l.live === "blocked").length, 0);
    rows.push(h_flex().h(26).flex_none().items_end().pb(3).pl(12).gap(8)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(g.label.toUpperCase()))
      .when(n > 0, (e) => e.child(div().text_size(11).text_color(wordColor(t, "blocked")).child(`${n} ${WORD.blocked}`))));
    const quiet = g.tasks.filter((task) => task.key !== ui.selectedKey && isQuiet(task, start));
    for (const task of g.tasks) if (!quiet.includes(task)) pushTask(task);
    if (quiet.length) {
      const open = Boolean(view.quiet?.[g.area]);
      rows.push(h_flex().id(`q-${g.area}`).h(HEAD_H).flex_none().items_center().gap(4).pl(4).cursor_pointer().hover((s) => s.bg(t.hover))
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
  if (!rows.length) rows.push(div().p(16).text_size(13).text_color(t.muted).child("No agents"));

  // Where your focus was, in Herdr with its window in front. One ink; the tooltip names the agent.
  const names = new Map(shown.map((l) => [l.a, l]));
  const youSegs = focusStretches(h, now).map((f) => {
    const x0 = Math.max(0, x(f.from));
    const x1 = Math.min(pastW, x(f.to));
    if (!names.has(f.a) || x1 <= 0 || x0 >= pastW) return null;
    return div().id(`y-${f.from}`).absolute().left(x0).top(8).h(8).w(Math.max(2, x1 - x0)).rounded(2).bg(t.foreground).opacity(0.3)
      .tooltip(`You on ${names.get(f.a).name} · ${clock(f.from)}–${clock(f.to)}`);
  });
  const herdrGaps = gapsFor(h, null, now).map((g) => band("you", g.from, g.to, "Not recorded: Herdr was closed"));

  const swatch = (el, word) => h_flex().gap(4).items_center().child(el).child(div().child(word));
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
      .child(div().child(`${att.count}× ${WORD.blocked} in ${span.name === "Day" ? "24h" : span.name}`))
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
      ...ticks.filter((k, i) => pastW - x(k) > 44 && i % Math.ceil(44 / ((span.tick / span.ms) * pastW)) === 0).map((k) => div().absolute().left(x(k) + 3).top(4).text_size(10).text_color(t.dim).child(clock(k))),
      div().absolute().left(pastW - 14).top(2).px(4).rounded(3).bg(t.accent).text_size(10).font_semibold().text_color(t.accent_foreground).child("now"),
    ]));
  const you = h_flex().h(LANE_H).flex_none().border_b(1).border_color(t.border)
    .child(h_flex().id("you").w(LABEL_W).flex_none().items_center().pl(12).tooltip("Where you looked")
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("You")))
    .child(track([...herdrGaps, ...youSegs]));

  return v_flex().id("timeline").size_full().bg(t.surface)
    .child(header).child(axis).child(you)
    .child(v_flex().id("timeline-body").flex_1().min_h(0).overflow_y_scroll().pb(8).children(rows))
    .child(legend);
}
