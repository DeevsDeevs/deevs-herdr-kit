// The perf fixture for the whole mod (BUILD2-PERF step 1): one big made-up Tower record, and one the
// size of a real busy one. Plain JavaScript with no node APIs, so QuickJS runs it too. Every name,
// path and text is invented.
//
// buildFixture(preset = "big") → { now, terms, agents, spaces, machines, config, files, towerDir, counts, readOut }
//   big: 150 terminals on three machines, 60 tasks in three areas, a month of history with a full task
//        file per task (index.json, tasks/*.json), a day of rebuilt past for every agent, 900 KiB of screens.
//   mac: 86 recorded lanes, 415 events over two weeks, a 39 KB backfill.json over ~100 terminals,
//        490 KB of screens; no task files (the record before the long past moved).

const MIN = 60e3;
const H = 60 * MIN;
const DAY = 24 * H;
export const HOME = "/home/me";
export const TOWER = `${HOME}/.config/agent-tower`;

export const PRESETS = {
  big: { tasks: 60, terminals: 150, machines: [null, "work-vps", "lab-box"], historyDays: 30, taskFiles: true, eventsDays: 2,
    backfillPerAgent: true, screensBytes: 900 * 1024, agentsPerTask: [40, 22, 15, 12, 10, 8, 6, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2] },
  mac: { tasks: 15, terminals: 100, machines: [null, "work-vps"], historyDays: 14, taskFiles: false, eventsDays: 14, lanes: 86, events: 415,
    allTerminals: true, backfillBytes: 39 * 1024, screensBytes: 490 * 1024, agentsPerTask: [30, 14, 10, 8, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1] },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const utf8 = (s) => {
  let b = 0;
  for (const c of s) {
    const p = c.codePointAt(0);
    b += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4;
  }
  return b;
};

const TOPICS = ["ledger export", "rate limiter", "billing sync", "search index", "bird feeder", "tax forms", "garden plan", "invoice parser",
  "release notes", "backup check", "recipe box", "budget sheet", "docs site", "sensor logger", "router setup", "fund review", "bond ladder",
  "dividend log", "watchlist memo", "sector notes"];
const ROLES = ["build", "review", "tests", "docs", "probe", "fix", "check", "merge", "bench", "walk", "notes", "cold"];
const ASKS = ["Keep the old CSV columns?", "Merge into main now?", "Which branch should I use?", "Run the slow suite too?",
  "Delete the stale fixtures?", "Ship on Friday?", "Use the v2 endpoint?"];
const DONES = ["Export rewritten; notes in the folder.", "Tests pass; result written.", "Reviewed: two small fixes.", "Bench done, numbers in the file."];
const PROGRAMS = {
  claude: { key: "claude", name: "Claude Code", agent: true },
  codex: { key: "codex", name: "Codex", agent: true },
  pi: { key: "pi", name: "pi", agent: true },
  zsh: { key: "shell", name: "zsh", shell: true, agent: false },
};

function screen(r, chars) {
  const rows = ["╭" + "─".repeat(70) + "╮"];
  while (rows.length * 73 < chars - 146) {
    const fill = `│ ● ${ROLES[Math.floor(r() * ROLES.length)]} ${"▏▎▍▌▋▊▉█"[Math.floor(r() * 8)].repeat(Math.floor(r() * 30))}`;
    rows.push(fill.padEnd(71, " ") + "│");
  }
  rows.push("╰" + "─".repeat(70) + "╯");
  return rows.join("\n").slice(-1500);
}

export function buildFixture(preset = "big", { now = Date.UTC(2026, 10, 15, 12), seed = 7 } = {}) {
  const P = typeof preset === "string" ? PRESETS[preset] : preset;
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const areaIds = ["work", "personal", "investing"].slice(0, P.machines.length);
  const config = {
    areas: [
      { id: "work", label: "Work", machines: ["work-vps"] },
      { id: "personal", label: "Personal", default: true },
      { id: "investing", label: "Investing", machines: ["lab-box"] },
    ].slice(0, areaIds.length),
    recipes: areaIds.map((area) => ({ id: `${area}-task`, label: `${area} task`, area, agent: "claude", folder: `~/work/${area}` })),
  };
  const sizes = Array.from({ length: P.tasks }, (_, i) => P.agentsPerTask[i] ?? 1 + (i % 3));

  // Every agent over the history, leads first per task.
  const agents = [];
  const counter = {};
  sizes.forEach((size, ti) => {
    const id = `k${ti + 1}-${TOPICS[ti % TOPICS.length].replace(/ /g, "-")}${ti >= TOPICS.length ? `-${ti}` : ""}`;
    const machine = P.machines[ti % P.machines.length];
    const area = areaIds[ti % areaIds.length];
    const taskStart = now - (1 + r() * (P.historyDays - 1)) * DAY;
    for (let k = 0; k < size; k++) {
      const lead = k === 0;
      const m = machine ?? "";
      counter[m] = (counter[m] ?? 0) + 1;
      const created = lead ? taskStart : taskStart + r() * (now - taskStart - H);
      const life = lead ? now - created : Math.min(now - created, (1 + r() * 29) * H);
      agents.push({
        address: `${machine ? `${machine}/` : ""}t${counter[m]}`, task: id, title: TOPICS[ti % TOPICS.length], ti, lead, machine, area,
        created: Math.round(created), finished: !lead && created + life < now - 10 * MIN ? Math.round(created + life) : null,
        name: lead ? `${id}-lead` : `${id}-${pick(ROLES)}${k}`, program: pick(["claude", "claude", "claude", "codex", "pi"]),
      });
    }
  });

  // hc's terminals: the newest agents (hc forgets an ended one after a day), every lead, then shells.
  const newest = [...agents].sort((x, y) => (y.finished ?? Infinity) - (x.finished ?? Infinity));
  const shown = newest.filter((a) => P.allTerminals || a.lead || !a.finished || a.finished > now - DAY).slice(0, P.terminals);
  const terms = [];
  for (const a of shown) {
    const status = a.finished ? "done" : pick(["working", "working", "idle", "idle", "blocked", "done"]);
    terms.push({
      address: a.address, state: a.finished ? "ended" : "live", program: PROGRAMS[a.program], status, status_ms: now - Math.round(r() * 3 * H),
      turn: 1 + Math.floor(r() * 60), name: a.name, created_ms: a.created, finished_ms: a.finished ?? undefined,
      cwd: `${HOME}/work/${a.task}`, pid: a.finished ? undefined : 40000 + terms.length, argv: [a.program, `You are a worker on task ${a.task}.`],
      parent: a.lead ? undefined : agents.find((x) => x.task === a.task && x.lead).address,
      report: status === "blocked" ? { kind: "question", msg: pick(ASKS) } : status === "done" ? { msg: pick(DONES) } : undefined,
      labels: { ...(a.lead ? { "herdr.space": `${a.machine ? `${a.machine}/` : ""}s${a.ti + 1}`, "task.title": a.title } : {}), "task.id": a.task, "task.role": a.lead ? "lead" : "worker" },
    });
  }
  for (let i = 0; terms.length < P.terminals; i++) terms.push({ address: `t${900 + i}`, state: "live", program: PROGRAMS.zsh, labels: { "herdr.space": `s${(i % P.tasks) + 1}` } });
  const spaces = sizes.map((_, ti) => {
    const m = P.machines[ti % P.machines.length];
    return { id: `${m ? `${m}/` : ""}s${ti + 1}`, name: `space-${ti + 1}`, machine: m, active: ti === 0 };
  });
  const liveAgents = terms.filter((t) => t.program?.agent && t.state === "live").map((t) => ({ address: t.address, status: t.status, pane: null }));
  const machines = P.machines.filter(Boolean).map((name) => ({ name, layout: "connected" }));

  // events.json: the agents of the last eventsDays (or a fixed lane count), a few changes each.
  const cut = now - P.eventsDays * DAY;
  let recorded = agents.filter((a) => (a.finished ?? now) > cut).sort((x, y) => x.created - y.created);
  if (P.lanes) recorded = [...agents].sort((x, y) => x.created - y.created).slice(-P.lanes);
  const lanes = {};
  for (const a of recorded) {
    lanes[a.address] = { task: `task:${a.task}`, taskId: a.task, taskTitle: a.title, area: a.area, role: a.lead ? "lead" : "worker",
      name: a.name, title: a.title, machine: a.machine, parent: null, created: a.created };
  }
  const eventCount = P.events ?? recorded.length * 8;
  const events = [];
  const perLane = Math.floor(eventCount / recorded.length);
  let extra = eventCount - perLane * recorded.length;
  for (const a of recorded) {
    const k = perLane + (extra-- > 0 ? 1 : 0);
    const from = Math.max(a.created, cut);
    const end = a.finished ?? now;
    for (let i = 0; i < k; i++) {
      const at = Math.round(from + ((i + 0.5) / k) * (end - from));
      const s = i === k - 1 && a.finished ? "ended" : i % 4 === 2 ? "blocked" : i % 4 === 3 ? (a.lead ? "done" : "idle") : i % 2 ? "idle" : "working";
      events.push({ a: a.address, s, turn: i + 1, at, msg: s === "blocked" ? pick(ASKS) : s === "done" ? pick(DONES) : null });
    }
  }
  events.sort((x, y) => x.at - y.at);
  const looks = events.filter((_, i) => i % 3 === 0).map((e) => ({ a: e.a, at: e.at + 30e3 }));
  const gaps = [{ m: "herdr", from: now - DAY - 8 * H, to: now - DAY }, ...(P.machines[1] ? [{ m: P.machines[1], from: now - 30 * H, to: now - 29 * H }] : [])];
  const files = {};
  files[`${TOWER}/timeline/events.json`] = JSON.stringify({ v: 1, beat: now - 30e3, moved: P.taskFiles ? cut : undefined, lanes, events, looks, gaps });

  // The long past (timeline-long.md, Format): one full task file per task, thinned before eventsDays.
  if (P.taskFiles) {
    const index = { v: 1, at: now - 5 * MIN, gaps: [{ m: "herdr", from: now - 12 * DAY, to: now - 12 * DAY + 9 * H }], tasks: {} };
    for (const [ti] of sizes.entries()) {
      const mine = agents.filter((a) => a.ti === ti);
      const key = `task:${mine[0].task}`;
      const file = `tasks/${encodeURIComponent(key)}.json`;
      const lanesOut = {};
      for (const a of mine) {
        if (a.created > cut) continue;
        const until = Math.min(a.finished ?? cut, cut);
        const sec = (t) => Math.round((t - a.created) / 1000);
        const w = [], asks = [], done = [];
        for (let t = a.created; t < until; t += (20 + r() * 100) * MIN) {
          const len = (5 + r() * 40) * MIN;
          w.push([sec(t), sec(Math.min(until, t + len))]);
          if (r() < 0.12) asks.push([sec(t + len), sec(Math.min(until, t + len + r() * 30 * MIN)), pick(ASKS).slice(0, 120)]);
          if (a.lead && r() < 0.05) done.push([sec(t + len), pick(DONES).slice(0, 120)]);
        }
        lanesOut[`${a.address}@${a.created}`] = { a: a.address, role: a.lead ? "lead" : "worker", name: a.name, title: a.title, machine: a.machine,
          parent: null, created: a.created, ended: a.finished && a.finished <= cut ? a.finished : null, thinTo: cut, w, asks, done, events: [] };
      }
      const data = { v: 1, task: key, taskId: mine[0].task, title: mine[0].title, area: mine[0].area, from: mine[0].created, until: cut, ended: null, lanes: lanesOut, looks: [] };
      const text = JSON.stringify(data);
      files[`${TOWER}/timeline/${file}`] = text;
      // thinned: when the writer last thinned this file (model.js writes it; not yet in the Format section).
      index.tasks[key] = { file, taskId: mine[0].task, title: mine[0].title, area: mine[0].area, from: mine[0].created, until: cut, ended: null, thinned: now - 5 * MIN,
        agents: mine.length, endedLanes: Object.entries(lanesOut).filter(([, l]) => l.ended != null).map(([k]) => k), bytes: utf8(text) };
    }
    files[`${TOWER}/timeline/index.json`] = JSON.stringify(index);
  }

  // backfill.json (toLocal's shape): a day of turns for every agent terminal, or up to backfillBytes.
  const fill = {};
  const termAgents = terms.filter((t) => t.program?.agent);
  const addTurn = (t) => {
    const key = `${t.address}@${t.created_ms}`;
    const e = (fill[key] ??= { at: now - 5 * MIN, covers: Math.max(t.created_ms, now - DAY), path: `${HOME}/.claude/projects/-home-me-work/${key.replace(/\W/g, "")}.jsonl`,
      mtime: now / 1000, size: 200000, turns: [] });
    const s0 = (e.turns.at(-1)?.end ?? Math.max(t.created_ms, now - DAY)) + r() * 40 * MIN;
    if (s0 > (t.finished_ms ?? now)) return false;
    const ask = r() < 0.15;
    e.turns.push({ start: Math.round(s0), end: Math.round(Math.min(t.finished_ms ?? now, s0 + r() * 30 * MIN)), ended: ask ? "ask-tool" : r() < 0.2 ? "question" : "answer",
      asks: ask ? [[Math.round(s0 + MIN), null]] : [] });
    return true;
  };
  if (P.backfillPerAgent) for (const t of termAgents) while (addTurn(t));
  else for (let i = 0; JSON.stringify(fill).length < P.backfillBytes; i++) addTurn(termAgents[i % termAgents.length]);
  files[`${TOWER}/timeline/backfill.json`] = JSON.stringify(fill);

  const screens = {};
  let bytes = 2;
  for (let j = 0; bytes < P.screensBytes; j++) {
    const e = events[j % events.length];
    const text = screen(r, 900 + r() * 600);
    const key = `${e.a}@${e.at + Math.floor(j / events.length)}`;
    screens[key] = text;
    bytes += utf8(JSON.stringify(text)) + key.length + 4;
  }
  files[`${TOWER}/timeline/screens.json`] = JSON.stringify(screens);
  files[`${TOWER}/config.json`] = JSON.stringify(config);

  // What read.py would answer for a task's machine: the panel's Details card draws from it.
  const readOut = (task) => JSON.stringify({
    lead: { found: true, written_s: 120, open_tool: false, last: { text: `Planned the ${task} work.\n\nShip on Friday?`, cut: false, ago_s: 300 },
      turn_ago_s: 400, prompt: { text: "go on", ago_s: 400 }, compact_ago_s: null, reports: [{ from: "t2 build", text: "Built it. Result in the folder.", ago_s: 900 }] },
    workers: {}, repos: [{ root: `${HOME}/work/${task}`, name: task, branch: "feature/x", upstream: null, remote: false, changed: 3, ahead: 0, default: false, files: ["a.txt"], pr: null }],
    chain: null,
  });

  const out = { now, terms, agents: liveAgents, spaces, machines, config, files, towerDir: TOWER, readOut };
  out.counts = {
    terminals: terms.length, agentTerminals: termAgents.length, tasks: sizes.length, lanes: Object.keys(lanes).length, events: events.length,
    taskFiles: Object.keys(files).filter((f) => f.includes("/tasks/")).length,
    taskFileBytes: Object.entries(files).filter(([f]) => f.includes("/tasks/")).reduce((n, [, t]) => n + utf8(t), 0),
    backfillEntries: Object.keys(fill).length, backfillBytes: utf8(files[`${TOWER}/timeline/backfill.json`]),
    screens: Object.keys(screens).length, screensBytes: utf8(files[`${TOWER}/timeline/screens.json`]), eventsBytes: utf8(files[`${TOWER}/timeline/events.json`]),
  };
  return out;
}
