// The selected work item in detail: plain functions over terminals(), agents(), spaces(), the
// settings and what read.py brought back, kept apart from drawing. Nothing here calls Herdr or hc.

// Ended terminals stay listed this long; hc forgets one after 24 hours anyway.
export const ENDED_MS = 24 * 3600 * 1000;
export const QUIET_MS = 10 * 60 * 1000;
// Summaries never wrap: whole segments drop from the tail past this many characters.
export const BUDGET = 48;
// A message longer than this (three lines' worth), or with more than two line breaks, is cut while rows follow it.
export const CUT_CHARS = 135;

// The sidebar's settings defaults, only what the panel shows: areas and recipes.
export const DEFAULTS = {
  areas: [
    { id: "work", label: "Work" },
    { id: "personal", label: "Personal", default: true },
  ],
  recipes: [
    { id: "work-lead", label: "A lead here", area: "work", argv: ["claude"], rules: [] },
    { id: "personal-lead", label: "A lead here", area: "personal", argv: ["claude"], rules: [] },
  ],
};

// Areas were called activities: a settings file written then still loads.
export function withOldKeys(own) {
  const recipes = Array.isArray(own.recipes)
    ? own.recipes.map((r) => (r && r.area === undefined && r.activity !== undefined ? { ...r, area: r.activity } : r))
    : own.recipes;
  return { ...own, areas: own.areas ?? own.activities, recipes };
}

const strings = (x) => Array.isArray(x) && x.every((s) => typeof s === "string");
const VALID = {
  areas: (v) => Array.isArray(v) && v.length > 0 && v.every((a) => typeof a?.id === "string" && typeof a.label === "string"),
  recipes: (v) => Array.isArray(v) && v.every((r) => typeof r?.id === "string" && typeof r.label === "string" && (r.rules === undefined || strings(r.rules))),
};

// The settings text (or null when there is no file) as areas and recipes; a part in the wrong shape
// is its default (the sidebar says so with a toast, the panel need not say it twice).
export function settingsFrom(text) {
  let own = null;
  try {
    own = text ? JSON.parse(text) : null;
  } catch {}
  if (!own || typeof own !== "object") return DEFAULTS;
  own = withOldKeys(own);
  return Object.fromEntries(Object.keys(VALID).map((k) => [k, own[k] !== undefined && VALID[k](own[k]) ? own[k] : DEFAULTS[k]]));
}

export const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);
// "home-server/sp1" -> "sp1": labels on a machine hold its own ids.
export const localId = (id) => id.slice(id.indexOf("/") + 1);

const isLive = (t) => t?.state === "live";
const taskIdOf = (t) => t?.labels?.["task.id"] || null;
export const agentName = (t) => t.name || t.template || t.program?.name || t.address;

// The sidebar's words: agents() when it has a pane (done turns idle once seen), else hc's. A done
// worker stays done: it finished and reported. Error counts as blocked.
export function statusOf(t, listed) {
  if (!isLive(t)) return "ended";
  const word = listed.get(t.address) ?? t.status ?? null;
  return word === "error" ? "blocked" : word;
}

// What a wait is, in the list's words (agent-tower model.js waitWords).
const KINDS = { question: "Asks you", auth: "Needs sign-in", permission: "Needs permission" };
export const kindOf = (t) => KINDS[t.report?.kind] ?? (t.status === "error" ? "Stopped with an error" : "Waiting on you");

export function spaceOf(t, spaceList) {
  const local = t?.labels?.["herdr.space"];
  if (!local) return null;
  const machine = machineOf(t.address);
  return spaceList.find((s) => s.id === (machine ? `${machine}/${local}` : local)) ?? null;
}

// A worker started with hc run has no space: it lives in the space of what started it.
function homeSpace(t, byAddress, spaceList) {
  const seen = new Set();
  for (let at = t; at && !seen.has(at.address); at = byAddress.get(at.parent)) {
    seen.add(at.address);
    const space = spaceOf(at, spaceList);
    if (space) return space;
  }
  return null;
}

// When an agent last changed, on the sidebar's clock (status_ms is not live, never an age).
export const changedAt = (t, changes) => changes?.[t.address]?.at ?? null;
// A busy mark is the time it was set, and lapses after ms: a run Herdr cut off before it cleared its
// mark (a render at 50 ms, a task at 500 ms; nothing after the cut runs) can't keep it.
export const held = (at, ms = 2 * 60000, now = Date.now()) => typeof at === "number" && now - at >= 0 && now - at < ms;

