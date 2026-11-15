// Agent tower panel: the work item selected in the agent-tower sidebar, in its own column right of
// Herdr's Files/Changes panel. The lead's state and last message, what needs you, and three rows
// (Workers, Code, Saved progress) that open in place. Live data comes from Herdr; the rest from one
// read.py run per machine that hosts a member, only while the panel is on screen.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc, exec, run, terminals, agents, spaces, machines, theme, home, appHome, readTextFile, shared, setShared, layout, window, props } from "herdr";
import * as panel from "./panel.js";

const MOD = "agent-tower-panel";
// Published by the sidebar: { key, lead, members, title, ids } or null (see panel.detailOf).
const SELECTED = "agent-tower.selected";
// The sidebar's clock for each terminal's last change: { [address]: { word, turn, at } }.
const CHANGES = "agent-tower.changes";
// A past stretch Timeline asked the card to show: { key, address, at, to, word, msg, screen, looked }.
// Its screen, when kept, is screens.json[screen] under the tower folder's timeline/.
const MOMENT = "agent-tower.moment";
// What the card had open per task (rows, unfolded texts, "+N more"), so a restart (an area's layout
// switch) or coming back to a task finds it as left: { [key]: { open, expanded, more, moreRepos, at } }.
const KEPT_VIEW = "agent-tower-panel.view";
const KEEP_TASKS = 30;
// One Hide text switch for the whole Tower: the list masks its titles and waits with it too.
const HIDE = "agent-tower.hideText";
// What stands at the left of a task, as the list draws it: "state" or "agents".
const ROW_MARK = "agent-tower.rowMark";
// Live workers listed before the rest fold into "+N more".
const SHOW_WORKERS = 3;
const SHOW_REPOS = 3;
// A report under a worker's name: about two lines at 340px.
const REPORT_CHARS = 84;
// A Code detail line at 340px.
const DETAIL_CHARS = 52;
const GH_EVERY_MS = 5 * 60000;
const STALE_MS = 3 * 60000;
// One fade for what a machine that doesn't answer last said and for ended workers.
const FADED = 0.7;
const chrome = (name) => svg(`mods/workspace-chrome/${name}.svg`);
const here = () => (window()?.platform === "macos" ? "this Mac" : "this computer");
const machineName = (m) => m ?? here();
const mk = (m) => m ?? "";
const lastLine = (s) => s?.trim().split("\n").pop()?.trim() ?? "";
// The body's one separator: a dot with 4px each side, in dim.
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dot = (t, color = t.dim) => div().flex_none().px(4).text_color(color).child("·");

// GPUI may break a line before any punctuation that isn't glued to its word, "?" included, so a
// question can end with "?" alone on a line. Short prominent texts wrap whole words instead.
const wordWrap = (text) => h_flex().flex_wrap().min_w(0).children(text.split(/\s+/).filter(Boolean)
  .map((w, i, all) => div().flex_none().max_w_full().truncate().child(i < all.length - 1 ? `${w} ` : w)));

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Herdr's status marks as the list draws them (agent-tower main.js statusMark): a ! for blocked, a
// still clock for a working task gone quiet.

// The task's mark at the left of the header, the same as its row's (agent-tower marks.js rowMark):
// its state, or under "agents" how many of its agents work right now on a working tile. A task that
// needs you, or with none working, shows its state mark: the number is never red.
function taskMark(t, d) {
  const mark = d.status ?? null;
  const n = shared(ROW_MARK) === "agents"
    ? [d.lead, ...d.workers.map((w) => w.t)].filter((x) => x?.state === "live" && x.status === "working").length : 0;
  if (!n || mark === "blocked") return h_flex().size(18).flex_none().items_center().justify_center().child(statusMark(t, mark));
  return h_flex().size(18).flex_none().rounded(5).bg(t.working + "26").items_center().justify_center()
    .text_size(10.5).font_bold().text_color(t.working).child(String(n));
}

