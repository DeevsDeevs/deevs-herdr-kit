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
  // Overlapping and duplicated (two writers) join; an open gap stays open and apart.
  const open = { m: "vps", from: now - 10 * MIN + 3e3, to: null };
  const mixed = model.joinGaps([g("vps", now - 20 * MIN, now - 10 * MIN), g("vps", now - 20 * MIN, now - 12 * MIN), open]);
  assert.deepEqual(mixed, [g("vps", now - 20 * MIN, now - 10 * MIN), open]);
  assert.equal(mixed[1], open);
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

// ── Case 4: a merge keeps the copy of a gap that covers most, in either order ──
// mergeRecords (two writers of events.json) and movePast (index.json and the moved part) both merge
// through model.mergeGaps.
{
  const g = (m, from, to) => ({ m, from, to });
  const rec = (gaps) => ({ ...model.newRecord(), gaps });
  const both = (x, y, want, what) => {
    assert.deepEqual(model.mergeRecords(rec(x), rec(y)).gaps, want, `${what}: theirs, mine`);
    assert.deepEqual(model.mergeRecords(rec(y), rec(x)).gaps, want, `${what}: mine, theirs`);
    assert.deepEqual(model.mergeGaps([...x, ...y]), want, `${what}: index, part`);
    assert.deepEqual(model.mergeGaps([...y, ...x]), want, `${what}: part, index`);
  };
  // Mine joined A with a newer gap; theirs still has A alone.
  const a = g("herdr", now - 60 * MIN, now - 47 * MIN);
  both([a], [g("herdr", a.from, now - 34 * MIN)], [g("herdr", a.from, now - 34 * MIN)], "theirs has the part");
  // recordStep closed a machine's gap and joined it to the one before; theirs still has it open.
  const r = model.newRecord();
  const step = (at, reachable) => model.recordStep(r, { terms: [], all: [], now: at, reach: [{ name: "vps", reachable, since: at }] });
  step(now - 30 * MIN, false);
  step(now - 20 * MIN, true);
  step(now - 20 * MIN + 4e3, false);
  const theirs = structuredClone(r.gaps);
  step(now - 5 * MIN, true);
  assert.deepEqual(r.gaps, [g("vps", now - 30 * MIN, now - 5 * MIN)]);
  both(theirs, r.gaps, [g("vps", now - 30 * MIN, now - 5 * MIN)], "closed and joined against open");
  // The same gap open on one side, closed on the other: closed (that writer saw the machine answer).
  both([g("vps", now - 9 * MIN, null)], [g("vps", now - 9 * MIN, now - 2 * MIN)], [g("vps", now - 9 * MIN, now - 2 * MIN)], "open against closed");
  // Open on both sides from different starts: one, from the earlier, open.
  both([g("vps", now - 9 * MIN, null)], [g("vps", now - 7 * MIN, null)], [g("vps", now - 9 * MIN, null)], "two open");
  // A silence that began after the other side's gap ended is a new one: still open.
  both([g("vps", now - 30 * MIN, now - 20 * MIN)], [g("vps", now - 10 * MIN, null)], [g("vps", now - 30 * MIN, now - 20 * MIN), g("vps", now - 10 * MIN, null)], "a new silence");
  // Another machine's open gap is not closed by this one's.
  both([g("lab", now - 25 * MIN, null)], [g("vps", now - 30 * MIN, now - 20 * MIN)], [g("vps", now - 30 * MIN, now - 20 * MIN), g("lab", now - 25 * MIN, null)], "another machine");
  // A stale open gap closes where the other writer first saw the machine answer; its later silence
  // stays apart (the time between was recorded).
  const twoSilences = [g("vps", now - 60 * MIN, now - 50 * MIN), g("vps", now - 20 * MIN, now - 10 * MIN)];
  both([g("vps", now - 60 * MIN, null)], twoSilences, twoSilences, "a later silence stays apart");
  // A stale older open gap doesn't push out the other writer's current one.
  both([g("vps", now - 60 * MIN, null)], [g("vps", now - 60 * MIN, now - 50 * MIN), g("vps", now - 5 * MIN, null)],
    [g("vps", now - 60 * MIN, now - 50 * MIN), g("vps", now - 5 * MIN, null)], "a current silence stays open");
  both([g("vps", now - 30 * MIN, null)], [g("vps", now - 30 * MIN, now - 20 * MIN), g("vps", now - 19 * MIN, null)],
    [g("vps", now - 30 * MIN, now - 20 * MIN), g("vps", now - 19 * MIN, null)], "a silence a minute after");
  // A record merged with itself is unchanged, and merging again changes nothing.
  const y = { ...model.newRecord(), lanes: { "vps/t1": { created: now - 90 * MIN } },
    events: [{ a: "vps/t1", s: "working", turn: 1, at: now - 80 * MIN, msg: null }, { a: "vps/t1", s: "idle", turn: 1, at: now - 40 * MIN, msg: null }],
    looks: [{ a: "vps/t1", at: now - 45 * MIN }], gaps: [g("herdr", now - 70 * MIN, now - 65 * MIN), g("vps", now - 60 * MIN, now - 50 * MIN), g("vps", now - 5 * MIN, null)] };
  const self = model.mergeRecords(y, y);
  for (const k of ["lanes", "events", "looks", "gaps"]) assert.deepEqual(self[k], y[k], `merged with itself: ${k}`);
  const pairs = [[[a], [g("herdr", a.from, now - 34 * MIN)]], [theirs, r.gaps], [[g("vps", now - 60 * MIN, null)], twoSilences],
    [[g("vps", now - 60 * MIN, null)], y.gaps], [[g("vps", now - 9 * MIN, null)], [g("vps", now - 7 * MIN, null)]]];
  for (const [p, q] of pairs) {
    const once = model.mergeRecords(rec(p), rec(q));
    assert.deepEqual(model.mergeRecords(rec(p), once).gaps, once.gaps, "merge(a, merge(a, b)) = merge(a, b)");
    assert.deepEqual(model.mergeRecords(once, rec(q)).gaps, once.gaps, "merge(merge(a, b), b) = merge(a, b)");
  }
}