// Herdr's compact age.
export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const RANK = { blocked: 0, working: 1, idle: 2, done: 2, ended: 3 };

// Everything the panel shows for a selection from live data: null when nothing is selected, and
// { gone: true } when none of its terminals is left.
export function detailOf(selection, terms, listed, spaceList, changes) {
  if (!selection) return null;
  const byAddress = new Map(terms.map((t) => [t.address, t]));
  const lead = selection.lead ? byAddress.get(selection.lead) ?? null : null;
  const members = (selection.members ?? []).map((a) => byAddress.get(a)).filter((t) => t && t !== lead);
  const anchor = lead ?? members[0] ?? null;
  if (!anchor || (!isLive(lead) && !members.some(isLive))) return { gone: true, title: selection.title ?? null };
  const taskId = taskIdOf(lead) ?? (selection.key?.startsWith("task:") ? selection.key.slice(5) : null);
  const row = (t, isLead) => ({ t, isLead, status: statusOf(t, listed), at: changedAt(t, changes) });
  const workers = members.map((t) => row(t, false));
  const leadRow = lead ? row(lead, true) : null;
  // The list's seen/12 h rule: a done lead the list no longer shows as Done reads idle here too.
  // A task Working by its workers keeps its lead's unseen Done (the list's leadWord).
  if (leadRow?.status === "done" && selection.status && selection.status !== "done" && selection.leadWord !== "done") leadRow.status = "idle";
  const blocked = [...(leadRow ? [leadRow] : []), ...workers].filter((a) => a.status === "blocked");
  // The ask the list shows (a lead's or a sub-lead's task.ask), when no blocked agent comes first.
  const need = selection.need ?? null;
  const askBy = need?.text && !blocked.some((a) => a.t.address === need.by) ? byAddress.get(need.by) ?? null : null;
  const ownAsk = lead?.labels?.["task.ask"]?.trim() || null;
  return {
    key: selection.key,
    taskId,
    // Every task.id folded into this one by the sidebar (old sub-leads kept their own), top first.
    ids: selection.ids?.length ? selection.ids : taskId ? [taskId] : [],
    lead,
    leadRow,
    // The list's title (it drops program glyphs and paths) before the terminal's own.
    title: lead?.labels?.["task.title"] || selection.title || lead?.title || agentName(anchor),
    // The task's word as its row shows it (the list publishes it), or null from an older list.
    status: selection.status ?? null,
    workers,
    // The task's live shells without a tab (the list's selection names them), unless already members.
    shells: (selection.shells ?? []).map((a) => byAddress.get(a)).filter((t) => isLive(t) && !members.includes(t)),
    needs: blocked.map((a) => ({ ...a, kind: kindOf(a.t), sentence: a.t.report?.msg?.trim() || null })),
    space: homeSpace(anchor, byAddress, spaceList),
    machine: machineOf(anchor.address),
    // Its launch folder, and the one its program runs in now (shown once read.py finds the launch one gone).
    cwd: anchor.cwd ?? anchor.foreground?.cwd ?? null,
    liveCwd: anchor.foreground?.cwd ?? null,
    recipe: lead?.labels?.["task.recipe"] ?? null,
    area: lead?.labels?.["task.area"] ?? null,
    // An older list publishes no need: the lead's own task.ask then.
    ask: askBy ? { t: askBy, text: need.text.trim() } : "need" in selection ? null : ownAsk && lead ? { t: lead, text: ownAsk } : null,
    machines: [...new Set([lead, ...members].filter(isLive).map((t) => machineOf(t.address)))],
  };
}

// A task's ended workers: `hc ls --all --json --label task.id=<id>` for each of its ids (every
// machine; the app's terminals() drops ended ones at its next resync), plus any terminals() still holds.
export function endedOf(ids, listed, terms, leadAddress, now) {
  if (!ids.length) return [];
  const byAddress = new Map(terms.map((t) => [t.address, t]));
  const ended = new Map();
  for (const t of terms) {
    if (ids.includes(taskIdOf(t)) && t.state && !isLive(t) && now - (t.finished_ms ?? now) < ENDED_MS) ended.set(t.address, t);
  }
  for (const e of listed ?? []) {
    if (e?.state === "live" || !e?.address || ended.has(e.address)) continue;
    const known = byAddress.get(e.address);
    ended.set(e.address, known && !isLive(known) ? known : { ...e, program: known?.program });
  }
  ended.delete(leadAddress);
  // The top lead, once ended, is the state line's "Ended", not a worker.
  for (const [a, t] of ended) if (taskIdOf(t) === ids[0] && t.labels?.["task.role"] === "lead") ended.delete(a);
  return [...ended.values()].map((t) => ({ t, isLead: false, status: "ended", at: null }));
}

