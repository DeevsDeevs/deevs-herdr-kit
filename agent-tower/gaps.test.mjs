// node gaps.test.mjs: a history with many gaps (a Mac that slept and woke for a few seconds every
// quarter hour). Gaps a few seconds apart join, when written and when read; Timeline cuts stretches
// by gaps in one pass; and a Timeline rebuild cut off half-way keeps the lanes it finished, so a
// first draw too big for one frame ends after a few (Node's vm timeout cuts the way Herdr does:
// no catch, no finally; cutoff.test.mjs). All data made up.
import assert from "node:assert/strict";
import vm from "node:vm";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const stubs = new URL(`file://${join(here, "perf/stubs.mjs")}`).href;
registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: stubs, shortCircuit: true } : next(s, c)) });
globalThis.__fx = { files: {}, shared: {}, elements: 0, calls: 0, log: [] };
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };

const model = await import("./mods/agent-tower/model.js");
const T = await import("./mods/agent-tower/timeline.js");
const { buildFixture } = await import("./perf/big-fixture.mjs");
const MIN = 60e3;
const now = Date.UTC(2026, 10, 15, 12);

// ── joinGaps ──
{
  const g = (m, from, to) => ({ m, from, to });
  // Sleep cycles: 13 minutes asleep, 5 s awake, five times; another machine's gap in between stays its own.
  const cycles = [];
  for (let i = 0, t = now - 2 * 3600e3; i < 5; i++, t += 13 * MIN + 5e3) cycles.push(g("herdr", t, t + 13 * MIN));
  const joined = model.joinGaps([...cycles, g("vps", now - 90 * MIN, now - 80 * MIN)]);
  assert.deepEqual(joined.map((x) => [x.m, x.from, x.to]), [["herdr", cycles[0].from, cycles[4].to], ["vps", now - 90 * MIN, now - 80 * MIN]]);
  assert.notEqual(joined[0], cycles[0], "a joined gap is a new object");
  assert.equal(cycles[0].to, cycles[0].from + 13 * MIN, "the old ones are left as they were");
  // Far enough apart: nothing joins, and the same array comes back.
  const apart = [g("herdr", now - 60 * MIN, now - 50 * MIN), g("herdr", now - 40 * MIN, now - 30 * MIN)];
  assert.equal(model.joinGaps(apart), apart);
  // Overlapping and duplicated (two writers) join; an open gap 3 s after a closed one goes on from
  // its start, open; one a minute after stays apart, as it was.
  const open = { m: "vps", from: now - 10 * MIN + 3e3, to: null };
  const mixed = model.joinGaps([g("vps", now - 20 * MIN, now - 10 * MIN), g("vps", now - 20 * MIN, now - 12 * MIN), open]);
  assert.deepEqual(mixed, [g("vps", now - 20 * MIN, null)]);
  const later = { m: "vps", from: now - 9 * MIN, to: null };
  const kept = model.joinGaps([g("vps", now - 20 * MIN, now - 10 * MIN), later]);
  assert.equal(kept[1], later);
  // A wider reach (Timeline joins what lies under a pixel).
  assert.equal(model.joinGaps(apart, 11 * MIN).length, 1);
}

