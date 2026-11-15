// Perf of the whole mod on a fixture (big-fixture.mjs), as Herdr runs it: one copy per case, init,
// its promise jobs settled, three warm renders, then `runs` timed renders (one render = one call of the
// copy's render(cx), Herdr's 50 ms budget). Then an idle minute on a fake clock: timers fire, jobs
// settle, and every notify or setShared draws again, as in Herdr; what ran is counted. A case with
// busy: its working agents start a turn every second of that minute. active: false, Herdr in the background.
// seconds: a longer or shorter idle stretch; activeAt: the second Herdr comes to the front;
// events: {second: (fx) => change fx.fixture} for something that happens then; after(inst, fx): what the case wants to check at the end (row.after).
// Needs mod-stubs.mjs mapped as gpui-kit, gpui-base and herdr. Engine-neutral: node and QuickJS.
//
// benchMods({ kit, fixture, clock, settle, runs, idleSeconds, cases }) → rows:
//   { case, median, max, elements, calls, idle: { renders, renderMs, setShared, commands: {what: n} } }
// kit: the agent-tower item folder (absolute); clock(): real ms; settle(): lets promise jobs run.

export const BUDGET_MS = 50; // herdr-app v0.1.15, gpui-kit shell sandbox.rs:439 (render and layout)

const layoutOf = ({ rail = false, sidebar = true } = {}) => ({
  id: "root", children: [
    { id: "sidebar", hidden: !sidebar, size: { px: rail ? 60 : 300 }, children: [
      { id: "tower-list", content: { mod: "agent-tower" } },
      { id: "tower-detail", content: { mod: "agent-tower-panel" } },
    ] },
    { id: "work", children: [
      { id: "tower-viewbar", content: { mod: "agent-tower", props: { viewBar: true } } },
      { id: "work-view", children: [{ id: "main" }, { id: "tower-stage", content: { mod: "agent-tower", props: { stage: true } } }] },
    ] },
  ],
});

// The stage learns its size from on_size_change, which the stubs never fire: a 1100 × 720 centre.
const stage = (view, span) => ({ mod: "agent-tower", props: { stage: true }, view, setup: (inst) => {
  inst.size = { width: 1100, height: 720 };
  if (span != null) inst.viewState = { ...inst.viewState, timeline: { ...(inst.viewState?.timeline ?? {}), span } };
} });

export const MOD_CASES = [
  { case: "list docked", mod: "agent-tower", props: {} },
  { case: "list rail", mod: "agent-tower", props: {}, layout: { rail: true } },
  { case: "list search 'ledger'", mod: "agent-tower", props: {}, setup: (inst, cx) => {
    inst.openSearch(cx);
    inst.searchInput.set_value("ledger");
  } },
  { case: "list composer open", mod: "agent-tower", props: {}, setup: (inst) => {
    inst.composing = true;
  } },
  { case: "Board", ...stage("board") },
  { case: "Timeline Day", ...stage("timeline", 3) },
  { case: "Timeline Week", ...stage("timeline", 4) },
  { case: "Timeline Month", ...stage("timeline", 5) },
  { case: "Radar", ...stage("radar") },
  { case: "Details card", mod: "agent-tower-panel", props: {} },
  // The same minute while the task works: each second its working agents start a turn (Herdr draws
  // the panel again on each change).
  { case: "Details card, busy", mod: "agent-tower-panel", props: {}, busy: true },
];

// The biggest task, selected the way the list writes agent-tower.selected.
async function selectionOf(kit, fixture) {
  const model = await import(`${kit}/mods/agent-tower/model.js`);
  const m = model.taskModel({ terms: fixture.terms, listed: new Map(fixture.agents.map((a) => [a.address, a.status])), spaces: fixture.spaces,
    config: fixture.config, changes: new Map(), now: fixture.now });
  const item = [...m.items].sort((x, y) => (y.members?.length ?? 0) - (x.members?.length ?? 0))[0];
  const members = fixture.terms.filter((t) => t.labels?.["task.id"] === item.taskId).map((t) => t.address);
  return { key: item.key, lead: item.lead?.address ?? null, members, title: item.title, ids: [item.taskId].filter(Boolean),
    status: item.lead?.status ?? null, need: item.need ?? null, area: item.area ?? null };
}