// Whether a layout node is on screen: no hidden node above it and, in each stack, the active child.
function shownWhere(node, test, hidden = false) {
  if (!node || typeof node !== "object") return false;
  if (test(node)) return !hidden && !node.hidden;
  const kids = node.children ?? [];
  return kids.some((k) => shownWhere(k, test, hidden || Boolean(node.hidden) || (node.type === "stack" && k.id !== (node.active ?? kids[0]?.id))));
}
export const blockShown = (root, mod) => shownWhere(root, (n) => n.content?.mod === mod);
export const nodeShown = (root, id) => shownWhere(root, (n) => n.id === id);

// tower-solo: Herdr's panel and our column take turns. seen: what the last look found while our
// column was open (null: it was closed since). Returns the id to hide, or null.
export function soloHide(herdr, ours, seen) {
  if (!herdr || !ours) return null;
  return seen && !seen.herdr ? "tower-detail" : "panel";
}

// ---- Masking: before anything is drawn or put in a tooltip.

const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bghp_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  /\bxox[abp]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
];
// A long run of hex, or of base64 mixing upper case, lower case and digits (a path rarely does).
const keyLike = (run) => /^[0-9a-fA-F]+$/.test(run) || (/[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run));

export function mask(text) {
  if (typeof text !== "string") return text;
  let out = text.replace(/(https?:\/\/[^\s?#)>\]"']+)[?#][^\s)>\]"']*/g, "$1");
  for (const re of SECRETS) out = out.replace(re, "•••");
  return out.replace(/[A-Za-z0-9+/_=-]{32,}/g, (run) => (keyLike(run) ? "•••" : run));
}

// ---- Words.

export const firstSentence = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : flat;
};

// Each path becomes its file name: "/a/b/report.md" -> "report.md".
export const shortPaths = (text) => text.replace(/(?:~|\.{1,2})?\/(?:[^\s/`'"()]+\/)+([^\s/`'"()]+)/g, "$1");

// The last sentence of the last paragraph, when that paragraph ends with "?".
export function endedWithQuestion(text) {
  const last = text?.trim().split(/\n\s*\n/).pop()?.trim();
  if (!last?.endsWith("?")) return null;
  const parts = last.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  return parts[parts.length - 1];
}

const flat = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

// What the message slot keeps under the Asks you card: nothing when the message ends with a
// question, since the card says it and the message's first words under it read as a cut second copy.
export const underAsk = (message) => (message && !message.empty && endedWithQuestion(message.text) ? null : message);

// lines: how many lines the slot shows folded (3, or 2 under the Asks you card).
// scale: the text's width against its width in a 340px panel (1 there and wider).
const charsFor = (lines, scale = 1) => Math.round((CUT_CHARS * lines * scale) / 3);

// How much of the 340px layout's text fits in a panel this wide, for text with `inset` px of
// padding and indent on its line (the panel's own 2px border included). Never above 1.
export const widthScale = (width, inset) => (width ? Math.max(0.4, Math.min(1, (width - inset) / (340 - inset))) : 1);
// Markdown as one line of prose, for the folded message and a report: no fenced code blocks,
// no heading, list or quote markers, no emphasis or code marks; lines joined with a space.
export function prose(text) {
  let fenced = false;
  return text.split("\n")
    .filter((line) => {
      // A horizontal rule is not text.
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return false;
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return false;
      }
      return !fenced;
    })
    .map((line) => line
      .replace(/^\s*(?:#{1,6}\s+|>\s?|(?:[-*+•]|\d+[.)])\s+)+/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/(^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s).,;:!?]|$)/g, "$1")
      .trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

// Cut at a word to fit `chars`; never end on a lone marker or on punctuation before the "…".
function cutAt(text, chars) {
  const cut = text.slice(0, chars);
  const space = cut.lastIndexOf(" ");
  return (space > chars * 0.6 ? cut.slice(0, space) : cut)
    .replace(/(?:\s+(?:[-*+•–—>#]+|\d+[.)]))+$/, "")
    .replace(/[\s,.;:–—-]+$/, "");
}

// The text cut at a word to fit `chars`, with "…" when anything went.
export function clip(text, chars) {
  return text.length <= chars ? text : `${cutAt(text, chars - 1)}…`;
}

export const isCut = (text, lines = 3, scale = 1) => text.length > charsFor(lines, scale) || (text.match(/\n/g)?.length ?? 0) > lines - 1;

// The folded form, used only when isCut: the first three lines' worth, cut at a word, ending in "…".
export function folded(text, lines = 3, scale = 1) {
  const chars = charsFor(lines, scale);
  const flat = prose(text);
  // Only line breaks made it a cut: as prose all of it fits.
  if (flat.length <= chars) return flat;
  // A message that ends with a question folds to that question: it is what the reader answers.
  const q = endedWithQuestion(text);
  if (q) return `… ${clip(prose(q), chars - 2)}`;
  return `${cutAt(flat, chars)}…`;
}

// Segments ([{text, color}]) joined with " · ": the first always stays, then whole segments while
// the line fits the budget.
export function fit(segments, budget = BUDGET) {
  const kept = [];
  let length = 0;
  for (const s of segments.filter(Boolean)) {
    const add = (kept.length ? 3 : 0) + s.text.length;
    if (kept.length && length + add > budget) break;
    kept.push(s);
    length += add;
  }
  return kept;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "2 checks failing · PR #412 · 19 changed · pushed", or the sums for several repos.
export function codeSummary(repos) {
  if (!repos.length) return [];
  const sum = (f) => repos.reduce((n, r) => n + f(r), 0);
  const failing = sum((r) => r.pr?.failing ?? 0);
  const running = sum((r) => r.pr?.running ?? 0);
  const checks = failing ? { text: plural(failing, "check failing", "checks failing"), color: "ansi1" } : running ? { text: "checks running", color: "dim" } : null;
  const ahead = sum((r) => r.ahead ?? 0);
  const unpushed = ahead ? { text: unpushedWords(ahead) } : null;
  const changed = sum((r) => r.changed ?? 0);
  if (repos.length > 1) return fit([{ text: `${repos.length} repos` }, checks, unpushed, changed ? { text: `${changed} changed` } : null]);
  const r = repos[0];
  return fit([
    checks,
    unpushed,
    r.pr?.number ? { text: `PR #${r.pr.number}` } : null,
    { text: changed ? `${changed} changed` : "all committed" },
    pushWords(r) ? { text: pushWords(r) } : null,
  ]);
}

// A repo without a remote was never meant to be pushed; one with a remote but no upstream wasn't yet.
export const pushWords = (r) => (r.upstream ? null : r.remote === false ? "no remote" : "never pushed");

export const unpushedWords = (n) => (n === 1 ? "1 commit unpushed" : `${n} commits unpushed`);

export function savedSummary(link, leadChangedAgoMs) {
  if (!link) return [];
  const old = leadChangedAgoMs != null && link.ago_ms - leadChangedAgoMs > QUIET_MS;
  return fit([{ text: `Saved progress ${agoWords(link.ago_ms)}` }, old ? { text: "newer work unsaved", color: "dim" } : null]);
}

export const agoWords = (ms) => (ms < 60000 ? "just now" : `${duration(ms)} ago`);

// ---- Reports: "<hc from=…>" in the lead's transcript, matched to the item's workers.

// The worker a report's "from" names, or null for anyone else (peers, chains, the person).
// leadMachine: the lead's machine (null: this one); remote: hc machines this app knows.
export function reportOwner(from, workers, leadMachine, remote) {
  const [where, ...rest] = from.trim().split(/\s+/);
  const name = rest.join(" ") || null;
  let address = where;
  const prefix = machineOf(where);
  if (!prefix) address = leadMachine ? `${leadMachine}/${where}` : where;
  else if (!remote.includes(prefix)) address = localId(where);
  const byAddress = workers.filter((w) => w.t.address === address);
  if (byAddress.length === 1) return byAddress[0];
  const byName = (byAddress.length ? byAddress : workers).filter((w) => name && agentName(w.t) === name);
  return byName.length === 1 ? byName[0] : byAddress[0] ?? null;
}

export function reportsFor(reports, workers, leadMachine, remote) {
  const out = new Map();
  for (const r of reports ?? []) {
    const w = reportOwner(r.from, workers, leadMachine, remote);
    if (!w || r.ago_ms > ENDED_MS) continue;
    const had = out.get(w.t.address);
    if (!had || had.ago_ms > r.ago_ms) out.set(w.t.address, r);
  }
  return out;
}

// ---- The lead's state line and message.

// One age form everywhere: "working for 5m", "idle for 3m", "done 2m ago", "waiting for 2m";
// under a minute, no number ("working", "done just now").
export function sinceWords(status, ms) {
  const m = ms != null && ms >= 60000 ? duration(ms) : null;
  if (status === "done") return m ? `done ${m} ago` : "done just now";
  const word = { blocked: "waiting", stale: "working" }[status] ?? status ?? "";
  return m ? `${word} for ${m}` : word;
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The lead's state: { word, color, meta: [{text, color}] }, or null for a blocked lead (its block
// says it). lead: { status, at }; read: the lead part of read.py's answer with ages in ms; others:
// whether any other member moved in the last 10 minutes.
export function stateLine(lead, read, othersMoved, now, down) {
  if (!lead) return { word: "Ended", color: "muted", meta: [] };
  const ago = lead.at ? now - lead.at : null;
  if (down) {
    const was = { working: "Was working", done: "Was done", blocked: "Was waiting on you" }[lead.status] ?? "Was idle";
    return { word: was, color: "muted", meta: [{ text: `${down.name} doesn't answer`, color: "ansi1" }], frozen: true };
  }
  if (lead.status === "ended") return { word: "Ended", color: "muted", meta: [] };
  if (lead.status === "blocked") return null;
  if (lead.status === "done") return { word: capital(sinceWords("done", ago)), color: "done", meta: [] };
  if (lead.status !== "working") return { word: capital(sinceWords("idle", ago)), color: "muted", meta: [] };
  const word = { word: capital(sinceWords("working", ago)), color: "working", meta: [] };
  if (!read?.found) return word;
  // Quiet under 10 minutes says nothing; red only when nothing else in the item moves either.
  const quiet = read.written_ago_ms;
  if (quiet >= QUIET_MS) {
    const text = ago != null && quiet >= ago ? "quiet since it started" : `quiet ${duration(quiet)}`;
    word.meta.push({ text, color: !othersMoved && !read.open_tool ? "ansi1" : "dim" });
  } else if (read.compact_ago_ms != null && (read.last?.ago_ms == null || read.compact_ago_ms < read.last.ago_ms)) {
    // A note, never in place of what it said.
    word.meta.push({ text: `compacted ${agoWords(read.compact_ago_ms)}` });
  }
  return word;
}

// hc's short line of what an agent is doing now, kept short: a shell command is just "Running a command".
export const activityWords = (msg) => {
  const flat = msg?.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return /^Running\b/.test(flat) ? "Running a command" : clip(flat, 60);
};

// A prompt as plain words: an hc message reads "From t4c: …".
export const promptWords = (text) => text.replace(/<hc from="([^"]*)">\s*/g, "From $1: ").replace(/\s*<\/hc>/g, "").trim();

// What the message slot says: { text, color, prefix?, empty? }. status: the lead's word; why: what
// to say when no conversation was found ({ program, where }).
export function messageOf(status, read, hasLead, why = {}) {
  if (!read) return hasLead ? null : { text: "Lead ended", color: "dim", empty: true };
  if (!read.found) {
    const program = why.program ?? "this agent";
    const where = why.where ?? "this computer";
    return read.ambiguous
      ? { text: `Two ${program} agents share this folder on ${where}`, color: "dim", empty: true }
      : { text: `No ${program} conversation found on ${where}`, color: "dim", empty: true };
  }
  const last = read.last;
  const inTurn = (ago) => read.turn_ago_ms != null && ago <= read.turn_ago_ms;
  // Working on something it hasn't answered yet: what it was asked.
  if (status === "working" && read.prompt?.text && inTurn(read.prompt.ago_ms) && !(last && inTurn(last.ago_ms))) {
    return { text: promptWords(read.prompt.text), color: "muted", prefix: `Asked ${agoWords(read.prompt.ago_ms)}: ` };
  }
  if (!last) return { text: "No message yet", color: "dim", empty: true };
  // Cut at a word, so the marker never splits one.
  const text = last.cut ? `${last.text.replace(/\s+\S*$/, "")}…cut, go to the agent for the rest` : last.text;
  if (status !== "working" && status !== "blocked") return { text, color: "foreground" };
  // Said in the turn still running: a note on the way, not its answer.
  if (status === "working" && inTurn(last.ago_ms)) return { text, color: "muted", prefix: `Said ${agoWords(last.ago_ms)}, still working: ` };
  return { text, color: "dim", prefix: `Last said ${agoWords(last.ago_ms)}: ` };
}

// The task's folder in the header's tooltip: the lead's launch folder, as the list's joinPlace takes
// it while it exists (a cd moves nothing); the folder it runs in now once the lead's read found the
// launch folder gone (data.launch_gone: moved by hand, hc keeps the old path).
export const shownFolder = (d, data) => (data?.launch_gone && d.liveCwd ? d.liveCwd : d.cwd);

// The footer's folder: its last path segment (the full path goes in the tooltip).
export const folderOf = (path) => path?.replace(/\/+$/, "").split("/").pop() || path || null;

// ---- A past moment (Timeline's click on a stretch, shared agent-tower.moment).

const THEN = { working: "Working", blocked: "Waiting on you", done: "Done", idle: "Idle", ended: "Ended" };
const two = (n) => String(n).padStart(2, "0");
export const clockOf = (ms) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

// { word, span, looked, live }: "Working", "05:36–08:26 · 2h", "you looked after 19m". A stretch
// still going (to null) says "since 05:36" and is live: its screen is the agent's own, now.
export function thenWords(moment, now) {
  const live = moment.to == null;
  const span = `${live ? `since ${clockOf(moment.at)}` : `${clockOf(moment.at)}–${clockOf(moment.to)}`} · ${duration((moment.to ?? now) - moment.at)}`;
  const looked = moment.looked != null ? `you looked after ${duration(moment.looked)}` : moment.word === "blocked" ? "not looked at yet" : null;
  return { word: THEN[moment.word] ?? moment.word ?? "", span, looked, live };
}

// The newest lines of a kept screen, without the blank ones at its foot.
export const screenTail = (text, n = 16) => text.replace(/\s+$/, "").split("\n").slice(-n).join("\n");

// ---- Read scheduling.

// Only machines that host a live member are read again: an old read from a machine whose members
// ended or left the task would hold the footer's age, its repos and its ended workers forever.
export function dropGone(reads, current) {
  for (const m of Object.keys(reads)) if (!current.has(m)) delete reads[m];
  return reads;
}

// The footer's check: { text, warn, reading }. reads: { [machine]: state } of current machines;
// down: machines that don't answer; leadKey: the lead's machine ("" here).
export function checkedOf(reads, down, leadKey, now, staleMs = 3 * 60000) {
  const states = Object.values(reads);
  const reading = states.some((s) => held(s.reading, undefined, now));
  const good = states.filter((s) => s.at != null);
  const oldest = good.length ? Math.min(...good.map((s) => s.at)) : null;
  const failedFirst = !good.length && states.some((s) => s.fails || s.missing);
  const failedSince = states.some((s) => s.failedAt && s.at != null && s.failedAt > s.at);
  const anyDown = [...down].some((m) => m in reads || m === leadKey);
  const neverRead = !good.length && (failedFirst || anyDown);
  const text = reading ? "checking…" : neverRead ? "couldn't check" : oldest != null ? `checked ${agoWords(now - oldest)}` : "checking…";
  // A machine that doesn't answer already says so in red on the state line.
  const warn = !down.has(leadKey) && (neverRead || anyDown || failedSince || (oldest != null && now - oldest > staleMs));
  return { text, warn, reading };
}

// Reads of one machine start at most this often, however fast its agents change: one read runs ps,
// lsof and git for every member (on a busy Mac that was a read.py every second).
export const READ_FLOOR_MS = 15000;
// The task's ended members (hc ls --all) and its chain link change rarely: read them at most this often.
export const LIST_EVERY_MS = 2 * 60000;
export const CHAIN_EVERY_MS = 5 * 60000;

// How long until the next read of one machine is due, in ms (<= 0: now).
export function readDue(state, { anyWorking, signature, now }) {
  if (!state || state.at == null && !state.failedAt) return 0;
  if (state.missing) return state.failedAt + 30 * 60000 - now;
  const last = Math.max(state.at ?? 0, state.failedAt ?? 0);
  if (state.signature !== signature && state.fails < 3) return last + READ_FLOOR_MS - now;
  const every = state.fails >= 3 ? 5 * 60000 : anyWorking ? 60000 : 5 * 60000;
  return last + every - now;
}
