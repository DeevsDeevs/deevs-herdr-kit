// The timing harness (from t47's render-budget harness; perf.test.mjs runs it): renders each view on a fixture the way the stage does
// (taskModel, then the view's render), a few warm-up renders first (they start the file reads,
// which settle as promise jobs, as in Herdr), then `runs` timed ones. Engine-neutral: node and QuickJS.
//
// bench({ kit, fixture, clock, settle, runs, cases }) → [{ case, median, max, elements, calls }]
// kit: the agent-tower mod folder (absolute); clock(): ms; settle(): a promise that lets jobs run.

export const BUDGET_MS = 50; // herdr-app v0.1.15, gpui-kit shell sandbox.rs:439 (render and layout)

export const CASES = [
  { case: "model", view: null },
  { case: "timeline Day", view: "timeline", span: 3 },
  { case: "timeline Week", view: "timeline", span: 4 },
  { case: "timeline Month", view: "timeline", span: 5 },
  { case: "timeline Day, all open", view: "timeline", span: 3, open: true },
  { case: "board", view: "board" },
  { case: "radar", view: "radar" },
  { case: "watchlist", view: "watchlist" },
];

// Watchlist's files: tickers named in the fixture's titles, and a long notes file (only its newest
// lines are drawn).
function watchlistFiles(towerDir) {
  const tickers = ["LEDGER", "BILLING", "SEARCH", "TAX", "BUDGET", "DOCS", "ROUTER", "PHOTO", "GARDEN", "SENSOR", "KYOTO", "INVOICE"]
    .map((symbol) => ({ symbol, name: `${symbol[0]}${symbol.slice(1).toLowerCase()} Holding`, note: "Hold until the next report." }));
  const notes = Array.from({ length: 4000 }, (_, i) => `- ${i}: made-up memo line about a made-up ticker.`).join("\n");
  return { [`${towerDir}/watchlist.json`]: JSON.stringify({ tickers }), [`${towerDir}/investing-notes.md`]: notes };
}

const THEME = new Proxy({}, { get: (_, k) => (typeof k === "string" ? "#808080" : undefined) });

export async function bench({ kit, fixture, clock, settle, runs = 20, cases = CASES }) {
  globalThis.__fx = { files: { ...fixture.files, ...watchlistFiles(fixture.towerDir) }, shared: {}, elements: 0, calls: 0, log: [] };
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  const model = await import(`${kit}/model.js`);
  const listed = fixture.listed ?? new Map((fixture.agents ?? []).map((a) => [a.address, a.status]));
  const modelOf = () => model.taskModel({ terms: fixture.terms, listed, spaces: fixture.spaces, config: fixture.config,
    changes: fixture.changes ?? new Map(), seen: fixture.seen ?? {}, now: fixture.now, titles: {}, eye: null });
  const out = [];
  for (const c of cases) {
    const mod = c.view ? await import(`${kit}/${c.view}.js`) : null;
    const state = { span: c.span };
    const ui = { now: fixture.now, width: 1100, height: 720, area: null, selectedKey: null, state, towerDir: fixture.towerDir, here: "mac",
      shape: "sidebar", hideText: false, rowMark: "state", notify() {}, select() {}, pick() {}, open() {}, goInto() {}, onMenu: (el) => el };
    const once = () => {
      const m = modelOf();
      if (c.open) state.tasks = Object.fromEntries(m.items.map((i) => [i.key, true]));
      return mod ? mod.render(THEME, m, ui) : m;
    };
    for (let i = 0; i < 3; i++) {
      once();
      await settle();
    }
    const times = [];
    let elements = 0, calls = 0;
    for (let i = 0; i < runs; i++) {
      const fx = globalThis.__fx;
      fx.elements = fx.calls = 0;
      const t0 = clock();
      once();
      times.push(clock() - t0);
      elements = fx.elements;
      calls = fx.calls;
    }
    times.sort((a, b) => a - b);
    out.push({ case: c.case, median: +times[times.length >> 1].toFixed(2), max: +times.at(-1).toFixed(2), elements, calls });
  }
  return out;
}

export const table = (rows, engine) => [`${engine}: ms per render (budget ${BUDGET_MS} ms; a test should fail over ${BUDGET_MS / 2})`,
  ...rows.map((r) => `${r.case.padEnd(24)} median ${String(r.median).padStart(7)}  max ${String(r.max).padStart(7)}  elements ${String(r.elements).padStart(6)}  calls ${String(r.calls).padStart(7)}`)].join("\n");
