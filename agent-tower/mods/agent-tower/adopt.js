// Adopt: Herdr spaces made before Tower become tasks, by labels only (adopt.md). One space is one
// task, named after the space, in the area its machine gives. Its lead is its first agent in Herdr's
// order (first tab, first pane): the one the space opened on, so a click on the task lands there. Its
// other agents are workers; what they started follows their task.id with no label of its own; a
// plain shell is in the task as task.role=shell; a space with only a shell is a task led by it.
// Finished terminals are left as they are. A space that already hosts a task is left alone, and an
// older agent beside that task becomes a task of its own (Close on one never ends the other).
// Nothing is started, stopped or messaged. Pure: tower-adopt asks the docked list, which calls
// runAdopt with terminals(), spaces(), agents(), the settings and an hc label function.

import { spaceOf, areaOf, ownTitle, isEye, newId, capTitle, duration } from "./model.js";

const live = (t) => t.state === "live";
const isAgent = (t) => live(t) && (t.status != null || Boolean(t.program?.agent));
const taskIdOf = (t) => t.labels?.["task.id"] || null;

// The space a terminal lives in: its own herdr.space, else its starter's (hc run has none).
function homeOf(t, byAddress, spaces) {
  const seen = new Set();
  for (let at = t; at && !seen.has(at.address); at = byAddress.get(at.parent)) {
    seen.add(at.address);
    const s = spaceOf(at, spaces);
    if (s) return s;
  }
  return null;
}

// When a terminal last changed: the list's own record (changes: address -> {at}), else hc's.
const changedAt = (t, changes) => changes?.get?.(t.address)?.at ?? changes?.[t.address]?.at ?? t.status_ms ?? t.finished_ms ?? t.created_ms ?? null;

// One entry per space, in Herdr's order: {space, spaceId, machine, area, finished, quietMs, working}
// and either {id, title, lead, workers, shells, follow} or {skip, apart: [{lead, title, id}]}.
// areas: {space id: area id} chosen over the machine's area.
// Names Herdr gives a space after the home folder or its user, and folders anyone has: they say
// nothing about the work, so the lead's own title is used instead. home: this computer's home folder.
const GENERIC = new Set(["~", "", "home", "downloads", "desktop", "documents", "tmp", "root"]);
export const genericName = (name, home = null) => GENERIC.has((name ?? "").trim().toLowerCase())
  || (home != null && (name ?? "").trim() === home.split("/").filter(Boolean).pop());

// No two tasks share a title: a taken one gets its machine (another machine's), else a number. Titles from a space's own
// name are placed first, so a real space keeps its name and a fallback gives way.
function uniqueTitles(plan, taken) {
  const used = new Set(taken.map((x) => x.toLowerCase()));
  const all = plan.flatMap((e) => [...(e.lead ? [e] : []), ...(e.apart ?? []).map((x) => Object.assign(x, { machine: e.machine }))]);
  for (const x of [...all.filter((x) => x.fromSpace), ...all.filter((x) => !x.fromSpace)]) {
    let title = x.title;
    if (used.has(title.toLowerCase()) && x.machine) title = capTitle(`${x.title} · ${x.machine}`);
    for (let n = 2; used.has(title.toLowerCase()); n++) title = capTitle(`${x.title} ${n}`);
    used.add(title.toLowerCase());
    x.title = title;
  }
  return plan;
}