// ── The recorder joins as it writes ──
{
  // A start after a short wake extends the gap before it; after a long one it adds a new one.
  const rec = model.newRecord();
  rec.beat = now - 30 * MIN;
  model.recordStart(rec, now - 17 * MIN);
  assert.equal(rec.gaps.length, 1);
  rec.beat = now - 17 * MIN + 5e3;
  model.recordStart(rec, now - 4 * MIN);
  assert.deepEqual(rec.gaps, [{ m: "herdr", from: now - 30 * MIN, to: now - 4 * MIN }]);
  rec.beat = now - 4 * MIN + 3 * MIN;
  model.recordStart(rec, now + 10 * MIN);
  assert.equal(rec.gaps.length, 2, "three minutes awake are kept");

  // A machine that answers for 4 s between two silences: one gap.
  const r2 = model.newRecord();
  const step = (at, reachable) => model.recordStep(r2, { terms: [], all: [], now: at, reach: [{ name: "vps", reachable, since: at }] });
  step(now - 30 * MIN, false);
  step(now - 20 * MIN, true);
  step(now - 20 * MIN + 4e3, false);
  step(now - 5 * MIN, true);
  assert.deepEqual(r2.gaps, [{ m: "vps", from: now - 30 * MIN, to: now - 5 * MIN }]);

  // Two writers: mine joined A and B, theirs still has both; the merge is one gap.
  const a = { m: "herdr", from: now - 60 * MIN, to: now - 47 * MIN };
  const b = { m: "herdr", from: now - 47 * MIN + 5e3, to: now - 34 * MIN };
  const merged = model.mergeRecords({ gaps: [a, b] }, { ...model.newRecord(), gaps: [{ ...a, to: b.to }] });
  assert.deepEqual(merged.gaps, [{ m: "herdr", from: a.from, to: b.to }]);
}

// ── Files written before the join read joined (events.json and index.json) ──
{
  const gaps = [];
  for (let t = now - 10 * 3600e3; t < now - 3600e3; t += 13 * MIN + 5e3) gaps.push({ m: "herdr", from: t, to: t + 13 * MIN });
  assert.ok(gaps.length > 40);
  assert.equal(T.parseHistory(JSON.stringify({ lanes: {}, events: [], looks: [], gaps })).gaps.length, 1);
  assert.equal(T.parseIndex(JSON.stringify({ tasks: {}, gaps })).gaps.length, 1);
}

// ── cutGaps: one pass, the same pieces as one cut per gap ──
{
  const perGap = (list, gaps) => {
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
  };
  let seed = 3;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
  for (let k = 0; k < 300; k++) {
    const list = [];
    for (let t = rnd(50); t < 1000; ) {
      const to = t + 1 + rnd(120);
      list.push({ s: ["working", "idle", "blocked"][rnd(3)], from: t, to, msg: null, ongoing: false });
      t = to + rnd(3) * rnd(40);
    }
    if (list.length && rnd(2)) list[list.length - 1].ongoing = true;
    // Gaps of any shape: overlapping, touching, inside one stretch, unsorted.
    const gaps = Array.from({ length: rnd(25) }, () => {
      const from = rnd(1100);
      return { m: "herdr", from, to: from + 1 + rnd(60) };
    });
    assert.deepEqual(T.cutGaps(list, gaps), perGap(list, gaps), `case ${k}`);
  }
}