function statusMark(t, status) {
  if (status === "stale") return chrome("clock").size(12).mx(1).flex_none().text_color(t.working);
  if (status === "working") return chrome("spinner").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(11).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  if (status === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
  return div().size(7).mx(3).flex_none();
}

// An agent with a pane is shown in place; one without (a worker started with hc run) is peeked at.
// What Details opens, the list does (the same paths as its own clicks): "enter" a task (its lead, or
// `agent` open), "open" one agent (its pane, else Tower's peek), "menu" for a task or an agent.
const ACT = "agent-tower.act";
const act = (request) => setShared(ACT, { ...request, at: Date.now() });
const enter = (key, agent) => act({ action: "enter", key, ...(agent ? { agent } : {}) });
const openAgent = (address) => act({ action: "open", address });
// Rule 5: a right-click opens the thing's own menu, the same as on its row (the list opens it).
function openMenu(thing) {
  act(thing.key ? { action: "menu", key: thing.key } : { action: "menu", address: thing.agent.address });
}
const withMenu = (el, thing) => el.on_mouse_down("right", (_e, cx) => {
  cx.stop_propagation();
  openMenu(thing);
});

// The list's folder (agent-tower main.js towerDir): ~/.config/agent-tower for the Herdr app itself, a
// Herdr with its own app home (a sandbox) its own. Read in the list's order, so both use one file.
const towerDir = () => (appHome() === `${home()}/.config/herdr-app` ? `${home()}/.config/agent-tower` : `${appHome()}/agent-tower`);

async function loadSettings() {
  // The mod was called agent-tasks: its settings folder still counts until there is a new one.
  for (const folder of new Set([towerDir(), `${home()}/.config/agent-tower`, `${home()}/.config/agent-tasks`])) {
    const text = await readTextFile(`${folder}/config.json`).catch(() => null);
    if (text != null) return panel.settingsFrom(text);
  }
  return panel.DEFAULTS;
}

const cwdOf = (t) => t.foreground?.cwd ?? t.cwd ?? null;
const specOf = (t) => ({ pid: t.pid ?? t.foreground?.pid ?? null, argv: t.foreground?.argv ?? t.argv ?? [], cwd: cwdOf(t) });

// read.py's seconds-ago as milliseconds-ago on this clock: the time since the answer arrived added.
function aged(data, arrived, now) {
  const ms = (s) => (s == null ? null : s * 1000 + (now - arrived));
  const lead = data.lead && {
    ...data.lead,
    written_ago_ms: ms(data.lead.written_s),
    turn_ago_ms: ms(data.lead.turn_ago_s),
    compact_ago_ms: ms(data.lead.compact_ago_s),
    last: data.lead.last && { ...data.lead.last, ago_ms: ms(data.lead.last.ago_s) },
    reports: (data.lead.reports ?? []).map((r) => ({ ...r, ago_ms: ms(r.ago_s) })),
  };
  const workers = Object.fromEntries(Object.entries(data.workers ?? {}).map(([k, w]) => [k, { ...w, written_ago_ms: ms(w.written_s) }]));
  const repos = (data.repos ?? []).map((r) => ({ ...r, commit_ago_ms: ms(r.commit_ago_s) }));
  const chain = data.chain && typeof data.chain === "object" ? { ...data.chain, ago_ms: ms(data.chain.ago_s) } : null;
  return { lead, workers, repos, chain };
}

export default class AgentTowerPanel extends View {
  init(_props, cx) {
    this.h = cx.focus_handle();
    this.config = panel.DEFAULTS;
    // Per item key: { machines: { [machine]: { at, data, fails, failedAt, error, missing, signature } }, ended, clamp }.
    this.cache = new Map();
    // Machines with a read running: one at a time each.
    this.inflight = new Set();
    // Pull requests per machine|root, read at most every 5 minutes: { at, pr }.
    this.prs = new Map();
    this.view = { key: null };
    cx.spawn(async (cx) => {
      this.config = await loadSettings();
      cx.notify();
    });
    // tower-solo.json: the panel is not drawn while its column is closed, so this notices that.
    if (props()?.solo) {
      cx.timer.every(1000, () => {
        if (!panel.nodeShown(layout(), "tower-detail")) this.soloSeen = null;
      });
    }
    // tower-stack: Details stays open under the list, as small as what it holds. A mod in a hidden
    // column doesn't run, so the card can't reopen itself: the list's Details menu does.
    // Ages, and whatever read is due; nothing while the panel is hidden or nothing is selected.
    cx.timer.every(30000, (cx) => {
      if (this.view.key && panel.blockShown(layout(), MOD)) cx.notify();
    });
  }

  // The selected item as the panel shows it: null when nothing is selected.
  selected(terms = terminals(), listed = new Map(agents().map((a) => [a.address, a.status])), changes = shared(CHANGES) ?? shared("agent-tasks.changes") ?? {}) {
    // Whatever any view selected, in any area: choosing what is selected is the list's and the views' job.
    return panel.detailOf(shared(SELECTED) ?? null, terms, listed, spaces(), changes);
  }

  item(key) {
    if (!this.cache.has(key)) this.cache.set(key, { machines: {}, ended: null, clamp: undefined });
    return this.cache.get(key);
  }

  // What each machine reads for this item: the lead's transcript and chain where the lead runs, the
  // workers' quiet time where each runs, git for every member's folder.
  groupsOf(d, terms) {
    const groups = new Map();
    const at = (m) => {
      if (!groups.has(mk(m))) groups.set(mk(m), { m, args: { workers: [], cwds: [], chain: false, gh_skip: [] } });
      return groups.get(mk(m)).args;
    };
    const lead = d.lead?.state === "live" ? d.lead : null;
    if (lead) {
      const args = at(panel.machineOf(lead.address));
      // pi keeps no file open: with another pi in the same folder its transcript can't be told apart.
      const shared = lead.program?.key === "pi" && terms.some((t) => t !== lead && t.state === "live" && t.program?.key === "pi"
        && panel.machineOf(t.address) === panel.machineOf(lead.address) && cwdOf(t) === cwdOf(lead));
      args.lead = shared ? null : specOf(lead);
      args.ambiguous = shared;
      args.lead_cwd = cwdOf(lead);
      args.chain = true;
      args.chains = d.ids;
      if (cwdOf(lead)) args.cwds.push(cwdOf(lead));
    }
    for (const w of d.workers) {
      if (w.t.state !== "live") continue;
      const args = at(panel.machineOf(w.t.address));
      args.workers.push({ key: w.t.address, ...specOf(w.t) });
      if (cwdOf(w.t) && !args.cwds.includes(cwdOf(w.t))) args.cwds.push(cwdOf(w.t));
    }
    return groups;
  }

  // Starts every read that is due for the shown item.
  schedule(d, terms, down, cx) {
    const item = this.item(d.key);
    const now = Date.now();
    const members = [d.lead, ...d.workers.map((w) => w.t)].filter((t) => t?.state === "live");
    const signature = members.map((t) => `${t.address}:${t.status}:${t.turn}`).join(" ");
    const anyWorking = members.some((t) => t.status === "working");
    for (const { m, args } of this.groupsOf(d, terms).values()) {
      if (down.has(mk(m)) || this.inflight.has(mk(m))) continue;
      const state = item.machines[mk(m)];
      const forced = this.forced === d.key;
      const freshen = this.freshen && state?.at != null && now - state.at > 60000;
      if (!forced && !freshen && panel.readDue(state, { anyWorking, signature, now }) > 0) continue;
      args.gh_skip = forced ? [] : args.cwds.length ? [...this.prs].filter(([k, v]) => k.startsWith(`${mk(m)}|`) && now - v.at < GH_EVERY_MS).map(([k]) => k.slice(mk(m).length + 1)) : [];
      this.read(d, m, args, signature, cx);
    }
    this.forced = null;
    this.freshen = false;
  }

  read(d, m, args, signature, cx) {
    const key = d.key;
    const item = this.item(key);
    const state = (item.machines[mk(m)] ??= { fails: 0 });
    state.signature = signature;
    state.reading = true;
    this.inflight.add(mk(m));
    // hc ls --all lists every machine: once per round, with the lead's read or, after it ended, the first member's.
    const listHere = (d.lead?.state === "live" ? panel.machineOf(d.lead.address) : d.machine) === m;
    const ids = d.ids;
    cx.spawn(async (cx) => {
      try {
        this.script ??= await readTextFile(`${appHome()}/mods/${MOD}/read.py`);
        if (!this.script) throw new Error("read.py is missing from the mod");
        const { ambiguous, ...sent } = args;
        const [r, listed] = await Promise.all([
          exec("sh", ["-c", 'python3 -c "$1" "$2"', "tower", this.script, JSON.stringify(sent)], { on: m, timeout: 20000 }),
          listHere && ids.length ? Promise.all(ids.map((id) => hc(["ls", "--all", "--json", "--label", `task.id=${id}`]))).catch(() => null) : null,
        ]);
        if (listed?.every((l) => l.code === 0)) {
          try {
            item.ended = listed.flatMap((l) => JSON.parse(l.stdout).terminals ?? []);
          } catch {}
        }
        if (r.code === 127 || /python3:.*(not found|No such file)/.test(r.stderr)) {
          state.missing = true;
          state.failedAt = Date.now();
        } else if (r.code !== 0) {
          throw new Error(lastLine(r.stderr) || `exit ${r.code}`);
        } else {
          const data = JSON.parse(r.stdout);
          const at = Date.now();
          for (const repo of data.repos ?? []) {
            const k = `${mk(m)}|${repo.root}`;
            if (repo.pr === "skipped") repo.pr = this.prs.get(k)?.pr ?? null;
            else if (repo.upstream && !repo.default && data.gh !== false) this.prs.set(k, { at, pr: repo.pr });
          }
          if (ambiguous) data.lead = { found: false, ambiguous: true };
          Object.assign(state, { at, data, fails: 0, failedAt: null, error: null, missing: false });
        }
      } catch (e) {
        state.fails = (state.fails ?? 0) + 1;
        state.failedAt = Date.now();
        state.error = String(e?.message ?? e).replace(/^Error: /, "");
      }
      state.reading = false;
      this.inflight.delete(mk(m));
      cx.notify();
    });
  }

  // tower-stack: the Details column as tall as what it holds (header, body padding, footer, borders
  // and the column's padding around it), between 120 px and 260 px: above that the card scrolls, so
  // the list above keeps its Needs you group and the selected row in sight.
  fit(contentHeight) {
    if (!props()?.stack) return;
    const px = Math.round(Math.max(120, Math.min(260, 42 + 24 + contentHeight + 32 + 2 + 16)));
    if (Math.abs(px - (this.fitPx ?? 0)) < 4) return;
    this.fitPx = px;
    run("layout.resize", { id: "tower-detail", px });
  }

  // Opening one of Herdr's panel and our column closes the other.
  solo() {
    const root = layout();
    const herdr = panel.nodeShown(root, "panel");
    const ours = panel.nodeShown(root, "tower-detail");
    const hide = panel.soloHide(herdr, ours, this.soloSeen);
    if (hide) run("layout.hide", { id: hide });
    this.soloSeen = ours && hide !== "tower-detail" ? { herdr: herdr && hide !== "panel" } : null;
  }

  get hideText() {
    return shared(HIDE) === true;
  }

  setHide(on, cx) {
    setShared(HIDE, on);
    cx.notify();
  }

  toggle(set, id, cx) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.keepView();
    cx.notify();
  }

  // The card's open parts for the shown task, kept in shared state (the newest 30 tasks).
  keepView() {
    const v = this.view;
    if (!v.key) return;
    const kept = { ...(shared(KEPT_VIEW) ?? {}), [v.key]: { open: [...v.open], expanded: [...v.expanded], more: v.more, moreRepos: Boolean(v.moreRepos), at: Date.now() } };
    const newest = Object.entries(kept).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, KEEP_TASKS);
    setShared(KEPT_VIEW, Object.fromEntries(newest));
  }

  // A click on the title goes into the task at once (rules 1 and 6).
  titleClick(d) {
    enter(d.key);
  }

  // The task: its mark (as its row's), its title, and the machines it runs on other than this one.
  header(t, d) {
    const live = Boolean(d?.lead || d?.workers);
    const hidden = this.hideText && live;
    const recipe = live ? this.config.recipes.find((r) => r.id === d.recipe) : null;
    // Rule 7: the whole title and what it is, never how to use it.
    const tip = live ? [d.title, d.taskId ? `Task ${d.taskId}` : null, recipe?.label, this.hideText ? null : panel.folderOf(d.cwd)].filter(Boolean).map(panel.mask).join(" · ") : null;
    const away = live ? d.machines.filter(Boolean).join(", ") : "";
    const title = div().id("tp-title").min_w(0).truncate().font_semibold().text_color(hidden ? t.dim : t.foreground).child(hidden ? "Text hidden" : d?.title ?? "Details")
        .when(Boolean(tip) && !hidden, (el) => el.tooltip(tip))
        .when(Boolean(d?.key), (el) => el.cursor_pointer().on_click(() => this.titleClick(d)));
    return h_flex().id("tp-header").h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .when(live, (el) => el.child(taskMark(t, d)))
      .child(title)
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(away))
      .child(h_flex().id("tp-close").size(24).mr(-6).flex_none().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Close the panel")
        .on_click(() => run("layout.hide", { id: "tower-detail" }))
        .child(chrome("x").size(14)));
  }

  // The kept screen of a moment, read once per moment (screens.json can be large).
  screenOf(moment, cx) {
    if (!moment?.screen || moment.to == null) return undefined;
    if (this.screen?.key === moment.screen) return this.screen.text;
    if (this.screenReading === moment.screen) return undefined;
    this.screenReading = moment.screen;
    cx.spawn(async (cx) => {
      let text = null;
      try {
        text = JSON.parse((await readTextFile(`${towerDir()}/timeline/screens.json`)) ?? "{}")[moment.screen] ?? null;
      } catch {}
      this.screen = { key: moment.screen, text };
      this.screenReading = null;
      cx.notify();
    });
    return undefined;
  }

  // "Then": the stretch clicked in Timeline, who it was, what it said or asked, when you looked, and
  // the screen kept where it ended; "Back to now" clears it. A stretch still going shows no screen:
  // the agent's own is live in the centre.
  then(t, d, moment, terms, now, cx) {
    const words = panel.thenWords(moment, now);
    const who = terms.find((x) => x.address === moment.address) ?? { address: moment.address };
    const subject = who.address === d.lead?.address ? ["lead", machineName(panel.machineOf(who.address))] : this.subject(t, d, who);
    const screen = words.live ? undefined : this.screenOf(moment, cx);
    const color = { Working: t.working, "Waiting on you": t.blocked, Done: t.done }[words.word] ?? t.muted;
    // A wait still open is said by its own block below: no second copy of the question.
    const open = words.live && d.needs.some((n) => n.t.address === moment.address);
    const said = moment.msg && !this.hideText && !open ? panel.mask(moment.msg) : null;
    return v_flex().id("tp-then").px(8).py(8).gap(4).flex_none().rounded(8).bg(t.raised)
      .child(h_flex().h(20).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_none().child("Then"))
        .child(div().flex_1())
        .child(h_flex().id("tp-now").h(20).px(8).flex_none().items_center().rounded(6).cursor_pointer()
          .bg(t.background).text_color(t.foreground).hover((st) => st.bg(t.hover))
          .on_click(() => setShared(MOMENT, null))
          .child("Back to now")))
      .child(h_flex().min_w(0).items_center().text_size(12)
        .when(Boolean(words.word), (el) => el.child(div().flex_none().text_size(13).font_medium().text_color(color).child(words.word)))
        .children([words.span, ...subject].flatMap((w, i) => [...(i || words.word ? [dot(t)] : []), div().text_color(t.dim).child(w).when(i < 2, (el) => el.flex_none()).when(i === 2, (el) => el.min_w(0).truncate())])))
      .when(Boolean(said), (el) => el.child(moment.word === "blocked"
        ? wordWrap(said).text_size(12).line_height("18px").text_color(t.foreground)
        : div().whitespace_normal().text_size(12).line_height("18px").text_color(t.muted).child(`Said: ${said}`)))
      .when(Boolean(words.looked), (el) => el.child(div().text_size(11).text_color(t.dim).child(capitalize(words.looked))))
      .when(!words.live, (el) => el.child(screen === undefined ? div().text_size(11).text_color(t.dim).child("Reading…")
        : screen === null ? div().text_size(11).text_color(t.dim).child("No screen kept")
          : this.hideText ? div().text_size(11).text_color(t.dim).child("Text hidden")
            : div().id("tp-then-screen").mt(2).p(8).rounded(6).bg(t.background).overflow_x_scrollbar()
              .font_family("JetBrains Mono").text_size(10.5).line_height("14px").text_color(t.muted).whitespace_nowrap()
              .children(panel.screenTail(panel.mask(screen)).split("\n").map((line) => div().child(line || " ")))));
  }

  // Who a line is about: "lead" or the worker's name, then where it runs.
  subject(t, d, x) {
    return [x === d.lead ? "lead" : panel.agentName(x), machineName(panel.machineOf(x.address))];
  }

  // A wait: what it waits for in the list's words, whose, where, since when, "Go to it", and the
  // agent's own sentence.
  need(t, d, n, now, down) {
    const since = n.at ? panel.sinceWords("blocked", now - n.at) : null;
    const sentence = n.sentence && (this.hideText ? null : panel.mask(n.sentence));
    return v_flex().id(`tp-need-${n.t.address}`).when(true, (el) => withMenu(el, { agent: n.t })).px(8).py(8).gap(4).flex_none().rounded(8).bg(t.blocked + "14")
      .opacity(down ? FADED : 1).transition("opacity", 200)
      .child(h_flex().h(22).items_center().text_size(12)
        .child(div().flex_none().text_color(t.blocked).child(n.kind))
        .child(div().flex_1())
        .when(!down, (el) => el.child(h_flex().id(`tp-go-${n.t.address}`).ml(6).h(22).px(8).flex_none().items_center().rounded(6).cursor_pointer()
          .bg(t.background).text_color(t.foreground).hover((s) => s.bg(t.hover))
          .on_click(() => openAgent(n.t.address))
          .child("Go to it"))))
      .child(div().truncate().text_size(12).text_color(t.muted).child([...this.subject(t, d, n.t), since].filter(Boolean).join(" · ")))
      .when(Boolean(n.sentence), (el) => el.child(this.hideText
        ? div().text_size(12).text_color(t.dim).child("Text hidden")
        : wordWrap(sentence).line_height("18px").text_size(12).text_color(t.foreground)));
  }

  // A row's summary from segments: one line, each segment its own colour.
  summary(t, segments, open) {
    const base = open ? t.foreground : t.muted;
    const kids = [];
    segments.forEach((s, i) => {
      if (i) kids.push(dot(t));
      const color = s.color ? t[s.color] ?? base : base;
      kids.push(div().min_w(0).text_color(color).child(s.text).when(i === segments.length - 1, (el) => el.truncate()).when(i < segments.length - 1, (el) => el.flex_none()));
    });
    return h_flex().flex_1().min_w(0).overflow_hidden().text_size(12).children(kids);
  }

  // An open row has no surface: hovering it only darkens its chevron.
  row(t, id, segments, detail) {
    const open = this.view.open.has(id);
    return [
      h_flex().id(`tp-row-${id}`).h(28).flex_none().px(8).gap(8).items_center().rounded(8).cursor_pointer()
        .when(!open, (el) => el.hover((s) => s.bg(t.hover)))
        .on_hover((on, cx) => {
          const next = on ? id : this.hoverRow === id ? null : this.hoverRow;
          if (next === this.hoverRow) return;
          this.hoverRow = next;
          cx.notify();
        })
        .on_click((_e, cx) => this.toggle(this.view.open, id, cx))
        .child(this.summary(t, panel.fit(segments, Math.floor(panel.BUDGET * panel.widthScale(this.width, 49))), open))
        .child(chrome(open ? "chevron-down" : "chevron-right").size(11).flex_none()
          .text_color(open && this.hoverRow === id ? t.foreground : t.dim)),
      ...(open ? [v_flex().id(`tp-open-${id}`).pt(2).pb(12).gap(4).text_size(12).line_height("18px").text_color(t.muted)
        .transition("height", 120).children(detail())] : []),
    ];
  }

  // One worker: icon, name, machine, its state since when, mark; under it its last report.
  worker(t, w, reports, quiet, nowOf, down) {
    const k = w.t;
    const ended = w.status === "ended";
    const ago = w.at ? nowOf(panel.machineOf(k.address)) - w.at : null;
    // Under 300 px (tower-stack) the name needs the room: the list's compact age.
    const age = ended ? (k.exit_code ? "failed" : "ended") : (this.width ?? 340) < 300 ? (ago != null ? panel.duration(ago) : "") : panel.sinceWords(w.status, ago);
    const q = quiet.get(k.address);
    const silent = !ended && w.status === "working" && q && q.written_ago_ms >= panel.QUIET_MS && !q.open_tool && !down.has(mk(panel.machineOf(k.address)));
    const report = reports.get(k.address);
    const reportId = `report:${k.address}`;
    const open = this.view.expanded.has(reportId);
    const said = report ? panel.mask(report.text) : null;
    // One run, so the time always ends the text instead of standing in a column of its own.
    const when = report ? ` · ${panel.agoWords(report.ago_ms)}` : "";
    const line2 = this.hideText ? null
      : said ? div().id(`tp-rep-${k.address}`).pl(30).pr(8).cursor_pointer().whitespace_normal().text_color(t.muted)
        .when(!open, (el) => el.max_h(36).overflow_hidden())
        .on_click((_e, cx) => this.toggle(this.view.expanded, reportId, cx))
        .child(`${open ? said : panel.clip(panel.shortPaths(panel.firstSentence(panel.prose(said))), Math.floor(REPORT_CHARS * panel.widthScale(this.width, 52)) - when.length)}${when}`)
      : k.title && k.title !== panel.agentName(k) ? div().pl(30).pr(8).truncate().text_color(t.muted).child(panel.mask(k.title)) : null;
    return v_flex().id(`tp-w-${k.address}`).flex_none().when(ended, (el) => el.opacity(FADED))
      .child(h_flex().id(`tp-wl-${k.address}`).h(22).px(8).gap(6).items_center().rounded(8)
        .when(!ended, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openAgent(k.address)))
        .when(!ended, (el) => withMenu(el, { agent: k }))
        .child(h_flex().w(14).flex_none().justify_center().child(programIcon(k.program, 14, ended ? t.dim : t.foreground) ?? div()))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(panel.agentName(k)))
        .child(div().flex_none().text_color(t.dim).child(machineName(panel.machineOf(k.address))))
        .child(div().flex_1().min_w(0))
        .child(div().id(`tp-wa-${k.address}`).flex_none().text_size(11).text_color(t.dim).child(age)
          .when(ended && Boolean(k.exit_code), (el) => el.tooltip(`exit code ${k.exit_code}`)))
        .when(silent, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`· quiet ${panel.duration(q.written_ago_ms)}`)))
        .child(h_flex().w(14).flex_none().justify_center().child(statusMark(t, ended ? null : w.status))))
      .when(Boolean(line2), (el) => el.child(line2));
  }

  // The workers, as the list shows them: the ones working or waiting listed (three, then "+N more");
  // done, idle and ended ones fold into one line in the list's order ("2 done · 10 idle · 1 ended").
  workers(t, workers, reports, quiet, nowOf, down) {
    const busy = (w) => !["idle", "done", "ended"].includes(w.status ?? "idle");
    // As the list does: a quiet sub-lead whose own workers are busy stays listed.
    const leads = (w) => workers.some((x) => x.t.parent === w.t.address && busy(x));
    const live = workers.filter((w) => busy(w) || ((w.status ?? "idle") === "idle" && leads(w)));
    const idle = workers.filter((w) => (w.status ?? "idle") === "idle" && !leads(w));
    const finished = workers.filter((w) => w.status === "done");
    const ended = workers.filter((w) => w.status === "ended");
    const shown = this.view.more ? live : live.slice(0, SHOW_WORKERS);
    const fold = (id, text, on) => h_flex().id(id).h(22).px(8).items_center().rounded(8).cursor_pointer().text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(on).child(text);
    const failed = ended.filter((w) => w.t.exit_code).length;
    const endedWords = [finished.length ? `${finished.length} done` : null, idle.length ? `${idle.length} idle` : null, ended.length - failed ? `${ended.length - failed} ended` : null,
      failed ? `${failed} failed` : null].filter(Boolean).join(" · ");
    const endedOpen = this.view.open.has("ended");
    const folded = [...finished, ...idle, ...ended];
    return v_flex().gap(6).text_size(12)
      .child(div().px(8).text_size(11).text_color(t.dim).child("Workers"))
      .children(shown.map((w) => this.worker(t, w, reports, quiet, nowOf, down)))
      .when(live.length > shown.length, (el) => el.child(fold("tp-more", `+${live.length - shown.length} more`, (_e, cx) => {
        this.view.more = true;
        this.keepView();
        cx.notify();
      })))
      .when(folded.length > 0, (el) => el.child(fold("tp-ended", endedOpen ? `Hide ${endedWords}` : endedWords, (_e, cx) => this.toggle(this.view.open, "ended", cx))))
      .when(endedOpen, (el) => el.children(folded.map((w) => this.worker(t, w, reports, quiet, nowOf, down))));
  }

  codeDetail(t, repos) {
    const open = (url) => exec(window()?.platform === "macos" ? "open" : "xdg-open", [url]).catch(() => null);
    // A detail line has no chevron, so it holds a few more characters than a row's summary.
    const budget = Math.floor(DETAIL_CHARS * panel.widthScale(this.width, 49));
    const seg = (parts) => {
      const kept = panel.fit(parts.filter(Boolean), budget);
      return h_flex().min_w(0).overflow_hidden().children(kept.flatMap((p, i) => [
        ...(i ? [dot(t)] : []),
        div().text_color(p.color ? t[p.color] : t.muted).child(p.text)
          .when(i < kept.length - 1, (el) => el.flex_none()).when(i === kept.length - 1, (el) => el.min_w(0).truncate()),
      ]));
    };
    // One repo: the row's summary already gives its counts, so line 1 carries the commit age.
    const one = repos.length === 1;
    const blocks = (this.view.moreRepos ? repos : repos.slice(0, SHOW_REPOS)).map((r) => {
      const branch = this.hideText ? "branch hidden" : panel.mask(r.branch ?? "no branch");
      const pr = r.pr;
      const checks = pr?.failing ? { text: `${pr.failing} ${pr.failing === 1 ? "check" : "checks"} failing`, color: "ansi1" } : pr?.running ? { text: "checks running", color: "dim" } : null;
      const commit = r.commit_ago_ms != null ? `last commit ${panel.agoWords(r.commit_ago_ms)}` : null;
      return v_flex().id(`tp-repo-${r.machine}-${r.root}`).px(8).flex_none()
        .child(h_flex().min_w(0).overflow_hidden()
          .child(div().flex_none().text_color(t.foreground).child(r.name))
          .child(dot(t))
          .child(div().id(`tp-br-${r.root}`).min_w(0).truncate().text_color(t.dim).child(branch)
            .when(!this.hideText, (el) => el.tooltip(branch)))
          .when(one && Boolean(commit), (el) => el.child(dot(t)).child(div().flex_none().text_color(t.dim).child(commit))))
        .when(!one, (el) => el.child(seg([
          { text: r.changed ? `${r.changed} changed` : "all committed" },
          panel.pushWords(r) ? { text: panel.pushWords(r) } : r.ahead ? { text: panel.unpushedWords(r.ahead) } : null,
          commit ? { text: commit } : null,
        ])))
        .when(Boolean(pr?.number), (el) => el.child(h_flex().id(`tp-pr-${r.root}`).min_w(0).overflow_hidden()
          .when(Boolean(pr.url), (el) => el.cursor_pointer().on_click(() => open(pr.url)))
          .child(seg([{ text: `PR #${pr.number}` }, pr.state ? { text: pr.state } : null, pr.review ? { text: pr.review } : null, checks]))));
    });
    const rest = repos.length - blocks.length;
    return [v_flex().gap(8).children(blocks), ...(rest > 0 ? [h_flex().id("tp-more-repos").h(22).px(8).items_center().rounded(8).cursor_pointer().text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        this.view.moreRepos = true;
        this.keepView();
        cx.notify();
      })
      .child(`+${rest} more`)] : [])];
  }

  savedDetail(t, link) {
    if (this.hideText) return [div().px(8).text_color(t.dim).child("Text hidden")];
    const open = this.view.expanded.has("next");
    const next = link.next ? panel.mask(link.next) : null;
    return [
      div().px(8).whitespace_normal().text_color(t.foreground).child(panel.mask(link.title ?? link.chain ?? "")),
      ...(next ? [div().id("tp-next").px(8).pt(4).whitespace_normal().cursor_pointer()
        // Two lines plus the 4px above them.
        .when(!open, (el) => el.max_h(40).overflow_hidden())
        .on_click((_e, cx) => this.toggle(this.view.expanded, "next", cx))
        // One run, so wrapped lines return to the text edge (gpui-kit has no inline colour change).
        .child(div().whitespace_normal().child(`Next: ${open ? next : panel.firstSentence(next)}`))] : []),
    ];
  }

  // When the card last read its machines (click: read again), and the one Hide text switch.
  footer(t, d, reads, down, now) {
    const states = Object.values(reads);
    const { text: age, warn, reading } = panel.checkedOf(reads, down, mk(d.machine), now, STALE_MS);
    return h_flex().id("tp-footer").h(32).flex_none().px(14).gap(4).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
      .child(div().id("tp-age").flex_none().text_color(warn ? t.ansi1 : t.dim)
        .when(!reading, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Read again now").on_click((_e, cx) => {
          this.forced = d.key;
          for (const s of states) if (s.missing) s.failedAt = 0;
          cx.notify();
        }))
        .child(age))
      .child(div().id(this.hideText ? "tp-show" : "tp-hide").ml_auto().pl(8).flex_none().cursor_pointer().hover((s) => s.text_color(t.foreground))
        .tooltip(this.hideText ? "Show text in the whole Tower" : "Hide text in the whole Tower")
        .on_click((_e, cx) => this.setHide(!this.hideText, cx))
        .child(this.hideText ? "Show text" : "Hide text"));
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const terms = terminals();
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    const changes = shared(CHANGES) ?? shared("agent-tasks.changes") ?? {};
    const down = new Set(machines().filter((m) => m.layout === "unavailable").map((m) => mk(m.name)));
    let d = this.selected(terms, listed, changes);
    const live = d && !d.gone ? d : null;

    // Another item: rows and texts fold; a cached read shows at once and is re-read if old.
    const shown = panel.blockShown(layout(), MOD);
    if (props()?.solo) this.solo();
    if ((live?.key ?? null) !== this.view.key) {
      const kept = live ? (shared(KEPT_VIEW) ?? {})[live.key] : null;
      this.view = { key: live?.key ?? null, open: new Set(kept?.open ?? []), expanded: new Set(kept?.expanded ?? []), more: Boolean(kept?.more), moreRepos: Boolean(kept?.moreRepos) };
      this.freshen = true;
    }
    if (shown && !this.wasShown) this.freshen = true;
    this.wasShown = shown;

    const root = v_flex().id("tower-panel").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // Narrower than 340px (tower-stack's sidebar): character budgets shrink with the width.
      .on_size_change((size, cx) => {
        if (Math.abs((this.width ?? 0) - size.width) < 1) return;
        this.width = size.width;
        cx.notify();
      })
      .track_focus(this.h);
    if (!live) {
      return root.child(this.header(t, d?.gone ? { title: panel.mask(d.title) } : null))
        .child(div().id("tp-content").px(14).pt(12).whitespace_normal().text_size(12).text_color(t.dim)
          .on_size_change((size) => this.fit(size.height))
          .child(d?.gone ? "Ended" : ""));
    }
    d = { ...live, title: panel.mask(live.title) };
    if (shown) this.schedule(d, terms, down, cx);

    const item = this.item(d.key);
    panel.dropGone(item.machines, new Set(this.groupsOf(d, terms).keys()));
    const leadMachine = d.lead ? panel.machineOf(d.lead.address) : d.machine;
    const leadState = item.machines[mk(leadMachine)] ?? null;
    const leadDown = down.has(mk(leadMachine));
    // Ages on a machine that doesn't answer stop where its last read left them.
    const nowOf = (m) => (down.has(mk(m)) ? item.machines[mk(m)]?.at ?? now : now);
    const reads = Object.fromEntries(Object.entries(item.machines).map(([m, s]) => [m, s]));
    const results = Object.entries(item.machines).filter(([, s]) => s.data)
      .map(([m, s]) => [m, aged(s.data, s.at, down.has(m) ? s.at : now)]);
    const leadRead = results.find(([m]) => m === mk(leadMachine))?.[1].lead ?? null;
    const quiet = new Map(results.flatMap(([, r]) => Object.entries(r.workers)));
    const repos = results.flatMap(([m, r]) => r.repos.map((repo) => ({ ...repo, machine: m })));
    const link = results.find(([m]) => m === mk(leadMachine))?.[1].chain ?? null;
    const remote = machines().map((m) => m.name).filter(Boolean);

    const leadStatus = d.leadRow?.status ?? "ended";
    const leadNow = nowOf(leadMachine);
    const lead = d.leadRow ? { status: leadStatus, at: d.leadRow.at } : null;
    const others = d.workers.some((w) => w.status !== "ended" && w.at && now - w.at < panel.QUIET_MS)
      || [...quiet.values()].some((q) => q.written_ago_ms != null && q.written_ago_ms < panel.QUIET_MS);
    const frozen = leadDown ? { name: machineName(leadMachine) } : null;
    const state = panel.stateLine(lead, leadRead, others, leadNow, frozen);

    // The message slot: what the lead last said, or why there is nothing to show.
    const where = machineName(leadMachine);
    let message;
    if (leadDown && leadState?.at == null) message = null;
    else if (leadState?.missing) message = { text: `No python3 on ${where}`, color: "dim", empty: true };
    else if (leadState?.at == null && leadState?.fails) message = { text: `Couldn't read ${where}: ${leadState.error}`, color: "dim", empty: true, clamp2: true };
    else if (leadState?.at == null && d.lead?.state === "live") message = { text: `Reading ${where}…`, color: "dim", empty: true };
    else message = panel.messageOf(leadStatus, leadRead, d.lead?.state === "live", { program: d.lead?.program?.name, where });
    if (message && !message.empty) message = { ...message, text: panel.mask(message.text) };
    const ask = d.ask ? { ...d.ask, text: panel.mask(d.ask.text) } : null;
    if (ask?.t === d.lead) message = panel.underAsk(message);
    // After a good read, a failed one keeps the old text, dimmed.
    if (message && !message.empty && leadState?.failedAt && leadState.at != null && leadState.failedAt > leadState.at) message = { ...message, color: "dim" };
    // While it works, hc's short line of what it is doing now (never in place of what it said).
    const activity = leadStatus === "working" && !leadDown ? panel.activityWords(d.lead?.report?.msg) : null;

    const ended = panel.endedOf(d.ids, item.ended, terms, d.lead?.address, now)
      .filter((e) => !d.workers.some((w) => w.t.address === e.t.address));
    const RANK = { blocked: 0, working: 1, idle: 2, done: 2, ended: 3 };
    const workers = [...d.workers, ...ended].sort((a, b) => (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2));
    const reports = panel.reportsFor(leadRead?.reports, workers, leadMachine, remote);
    const neverAnswered = leadDown && leadState?.at == null;
    const rowsFollow = workers.length > 0 || (!neverAnswered && (repos.length > 0 || Boolean(link)));
    if (item.clamp === undefined && (leadState?.at != null || d.lead?.state !== "live")) item.clamp = rowsFollow;
    const clamp = item.clamp ?? rowsFollow;

    // The body, top to bottom: what needs you, then the lead, its words, the workers, the rows.
    const body = [];
    let above = null;
    const gapAfter = { needs: { any: 12 }, card: { any: 12 }, state: { message: 4 }, message: { any: 16 }, workers: { any: 16 } };
    const place = (kind, el) => {
      const mt = above ? gapAfter[above]?.[kind] ?? gapAfter[above]?.any ?? 12 : 0;
      body.push(el.mt(mt));
      above = kind;
    };
    const fade = (el) => el.opacity(leadDown ? FADED : 1).transition("opacity", 200);

    // A moment Timeline asked for comes first; the rest of the card stays the present.
    // Only while Timeline is the view: the moment belongs to it.
    const moment = (shared("agent-tower.view")?.view ?? "list") === "timeline" ? shared(MOMENT) ?? null : null;
    if (moment?.key === d.key && moment.address) place("card", this.then(t, d, moment, [...terms, ...ended.map((e) => e.t)], now, cx));
    if (d.needs.length) {
      place("needs", v_flex().gap(8).children(d.needs.map((n) => this.need(t, d, n, nowOf(panel.machineOf(n.t.address)), down.has(mk(panel.machineOf(n.t.address)))))));
    }
    if (ask) {
      place("card", fade(v_flex().id("tp-ask").when(true, (el) => withMenu(el, { agent: ask.t })).px(8).py(8).gap(2).rounded(8).bg(t.raised).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .when(ask.t.state === "live", (el) => el.on_click(() => openAgent(ask.t.address)))
        .child(div().text_size(11).text_color(t.muted).child(["Asks you", ...this.subject(t, d, ask.t)].join(" · ")))
        .child(this.hideText
          ? div().text_size(12).text_color(t.dim).child("Text hidden")
          : wordWrap(ask.text.slice(0, 300)).text_size(13).line_height("19px").text_color(t.foreground))));
    }
    if (state) {
      // "Working for 5m · lead · this computer": the lead's line says whose it is.
      place("state", v_flex().id("tp-state").when(Boolean(d.lead), (el) => withMenu(el, { agent: d.lead })).px(8).gap(2)
        .when(d.lead?.state === "live", (el) => el.cursor_pointer().on_click(() => enter(d.key, d.lead.address)))
        .child(h_flex().h(20).flex_none().items_center().text_size(12)
          .child(div().flex_none().text_size(13).font_medium().text_color(t[state.color] ?? t.muted).child(state.word))
          .when(Boolean(d.lead), (el) => el.children([...this.subject(t, d, d.lead), ...state.meta].flatMap((m, i) => [dot(t),
            div().min_w(0).text_color(m.color ? t[m.color] : t.dim).child(m.text ?? m).when(i > 0, (el) => el.truncate()).when(i === 0, (el) => el.flex_none())]))))
        .when(Boolean(activity) && !this.hideText, (el) => el.child(div().truncate().text_size(12).text_color(t.dim).child(panel.mask(activity ?? "")))));
    }
    if (message) {
      // Under its own Asks you card the lead's message is context: muted, two lines. A click unfolds it.
      const under = ask?.t === d.lead;
      const lines = under ? 2 : 3;
      const scale = panel.widthScale(this.width, 30);
      const cut = (clamp || under) && !message.empty && panel.isCut(message.text, lines, scale);
      const open = this.view.expanded.has("msg");
      const color = under && message.color === "foreground" ? t.muted : t[message.color] ?? t.foreground;
      const text = this.hideText && !message.empty ? null : cut && !open ? panel.folded(message.text, lines, scale) : message.text;
      place("message", fade(div().id("tp-msg").px(8).whitespace_normal().text_size(12).line_height("18px")
        .when(cut, (el) => el.cursor_pointer().on_click((_e, cx) => this.toggle(this.view.expanded, "msg", cx)))
        .when(cut && !open, (el) => el.max_h(lines * 18).overflow_hidden())
        .when(Boolean(message.clamp2), (el) => el.max_h(36).overflow_hidden())
        .child(text == null
          ? div().text_color(t.dim).child("Text hidden")
          : div().whitespace_normal().text_color(color).child(`${message.prefix ?? ""}${text}`))));
    }
    if (workers.length) place("workers", fade(this.workers(t, workers, reports, quiet, nowOf, down)));

    const rows = [];
    if (repos.length && !neverAnswered) rows.push(...this.row(t, "code", panel.codeSummary(repos), () => this.codeDetail(t, repos)));
    if (link && !neverAnswered) {
      const leadAgo = d.leadRow?.at ? leadNow - d.leadRow.at : null;
      rows.push(...this.row(t, "saved", panel.savedSummary(link, leadAgo), () => this.savedDetail(t, link)));
    }
    if (rows.length) place("rows", fade(v_flex().gap(0).children(rows)));

    // Rule 5: a right-click anywhere on the card is the task's menu (an agent's line has its own).
    const task = { key: d.key };
    return root.child(withMenu(this.header(t, d), task))
      .child(withMenu(v_flex().id("tp-body").flex_1().min_h(0).px(6).pt(12).pb(12).overflow_y_scrollbar()
        .child(v_flex().id("tp-content").flex_none().children(body)
          .on_size_change((size) => this.fit(size.height))), task))
      .child(withMenu(this.footer(t, d, reads, down, now), task));
  }
}