// ── Case 3: a gap that ended before the span's start still cuts a stretch that crosses the start ──
// Working from 3 h ago, then an ask from 50 min ago; Herdr was closed from 2 h ago to 70 min ago.
// Each span (1h to Month) has the same stretches, draws the 1h mark from where the gap ended, and
// counts the same longest wait.
{
  const dir = "/made/up/case3";
  const ev = { v: 1, beat: now, lanes: { t1: { task: "task:c3", taskId: "c3", taskTitle: "Made-up task", role: "lead", name: "lead", machine: null, created: now - 4 * 3600e3 } },
    events: [{ a: "t1", s: "working", turn: 1, at: now - 180 * MIN, msg: null }, { a: "t1", s: "blocked", turn: 1, at: now - 50 * MIN, msg: "Made-up question?" },
      { a: "t1", s: "idle", turn: 2, at: now - 15 * MIN, msg: null },
      { a: "t2", s: "blocked", turn: 1, at: now - 180 * MIN, msg: "Another made-up question?" }, { a: "t2", s: "idle", turn: 2, at: now - 30 * MIN, msg: null }],
    looks: [], gaps: [{ m: "herdr", from: now - 120 * MIN, to: now - 70 * MIN }] };
  ev.lanes.t2 = { ...ev.lanes.t1, role: "worker", name: "worker" };
  globalThis.__fx = { files: { [`${dir}/timeline/events.json`]: JSON.stringify(ev) }, shared: { "agent-tower.recorded": "case 3" }, elements: 0, calls: 0, log: [] };
  T.history(dir, null, now);
  for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 0));
  const THEME = new Proxy({}, { get: (_, k) => (typeof k === "string" ? "#808080" : undefined) });
  const m = { areas: [], items: [] };
  const seen = T.SPANS.map((_, span) => {
    const ui = { now, width: 1100, height: 720, state: { span, tasks: { "task:c3": true } }, towerDir: dir, here: "mac", notify() {}, select() {}, pick() {}, open() {}, goInto() {}, onMenu: (el) => el };
    globalThis.__fx.ids = [];
    T.render(THEME, m, ui);
    const ids = globalThis.__fx.ids;
    globalThis.__fx.ids = null;
    const lane = (a) => ui.state.cache.shown.find((l) => l.a === a).stretches.map((st) => [st.s, (now - st.from) / MIN, (now - st.to) / MIN]);
    const longest = ui.state.cache.att.longest;
    return { span: T.SPANS[span].name, t1: lane("t1"), t2: lane("t2"), longest: longest && [longest.lane.a, longest.waited / MIN], ids };
  });
  assert.deepEqual(seen[2].t1, [["working", 180, 120], ["working", 70, 50], ["blocked", 50, 15], ["idle", 15, 0]]);
  assert.deepEqual(seen[2].t2, [["blocked", 180, 120], ["blocked", 70, 30], ["idle", 30, 0]]);
  for (const s of seen) assert.deepEqual([s.t1, s.t2], [seen[2].t1, seen[2].t2], `${s.span} as 8h`);
  // The longest wait counts the asks in the span, cut: at 1h the 40 minutes after the gap, not 150.
  assert.deepEqual(seen.map((s) => s.longest), [["t2", 40], ...seen.slice(1).map(() => ["t2", 60])]);
  assert.ok(seen[0].ids.includes(`s-t1-${now - 70 * MIN}`) && !seen[0].ids.includes(`s-t1-${now - 180 * MIN}`), "1h draws the working mark from where the gap ended");
}