// ── A rebuild cut off half-way keeps what it finished ──
// The ten-times record (175 lanes, 850 gaps). A frame here may work out at most BUDGET lanes: a read
// of a lane's events beyond that spins until the vm cuts the render off, as Herdr's 50 ms does.
{
  const fx = buildFixture("gaps10");
  globalThis.__fx = { files: { ...fx.files }, shared: {}, elements: 0, calls: 0, log: [] };
  const listed = new Map(fx.agents.map((a) => [a.address, a.status]));
  const theModel = () => model.taskModel({ terms: fx.terms, listed, spaces: fx.spaces, config: fx.config, changes: new Map(), seen: {}, now: fx.now, titles: {}, eye: null });
  const THEME = new Proxy({}, { get: (_, k) => (typeof k === "string" ? "#808080" : undefined) });
  const ui = { now: fx.now, width: 1100, height: 720, area: null, selectedKey: null, state: { span: 0 }, towerDir: fx.towerDir, here: "mac",
    shape: "sidebar", notify() {}, select() {}, pick() {}, open() {}, goInto() {}, onMenu: (el) => el };
  // Loaded first (the files are read in promise jobs, as in Herdr).
  for (let i = 0; i < 3; i++) {
    T.render(THEME, theModel(), ui);
    for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 0));
  }
  const h = T.history(fx.towerDir, null, fx.now);
  assert.ok(h.events.length >= 8000 && h.gaps.length >= 800, "the big record is loaded");
  const BUDGET = 20;
  let spying = true;
  const readIn = new Map();
  let thisFrame = new Set();
  let frame = 0;
  for (const e of h.events) {
    const msg = e.msg;
    Object.defineProperty(e, "msg", {
      get() {
        if (spying && !thisFrame.has(e.a)) {
          thisFrame.add(e.a);
          if (thisFrame.size > BUDGET) for (;;) {}
          readIn.set(e.a, [...(readIn.get(e.a) ?? []), frame]);
        }
        return msg;
      },
    });
  }
  // Each span: a fresh view (nothing kept from an earlier frame), drawn over cut-off frames.
  for (const span of [0, 2, 4]) {
    ui.state = { span };
    readIn.clear();
    let drawn = null;
    let cuts = 0;
    for (frame = 0; frame < 20 && !drawn; frame++) {
      thisFrame = new Set();
      try {
        drawn = vm.runInNewContext("f()", { f: () => T.render(THEME, theModel(), ui) }, { timeout: 300 });
      } catch (e) {
        assert.equal(e.code, "ERR_SCRIPT_EXECUTION_TIMEOUT", String(e));
        cuts++;
      }
    }
    assert.ok(drawn, `span ${span}: drawn after ${cuts} cut-off frames`);
    assert.ok(cuts >= 2, `span ${span}: the first draw was bigger than a frame (${cuts} cut)`);
    assert.ok(ui.state.cache, `span ${span}: kept`);
    // Every lane worked out in one frame only: a cut frame's finished lanes were not done again.
    const again = [...readIn].filter(([, frames]) => frames.length > 1);
    assert.deepEqual(again, [], `span ${span}: lanes worked out again`);
    assert.ok(readIn.size > BUDGET, `span ${span}: lanes read (${readIn.size})`);
  }
  spying = false;
}

// ── Round 1 (review) ──

// R1-4: one gap in two writers' copies: the one that covers more wins, in either order, and a gap
// closed on one side is not reopened by the other's stale open copy.
{
  const a = { m: "herdr", from: now - 60 * MIN, to: now - 47 * MIN };
  const joined = { m: "herdr", from: now - 60 * MIN, to: now - 34 * MIN };
  const rec = (gaps) => ({ ...model.newRecord(), gaps });
  assert.deepEqual(model.mergeRecords(rec([a]), rec([joined])).gaps, [joined], "theirs has the part");
  assert.deepEqual(model.mergeRecords(rec([joined]), rec([a])).gaps, [joined], "mine has the part");
  // index.json (movePast joins index.gaps with the moved part the same way).
  assert.deepEqual(model.joinGaps([a, joined]), [joined]);
  assert.deepEqual(model.joinGaps([joined, a]), [joined]);
  // Open against closed, same start: closed. A machine's gap closed and joined here; theirs still open.
  const openThere = { m: "vps", from: now - 20 * MIN + 4e3, to: null };
  const r = model.newRecord();
  const step = (at, reachable) => model.recordStep(r, { terms: [], all: [], now: at, reach: [{ name: "vps", reachable, since: at }] });
  step(now - 30 * MIN, false);
  step(now - 20 * MIN, true);
  step(now - 20 * MIN + 4e3, false);
  step(now - 5 * MIN, true);
  const closedHere = { m: "vps", from: now - 30 * MIN, to: now - 5 * MIN };
  assert.deepEqual(r.gaps, [closedHere]);
  const theirs = { ...model.newRecord(), gaps: [{ m: "vps", from: now - 30 * MIN, to: now - 20 * MIN }, openThere] };
  assert.deepEqual(model.mergeRecords(theirs, r).gaps, [closedHere], "not reopened");
  assert.deepEqual(model.mergeRecords(r, theirs).gaps, [closedHere], "either order");
  assert.deepEqual(model.joinGaps([{ m: "vps", from: now - 30 * MIN, to: null }, closedHere]), [closedHere]);
}