// areas, titles, leads: {space id: area id, title or lead address} chosen by hand (tower-adopt --space).
// only: one space's id (its title then clashes only with tasks that exist, not with other plans).
export function adoptPlan({ terms, spaces, agents = [], config, now = Date.now(), changes = null, areas = {}, titles = {}, leads = {}, home = null, only = null }, makeId = newId) {
  const byAddress = new Map(terms.map((t) => [t.address, t]));
  const order = new Map(agents.map((a, i) => [a.address, i]));
  // The titles tasks already have, live ones: a new task never takes one.
  const taken = terms.filter((t) => live(t) && taskIdOf(t) && t.labels["task.role"] === "lead" && t.labels["task.title"]).map((t) => t.labels["task.title"]);
  return uniqueTitles(spaces.filter((s) => !only || s.id === only).map((s) => {
    const all = terms.filter((t) => homeOf(t, byAddress, spaces)?.id === s.id);
    const mine = all.filter((t) => !isEye(t));
    // Opened in the space itself (a tab or a pane), not started by another terminal.
    const top = mine.filter((t) => spaceOf(t, spaces)?.id === s.id);
    const last = Math.max(...all.map((t) => changedAt(t, changes) ?? -Infinity));
    const base = { space: s.name, spaceId: s.id, machine: s.machine ?? null, area: areaOf(config, s.machine ?? null, areas[s.id] ?? null),
      finished: mine.filter((t) => !live(t)).length, quietMs: Number.isFinite(last) ? Math.max(0, now - last) : null,
      working: mine.some((t) => live(t) && t.status === "working") };
    if (!mine.some(live) && all.some((t) => live(t) && isEye(t))) return { ...base, skip: "the Eye's", apart: [] };
    const hosted = [...new Set(mine.filter(live).map(taskIdOf).filter(Boolean))];
    if (hosted.length) {
      // Beside a task, an older agent takes that task's area (its lead's task.area), unless one was given.
      const hostArea = mine.find((t) => taskIdOf(t) === hosted[0] && t.labels["task.role"] === "lead")?.labels["task.area"];
      const area = areas[s.id] ? base.area : areaOf(config, s.machine ?? null, hostArea ?? null);
      const apart = top.filter((t) => isAgent(t) && !taskIdOf(t))
        .map((t) => ({ lead: t.address, title: capTitle(genericName(s.name, home) ? ownTitle(t) ?? s.name : s.name), id: makeId(), area }));
      return { ...base, skip: `hosts task ${hosted.join(", ")}`, apart };
    }
    const agentsTop = top.filter(isAgent).sort((a, b) => (order.get(a.address) ?? Infinity) - (order.get(b.address) ?? Infinity));
    const shells = top.filter((t) => live(t) && !isAgent(t));
    const lead = (leads[s.id] && mine.find((t) => t.address === leads[s.id] && live(t))) || (agentsTop[0] ?? shells[0] ?? null);
    if (!lead) return { ...base, skip: "nothing live", apart: [] };
    // An unnamed space is called after its folder ("~"): the lead's own title says more.
    // The space's name, named or not (Herdr names it after its folder): the lead's own title is often
    // an old conversation's. Only a home-folder name gives way to the lead's own title.
    const fromSpace = Boolean(titles[s.id]) || !genericName(s.name, home);
    const title = titles[s.id] ?? (fromSpace ? s.name : ownTitle(lead) ?? s.name);
    return {
      ...base, id: makeId(), title: capTitle(title), fromSpace, lead: lead.address,
      workers: agentsTop.filter((t) => t !== lead).map((t) => t.address),
      shells: shells.filter((t) => t !== lead).map((t) => t.address),
      follow: mine.filter((t) => live(t) && !top.includes(t) && t !== lead).length,
    };
  }), taken);
}

// The hc label calls an entry makes: [address, ...pairs].
export const labelsOf = (e) => [
  ...(e.lead ? [
    [e.lead, `task.id=${e.id}`, "task.role=lead", `task.title=${e.title}`, `task.area=${e.area}`, "task.by=adopt"],
    ...e.workers.map((a) => [a, `task.id=${e.id}`, "task.role=worker"]),
    ...e.shells.map((a) => [a, `task.id=${e.id}`, "task.role=shell"]),
  ] : []),
  ...(e.apart ?? []).map((x) => [x.lead, `task.id=${x.id}`, "task.role=lead", `task.title=${x.title}`, `task.area=${x.area}`, "task.by=adopt"]),
];

// One line per space: what it becomes, or why it is left; with its machine and how long it has been
// quiet, so a wrong area or a dead space shows at a glance.
export function lineOf(e) {
  const quiet = e.working ? "working now" : e.quietMs != null ? `quiet ${duration(e.quietMs)}` : "never ran";
  const where = `${e.space} [${e.spaceId}] (${e.machine ?? "this computer"}, ${quiet})`;
  if (e.skip) return `${where}: left alone, ${e.skip}${e.apart.map((x) => `; ${x.lead} becomes its own task "${x.title}" in ${x.area}`).join("")}`;
  const parts = [`lead ${e.lead}`, e.workers.length ? `workers ${e.workers.join(" ")}` : null, e.shells.length ? `shell ${e.shells.join(" ")}` : null,
    e.follow ? `+${e.follow} started by them` : null, e.finished ? `${e.finished} finished, untouched` : null].filter(Boolean);
  return `${where} → "${e.title}" in ${e.area}: ${parts.join(", ")}`;
}