export async function benchMods({ kit, fixture, clock, settle, runs = 10, idleSeconds = 60, cases = MOD_CASES }) {
  const realNow = Date.now;
  let fake = fixture.now;
  Date.now = () => fake;
  const settleAll = async () => {
    for (let i = 0; i < 4; i++) await settle();
  };
  const selected = await selectionOf(kit, fixture);
  const rows = [];
  try {
    for (const c of cases) {
      fake = fixture.now;
      const fx = globalThis.__fx = {
        fixture: { ...fixture, terms: JSON.parse(JSON.stringify(fixture.terms)) }, files: { ...fixture.files }, active: c.active ?? true, shared: { "agent-tower.selected": selected, "agent-tower.view": { view: c.view ?? "list", shape: "sidebar" } },
        props: c.props, layout: layoutOf(c.layout), focused: null, log: [], elements: 0, calls: 0, sharedSet: 0,
      };
      const timers = [];
      let notified = 0;
      const cx = {
        notify: () => notified++,
        focus_handle: () => ({ focus() {}, is_focused: () => false }),
        stop_propagation() {},
        spawn(f) {
          Promise.resolve().then(() => f(cx)).catch(() => null);
          return { detach() {}, cancel() {} };
        },
        timer: {
          every: (ms, f) => (timers.push({ ms, f, next: fake + ms, every: true }), { cancel() {} }),
          after: (ms, f) => (timers.push({ ms, f, next: fake + ms }), { cancel() {} }),
        },
      };
      const { default: Mod } = await import(`${kit}/mods/${c.mod}/main.js`);
      const inst = new Mod();
      inst.init(c.props, cx);
      await settleAll();
      c.setup?.(inst, cx);
      const render = () => {
        fx.elements = fx.calls = 0;
        const t0 = clock();
        inst.render(cx);
        return clock() - t0;
      };
      for (let i = 0; i < 3; i++) {
        render();
        await settleAll();
      }
      const times = [];
      let elements = 0, calls = 0;
      for (let i = 0; i < runs; i++) {
        times.push(render());
        elements = fx.elements;
        calls = fx.calls;
        await settleAll();
      }
      times.sort((a, b) => a - b);

      // The idle minute: nothing changes in the fixture; whatever runs, runs on its own.
      fx.log = [];
      notified = 0;
      const sharedBefore = fx.sharedSet;
      let renders = 0, renderMs = 0, seenShared = fx.sharedSet;
      for (let s = 0; s < (c.seconds ?? idleSeconds); s++) {
        fake += 1000;
        if (c.activeAt != null && s + 1 >= c.activeAt) fx.active = true;
        // Something changes in Herdr at this second (an agent ends, a lead stops): Herdr draws again.
        if (c.events?.[s + 1]) {
          c.events[s + 1](fx);
          notified++;
        }
        if (c.busy) {
          for (const t of fx.fixture.terms) if (t.status === "working") Object.assign(t, { turn: t.turn + 1, status_ms: fake });
          notified++;
        }
        for (const tm of timers.filter((x) => x.next <= fake)) {
          try {
            tm.f(cx);
          } catch {}
          if (tm.every) tm.next += tm.ms;
          else timers.splice(timers.indexOf(tm), 1);
        }
        await settleAll();
        // Herdr draws a copy again on its notify, and every mod on any setShared.
        if (notified || fx.sharedSet !== seenShared) {
          notified = 0;
          seenShared = fx.sharedSet;
          renders++;
          renderMs += render();
          await settleAll();
        }
      }
      const commands = {};
      for (const { what } of fx.log) commands[what] = (commands[what] ?? 0) + 1;
      rows.push({ case: c.case, median: +times[times.length >> 1].toFixed(2), max: +times.at(-1).toFixed(2), elements, calls,
        idle: { seconds: c.seconds ?? idleSeconds, renders, renderMs: +renderMs.toFixed(1), setShared: fx.sharedSet - sharedBefore, commands },
        ...(c.after ? { after: c.after(inst, fx) } : {}) });
    }
  } finally {
    Date.now = realNow;
  }
  return rows;
}

export const table = (rows, engine) => [
  `${engine}: one render in ms (Herdr's budget ${BUDGET_MS}; a test should fail over ${BUDGET_MS / 2}), and an idle minute`,
  ...rows.map((r) => `${r.case.padEnd(22)} median ${String(r.median).padStart(7)}  max ${String(r.max).padStart(7)}  elements ${String(r.elements).padStart(5)}  calls ${String(r.calls).padStart(6)}`
    + `  | idle: ${r.idle.renders} renders ${r.idle.renderMs} ms, ${r.idle.setShared} setShared, ${Object.entries(r.idle.commands).map(([k, v]) => `${k} ×${v}`).join(", ") || "nothing"}`),
].join("\n");