// A task's line swept over stretches cut by the machines' gaps only, Herdr's left out as it goes:
// the same pieces (words, times, messages, lanes, ongoing) as over the stretches cut by both.
{
  let seed = 11;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
  const WORDS = ["working", "idle", "blocked", "done"];
  for (let k = 0; k < 300; k++) {
    const herdr = Array.from({ length: rnd(12) }, () => {
      const from = rnd(1100);
      return { m: "herdr", from, to: from + 1 + rnd(80) };
    });
    const lanes = Array.from({ length: 1 + rnd(4) }, (_, li) => {
      const list = [];
      for (let t = rnd(60); t < 1000; ) {
        const to = t + 1 + rnd(150);
        list.push({ s: WORDS[rnd(4)], from: t, to, msg: `m${li}-${t}`, ongoing: false, ...(rnd(6) ? {} : { how: "rebuilt" }) });
        t = to + rnd(2) * rnd(30);
      }
      if (list.length && rnd(2)) list[list.length - 1].ongoing = true;
      const machine = Array.from({ length: rnd(4) }, () => {
        const from = rnd(1100);
        return { m: "vps", from, to: from + 1 + rnd(60) };
      });
      const lineStretches = T.cutGaps(list, machine);
      return { a: `t${li}`, role: li ? "worker" : "lead", lineStretches, stretches: T.cutGaps(lineStretches, herdr) };
    });
    const task = { lanes: lanes.slice(0, 2), folded: lanes.slice(2) };
    const from = rnd(300);
    const to = 700 + rnd(400);
    const strip = (xs) => xs.map(({ lane, ...x }) => ({ ...x, lane: lane.a }));
    assert.deepEqual(strip(T.summaryOf(task, from, to, herdr)), strip(T.summaryOf(task, from, to)), `case ${k}`);
  }
}

// A history put in the files and read by Timeline (a new recorder stamp), its events' msg spied on
// as above.
const THEME = new Proxy({}, { get: (_, k) => (typeof k === "string" ? "#808080" : undefined) });
let stamp = 1;
async function loadInto(files, dir, ui, m) {
  for (const x of spies) x.on = false;
  globalThis.__fx = { files: { ...files }, shared: { "agent-tower.recorded": stamp++ }, elements: 0, calls: 0, log: [] };
  for (let i = 0; i < 3; i++) {
    T.render(THEME, m(), ui);
    for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 0));
  }
  return T.history(dir, null, ui.now);
}
// Only the newest spy cuts (an older one's events may still be read).
const spies = [];
const spy = (h, budget) => {
  for (const x of spies) x.on = false;
  const s = { frame: new Set(), on: true };
  spies.push(s);
  for (const e of h.events) {
    const msg = e.msg;
    Object.defineProperty(e, "msg", { get() {
      if (s.on && !s.frame.has(e.a)) {
        s.frame.add(e.a);
        if (s.frame.size > budget) for (;;) {}
      }
      return msg;
    } });
  }
  return s;
};
// One frame of a view, cut off as Herdr would: what it returned, or null.
const frameOf = (s, f) => {
  s.frame = new Set();
  try {
    return vm.runInNewContext("f()", { f }, { timeout: 300 });
  } catch (e) {
    assert.equal(e.code, "ERR_SCRIPT_EXECUTION_TIMEOUT", String(e));
    return null;
  }
};