// ── Case 3, round 1: the Workers lane counts the same asks however the view got to Week ──
// An ended worker's ask that ends just before the Week start, cut by a Herdr gap, and one inside the
// span. A view that showed Month first keeps the lane cut for Month's start; Week counts neither
// piece of the ask before its start.
{
  const dir = "/made/up/case3w";
  const D = 24 * 60 * MIN;
  const lane = { task: "task:c3w", taskId: "c3w", taskTitle: "Made-up task", machine: null, created: now - 9 * D };
  const ev = { v: 1, beat: now, lanes: { t0: { ...lane, role: "lead", name: "lead" }, t1: { ...lane, role: "worker", name: "worker" } },
    events: [{ a: "t0", s: "working", turn: 1, at: now - 9 * D, msg: null },
      { a: "t1", s: "blocked", turn: 1, at: now - 7 * D - 60 * MIN, msg: "Made-up question?" }, { a: "t1", s: "idle", turn: 2, at: now - 7 * D - 2 * MIN, msg: null },
      { a: "t1", s: "blocked", turn: 2, at: now - 7 * D + 5 * MIN, msg: "Another made-up question?" }, { a: "t1", s: "idle", turn: 3, at: now - 7 * D + 20 * MIN, msg: null },
      { a: "t1", s: "ended", turn: null, at: now - D, msg: null }],
    looks: [], gaps: [{ m: "herdr", from: now - 7 * D - 40 * MIN, to: now - 7 * D - 30 * MIN }] };
  globalThis.__fx = { files: { [`${dir}/timeline/events.json`]: JSON.stringify(ev) }, shared: { "agent-tower.recorded": "case 3w" }, elements: 0, calls: 0, log: [] };
  T.history(dir, null, now);
  for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 0));
  const THEME = new Proxy({}, { get: (_, k) => (typeof k === "string" ? "#808080" : undefined) });
  const m = { areas: [], items: [] };
  const uiOf = () => ({ now, width: 1100, height: 720, state: { span: 4, tasks: { "task:c3w": true } }, towerDir: dir, here: "mac", notify() {}, select() {}, pick() {}, open() {}, goInto() {}, onMenu: (el) => el });
  const asks = (ui) => ui.state.cache.groups.flatMap((g) => g.tasks).flatMap((tk) => tk.workers?.asks ?? []).map(([l, st]) => [l.a, st.n ?? 1]);
  const fresh = uiOf();
  T.render(THEME, m, fresh);
  const fromMonth = uiOf();
  fromMonth.state.span = 5;
  T.render(THEME, m, fromMonth);
  fromMonth.state.span = 4;
  T.render(THEME, m, fromMonth);
  assert.deepEqual(asks(fresh), [["t1", 1]], "Week counts the ask inside it");
  assert.deepEqual(asks(fromMonth), asks(fresh), "Month, then Week: the same asks");
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
  const readIn = new Map();
  let thisFrame = new Set();
  let frame = 0;
  for (const e of h.events) {
    const msg = e.msg;
    Object.defineProperty(e, "msg", {
      get() {
        if (!thisFrame.has(e.a)) {
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
}

// ── Guards: what everyday use costs today, held there (timeline-edges.md, step 0) ──
// The ten-times record plus an index.json with one old gap (the person's Mac has one once the
// hourly move ran). A lane worked out is a read of its events in a frame; a frame that works out
// more than `cutAt` lanes is cut off as Herdr would. A frame "draws" when it comes back with the
// same ids and element count as one uncut render of a fresh view on the same data and now.
{
  const fx = buildFixture("gaps10");
  const evPath = `${fx.towerDir}/timeline/events.json`;
  const index = { v: 1, at: fx.now - 5 * MIN, gaps: [{ m: "herdr", from: fx.now - 20 * 24 * 60 * MIN, to: fx.now - 20 * 24 * 60 * MIN + 9 * 60 * MIN }], tasks: {} };
  globalThis.__fx = { files: { ...fx.files, [`${fx.towerDir}/timeline/index.json`]: JSON.stringify(index) },
    shared: { "agent-tower.recorded": "guards" }, elements: 0, calls: 0, log: [] };
  const listed = new Map(fx.agents.map((a) => [a.address, a.status]));
  const theModel = () => model.taskModel({ terms: fx.terms, listed, spaces: fx.spaces, config: fx.config, changes: new Map(), seen: {}, now: fx.now, titles: {}, eye: null });
  const THEME = new Proxy({}, { get: (_, k) => (typeof k === "string" ? "#808080" : undefined) });
  const uiOf = (span, height = 720) => ({ now: fx.now, width: 1100, height, area: null, selectedKey: null, state: { span }, towerDir: fx.towerDir, here: "mac",
    shape: "sidebar", notify() {}, select() {}, pick() {}, open() {}, goInto() {}, onMenu: (el) => el });
  let counting = false;
  let cutAt = Infinity;
  let inFrame = new Set();
  const worked = new Set();
  let watched = null;
  const watch = () => {
    const h = T.history(fx.towerDir, null, fx.now);
    if (h === watched) return;
    watched = h;
    for (const e of h.events) {
      const msg = e.msg;
      Object.defineProperty(e, "msg", { get() {
        if (counting && watched === h && !inFrame.has(e.a)) {
          inFrame.add(e.a);
          worked.add(e.a);
          if (inFrame.size > cutAt) for (;;) {}
        }
        return msg;
      } });
    }
  };
  const settle = async () => {
    for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 0));
    watch();
  };
  const drawnAs = (f) => {
    globalThis.__fx.ids = [];
    globalThis.__fx.elements = 0;
    const out = f();
    const sig = out ? `${globalThis.__fx.elements}|${globalThis.__fx.ids.join(",")}` : null;
    globalThis.__fx.ids = null;
    return sig;
  };
  // One frame, cut off past `budget` lanes: its drawing, or null when cut.
  const frameIn = (ui, budget = 20) => drawnAs(() => {
    inFrame = new Set();
    cutAt = budget;
    counting = true;
    try {
      return vm.runInNewContext("f()", { f: () => T.render(THEME, theModel(), ui) }, { timeout: 300 });
    } catch (e) {
      assert.equal(e.code, "ERR_SCRIPT_EXECUTION_TIMEOUT", String(e));
      return null;
    } finally {
      counting = false;
    }
  });
  // An uncut render of a fresh view showing what `ui` shows.
  const reference = (ui) => drawnAs(() => T.render(THEME, theModel(), { ...ui, state: { span: ui.state.span, tasks: ui.state.tasks, open: ui.state.open, quiet: ui.state.quiet } }));
  let writes = 0;
  // A recorder write: the gaps unchanged, a new stamp; with `add`, a new event on the newest lane;
  // with `pretty`, the same record in new text.
  const write = ({ add = true, pretty = false } = {}) => {
    const ev = JSON.parse(globalThis.__fx.files[evPath]);
    if (add) ev.events.push({ a: ev.events.at(-1).a, s: "idle", turn: 9000 + writes, at: fx.now - 1000, msg: null });
    globalThis.__fx.files[evPath] = pretty ? JSON.stringify(ev, null, 1) : JSON.stringify(ev);
    globalThis.__fx.shared["agent-tower.recorded"] = `guard write ${++writes}`;
  };
  // Loaded first (the record before this one has the cut-off spies of the block above).
  T.history(fx.towerDir, null, fx.now);
  await settle();
  for (let i = 0; i < 3; i++) {
    T.render(THEME, theModel(), uiOf(0));
    await settle();
  }
  assert.equal(T.parseIndex(globalThis.__fx.files[`${fx.towerDir}/timeline/index.json`]).gaps.length, 1, "an index with a gap");
  const numbers = [];

  // G1: a reload with nothing changed keeps every lane; with one lane changed it redoes that one.
  for (const span of [0, 4]) {
    const ui = uiOf(span);
    frameIn(ui, Infinity);
    await settle();
    assert.ok(frameIn(ui, Infinity), "drawn");
    for (const how of [{ add: false }, { add: false, pretty: true }, { add: true }]) {
      write(how);
      await settle();
      worked.clear();
      frameIn(ui, Infinity);
      await settle();
      frameIn(ui, Infinity);
      const want = how.add ? [watched.events.at(-1).a] : [];
      assert.deepEqual([...worked], want, `span ${span}, ${JSON.stringify(how)}: lanes worked out again`);
    }
  }

  // G2: a recorder write every 5 frames while the view draws over cut-off frames (1h and Week). The
  // bar is kit main c1fa53a's count (the harness counts lanes, not time: the same on every run).
  // G4, the now-line a pixel on, is in perf.test.mjs (PIXEL_BAR).
  for (const [span, bar] of [[0, 57], [4, 52]]) {
    const ui = uiOf(span);
    let ref = reference(ui);
    let drawn = 0;
    for (let k = 0; k < 60; k++) {
      if (k > 0 && k % 5 === 0) {
        write();
        await settle();
        ref = reference(ui);
      }
      if (frameIn(ui) === ref) drawn++;
      await settle();
    }
    numbers.push(`G2 span ${span}: drawn in ${drawn} of 60 frames`);
    assert.ok(drawn >= bar, `span ${span}: drawn in ${drawn} of 60 frames (today ${bar})`);
  }

  // G3: the first finished render of a fresh view draws every lane: the window tall enough for all,
  // every task, fold and quiet group open; drawn over cut-off frames, it equals one uncut render.
  for (const span of [0, 2, 4]) {
    const ui = uiOf(span, 100000);
    const ref0 = reference(ui);
    // Every task, fold and quiet group open.
    const probe = { ...ui, state: { span } };
    T.render(THEME, theModel(), probe);
    ui.state = { span, tasks: {}, open: {}, quiet: {} };
    for (const g of probe.state.cache.groups) {
      ui.state.quiet[g.area] = true;
      for (const task of g.tasks) ui.state.tasks[task.key] = ui.state.open[task.key] = true;
    }
    const ref = reference(ui);
    assert.ok(ref.length > ref0.length, `span ${span}: all open draws more`);
    let first = null;
    let cuts = 0;
    for (let k = 0; k < 60 && !first; k++) {
      first = frameIn(ui);
      if (!first) cuts++;
      await settle();
    }
    numbers.push(`G3 span ${span}: first finished after ${cuts} cut frames, ${ref.split("|")[0]} elements`);
    assert.ok(cuts >= 2, `span ${span}: bigger than a frame (${cuts} cut)`);
    assert.equal(first, ref, `span ${span}: the first finished render draws all that an uncut one does`);
  }

  // Case 2: a machine not answering for 3 minutes (an open gap) while now moves 250 ms a frame, at
  // Week and 1h: a fresh view draws over cut-off frames as soon as without it, and its lanes on that
  // machine show nothing after the gap began.
  const cutDraw = async (span) => {
    const ui = uiOf(span);
    let cuts = 0;
    for (; cuts < 40 && !frameIn(ui); cuts++) {
      ui.now += 250;
      await settle();
    }
    return { cuts, ui };
  };
  const without = [await cutDraw(4), await cutDraw(0)];
  const ev = JSON.parse(globalThis.__fx.files[evPath]);
  const opened = fx.now - 3 * MIN;
  ev.gaps.push({ m: "work-vps", from: opened, to: null });
  globalThis.__fx.files[evPath] = JSON.stringify(ev);
  globalThis.__fx.shared["agent-tower.recorded"] = "open gap";
  await settle();
  await settle();
  assert.ok(watched.gaps.some((g) => g.to == null), "the open gap is loaded");
  for (const [i, span] of [[0, 4], [1, 0]]) {
    const { cuts, ui } = await cutDraw(span);
    numbers.push(`Case 2 span ${span}: drawn after ${cuts} cut frames with an open gap, ${without[i].cuts} without`);
    assert.ok(cuts < 40 && cuts <= without[i].cuts + 1, `span ${span}: drawn after ${cuts} cut frames with an open gap (${without[i].cuts} without)`);
    const vps = ui.state.cache.shown.filter((l) => l.machine === "work-vps");
    assert.ok(vps.some((l) => l.live), "live lanes on that machine");
    for (const l of vps) assert.ok(l.stretches.every((st) => st.to <= opened), `${l.a}: nothing after the gap began`);
  }

  // Case 1: two views at different spans (1h and Week; every copy shares the module) rendering in
  // turn keep their lanes as one view alone does: a reload redoes none, a new event its lane, a new
  // open gap only its machine's lanes.
  {
    const views = [uiOf(0), uiOf(4)];
    const turn = () => views.map((ui) => {
      worked.clear();
      assert.ok(frameIn(ui, Infinity), "drawn");
      return [...worked];
    });
    // The new record is read on the first settle and lands on the second.
    const reload = async (how) => {
      const was = watched;
      write(how);
      await settle();
      await settle();
      assert.notEqual(watched, was, "read again");
    };
    turn();
    await settle();
    turn();
    await reload({ add: false });
    assert.deepEqual(turn(), [[], []], "two views, a reload with nothing changed");
    await reload({ add: true });
    const changed = watched.events.at(-1).a;
    assert.deepEqual(turn(), [[changed], [changed]], "two views, one new event");
    const ev = JSON.parse(globalThis.__fx.files[evPath]);
    ev.gaps.push({ m: "lab-box", from: fx.now - 2 * MIN, to: null });
    globalThis.__fx.files[evPath] = JSON.stringify(ev);
    globalThis.__fx.shared["agent-tower.recorded"] = "lab-box silent";
    await settle();
    await settle();
    const redone = turn();
    numbers.push(`Case 1: a new open gap redid ${redone.map((r) => r.length).join(" / ")} lanes (1h / Week), all on its machine`);
    for (const r of redone) assert.ok(r.length > 0 && r.every((a) => a.startsWith("lab-box/")), `only lab-box lanes: ${r.filter((a) => !a.startsWith("lab-box/")).slice(0, 3)}`);
    assert.deepEqual(turn(), [[], []], "and kept after");

    // Round 1: a render cut off inside the gap lists' slow path (the first frame after a reload)
    // keeps the kept lists, so the next frame works out no lane. The cut: an old Herdr gap whose
    // start, written out for the lists' value key, spins while armed.
    const ui = views[0];
    await reload({ add: false });
    const trapped = watched.gaps.find((g) => g.m === "herdr" && g.to != null);
    const at = trapped.from;
    let armed = true;
    trapped.from = { valueOf: () => at, toString() { if (armed) for (;;) {} return String(at); } };
    assert.equal(frameIn(ui, Infinity), null, "cut off in the slow path");
    armed = false;
    worked.clear();
    assert.ok(frameIn(ui, Infinity), "drawn");
    assert.deepEqual([...worked], [], "a render cut in the slow path loses no kept list");
    trapped.from = at;
  }
  console.log(numbers.join("\n"));
}

console.log("gaps ok");