// A request from tower-adopt: {space?: id or name, area?, title?, lead? (with space), apply?}. env: {terms,
// spaces, agents, config, now, changes?, label(address, pairs) → Promise<{code, stderr}>}. Answers {ok, text, why?}; a dry run
// (no apply) calls label never.
export async function runAdopt(request, env) {
  const text = (k) => (typeof request?.[k] === "string" && request[k].trim() ? request[k].trim() : null);
  const want = text("space");
  const area = text("area"), title = text("title"), lead = text("lead");
  // --area, --title and --lead are choices for one space: they need --space.
  if ((area || title || lead) && !want) return { ok: false, why: "--area, --title and --lead need --space: they set one space's task" };
  // --space: an id, else a name; a name several spaces share (on different machines) asks for the id.
  let chosen = null;
  if (want) {
    const byId = env.spaces.filter((s) => s.id.toLowerCase() === want.toLowerCase());
    const byName = env.spaces.filter((s) => s.name.toLowerCase() === want.toLowerCase());
    if (!byId.length && byName.length > 1) return { ok: false, why: `"${want}" names ${byName.length} spaces: give its id (${byName.map((s) => `${s.id} on ${s.machine ?? "this computer"}`).join(", ")})` };
    chosen = byId[0] ?? byName[0] ?? null;
    if (!chosen) return { ok: false, why: `no space named "${want}"` };
  }
  if (area && !env.config.areas.some((a) => a.id === area)) return { ok: false, why: `no area "${area}"; the areas are ${env.config.areas.map((a) => a.id).join(", ")}` };
  if (lead) {
    const byAddress = new Map(env.terms.map((t) => [t.address, t]));
    const t = byAddress.get(lead);
    if (!t) return { ok: false, why: `no terminal ${lead}` };
    if (homeOf(t, byAddress, env.spaces)?.id !== chosen.id) return { ok: false, why: `${lead} is not in ${chosen.name} [${chosen.id}]` };
    if (!live(t) || isEye(t)) return { ok: false, why: `${lead} can't lead: it ${isEye(t) ? "is an Eye" : "has finished"}` };
  }
  const one = (v) => (v && chosen ? { [chosen.id]: v } : {});
  const plan = adoptPlan({ ...env, areas: one(area), titles: one(title && capTitle(title)), leads: one(lead), only: chosen?.id ?? null });
  if ((title || lead) && plan[0]?.skip) return { ok: false, why: `${chosen.name} [${chosen.id}] is left alone: it ${plan[0].skip}` };
  if (title && plan[0]?.title !== capTitle(title)) return { ok: false, why: `"${title}" is already another task's title` };
  const lines = plan.map(lineOf);
  const tasks = plan.reduce((n, e) => n + (e.lead ? 1 : 0) + (e.apart?.length ?? 0), 0);
  if (!request?.apply) return { ok: true, applied: false, text: [...lines, `Dry run: nothing changed. tower-adopt --apply makes ${tasks} tasks.`].join("\n") };
  const failed = [];
  // Each space's calls together; one space at a time, so a slow machine slows only its own.
  for (const e of plan) {
    const results = await Promise.all(labelsOf(e).map(([address, ...pairs]) => Promise.resolve(env.label(address, pairs)).catch((err) => ({ code: 1, stderr: String(err) }))
      .then((r) => (r?.code === 0 ? null : `${address}: ${(r?.stderr ?? "").trim().split("\n").pop() || "label failed"}`))));
    failed.push(...results.filter(Boolean));
  }
  return {
    ok: failed.length === 0, applied: true,
    text: [...lines, failed.length ? `Not labelled (run it again for these): ${failed.join("; ")}` : `Done: ${tasks} tasks made.`].join("\n"),
    ...(failed.length ? { why: `${failed.length} label calls failed` } : {}),
  };
}

// ── From now on (adopt.md, c): a space made with the list's "New space" is a task from birth, and an
// agent opened later in one of its tabs joins it. The list calls these; each returns label calls. ──

// Before space.new: what to compare the spaces with afterwards.
export const beforeNew = (spaces, machine = null) => ({ machine, known: spaces.map((s) => s.id), at: Date.now() });

// After it: the new space on that machine and its first live terminal, once there is one; else null.
export function bornSpace(before, spaces, terms) {
  const known = new Set(before.known);
  const s = spaces.find((x) => !known.has(x.id) && (x.machine ?? null) === before.machine);
  const first = s && terms.find((t) => live(t) && spaceOf(t, spaces)?.id === s.id);
  return first ? { space: s, address: first.address } : null;
}

// The labels that make a new space's first terminal lead its task, in the area shown.
export const birthLabels = (space, area, id = newId()) => [`task.id=${id}`, "task.role=lead", `task.title=${capTitle(space.name)}`, `task.area=${area}`, "task.by=space"];

// Agents opened in a space whose one task came from "New space" or adopt, not yet in a task: each
// joins it as a worker. [[address, ...pairs]]. A space with two tasks, or a task started by
// tower-new, is never joined: Close on that task would end what it never started.
export function joinLabels({ terms, spaces }) {
  const byAddress = new Map(terms.map((t) => [t.address, t]));
  // space id -> {task id -> its lead's task.by}
  const tasks = new Map();
  for (const t of terms) {
    const id = taskIdOf(t);
    const s = id && live(t) && homeOf(t, byAddress, spaces);
    if (!s) continue;
    if (!tasks.has(s.id)) tasks.set(s.id, new Map());
    const held = tasks.get(s.id);
    if (t.labels["task.role"] === "lead") held.set(id, t.labels["task.by"] ?? null);
    else if (!held.has(id)) held.set(id, null);
  }
  const out = [];
  for (const t of terms) {
    const s = spaceOf(t, spaces);
    const held = s && tasks.get(s.id);
    if (!held || held.size !== 1 || !isAgent(t) || taskIdOf(t) || isEye(t)) continue;
    const [[id, by]] = held;
    if (by === "space" || by === "adopt") out.push([t.address, `task.id=${id}`, "task.role=worker"]);
  }
  return out;
}

// The space a row that is not a task yet stands for (the row menu's "Make a task"): a shell space
// row is one; an agent or left-over row is its lead's space.
export const rowSpace = (row, spaces) => (row?.key ? row.space ?? spaceOf(row.lead, spaces) ?? null : row ?? null);