// R1-1 and R1-2 on the ten-times record.
{
  const fx = buildFixture("gaps10");
  const listed = new Map(fx.agents.map((a) => [a.address, a.status]));
  const theModel = () => model.taskModel({ terms: fx.terms, listed, spaces: fx.spaces, config: fx.config, changes: new Map(), seen: {}, now: fx.now, titles: {}, eye: null });
  const uiOf = (span, now = fx.now) => ({ now, width: 1100, height: 720, area: null, selectedKey: null, state: { span }, towerDir: fx.towerDir, here: "mac",
    shape: "sidebar", notify() {}, select() {}, pick() {}, open() {}, goInto() {}, onMenu: (el) => el });

  // R1-1: two views (1h and 8h, as two area windows) drawn in turn, each cut at 20 lanes a frame:
  // neither undoes the other's kept lanes.
  const a = uiOf(0);
  const b = uiOf(2);
  let h = await loadInto(fx.files, fx.towerDir, a, theModel);
  let s = spy(h, 20);
  a.state = { span: 0 };
  let drawnA = null;
  let drawnB = null;
  for (let k = 0; k < 20 && !(drawnA && drawnB); k++) {
    drawnA ||= frameOf(s, () => T.render(THEME, theModel(), a));
    drawnB ||= frameOf(s, () => T.render(THEME, theModel(), b));
  }
  assert.ok(drawnA && drawnB, "both views drawn");

  // R1-2: a machine that does not answer (an open gap) while now moves 250 ms a frame, at Week.
  const ev = JSON.parse(fx.files[`${fx.towerDir}/timeline/events.json`]);
  ev.gaps.push({ m: "work-vps", from: fx.now - 3 * MIN, to: null });
  const files = { ...fx.files, [`${fx.towerDir}/timeline/events.json`]: JSON.stringify(ev) };
  const w = uiOf(4);
  h = await loadInto(files, fx.towerDir, w, theModel);
  assert.ok(h.gaps.some((g) => g.to == null), "the open gap is loaded");
  s = spy(h, 20);
  w.state = { span: 4 };
  let drawn = null;
  let cuts = 0;
  for (let k = 0; k < 40 && !drawn; k++, w.now += 250) {
    drawn = frameOf(s, () => T.render(THEME, theModel(), w));
    if (!drawn) cuts++;
  }
  assert.ok(drawn, `drawn with an open gap after ${cuts} cut frames`);
  // The open gap still cuts: nothing after its start on that machine.
  const vpsLanes = w.state.cache.shown.filter((l) => l.machine === "work-vps" && l.live);
  assert.ok(vpsLanes.length > 0);
  for (const l of vpsLanes) assert.ok(l.stretches.every((st) => st.to <= fx.now - 3 * MIN), `${l.a} drawn past the open gap`);
}

// R1-3: a gap that ended before the span's start still cuts a stretch that crosses it: the same
// stretch at 1h as at 8h.
{
  const dir = "/made/up/r13";
  const ev = { v: 1, beat: now, lanes: { t1: { task: "task:r13", taskId: "r13", taskTitle: "Made-up task", role: "lead", name: "lead", machine: null, created: now - 4 * 3600e3 } },
    events: [{ a: "t1", s: "working", turn: 1, at: now - 180 * MIN, msg: null }, { a: "t1", s: "idle", turn: 1, at: now - 30 * MIN, msg: null }],
    looks: [], gaps: [{ m: "herdr", from: now - 120 * MIN, to: now - 70 * MIN }] };
  const ui = (span) => ({ now, width: 1100, height: 720, state: { span }, towerDir: dir, here: "mac", notify() {}, select() {}, pick() {}, open() {}, goInto() {}, onMenu: (el) => el });
  const m = () => ({ areas: [], items: [] });
  const one = ui(0);
  await loadInto({ [`${dir}/timeline/events.json`]: JSON.stringify(ev) }, dir, one, m);
  const eight = ui(2);
  T.render(THEME, m(), one);
  T.render(THEME, m(), eight);
  const working = (u) => u.state.cache.shown.find((l) => l.a === "t1").stretches.filter((st) => st.s === "working").map((st) => [(now - st.from) / MIN, (now - st.to) / MIN]);
  assert.deepEqual(working(eight), [[180, 120], [70, 30]]);
  assert.deepEqual(working(one), working(eight), "1h cuts as 8h does");
}

console.log("gaps ok");
