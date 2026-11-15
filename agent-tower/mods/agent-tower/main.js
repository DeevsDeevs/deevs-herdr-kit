// Agent tower: one list of your work, on this computer or any hc machine. A work item is a
// top-level agent, or a labelled lead and its workers; a task is only labels on its terminals.
// Rows, groups, the tree, the status marks and the menu follow Herdr's own agents, spaces and
// menu mods (see NOTICE).

import { View } from "gpui-kit";
import { InputState, Input, ScrollHandle } from "gpui-base";
import { hc as hostHc, exec as hostExec, run as hostRun, notify, knownAgents, terminals as hostTerminals, agents as hostAgents, focused as hostFocused,
  spaces as hostSpaces, machines as hostMachines, panes as hostPanes, theme, props, openOverlay, closeOverlay, home, appHome, readTextFile as hostRead,
  writeTextFile as hostWrite, watchFolder, shared as hostShared, setShared as hostSetShared, window, layout as hostLayout, layouts, nextCommand } from "herdr";
import * as model from "./model.js";
import * as perf from "./perf.js";
import * as adopt from "./adopt.js";
// Built through perf.js, so a render's elements are counted for the perf log.
import { div, svg, image, v_flex, h_flex } from "./perf.js";

// Herdr's reads, once per render: each is a crossing that converts the whole value (the list read
// shared state 84 times and the layout 10 times a render). Outside a render (a click, a timer) they
// read straight through; a write in the render updates what it remembers, and a layout command
// forgets the layout.
let frame = null;
const once = (key, read) => {
  if (!frame) return read();
  if (!frame.has(key)) frame.set(key, read());
  return frame.get(key);
};
const shared = (k) => once(`shared:${k}`, () => hostShared(k));
const setShared = (k, v) => {
  frame?.set(`shared:${k}`, v);
  return hostSetShared(k, v);
};
const terminals = () => once("terminals", hostTerminals);
const agents = () => once("agents", hostAgents);
const spaces = () => once("spaces", hostSpaces);
const panes = () => once("panes", hostPanes);
const machines = () => once("machines", hostMachines);
const focused = () => once("focused", hostFocused);
const layout = () => once("layout", hostLayout);
const run = (command, args) => {
  if (frame) {
    if (String(command).startsWith("layout.")) frame.delete("layout");
    if (String(command).startsWith("pane.") || String(command).startsWith("agent.")) frame.delete("focused");
  }
  return hostRun(command, args);
};
function inFrame(draw) {
  const outer = frame;
  frame ??= new Map();
  try {
    return draw();
  } finally {
    if (!outer) frame = null;
  }
}

// The perf log (off unless the settings say "perf": true), made again whenever the settings are read.
let perfLog = perf.perfLog({ on: false, dir: "", exec: hostExec });
// Every command and file read or write goes through here, timed for the perf log (named by its
// kind and one plain word only: perf.commandName drops addresses, paths and text).
const baseName = (path) => String(path ?? "").split("/").pop();
const timed = (fn, name) => (...a) => {
  if (!perfLog.on) return fn(...a);
  const t0 = perf.now();
  return Promise.resolve(fn(...a)).finally(() => perfLog.command(name(a), perf.now() - t0));
};
const hc = timed(hostHc, (a) => `hc ${a[0]?.[0] ?? ""}`);
const exec = timed(hostExec, (a) => `exec ${a[0]}`);
const readTextFile = timed(hostRead, (a) => `read ${baseName(a[0])}`);
const writeTextFile = timed(hostWrite, (a) => `write ${baseName(a[0])}`);
// A render, timed with the elements it built: for the list, the stage and each view. A render
// inside another (a view in the stage) is counted in both: the outer one carries its count over.
let renderDepth = 0;
let carried = 0;
function timedRender(view, draw) {
  if (!perfLog.on) return draw();
  const before = perf.elements();
  const outer = renderDepth ? carried + before : 0;
  carried = 0;
  renderDepth++;
  const t0 = perf.now();
  let out;
  try {
    out = draw();
  } finally {
    renderDepth--;
  }
  const mine = carried + perf.elements();
  perfLog.render(view, perf.now() - t0, mine);
  carried = renderDepth ? outer + mine : 0;
  return out;
}
import { chrome, statusMark, markSlot, rowMark, programIcon, machineChip, BADGE, RANK, WORD } from "./marks.js";

const START_GIVE_UP_MS = 60 * 1000;
const REQUEST = "agent-tower.request";
// When each terminal last changed, shared by the docked list and the window (each copy of a mod
// gets its own localStorage).
const CHANGES = "agent-tower.changes";
// Which writing of CHANGES is the latest ("<copy id>:<n>"): a reader converts the map only when it moves.
const CHANGES_V = "agent-tower.changesV";
// Done leads without a pane that were clicked here: address -> the change they were seen at.
const SEEN = "agent-tower.seen";
const DONE_SHOWN = 5;
// What the panel mod (agent-tower-panel) shows: the selected item, or null.
const SELECTED = "agent-tower.selected";
// The area the docked list shows, for the panel mod (it clears a selection from another area).
const AREA = "agent-tower.area";
// The item the person clicked, which focus changes do not move: {key, space} or null.
const PIN = "agent-tower.pin";
// When you last left each area ({area: ms}): news in an area is what finished after that.
const AREA_LEFT = "agent-tower.areaLeft";
// The finished-elsewhere signal shown on the area switch: dot, pulse, line or off.
const DONE_SIGNAL = "agent-tower.doneSignal";
const SIGNAL_LABEL = { dot: "Dot by the area name", pulse: "Breathing dot by the area name", line: "Line at the bottom", off: "Off" };
// One "Hide text" for the whole Tower (the card's footer flips it): agents' own words go.
const HIDE_TEXT = "agent-tower.hideText";
const hidden = () => shared(HIDE_TEXT) === true;
// What stands at the left of a task row (model.ROW_MARKS).
const ROW_MARK = "agent-tower.rowMark";
// Where the view switch sits (an experiment, never beside the area words): "bar", above the
// centre (the layout's tower-viewbar block); "menu", one icon in the list's header opening the
// views; "bottom", a row at the foot of the list.
const VIEW_SWITCH = "agent-tower.viewSwitch";
const VIEW_SWITCHES = ["bar", "menu", "bottom"];
// The bar by default (until you pick); a layout without the bar block gets the header icon.
const viewSwitch = () => {
  const v = VIEW_SWITCHES.includes(shared(VIEW_SWITCH)) ? shared(VIEW_SWITCH) : VIEW_SWITCHES[0];
  return v === "bar" && !find(layout(), "tower-viewbar") ? "menu" : v;
};
// The five choices, each a setting you can flip, logged like any variant.
const CHOICES = {
  listInView: { title: "A list row while a view is up", ids: ["into", "peek"], labels: { into: "Goes into the task", peek: "Peeks, the view stays" } },
  agentInView: { title: "An agent clicked in a view", ids: ["into", "peek"], labels: { into: "Goes into its task", peek: "Peeks, the view stays" } },
  otherArea: { title: "A task in another area", ids: ["switch", "stay"], labels: { switch: "Brings its area's window", stay: "Shows it here" } },
  areaMenu: { title: "Right-click on the area row", ids: ["area", "settings"], labels: { area: "The area's menu", settings: "These settings" } },
  doubleClick: { title: "Double-click on a task", ids: ["same", "rename"], labels: { same: "Same as a click", rename: "Renames it" } },
};
const choiceKey = (name) => `agent-tower.choice.${name}`;
const choice = (name) => (CHOICES[name].ids.includes(shared(choiceKey(name))) ? shared(choiceKey(name)) : CHOICES[name].ids[0]);
// The switches you can flip (a right-click on the area row), each flip logged with logUse.
const SWITCHES = [
  { key: DONE_SIGNAL, name: "doneSignal", title: "Done in another area", ids: model.DONE_SIGNALS, labels: SIGNAL_LABEL },
  { key: ROW_MARK, name: "rowMark", title: "Left of a task", ids: model.ROW_MARKS, labels: { state: "Its state", agents: "How many agents work" } },
  { key: VIEW_SWITCH, name: "viewSwitch", title: "Views switch", ids: VIEW_SWITCHES,
    labels: { menu: "One icon in the list's header", bar: "A bar above the centre", bottom: "A row at the foot of the list" } },
  ...Object.entries(CHOICES).map(([name, c]) => ({ key: choiceKey(name), name, ...c })),
];
// Rows and headers of the switches popup, compact: eight sections fit the window.
const SWITCH_ROW = 26;
const SWITCH_HEAD = 22;
// The lead agent last picked in the composer, per recipe: {recipeId: agentId}.
const LEAD_PICK = "agent-tower.leadPick";
// Where tower-new and the mod exchange requests: ~/.config/agent-tower for the Herdr app itself;
// a Herdr with its own app home (a sandbox) keeps its own, so two apps never take one request.
const towerDir = () => (appHome() === `${home()}/.config/herdr-app` ? `${home()}/.config/agent-tower` : `${appHome()}/agent-tower`);
// Every switch of a view or a variant, one JSON line each, so unused ones can be removed.
const useFile = () => `${towerDir()}/use.jsonl`;
// how: what made it ("click", "key", "menu").
function logUse(what, from, to, how = "click") {
  const line = JSON.stringify({ at: new Date().toISOString(), what, from: from ?? null, to, how });
  return exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "%s\\n" "$2" >> "$1"', "use", useFile(), line])
    .then(() => {
      // use.md reads the whole log: made again at most every 10 minutes (and when the list closes).
      if (Date.now() - useSummaryAt < USE_SUMMARY_MS) return;
      useSummaryAt = Date.now();
      return writeUseSummary();
    }).catch(() => null);
}
const USE_SUMMARY_MS = 10 * 60 * 1000;
let useSummaryAt = 0;

// use.md beside the log: what you switched to, how often, and about how long each view was on screen.
async function writeUseSummary() {
  const text = await readTextFile(useFile()).catch(() => null);
  const path = `${towerDir()}/use.md`;
  const old = await readTextFile(path).catch(() => null);
  await writeTextFile(path, model.useSummary(text, Date.now()), old).catch(() => null);
}
// ── Views: the list, and Board and Timeline drawn by the stage copy (props.stage) from the
// same model. agent-tower.view: {view, shape, back}; shape "sidebar" puts the view in the centre
// beside the list (the layout's stack "work-view"), "window" switches to the tower-window layout
// (back: the layout to return to). Switching a view restarts nothing: only the shape is a layout.
const VIEW = "agent-tower.view";
const VIEWS = [
  { id: "list", label: "List", icon: "view-list", key: "ctrl-s s" },
  { id: "board", label: "Board", icon: "view-board", key: "ctrl-s o" },
  { id: "timeline", label: "Timeline", icon: "view-timeline", key: "ctrl-s g" },
  { id: "radar", label: "Radar", icon: "view-radar", key: "ctrl-s r" },
  { id: "watchlist", label: "Watchlist", icon: "view-watchlist", key: "ctrl-s v" },
];
// Offered where an area's settings name no views of their own.
const DEFAULT_VIEWS = ["list", "board", "timeline", "radar"];
// The views an area offers, in its settings' order (the first is where it opens).
function viewsOf(areaId) {
  const a = liveConfig.areas.find((x) => x.id === areaId);
  const ids = Array.isArray(a?.views) && a.views.length ? a.views : DEFAULT_VIEWS;
  return ids.map((id) => VIEWS.find((v) => v.id === id)).filter(Boolean);
}
// The recipes an area's window shows as buttons.
const buttonsOf = (areaId) => {
  const a = liveConfig.areas.find((x) => x.id === areaId);
  return (a?.buttons ?? []).map((id) => liveConfig.recipes.find((r) => r.id === id && r.area === areaId)).filter(Boolean);
};
// Per area, what to come back to: {area: {view, shape, selected, focus}}.
const AREA_MEMORY = "agent-tower.areaMemory";
// After an area switch: what the copies of the new window restore once ({area, selected, focus, at}).
const ARRIVE = "agent-tower.arrive";
// The last layout used that is not an area's own (where an area without one returns to).
const BASE_LAYOUT = "agent-tower.baseLayout";
// One Eye per area (eye-per-area.md): labelled tower.area, TOWER_AREA in its environment. Off, one
// Eye for all areas as before (no tower.area, no TOWER_AREA); an older Eye for all still serves
// every area without its own.
const EYE_PER_AREA = true;
const eyeKey = (area) => (EYE_PER_AREA ? area : "all");
// Eyes starting, by area ({area: ms}), so every copy (the list, the bar alone) dims its start.
const EYE_STARTING = "agent-tower.eyeStarting";
const markEyeStarting = (area, on) => {
  const now = { ...(shared(EYE_STARTING) ?? {}) };
  if (on) now[area] = Date.now();
  else delete now[area];
  setShared(EYE_STARTING, now);
};
// A recipe button pressed: the list opens its composer on it ({recipe, at}).
const COMPOSE = "agent-tower.compose";
// The whole-window shape hides the sidebar column (no restart).
const sidebarHidden = () => Boolean(find(layout(), "sidebar")?.hidden) || shared("layout") === WINDOW_LAYOUT;
const WINDOW_LAYOUT = "tower-window";
const STAGE_STACK = "work-view";
const viewNow = () => ({ view: "list", shape: "sidebar", back: null, ...(shared(VIEW) ?? {}) });
const viewIcon = (name) => svg(`mods/agent-tower/${name}.svg`);
// Timeline's past (model.recordStep): written by one copy at a time (the lease), every 5 s at
// most, merged when another writer changed the file; RECORDED tells Timeline to read it again.
const RECORDED = "agent-tower.recorded";
const recDir = () => `${towerDir()}/timeline`;

// writeTextFile only if the file is as last read; on a conflict, read theirs, merge, write again.
async function writeMerged(path, value, expected, merge, given = null) {
  let text = given ?? JSON.stringify(value);
  try {
    await writeTextFile(path, text, expected);
    return { text, value };
  } catch {
    const theirs = await readTextFile(path).catch(() => null);
    let parsed = null;
    try {
      parsed = theirs ? JSON.parse(theirs) : null;
    } catch {}
    const merged = parsed ? merge(parsed, value) : value;
    text = JSON.stringify(merged);
    await writeTextFile(path, text, theirs);
    return { text, value: merged };
  }
}

// A recorder file. Herdr refuses one over 1 MiB, to read and also to write (a write reads it first),
// so one found over it is read through cat (exec takes 8 MiB), moved aside to <file>.big, and
// returned as big: the caller trims it and writes it anew. {text, big}.
async function readRecorderFile(path) {
  try {
    return { text: await readTextFile(path), big: null };
  } catch (e) {
    if (!/1 MiB/.test(String(e?.message ?? e))) return { text: null, big: null };
    const r = await exec("cat", [path]).catch(() => null);
    await exec("mv", ["-f", path, `${path}.big`]).catch(() => null);
    return { text: null, big: r?.code === 0 ? r.stdout : "" };
  }
}

// Said once per file and session in Herdr's log when a recorder file had to be trimmed.
const trimmedLogged = new Set();
function logTrim(file, gone, why) {
  if (!gone || trimmedLogged.has(file)) return;
  trimmedLogged.add(file);
  console.log(`agent-tower: timeline/${file} ${why}: ${gone} oldest entries trimmed to stay under Herdr's 1 MiB file limit`);
}

// The last layout the docked list started in (for logging tower against tower-stack).
const LAST_LAYOUT = "agent-tower.lastLayout";
// Settings warnings already shown, and when: {key: ms} (once a day each).
const WARNED = "agent-tower.warned";
// A new space was made from the composer's "New space on…" menu: the list closes its composer.
const COMPOSE_CLOSE = "agent-tower.composeClose";
// The list's folds and opened rows: {folded, opened}.
const FOLDS = "agent-tower.folds";
// A composer's words while an area switch restarts the list: {area, text, at}.
const DRAFT = "agent-tower.draft";
// Workers just kept, whose new tab the list names after them: [{address, name}].
const KEPT = "agent-tower.kept";

// The moment Timeline picked ({key, address, at}); another task's selection clears it.
const MOMENT = "agent-tower.moment";

// The layout follows a view and a shape: the whole window hides the sidebar column, the centre's
// stack shows the stage for a view other than the list. Nothing restarts.
function applyShape(view, shape) {
  const sidebar = find(layout(), "sidebar");
  const hide = shape === "window" && (view !== "list" || viewSwitch() === "bar");
  if (sidebar && Boolean(sidebar.hidden) !== hide) run(hide ? "layout.hide" : "layout.show", { id: "sidebar" });
  showStage(view);
}

// Show a view, or a shape: remembered, logged with what made it, the layout following.
function setView(to, how) {
  const cur = viewNow();
  // The way back to a view you came from lasts until you switch by other means.
  const next = { ...cur, from: null, ...to };
  if (next.view === cur.view && next.shape === cur.shape) {
    if (cur.from && !next.from) setShared(VIEW, next);
    return;
  }
  if (next.view !== cur.view) logUse("view", cur.view, next.view, how);
  if (cur.view === "timeline" && next.view !== "timeline" && shared(MOMENT)) setShared(MOMENT, null);
  const was = sidebarHidden();
  const hide = next.shape === "window" && (next.view !== "list" || viewSwitch() === "bar");
  // The shape on screen, whatever made it change (its icon, a view key, List).
  if (was !== hide) logUse("shape", was ? "window" : "sidebar", hide ? "window" : "sidebar", how);
  // The old whole-window layout (tower-window) is left for the layout you came from.
  if (shared("layout") === WINDOW_LAYOUT && !hide) run("layout.switch", { name: [cur.back, shared(BASE_LAYOUT), "tower"].find((n) => n && n !== WINDOW_LAYOUT) });
  else applyShape(next.view, next.shape);
  setShared(VIEW, next);
}

// Another area: what is left is remembered (view, shape, selected task, focused terminal), the
// area's own window opens if it names one (a layout switch: the one restart), and what it was
// left on comes back. how: "click" or "key".
function goArea(to, how) {
  const from = shared(AREA) ?? null;
  if (!to || to === from) return;
  const now = Date.now();
  // Two copies hearing one key (two stages in a window) must not move two areas.
  if (now - (shared(AREA_SWITCHED) ?? 0) < 400) return;
  setShared(AREA_SWITCHED, now);
  const v = viewNow();
  const memory = { ...(shared(AREA_MEMORY) ?? {}) };
  // Only what belongs to the area left is its memory: another area's task or terminal never is.
  const sel = shared(SELECTED);
  const focus = focused()?.terminal ?? null;
  const layoutNow = shared("layout");
  if (from) memory[from] = { view: v.view, shape: v.shape, selected: sel?.area === from ? sel.key : null, focus: focus && areaOfAddress(focus) === from ? focus : null,
    layout: layoutNow && layoutNow !== WINDOW_LAYOUT && !liveConfig.areas.some((x) => x.layout === layoutNow && x.id !== from) ? layoutNow : null };
  setShared(AREA_MEMORY, memory);
  if (from) setShared(AREA_LEFT, { ...(sharedOr(AREA_LEFT) ?? {}), [from]: now });
  logUse("area", from, to, how);
  const offered = viewsOf(to).map((x) => x.id);
  const back = memory[to] ?? {};
  const view = offered.includes(back.view) ? back.view : offered[0] ?? "list";
  const shape = back.shape ?? "sidebar";
  setShared(AREA, to);
  if (v.view === "timeline" && view !== "timeline" && shared(MOMENT)) setShared(MOMENT, null);
  setShared(VIEW, { ...v, view, shape });
  setShared(ARRIVE, { area: to, selected: back.selected ?? null, focus: back.focus ?? null, at: now });
  const want = back.layout ?? liveConfig.areas.find((a) => a.id === to)?.layout ?? shared(BASE_LAYOUT) ?? null;
  if (want && want !== shared("layout") && layouts().includes(want)) run("layout.switch", { name: want });
  else applyShape(view, shape);
}

// When the last area switch happened (one per key, whichever copy hears it).
const AREA_SWITCHED = "agent-tower.areaSwitched";

// The area a terminal's task is shown in, or null.
function areaOfAddress(address) {
  const items = model.workItems(terminals(), new Map(agents().map((a) => [a.address, a.status])), spaces());
  const item = model.itemHolding(items, address);
  return item ? model.itemArea(liveConfig, item) : null;
}

// The next area in the settings' order (ctrl-s a).
function nextArea(how) {
  const areas = liveConfig.areas;
  const at = areas.findIndex((a) => a.id === shared(AREA));
  if (areas.length > 1) goArea(areas[(at + 1) % areas.length].id, how);
}

// A recipe button: the list opens its composer on that recipe (beside it, if the list was hidden).
function pressRecipe(recipe) {
  setShared(COMPOSE, { recipe: recipe.id, at: Date.now() });
  if (sidebarHidden()) setView({ shape: "sidebar" }, "click");
}

// The centre of a sidebar-shape layout follows the view (the list's copy does it on render, so
// it holds after a layout switch too).
function showStage(view) {
  const stack = find(layout(), STAGE_STACK);
  const want = view === "list" ? "main" : "tower-stage";
  if (stack && stack.active !== want && find(stack, want)) run("layout.select", { stack: STAGE_STACK, child: want });
}

const eyeIcon = (size, color) => svg("mods/agent-tower/eye.svg").size(size).flex_none().text_color(color);
const shownSpace = () => spaces().find((s) => s.active)?.id ?? null;
// Task titles by task id, so a title outlives its lead's record.
const TITLES = "agent-tower.titles";
// Before the rename these lived under agent-tasks.*; read them until the new key is written.
const sharedOr = (key) => shared(key) ?? shared(key.replace("agent-tower.", "agent-tasks."));
const pad = (n) => String(n).padStart(2, "0");
const clock = (ms) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;
const here = () => (window()?.platform === "macos" ? "this Mac" : "this computer");

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Herdr's rail: the sidebar goes by its width (agents and spaces mods). A window is never a rail.
const narrow = () => !props()?.overlay && (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;


// A setting in the wrong shape falls back to its default, with a toast saying which.
// The settings file the mod read (else the one it would read first), for the Eye's message.
let settingsFile = null;
// The settings file's text as last read (null: none), to tell when it changed.
let settingsText = null;
// The settings changed and were read again: every copy reads them too ({at}).
const CONFIG_AT = "agent-tower.configAt";
// The settings as last read by this copy (area views and buttons are read outside a View).
let liveConfig = model.DEFAULTS;

async function loadConfig(quiet = false) {
  let own;
  settingsText = null;
  // A sandboxed Herdr (its own app home) reads its own settings first. The mod was called
  // agent-tasks: that settings folder still counts until there is a new one.
  const folders = [...new Set([towerDir(), `${home()}/.config/agent-tower`, `${home()}/.config/agent-tasks`])];
  for (const folder of folders) {
    const file = `${folder}/config.json`;
    // readTextFile gives null for a missing file.
    const text = await readTextFile(file).catch(() => null);
    if (text == null) continue;
    settingsFile = file;
    settingsText = text;
    try {
      own = JSON.parse(text);
    } catch (e) {
      notify({ title: "agent-tower settings were not read", body: `${file} is not valid JSON (${e.message ?? e}); using the built-in settings.`, level: "warning" });
    }
    break;
  }
  const { config, bad } = model.parseConfig(own);
  liveConfig = config;
  if (perfLog.on !== (config.perf === true) || (perfLog.on && perfLog.file !== `${towerDir()}/${perf.FILE}`)) {
    perfLog.flush();
    perfLog = perf.perfLog({ on: config.perf === true, dir: towerDir(), exec: hostExec });
  }
  if (bad.length && !quiet) notify({ title: "Some agent-tower settings were ignored", body: `Not in the expected shape: ${bad.join(", ")}`, level: "warning" });
  return config;
}

// A press on a control is not a window drag. onClick also gets the press (its element's
// bounds, window-relative), kept outside the element since a redraw may come between.
let lastPress = null;
function control(el, onClick) {
  return el
    .cursor_pointer()
    .on_mouse_down("left", (e, cx) => {
      lastPress = e;
      cx.stop_propagation();
    })
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx, lastPress);
    });
}

function iconButton(t, id, name, onClick, tip, on = false, glyph = null) {
  return control(
    h_flex().id(id).size(26).flex_none().items_center().justify_center().rounded(6).text_color(on ? t.foreground : t.dim)
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child((glyph ?? chrome(name)).size(14)),
    onClick,
  );
}

// A space that holds only shells: the terminal icon (a space's letter said nothing about it).
const spaceIcon = (t) => h_flex().size(18).flex_none().items_center().justify_center().child(chrome("terminal").size(14).text_color(t.dim));

// The machines among these addresses that do not answer now, by a fresh `hc machine ls`.
async function silentNow(addresses) {
  const wanted = [...new Set(addresses.map(model.machineOf).filter(Boolean))];
  if (!wanted.length) return [];
  let listed = [];
  try {
    const r = await hc(["machine", "ls", "--json"]);
    if (r.code === 0) listed = JSON.parse(r.stdout).machines ?? [];
  } catch {}
  const layouts = machines();
  return wanted.filter((m) => listed.find((k) => k.name === m)?.state !== "connected"
    || layouts.find((k) => k.name === m)?.layout === "unavailable");
}

const silentWords = (names, what) => `${names.join(", ")} ${names.length === 1 ? "does" : "do"} not answer; nothing was ${what}.`;

// Close on a merged row reaches every member.
const closeAll = (keys, terms) => [...new Set(keys.flatMap((k) => model.closeSet(k, terms)))].sort();

// An agent with a pane is shown in place; one without (a worker started with hc run) opens in
// the list's own peek: Herdr's dialog with this mod as its header, which says on which machine
// and in which task the terminal runs, and keeps it where Keep can work (Herdr's peek can't).
function goTo(address) {
  // A pane in the centre is hidden while a view or the whole window is up: peek there instead.
  const viewUp = viewNow().view !== "list" || sidebarHidden();
  if (!viewUp && hasPane(address)) {
    if (shared(PEEKED)) setShared(PEEKED, null);
    return run("pane.focus", { terminal: address });
  }
  setShared(PEEKED, address);
  openOverlay({ kind: "dialog", width: 0.8, height: 0.8, layout: { type: "column", children: [
    { type: "block", size: { px: 36 }, content: { mod: "agent-tower", props: { peekBar: address } } },
    // Hide text (DE10): Tower's own peek shows no terminal text; Herdr's panes can't be hidden by a mod.
    hidden() ? { type: "block", content: { mod: "agent-tower", props: { textHidden: true } } } : { type: "block", content: { terminal: address } },
  ] } });
}

// Whether a terminal has a pane: an agent's, or any pane showing it (a lead whose program ended and
// left a shell is no agent any more, but its pane is still there).
const hasPane = (address) => agents().some((a) => a.address === address && a.pane) || panes().some((p) => p.terminal === address);

// ── Notifications (notify.md): a tower layout names this mod as its toast ("toast": "agent-tower"),
// so Herdr's toasts and every notify() are drawn here. Its props: {title, body, level, icon, action,
// timeout, overlay}. ──
const isToast = () => {
  const p = props();
  return Boolean(p) && !p.menu && !p.peekBar && !p.paneHead && !p.stage && !p.stageBar && !p.viewBar && p.overlay != null && ("level" in p || "title" in p);
};
const TOAST_DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

// The shipped spaces mod's menu: a popup is as tall as its items; height is only the most.
function openSpaceMenu(spaceId) {
  openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: spaceId } } });
}

// Ctrl-S / from anywhere: the list comes back if it was hidden, and its search opens.
const SEARCH_OPEN = "agent-tower.searchOpen";
function askSearch() {
  if (sidebarHidden()) setView({ shape: "sidebar" }, "key");
  setShared(SEARCH_OPEN, Date.now());
}

// What a view, Details or a peek asks the list to do (paths-grammar.md): {action, key?, address?,
// agent?, moment?, area?, at}. "enter": go into the task (agent: open that one instead of the lead);
// "open": an agent (rule 2, by choice 2); "pick": select only (a moment); "menu": the right-click
// menu of a task, an agent or an area. The copy on screen takes it once: the list, or the stage
// while the list is hidden.
const ACT = "agent-tower.act";
const act = (req) => setShared(ACT, { ...req, at: Date.now() });
// The id of the copy that acts (the list while it shows, else the stage): a menu opened anywhere
// (a view, Details) names it as "from", so its Rename, End… and so on reach a copy that can do them.
// A popup opens only from a click, so menus are opened where the click is, not through ACT.
const ACTOR = "agent-tower.actor";
// The worker shown in a peek, so its row (not the pane behind) is the lit one.
const PEEKED = "agent-tower.peeked";

// Where a task opens: its lead, or (the lead ended) its first live terminal.
const leadOf = (item) => (item?.leadGone ? item.live[0]?.address : item?.lead?.address) ?? null;
const hex32 = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// The task a terminal belongs to (with remembered titles), and its machine's word.
function whereOf(address) {
  const terms = terminals();
  const listed = new Map(agents().map((a) => [a.address, a.status]));
  const items = model.workItems(terms, listed, spaces());
  model.rememberTitles(items, sharedOr(TITLES) ?? {}, terms);
  const item = model.itemHolding(items, address);
  return { item, title: item ? model.titleOf(item) : null, machine: model.machineOf(address), word: model.machineOf(address) ?? here(),
    t: terms.find((x) => x.address === address) ?? null, status: listed.get(address) ?? terms.find((x) => x.address === address)?.status ?? null };
}

export default class AgentTasks extends View {
  init(_props, cx) {
    this.h = cx.focus_handle();
    if (isToast()) return;
    if (props()?.menu) return this.initMenu();
    if (props()?.peekBar || props()?.paneHead) return this.initHead();
    if (props()?.stage) return this.initStage(cx);
    if (props()?.textHidden) return;
    if (props()?.stageBar || props()?.viewBar) {
      this.initEyeStart();
      cx.spawn(async (cx) => {
        this.config = await loadConfig();
        cx.notify();
      });
      return;
    }
    this.id = model.newId();
    this.config = model.DEFAULTS;
    // The area survives a restart (a layout switch, a reload): the docked list publishes it.
    this.area = shared(AREA) ?? null;
    this.recipeChoice = {};
    this.eyeDrafts = {}; // the Eye composer's words per area
    this.listedMachines = [];
    this.reach = [];
    this.pending = [];
    this.busy = false; // a send to the Eye or a start from the composer is in flight
    this.chosen = null; // the chip picked since the composer opened
    this.starting = new Set(); // names whose start is between the checks and space.new
    this.skillAt = new Map(); // machine -> Promise<whether the skill is there>
    this.looker = null;
    // Explicit folds and opens, by group id or item key; an item's tree otherwise opens only while
    // something in it works or waits.
    // Kept in shared state, so an area switch (a restart) keeps them.
    const folds = shared(FOLDS);
    // Earlier is open unless closed: long-lived tasks are a glance away, no fold to discover.
    // Folds kept from before (no earlierShown) open it once; a close after that is kept.
    const folded = folds?.folded ?? ["spaces", "done-more", "leftover"];
    this.folded = new Set(folds?.earlierShown ? folded : folded.filter((f) => f !== "earlier"));
    this.opened = new Set(folds?.opened ?? []);
    this.reconnecting = {};
    this.copiedLogin = null;
    this.menuFor = null; // the row whose menu is open: its tooltip waits until the pointer leaves
    this.lastFocus = undefined; // the focus the selection last followed
    this.lastShown = undefined; // the space on screen at the last render
    this.renaming = null;
    this.renamedTasks = new Set();
    this.refreshingMachines = false;
    this.scroll = ScrollHandle.new();
    // Search: every item in every area, group and fold (ctrl-s / or the magnifier).
    this.searching = false;
    this.searchInput = InputState.new({ placeholder: "Tasks, agents, machines" });
    this.searchInput.on("change", (_e, cx) => cx.notify());
    this.scrolledFor = null; // the selection and card size the list last scrolled to
    this.input = InputState.new({ placeholder: "What needs doing?" });
    this.input.on("submit", (_e, cx) => this.start(cx));
    this.eyeInput = InputState.new({ placeholder: "Tell the Eye" });
    this.eyeInput.on("submit", (_e, cx) => this.start(cx));

    this.eye = null;
    this.composeTo = "lead";
    this.renameInput = InputState.new({});
    this.renameInput.on("submit", (_e, cx) => this.saveRename(cx));
    // Opened as a window it starts with the composer and the keyboard; docked it never takes the keyboard by itself.
    this.composing = Boolean(props()?.overlay);
    // Words left in the composer by an area switch (the last copy's close) come back.
    const draft = shared(DRAFT);
    if (!props()?.overlay && (draft?.text || draft?.eyeText) && Date.now() - draft.at < 10 * 60000) {
      this.composing = Boolean(draft.text) || draft.area === this.area;
      if (draft.text) this.input.set_value(draft.text);
      // The Eye's words wait for their own area: here now, or when it is shown again.
      if (draft.eyeText) {
        this.eyeDrafts[draft.area] = draft.eyeText;
        if (draft.area === this.area) this.eyeInput.set_value(draft.eyeText);
      }
    }
    if (this.composing) {
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    }
    cx.spawn(async (cx) => {
      this.config = await loadConfig();
      this.area ??= this.config.areas.find((a) => a.layout && a.layout === shared("layout"))?.id ?? null;
      this.configLoaded = true;
      // A settings warning shows once a day, from the docked list (it restarts on area switches).
      const warned = { ...(shared(WARNED) ?? {}) };
      const once = (key) => {
        if (props()?.overlay || Date.now() - (warned[key] ?? 0) < 86400000) return false;
        warned[key] = Date.now();
        return true;
      };
      // A recipe's argv quietly wins over its lead and roles.lead (README, Settings).
      for (const label of model.argvRecipes(this.config)) if (once(`argv:${label}`)) notify({ title: `Recipe ${label}: argv overrides lead`, level: "warning" });
      // A recipe naming an agent the settings don't have.
      for (const label of model.unknownEyeAgents(this.config).filter((l) => once(`eye-agent:${l}`))) {
        notify({ title: `${label}'s Eye: unknown agent`, level: "warning" });
      }
      for (const label of model.unknownAgents(this.config).filter((l) => once(`agent:${l}`))) {
        notify({ title: `Recipe ${label}: unknown agent`, level: "warning" });
      }
      if (JSON.stringify(warned) !== JSON.stringify(shared(WARNED) ?? {})) setShared(WARNED, warned);
      cx.notify();
    });
    // The app's program table, for the agent picker's icons.
    cx.spawn(async (cx) => {
      this.programs = await knownAgents().catch(() => []);
      cx.notify();
    });
    cx.timer.every(60000, (cx) => cx.notify());
    this.refreshMachines(cx);
    cx.timer.every(30000, (cx) => {
      perfLog.flush();
      if (!props()?.overlay) this.checkSettings(cx);
      // An agent opened in a tab of a space whose one task came from New space or adopt joins it
      // (adopt.js); the docked list asks once per agent.
      if (!props()?.overlay) {
        for (const [a, ...pairs] of adopt.joinLabels({ terms: terminals(), spaces: spaces() })) {
          if ((this.joined ??= new Set()).has(a)) continue;
          this.joined.add(a);
          this.label(cx, a, pairs, "An agent could not join its space's task");
        }
      }
      // Herdr in the background: the machines every 2 minutes, not every 30 s.
      this.machineTick = (this.machineTick ?? 0) + 1;
      if (window()?.active || this.machineTick % 4 === 0) this.refreshMachines(cx);
    });
    // Only the docked list reads the inbox (a window comes and goes).
    if (!props()?.overlay) {
      this.watchInbox(cx);
      this.startRecorder(cx);
    }
    // Keys: "agent-tower.search" opens the search.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "search" && (props()?.overlay || !sidebarHidden())) this.openSearch(cx);
        // In the whole-window shape the stage takes the view and area keys.
        else if (!props()?.overlay && !sidebarHidden()) this.viewKey(c);
      }
    });
  }

  // The settings file, every 30 s from the docked list: changed (or new, or gone), it is read again
  // here, and the other copies follow (one shared value, only on a change).
  checkSettings(cx) {
    if (this.checkingSettings) return;
    this.checkingSettings = true;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(settingsFile ?? `${towerDir()}/config.json`).catch(() => null);
        if (text === settingsText) return;
        this.config = await loadConfig();
        this.configAt = Date.now();
        setShared(CONFIG_AT, this.configAt);
        cx.notify();
      } finally {
        this.checkingSettings = false;
      }
    });
  }

  // A hung machine link can hang `hc machine ls`; never stack a second one behind it.
  refreshMachines(cx) {
    if (this.refreshingMachines) return;
    this.refreshingMachines = true;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) {
          const next = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
          // Drawn again only when something about the machines changed.
          if (JSON.stringify(next) !== JSON.stringify(this.listedMachines)) {
            this.listedMachines = next;
            cx.notify();
          }
        }
      } catch {}
      this.refreshingMachines = false;
    });
  }

  // The lookup and labelling stop with the view; label what can be found now, warn about the rest.
  async close() {
    perfLog.flush();
    // A peek that closes is no longer what is shown.
    if (props()?.peekBar && shared(PEEKED) === props().peekBar) setShared(PEEKED, null);
    // A composer open with words in it: they come back in the next copy (an area switch).
    // The Eye's words too, for the area they were typed in (another area's Eye never gets them).
    if (this.composing && !props()?.overlay && (this.input?.value().trim() || this.eyeInput?.value().trim())) {
      setShared(DRAFT, { area: this.composeArea ?? this.area, text: this.input.value(), eyeText: this.eyeInput.value(), at: Date.now() });
    }
    // The inbox lease goes at once, so the next copy takes the requests.
    if (this.inboxKeeper?.held()) await this.inboxKeeper.release();
    // The recorder: write what is pending and let the next copy take over at once.
    if (this.holdsRecorder()) {
      // The last line before a restart or a quit: use.md's time stops here, not at the line before.
      await logUse("beat", null, null, null);
      await this.flushRecord(true).catch(() => null);
      await this.recKeeper.release();
    }
    // use.md with the last beat line in it.
    if (!props()?.overlay && !props()?.stage && useSummaryAt) await writeUseSummary().catch(() => null);
    if (!this.pending?.length) return;
    const terms = terminals();
    const spaceList = spaces();
    const labelling = [];
    for (const p of this.pending.filter((p) => !p.found)) {
      const found = model.findLead(p, spaceList, terms);
      if (found) labelling.push(hc(["label", found.terminal.address, ...model.leadPairs(p)]).catch(() => null));
      else notify({ title: "A task may start unlabelled", body: `"${p.name}" was still starting when the window closed, so it won't show as a task.`, level: "warning" });
    }
    await Promise.all(labelling);
  }

  dismiss() {
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
  }

  go(address) {
    goTo(address);
    this.dismiss();
  }

  label(cx, address, pairs, failure) {
    cx.spawn(async () => {
      const r = await hc(["label", address, ...pairs]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) notify({ title: failure, body: model.errorWords(r), level: "error" });
    });
  }

  shownArea() {
    const areas = this.config.areas;
    return areas.find((a) => a.id === this.area) ?? areas.find((a) => a.default) ?? areas[0];
  }

  // The lead agent a start with this recipe uses (model.leadAgent), with your last pick for it.
  leadFor(recipe) {
    return model.leadAgent(this.config, recipe, (shared(LEAD_PICK) ?? {})[recipe.id]);
  }

  chosenRecipe(area) {
    const recipes = this.config.recipes.filter((r) => r.area === area);
    return recipes.find((r) => r.id === this.recipeChoice[area]) ?? recipes[0] ?? null;
  }

  // While an Eye runs the composer opens on it; a recipe chip applies until it closes.
  openComposer(cx) {
    this.composing = true;
    this.chosen = null;
    this.composeTo = model.composeMode(null, Boolean(this.eye));
    (this.composeTo === "eye" ? this.eyeInput : this.input).focus();
    cx.notify();
  }

  closeComposer(cx) {
    this.composing = false;
    this.input.set_value("");
    if (shared(DRAFT)) setShared(DRAFT, null);
    cx.notify();
  }

  // Enter in the composer: to the Eye, or a lead from the chosen recipe.
  // One send or start at a time: while one is in flight Enter does nothing (the input dims).
  start(cx) {
    if (this.busy) return;
    if (this.composeTo === "eye") return this.tellEye(cx);
    const words = model.oneLine(this.input.value());
    const recipe = this.chosenRecipe(this.shownArea()?.id);
    if (!words || !recipe) return;
    this.busy = true;
    cx.notify();
    this.startTask(cx, recipe, words, null, {
      launched: (cx) => {
        this.busy = false;
        this.closeComposer(cx);
      },
      reply: (a) => {
        if (!a.ok) this.busy = false;
      },
    });
  }

  // What adopt.js reads and how it labels (tower-adopt through the inbox, and the row menu's "Make a task").
  adoptEnv() {
    return { terms: terminals(), spaces: spaces(), agents: agents(), config: this.config, now: Date.now(), changes: this.changes, home: home(),
      label: (a, pairs) => hc(["label", a, ...pairs]) };
  }

  // The one start path, for the composer and for the inbox. reply gets {ok, task, lead} once the
  // lead is labelled, or {ok: false, why}; launched runs when the space is asked for. Refusals
  // toast as before.
  startTask(cx, recipe, words, agentId, { reply = () => {}, launched = () => {} } = {}) {
    // Herdr stores a space name trimmed; findLead compares names exactly.
    const name = words.replace(/\s+/g, " ").slice(0, 40).trim();
    if (this.pending.some((p) => p.name === name) || this.starting.has(name)) {
      notify({ title: "That task is still starting", body: "Wait for it, or use other words.", level: "warning" });
      reply({ ok: false, why: "a task with these words is still starting" });
      return;
    }
    const machine = recipe.machine ?? null;
    this.starting.add(name);
    cx.spawn(async (cx) => {
      // The settings as they are now: a role or recipe changed since Herdr started counts.
      this.config = await loadConfig();
      recipe = this.config.recipes.find((r) => r.id === recipe.id) ?? recipe;
      // Never start on a machine that does not answer: say so and keep the words.
      const silent = machine ? await silentNow([`${machine}/x`]) : [];
      if (silent.length) {
        notify({ title: "The task didn't start", body: silentWords(silent, "started"), level: "error" });
        // The words were the composer's; it wants them back.
        reply({ ok: false, why: silentWords(silent, "started") });
      } else {
        const skill = await this.skillOn(machine);
        const id = await this.launch(cx, recipe, words, name, agentId, reply, skill);
        launched(cx, id);
      }
      this.starting.delete(name);
      cx.notify();
    });
  }

  // Whether the skill (for the Eye: its Eye part) is on that machine, asked once per machine
  // and kept for the session; a check that could not run is asked again next time.
  skillOn(machine, eye = false) {
    const args = model.skillCheck(this.config.skill, eye);
    if (!args) return Promise.resolve(false);
    const key = `${eye ? "eye:" : ""}${machine ?? ""}:${this.config.skill}`;
    if (!this.skillAt.has(key)) {
      this.skillAt.set(key, exec("sh", args, { on: machine, timeout: 20000 })
        .then((r) => r.code === 0)
        .catch(() => {
          this.skillAt.delete(key);
          return false;
        }));
    }
    return this.skillAt.get(key);
  }

  // skill: whether the skill is on the lead's machine; without it the lead gets the full contract.
  async launch(cx, recipe, words, name, agentId, reply, skill) {
    const id = model.newId();
    const machine = recipe.machine ?? null;
    const lead = model.leadAgent(this.config, recipe, agentId ?? (shared(LEAD_PICK) ?? {})[recipe.id]);
    const worker = await this.workerCommand(machine, model.workerAgent(this.config, recipe));
    this.pending.push({ id, name, words, machine, recipe: recipe.id, area: recipe.area, lead: lead.id, reply, before: new Set(spaces().map((s) => s.id)), at: Date.now(), found: false });
    run("space.new", {
      name,
      ...(recipe.folder ? { folder: recipe.folder } : {}),
      machine: machine ?? "",
      // Its task id and its workers' command in its environment (the skill reads them there).
      argv: model.withEnv({ TOWER_TASK: id, TOWER_WORKER: worker }, lead.argv),
      task: model.firstMessage(recipe, this.config, id, words, skill),
    });
    this.looker ??= cx.timer.every(1500, (cx) => this.lookForLeads(cx));
    return id;
  }

  // The workers' command for a lead on that machine: the path of a small script that runs the
  // agent's argv (model.workerScript), written there (this computer: the tower folder's bin/;
  // another: ~/.config/agent-tower/bin/ in its home). If it can't be written, the argv as text.
  async workerCommand(machine, agent) {
    const script = 'd="${2:-$HOME/.config/agent-tower/bin}"; mkdir -p "$d" && printf "%s" "$3" > "$d/$1" && chmod +x "$d/$1" && printf "%s" "$d/$1"';
    const dir = machine ? "" : `${towerDir()}/bin`;
    const r = await exec("sh", ["-c", script, "w", model.workerFile(agent.id), dir, model.workerScript(agent.argv)], { on: machine, timeout: 15000 }).catch(() => null);
    return r?.code === 0 && r.stdout.trim() ? r.stdout.trim() : model.shellQuote(agent.argv);
  }

  lookForLeads(cx) {
    const terms = terminals();
    const spaceList = spaces();
    const now = Date.now();
    const fail = (p, why) => {
      p.failed = true;
      if (p.eye) markEyeStarting(p.eye, false);
      notify({ title: p.eye ? "The Eye didn't start" : "The task didn't start", body: why, level: "error" });
      p.reply?.({ ok: false, why });
    };
    for (const p of this.pending) {
      const found = p.found ? null : model.findLead(p, spaceList, terms);
      if (found) {
        p.found = true;
        this.labelLead(cx, p, found);
      } else if (p.machine && this.reach.some((m) => m.name === p.machine && !m.reachable)) {
        // Its machine stopped answering: the start has failed, no need to wait out the minute.
        fail(p, `${p.machine} does not answer.`);
      } else if (!p.found && now - p.at > START_GIVE_UP_MS) {
        // A labelled lead shows as an item within a second; one still pending by now has gone.
        fail(p, `No terminal showed up for "${p.name}" within a minute.`);
      }
    }
    this.pending = this.pending.filter((p) => !p.failed && !p.done);
    if (!this.pending.length) {
      this.looker.cancel();
      this.looker = null;
    }
    cx.notify();
  }

  // One label call: a lead's task labels, or an Eye's tower.eye=1 and tower.area (an Eye is not named).
  labelLead(cx, p, { space, terminal }) {
    cx.spawn(async (cx) => {
      const r = await hc(["label", terminal.address, ...(p.eye ? ["tower.eye=1", ...(p.eyeArea ? [`tower.area=${p.eyeArea}`] : [])] : model.leadPairs(p))])
        .catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) {
        this.pending = this.pending.filter((x) => x !== p);
        notify({ title: p.eye ? "Couldn't label the Eye" : "Couldn't label the new lead", body: model.errorWords(r), level: "error" });
        p.reply?.({ ok: false, why: `the lead started but could not be labelled: ${model.errorWords(r)}` });
        cx.notify();
        return;
      }
      p.reply?.({ ok: true, task: p.id, lead: terminal.address });
      if (p.eye) markEyeStarting(p.eye, false);
      if (!p.eye && !p.reply) this.selectNew = p.id;
      if (p.eye) {
        p.done = true;
        cx.notify();
        return;
      }
      await this.nameTask(p.id, terminal.address, space.id, p.words);
    });
  }

  // ── The Eye ──

  // "Start": the shown area's Eye, a space named "Eye · <area>" on this computer in its folder, its
  // agent (the area's own, else roles.eye) and its first message, with TOWER_AREA in its
  // environment; its terminal is then labelled tower.eye=1 tower.area=<area>. Only from Start.
  // The skill form only when the skill on this computer has an Eye part; else the full text.
  startEye(cx, area = this.shownArea()?.id) {
    if (!area || this.eyeStarting(area) || model.eyeOff(this.config ?? liveConfig, area)) return;
    const key = eyeKey(area);
    const own = EYE_PER_AREA ? area : null;
    this.starting.add(`Eye:${key}`);
    markEyeStarting(key, true);
    cx.spawn(async (cx) => {
      // The settings as they are now (you may have switched its agent since Herdr started).
      this.config = await loadConfig();
      const skill = await this.skillOn(null, true);
      const agent = model.eyeAgentOf(this.config, own);
      // A folder of its own (per area: the tower folder's eye/<area>), unless the settings name one.
      const dir = towerDir();
      const folder = (own ? model.eyeFolder(this.config, own, dir) : this.config.eye.folder ?? `${dir}/eye`).replace(/^~(?=\/|$)/, home());
      const name = own ? `Eye · ${model.areaLabel(this.config, own)}` : "Eye";
      await exec("mkdir", ["-p", folder]).catch(() => null);
      // The start command and the settings go in its environment, not in the message you read.
      const argv = model.withEnv({
        TOWER_NEW: `${appHome()}/mods/agent-tower/tower-new`,
        TOWER_CONFIG: settingsFile ?? `${dir}/config.json`,
        AGENT_TOWER_DIR: dir === `${home()}/.config/agent-tower` ? null : dir,
        TOWER_AREA: own,
      }, agent.argv);
      this.pending.push({ id: model.newId(), eye: key, eyeArea: own, name, words: name, machine: null, before: new Set(spaces().map((s) => s.id)), at: Date.now(), found: false });
      run("space.new", { name, folder, machine: "", argv, task: model.eyeMessage(skill ? this.config : { ...this.config, skill: null }, own) });
      this.looker ??= cx.timer.every(1500, (cx) => this.lookForLeads(cx));
      this.starting.delete(`Eye:${key}`);
      cx.notify();
    });
  }

  // Ends the Eye's terminal only; no task is touched.
  async endEye(address) {
    await hc(["kill", address]).catch(() => null);
    const r = await hc(["rm", address]).catch(() => null);
    if (r && r.code !== 0 && terminals().some((t) => t.address === address)) {
      notify({ title: "Couldn't end the Eye", body: model.errorWords(r), level: "error" });
    }
  }

  // What you typed, to the Eye, with hc send (never --force; "--" so a leading dash is text).
  // Nothing is sent while the Eye waits, while it starts, or when it runs no agent (a shell
  // would run the words); the text stays and the hint says why.
  tellEye(cx) {
    const text = model.oneLine(this.eyeInput.value());
    const eye = this.eye;
    if (!text || !eye || this.busy) return;
    if (model.eyeAgent(eye, Date.now(), this.changes ?? new Map()) !== "ok") return;
    if (model.eyeWait(eye, new Map(agents().map((a) => [a.address, a.status]))) === "open") return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["send", "--", eye.address, text]).catch((e) => ({ code: 1, stderr: String(e) }));
      this.busy = false;
      if (r.code !== 0) notify({ title: "Not sent to the Eye. Your text is kept.", body: model.errorWords(r), level: "error" });
      else {
        this.eyeInput.set_value("");
        this.closeComposer(cx);
      }
      cx.notify();
    });
  }

  // ── The inbox: requests to start a task (tower-new writes them). Only the docked copy holding
  // the lease acts; each request is taken once, deleted, and answered in the outbox. ──

  watchInbox(cx) {
    const dir = towerDir();
    this.inboxKeeper = model.leaseKeeper({ path: `${dir}/inbox.lease`, id: this.id, read: (p) => readTextFile(p), write: writeTextFile });
    cx.timer.every(5000, (cx) => this.inboxTick(cx));
    this.inbox = `${dir}/inbox`;
    this.outbox = `${dir}/outbox`;
    this.handled = new Set();
    cx.spawn(async (cx) => {
      // Only you may read or write requests and answers: 0700, narrowed when it is wider.
      await exec("mkdir", ["-p", "-m", "700", this.inbox, this.outbox]).catch(() => null);
      await exec("chmod", ["700", this.inbox, this.outbox]).catch(() => null);
      await this.readInbox(cx);
      for (;;) {
        const paths = await watchFolder(this.inbox).catch(() => new Promise((ok) => cx.timer.after(10000, () => ok(null))));
        // Only the requests in the batch are read; a batch with none (a removal, a stray file) does nothing.
        const batch = model.inboxBatch(paths, this.inbox);
        if (batch && !batch.length) continue;
        await this.readInbox(cx, batch);
      }
    });
  }

  // One read at a time (the watch and the tick both call this); a call meanwhile reads again after,
  // the paths asked for meanwhile together (paths null: the whole folder).
  async readInbox(cx, paths = null) {
    this.inboxAll ||= paths == null;
    this.inboxPaths = new Set([...(this.inboxPaths ?? []), ...(paths ?? [])]);
    if (this.readingInbox) {
      this.readAgain = true;
      return;
    }
    this.readingInbox = true;
    try {
      do {
        this.readAgain = false;
        const want = this.inboxAll ? null : [...this.inboxPaths];
        this.inboxAll = false;
        this.inboxPaths = new Set();
        await this.readInboxOnce(cx, want);
      } while (this.readAgain);
    } finally {
      this.readingInbox = false;
    }
  }

  // The inbox lease lives in <tower folder>/inbox.lease, outside the watched inbox (a write in it
  // would wake the watch): model.leaseKeeper, a compare-and-swap file, so no mod redraws. Every 5 s:
  // the holder renews it when due and reads the whole folder when a read was missed (a lost lease
  // write, a failed find, a request that landed while it was busy); a copy without it tries to take
  // it every 10 s (one left by a copy gone without closing is free after 20 s), then reads it all.
  inboxTick(cx) {
    const keeper = this.inboxKeeper;
    if (keeper.held()) {
      if (keeper.due()) keeper.take();
      if (this.inboxMissed) {
        this.inboxMissed = false;
        this.readInbox(cx);
      }
    } else if ((this.inboxTicks = (this.inboxTicks ?? 0) + 1) % 2 === 0) {
      keeper.take().then((ok) => ok && this.readInbox(cx));
    }
  }

  async readInboxOnce(cx, want = null) {
    if (want && !want.length) return;
    // Without the lease the batch is not read here: the holder reads the whole folder on its tick.
    if (!(await this.inboxKeeper.take())) {
      this.inboxMissed = true;
      return;
    }
    const now = Date.now();
    // Answers nobody fetched go after ten minutes (swept at most every ten).
    if (now - (this.outboxSwept ?? 0) > model.ANSWER_KEEP_MINUTES * 60000) {
      this.outboxSwept = now;
      await exec("find", [this.outbox, "-maxdepth", "1", "-type", "f", "-name", "*.json", "-mmin", `+${model.ANSWER_KEEP_MINUTES}`, "-delete"]).catch(() => null);
    }
    // Regular files only: a link or a folder is never followed or read. The whole folder, or just
    // the requests a watch batch named.
    const r = await exec("find", want ? [...want, "-maxdepth", "0", "-type", "f"] : [this.inbox, "-maxdepth", "1", "-type", "f", "-name", "*.json"]).catch(() => null);
    // A find that failed reads again on the tick (a batch naming removed paths is not a failure).
    if (!r) this.inboxMissed = true;
    const paths = (r?.stdout ?? "").split("\n").filter((p) => p && !p.split("/").pop().startsWith("."));
    // A request may have landed while these were handled (the watch tells only copies waiting then).
    if (paths.length) this.inboxMissed = true;
    for (const path of paths) {
      const name = path.split("/").pop();
      const id = name.slice(0, -5);
      const answer = (a) => this.answerRequest(id, a);
      const drop = () => exec("rm", ["-f", path]).catch(() => null);
      if (this.handled.has(id)) {
        await drop();
        answer({ ok: false, why: "already handled" });
        continue;
      }
      this.handled.add(id);
      // readTextFile gives null past 1 MiB.
      const text = await readTextFile(path).catch(() => null);
      if (text == null || text.length > model.REQUEST_MAX_BYTES) {
        await drop();
        answer({ ok: false, why: "too big" });
        continue;
      }
      let req = null;
      try {
        req = JSON.parse(text);
      } catch {}
      let at = typeof req?.at === "number" ? req.at : null;
      if (at == null) {
        const d = await exec("date", ["-r", path, "+%s"]).catch(() => null);
        at = d?.code === 0 ? Number(d.stdout.trim()) * 1000 : now;
      }
      await drop();
      // tower-adopt: existing spaces and agents made tasks (adopt.js), answered in the outbox.
      if (req?.adopt) {
        answer(await adopt.runAdopt(req.adopt, this.adoptEnv()));
        continue;
      }
      const checked = model.checkRequest(req, this.config, now - at);
      if (!checked.ok) answer({ ok: false, why: checked.why });
      // Answered as soon as the lead's space is asked for (an agent's tool may wait only seconds);
      // a later failure shows in the list.
      else this.startTask(cx, checked.recipe, checked.words, checked.agent, {
        reply: (a) => {
          if (!a.ok && !this.answered?.has(id)) answer(a);
        },
        launched: (_cx, task) => {
          (this.answered ??= new Set()).add(id);
          answer({ ok: true, task, starting: true });
        },
      });
    }
    cx.notify();
  }

  // The answer file, replacing one already there (a second request with the same id).
  async answerRequest(id, a) {
    const path = `${this.outbox}/${id}.json`;
    const text = `${JSON.stringify(a)}\n`;
    const ok = await writeTextFile(path, text, null).then(() => true).catch(() => false);
    if (ok) return;
    const old = await readTextFile(path).catch(() => null);
    if (old != null) await writeTextFile(path, text, old).catch(() => null);
  }

  // A small model names the task; your words stay when it fails or you renamed it meanwhile.
  // renamedTasks covers a rename terminals() doesn't show yet.
  async nameTask(taskId, address, spaceId, words) {
    const namer = this.config.roles.namer;
    // stdin closed: a namer that also reads stdin (claude -p) would wait for it, then fail.
    const r = await exec("sh", ["-c", '"$@" </dev/null', "sh", namer[0], ...model.namerArgs(namer, model.namePrompt(words))], { timeout: 60000 })
      .catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
    const name = r?.code === 0 ? model.acceptName(r.stdout) : null;
    // A failed naming leaves your words as the title; said once per session in Herdr's log.
    if (!name && !this.namerFailed) {
      this.namerFailed = true;
      console.log(`agent-tower: the namer gave no name (exit ${r?.code}): ${(r?.stderr || r?.stdout || "").trim().split("\n").pop()}`);
    }
    if (!name || this.renamedTasks.has(taskId)) return;
    // A rename meanwhile set task.by to "you"; a label written a moment ago may not show yet.
    const by = terminals().find((t) => t.address === address)?.labels?.["task.by"];
    if (by && by !== "raw") return;
    const w = await hc(["label", address, `task.title=${name}`, "task.by=llm"]).catch(() => null);
    if (w?.code === 0 && !this.renamedTasks.has(taskId)) {
      this.rememberTitle(taskId, name);
      run("space.rename", { id: spaceId, name });
    }
  }

  beginRename(key, cx) {
    const item = this.items?.find((i) => i.key === key);
    if (!item?.lead) return;
    this.renaming = key;
    const title = model.titleOf(item);
    this.renameInput.set_value(title);
    this.renameInput.focus();
    // The closing menu hands the keyboard back to the pane under it; take it after that, once the
    // input is drawn and can hold a selection.
    cx.timer.after(150, () => {
      this.renameInput.focus();
      this.renameInput.set_selected_range({ start: 0, end: title.length });
    });
    cx.notify();
  }

  endRename(cx) {
    this.renaming = null;
    if (props()?.overlay) this.input.focus();
    cx.notify();
  }

  // A labelled lead gets a new title; an unlabelled agent becomes a task's lead, in one label call.
  // Its space takes the name too when no other item lives there.
  saveRename(cx) {
    const item = this.items?.find((i) => i.key === this.renaming);
    const title = model.capTitle(this.renameInput.value().trim());
    this.endRename(cx);
    if (!item?.lead || !title) return;
    const taskId = item.taskId ?? model.newId();
    this.renamedTasks.add(taskId);
    const pairs = item.taskId
      ? [`task.title=${title}`, "task.by=you"]
      : [`task.id=${taskId}`, "task.role=lead", `task.title=${title}`, "task.by=you"];
    this.label(cx, item.lead.address, pairs, "Couldn't rename");
    this.rememberTitle(taskId, title);
    const alone = item.space && !this.items.some((i) => i !== item && i.space?.id === item.space.id);
    if (alone) run("space.rename", { id: item.space.id, name: title });
  }

  rememberTitle(taskId, title) {
    setShared(TITLES, { ...(sharedOr(TITLES) ?? {}), [taskId]: title });
  }

  // Only what the person confirmed: the terminals counted in the menu that still belong to its
  // items, and none at all if any of their machines does not answer (never half a task).
  closeItem(request, cx) {
    const still = new Set(closeAll(request.keys, terminals()));
    const addresses = request.addresses.filter((a) => still.has(a));
    cx.spawn(async (cx) => {
      const silent = await silentNow(addresses);
      if (silent.length) {
        notify({ title: "Nothing was ended", body: silentWords(silent, "ended"), level: "error" });
        return;
      }
      for (const address of addresses) {
        cx.spawn(async (cx) => {
          await hc(["kill", address]).catch(() => null);
          const r = await hc(["rm", address]).catch(() => null);
          if (r?.code === 0) return;
          cx.timer.after(2000, (cx) => cx.spawn(async () => {
            const again = await hc(["rm", address]).catch((e) => ({ code: 1, stderr: String(e) }));
            if (again.code !== 0 && terminals().some((x) => x.address === address)) {
              notify({ title: `Couldn't close ${address}`, body: model.errorWords(again), level: "error" });
            }
          }));
        });
      }
    });
  }

  // The item menu is another copy of this mod; what it asks for comes back through shared state.
  takeRequest(cx) {
    const request = shared(REQUEST);
    if (request?.from !== this.id) return;
    setShared(REQUEST, null);
    if (request.action === "rename") this.beginRename(request.keys[0], cx);
    else if (request.action === "close") this.closeItem(request, cx);
    else if (request.action === "adopt") {
      cx.spawn(async (cx) => {
        const a = await adopt.runAdopt({ space: request.space, apply: true }, this.adoptEnv());
        const name = spaces().find((x) => x.id === request.space)?.name ?? "The space";
        notify(a.ok ? { title: `${name} is a task now`, level: "success" } : { title: `${name} is not a task yet`, body: a.why ?? a.text, level: "error" });
        cx.notify();
      });
    }
    // The agent popup gave the keyboard back to the pane under it: the composer takes it again.
    else if (request.action === "picked") cx.timer.after(150, () => this.input.focus());
    // An agent's End (its menu): only that terminal ends.
    else if (request.action === "agent-end") {
      cx.spawn(async (cx) => {
        await this.endEye(request.address);
        cx.notify();
      });
    }
    // The Eye's End: only its terminal ends.
    else if (request.action === "eye-end") {
      cx.spawn(async (cx) => {
        await this.endEye(request.eye);
        cx.notify();
      });
    }
  }

  // items: one, or every member of a merged row.
  // The row's tooltip is dropped while its menu is open, so it never sits over the menu.
  // leftOnly: the Left over group's menu, which only ends those agents.
  // leftOf: whose left-overs these are (an item's key, or null for the Left over group of
  // the shown area), so the question can count them again.
  openItemMenu(items, rowKey, cx, leftOnly = false, leftOf = null, noRename = false) {
    const space = leftOnly ? null : items[0].space?.id ?? null;
    this.menuFor = rowKey;
    // From a render (the act channel) there is no cx to notify: the popup opens all the same.
    cx?.notify();
    openOverlay({ mod: "agent-tower", kind: "popup", width: 250, height: 262, props: {
      menu: true, from: this.id, keys: items.map((i) => i.key), space, rail: narrow() || noRename, leftOnly,
      leftOf, area: this.shownArea()?.id, areas: this.config.areas,
    } });
  }

  // A row's tooltip, unless its menu was just opened; the hover leaving the row clears that.
  tip(el, key, text) {
    return el
      .when(this.menuFor !== key, (el) => el.tooltip(text))
      .on_hover((on, cx) => {
        if (!on && this.menuFor === key) {
          this.menuFor = null;
          cx.notify();
        }
      });
  }

  // Herdr's flat header: the areas as plain words; a count only on an area you are not looking at.
  // Leaving an area stamps it: what finished there before now is no longer news.
  switchArea(to) {
    const from = this.shownArea()?.id;
    if (to !== from) setShared(AREA_LEFT, { ...(sharedOr(AREA_LEFT) ?? {}), [from]: Date.now() });
    this.folded.delete("done");
    this.area = to;
    this.renaming = null;
    if (!props()?.overlay) setShared(AREA, to);
  }

  signal() {
    return shared(DONE_SIGNAL) ?? this.config.doneSignal ?? "dot";
  }

  // "2 need you · 3 done in Personal", then the newest three and "+N more" (Herdr's word: Done).
  newsTip(label, count, done, now) {
    const head = [count > 0 ? `${count} need${count === 1 ? "s" : ""} you` : null, done.length ? `${done.length} done` : null]
      .filter(Boolean).join(" · ");
    return [`${head} in ${label}`,
      ...done.slice(0, 3).map((i) => `${model.titleOf(i)} · ${model.duration(now - model.changedAt(i, this.changes))}`),
      ...(done.length > 3 ? [`+${done.length - 3} more`] : [])].join("\n");
  }

  // Herdr's flat header: the areas as plain words; on an area you are not looking at, the red
  // count of what needs you and, by the chosen signal, a done dot (still, or breathing while the
  // newest finish is fresh and nothing there is red). A right-click picks the signal.
  topRow(t, needCounts, news, now) {
    const areas = this.config.areas;
    const shown = this.shownArea()?.id;
    const signal = this.signal();
    // Each word keeps a slot for its badge and dot so it never moves, while the words fit beside
    // the icons (an estimate: 6.5px a character at 11.5px); crowded (three areas at 268px), a slot
    // is only as wide as what it shows, so the words stay readable.
    const icons = (this.eye || !this.eyeAllowed() ? 0 : 1) + (viewSwitch() === "menu" ? 1 : 0) + 2 + (props()?.overlay ? 1 : 0);
    const room = (Number.isFinite(this.listWidthNow) ? this.listWidthNow : 320) - 26 - icons * 28 - 8;
    const crowded = areas.reduce((w, a) => w + 6.5 * [...a.label].length + 26 + 6, 0) > room;
    // What the words need with only the badges they show; more than the room: a line of their own
    // (area words are never cut: a cut word is a letter again).
    const shownMarks = (a) => (a.id === shown ? 0 : ((needCounts.get(a.id) ?? 0) > 0 ? 19 : 0) + ((news.get(a.id)?.length ?? 0) > 0 ? 11 : 0));
    const ownLine = areas.length > 1 && areas.reduce((w, a) => w + 6.5 * [...a.label].length + shownMarks(a) + 6, 0) > room;
    const word = (a) => {
      const on = a.id === shown;
      const count = on ? 0 : needCounts.get(a.id) ?? 0;
      const allDone = on || (signal !== "dot" && signal !== "pulse") ? [] : news.get(a.id) ?? [];
      // Crowded, a count speaks for the area and the dot gives way to it.
      const done = crowded && count > 0 ? [] : allDone;
      const fresh = signal === "pulse" && done.length > 0 && count === 0 && now - model.changedAt(done[0], this.changes) < model.PULSE_MS;
      return control(
        h_flex().id(`at-area-${a.id}`).h(28).flex_none().gap(5).items_center().text_size(11.5).font_medium()
          .text_color(on ? t.foreground : t.dim)
          .hover((s) => s.text_color(t.foreground))
          .when(count > 0 || allDone.length > 0, (el) => el.tooltip(this.newsTip(a.label, count, allDone, now)))
          .child(a.label)
          // A slot always kept for the badge and the dot, so the words never move when one appears.
          // Room for a badge and a dot together (14 + 4 + 7); crowded, just what it shows.
          .child(h_flex().when(!crowded, (el) => el.w(26)).flex_none().gap(4).items_center()
            // Herdr's tinted badge, not a solid red: quieter than the Needs you header.
            .when(count > 0, (el) => el.child(
              h_flex().h(14).min_w(14).px(4).items_center().justify_center().rounded(4).bg(t.blocked + "26")
                .text_size(10.5).font_bold().text_color(t.blocked).child(String(count))))
            // Herdr's done dot, never a number; the same element whether it breathes or not.
            .when(done.length > 0, (el) => el.child(div().id(`at-area-done-${a.id}`).size(7).flex_none().rounded(4).bg(t.done)
              .when(fresh, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1600 }))))),
        (cx) => {
          goArea(a.id, "click");
          this.switchArea(a.id);
          cx.notify();
        },
      );
    };
    const words = h_flex().flex_1().min_w(0).mr(8).gap(6).items_center().overflow_hidden().when(areas.length > 1, (el) => el.children(areas.map(word)));
    const switches = (el) => el.on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      this.openAreaMenu();
    });
    // The icons sit close (26px each has its own padding): the area words get the room; when the
    // words can't be whole beside them, the words take the line and the icons the next.
    const row = () => h_flex().id("at-top").h(31).flex_none().pl(16).pr(10).gap(2).items_center();
    if (ownLine) {
      return switches(v_flex().id("at-top-wrap").flex_none()
        .child(h_flex().h(28).flex_none().pl(16).pr(10).items_center().child(words))
        .child(this.topIcons(row().child(div().flex_1()), t)));
    }
    return switches(this.topIcons(row().child(words), t));
  }

  // The header's icons (on its first line or, crowded, its second), appended to row.
  topIcons(row, t) {
    return row
      // No Eye running: an eye icon starts it (dimmed while it starts).
      .when(!this.eye && this.eyeAllowed(), (el) => el.child(this.eyeStarting()
        ? h_flex().id("at-eye-start").size(26).flex_none().items_center().justify_center().rounded(6).opacity(0.5)
          .tooltip("Starting the Eye…").child(eyeIcon(14, t.dim))
        : control(h_flex().id("at-eye-start").size(26).flex_none().items_center().justify_center().rounded(6).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Start the Eye")
          .child(svg("mods/agent-tower/eye.svg").size(14)), (cx) => this.startEye(cx))))
      // Views switch "menu": the shown view's icon; a click lists the views and the shape.
      .when(!props()?.overlay && viewSwitch() === "menu", (el) => el.child(iconButton(t, "at-views", null, (cx, press) => this.openViewMenu(cx, press),
        "Views", false, viewIcon(VIEWS.find((x) => x.id === viewNow().view)?.icon ?? "view-list"))))
      .child(iconButton(t, "at-find", "search", (cx) => (this.searching ? this.closeSearch(cx) : this.openSearch(cx)), "Search tasks, agents and machines in every area (Ctrl-S /)", this.searching))
      .child(iconButton(t, "at-new", "plus", (cx) => (this.composing ? !this.busy && this.closeComposer(cx) : this.openComposer(cx)),
        this.eye ? "Tell the Eye, start a task or a space" : "New task or space", this.composing))
      .when(Boolean(props()?.overlay), (el) => el.child(iconButton(t, "at-close", "x", () => this.dismiss(), "Close (Esc)")));
  }

  // Line: one footer line per other area with news; a click opens the one item, or the area.
  doneLine(t, areaId, list, now) {
    const label = this.config.areas.find((a) => a.id === areaId)?.label ?? areaId;
    const one = list.length === 1 ? list[0] : null;
    const tip = [...this.newsTip(label, 0, list, now).split("\n").slice(1), one ? "Open it" : `Go to ${label}`].join("\n");
    return h_flex().id(`at-done-${areaId}`).h(26).flex_none().px(8).gap(7).items_center().rounded(6).text_size(11).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (one) {
          this.enterRow(one, "done");
        } else {
          goArea(areaId, "click");
          this.switchArea(areaId);
        }
        cx.notify();
      })
      .child(div().flex_none().text_color(t.dim).child(label))
      .child(div().flex_none().text_color(t.dim).child("·"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(one ? model.titleOf(one) : `${list.length} done`))
      .child(div().w(28).flex_none().text_right().text_color(t.dim).child(model.duration(now - model.changedAt(list[0], this.changes))))
      .child(markSlot(t, "done"));
  }

  // Whether the shown area's Eye is starting (another area's start doesn't count).
  eyeStarting(area = this.shownArea()?.id) {
    const key = eyeKey(area);
    return this.pending.some((p) => p.eye === key) || this.starting.has(`Eye:${key}`)
      || Date.now() - (shared(EYE_STARTING)?.[key] ?? 0) < START_GIVE_UP_MS;
  }

  // What starting an Eye needs in a copy other than the list (the stage, the bar alone).
  initEyeStart() {
    this.pending ??= [];
    this.starting ??= new Set();
    this.skillAt ??= new Map();
    this.reach ??= [];
  }

  // Whether the shown area may have an Eye (its settings may say eye: false).
  eyeAllowed() {
    return !model.eyeOff(this.config, this.shownArea()?.id);
  }

  // The composer's chips: the Eye first (while one runs), then the area's recipes.
  composeChips(area) {
    const recipes = this.config.recipes.filter((r) => r.area === area);
    return [...(this.eye ? [{ id: "eye", label: "Eye" }] : []), ...recipes.map((r) => ({ id: r.id, label: r.label, recipe: r }))];
  }

  chooseChip(area, chip, cx) {
    const toEye = chip.id === "eye";
    this.chosen = toEye ? "eye" : "lead";
    this.composeTo = this.chosen;
    if (!toEye) this.recipeChoice[area] = chip.id;
    (toEye ? this.eyeInput : this.input).focus();
    cx.notify();
  }

  // One input at full width; a chip row (Eye, then recipes) when there is a choice; one hint
  // line, the same height in both modes so the list does not jump.
  composer(t, area, listed) {
    const toEye = this.composeTo === "eye";
    const chips = this.composeChips(area);
    const chosen = this.chosenRecipe(area);
    const current = toEye ? "eye" : chosen?.id;
    const showChips = chips.length > 1;
    const lead = !toEye && chosen ? this.leadFor(chosen) : null;
    const wait = toEye ? model.eyeWait(this.eye, listed) : null;
    const running = toEye ? model.eyeAgent(this.eye, Date.now(), this.changes) : null;
    const hint = div().h(15).flex_none().min_w(0).truncate().text_size(11).line_height("15px");
    const openIt = (words) => control(hint.id("at-eye-open").text_color(t.blocked).hover((s) => s.text_color(t.foreground))
      .child(words), () => this.go(this.eye.address));
    const hintLine = toEye
      ? running === "starting" ? hint.text_color(t.dim).child("Starting the Eye…")
        : running === "none" ? openIt("No agent in the Eye · Open it")
          // The pill and the kind already say it in red; this is the way there.
          : wait === "open" ? control(hint.id("at-eye-open").text_color(t.muted).hover((s) => s.text_color(t.foreground))
            .child("Open the Eye"), () => this.go(this.eye.address))
            : hint
      : !chosen
        // Two lines at most, whole words; the full path in the tooltip.
        ? div().id("at-no-recipe").flex_none().min_w(0).max_h(30).overflow_hidden().whitespace_normal().text_size(11)
          .line_height("15px").text_color(t.dim).tooltip(`Add one in ${towerDir()}/config.json`)
          .child("No recipe")
        // "[recipe · ]Led by <agent ▾>[ · on <machine>]": who leads
        // and where; the machine only when the recipe's name doesn't already say it.
        : h_flex().h(15).flex_none().min_w(0).items_center().text_size(11).text_color(t.dim)
          .child(div().min_w(0).truncate().child(`${showChips ? "" : `${chosen.label} · `}Led by`))
          .child(control(
            h_flex().id("at-lead-pick").flex_none().h(18).px(5).ml(4).mr(-5).gap(3).items_center().rounded(4)
              .text_color(t.muted)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .child(lead.label)
              .child(chrome("chevron-down").size(10)),
            // Under its button, so the popup never covers what opened it.
            (_cx, press) => openOverlay({ mod: "agent-tower", kind: "popup", width: 210, height: 23 + 31 * this.config.agents.length + 10,
              ...(press?.bounds ? { at: { x: press.bounds.x - 5, y: press.bounds.y + press.bounds.height + 4 } } : {}),
              props: {
                menu: true, agentPick: true, from: this.id, recipe: chosen.id, current: lead.id,
                agents: this.config.agents.map((a) => ({ id: a.id, label: a.label, program: this.programFor(a) })),
              } }),
          ))
          .when(Boolean(chosen.machine) && !chosen.label.includes(chosen.machine), (el) => el.child(div().flex_none().pl(8).child(`· on ${chosen.machine}`)));
    return v_flex().flex_none().pl(16).pr(10).pt(2).pb(8).gap(7).border_b(1).border_color(t.border)
      .on_key_down((e, cx) => {
        if (e.key !== "escape" || props()?.overlay) return;
        cx.stop_propagation();
        this.closeComposer(cx);
      })
      // shortcut: no focus border and no Tab between chips: Herdr 0.1.15's input fires no focus
      // events and keeps Tab; add both when it does.
      .child(h_flex().id("at-input").h(30).px(9).items_center().rounded(7).border_1()
        .border_color(t.input).bg(t.background)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .when(Boolean(this.busy), (el) => el.opacity(0.6))
        .child(Input.new(toEye ? this.eyeInput : this.input).flex_1().h_full().text_size(13).text_color(t.foreground)))
      // The Eye and the recipes, then Herdr's own "New space" (what Herdr's + does), with the
      // machines to pick from when there are others: one + for both.
      .child(h_flex().ml(-6).flex_wrap().gap(4).items_center()
        .when(showChips, (el) => el.children(chips.map((c) => {
          const on = c.id === current;
          return control(
            h_flex().id(`at-chip-${c.id}`).h(20).px(6).items_center().rounded(4).text_size(11)
              .when(on, (el) => el.bg(t.selected))
              .text_color(on ? t.foreground : t.muted)
              .hover((s) => s.text_color(t.foreground))
              .child(c.label),
            (cx) => this.chooseChip(area, c, cx),
          );
        })))
        .when(showChips, (el) => el.child(div().w(1).h(12).mx(2).bg(t.border)))
        .child(this.newSpaceChip(t)))
      .child(hintLine);
  }

  // Herdr's own new space: what its + does (space.new, on the shown space's machine); with other
  // machines connected, a chevron lists them (Herdr's "New space on <machine>").
  newSpaceChip(t) {
    const others = this.listedMachines.filter((m) => m.state === "connected").map((m) => m.name);
    const fresh = (machine) => {
      // A task from birth (adopt.js): the new space's first terminal is labelled once it shows.
      this.born = adopt.beforeNew(spaces(), machine === undefined ? spaces().find((x) => x.active)?.machine ?? null : machine);
      run("space.new", machine === undefined ? {} : { machine });
      this.composing = false;
      this.input.set_value("");
    };
    return h_flex().h(20).items_center().rounded(4).text_size(11).text_color(t.muted)
      .child(control(h_flex().id("at-space-new").h(20).px(6).gap(4).items_center().rounded(4).hover((s) => s.text_color(t.foreground).bg(t.hover))
        .child(chrome("plus").size(10)).child("New space"), (cx) => {
        fresh(undefined);
        cx.notify();
      }))
      .when(others.length > 0, (el) => el.child(control(h_flex().id("at-space-new-on").h(20).px(3).items_center().rounded(4)
        .hover((s) => s.text_color(t.foreground).bg(t.hover)).child(chrome("chevron-down").size(10)),
      (_cx, press) => openOverlay({ mod: "agent-tower", kind: "popup", width: 220, height: 10 + 31 * (others.length + 1),
        ...(press?.bounds ? { at: { x: press.bounds.x - 5, y: press.bounds.y + press.bounds.height + 4 } } : {}),
        props: { menu: true, spaceNew: true, machines: [null, ...others], word: here() } }))));
  }

  // The app's program for an agent (its icon), by the agent command's first word.
  programFor(agent) {
    const word = agent.argv[0].split("/").pop();
    const p = (this.programs ?? []).find((k) => k.key === word || k.run?.[0] === word);
    return p ? { icon: p.icon, tint: p.tint } : null;
  }

  // The running Eye's row, pinned above the area row (it covers every area), in an item row's
  // grammar. Working: one line, its sentence in the tooltip. Waiting: Herdr's "Needs you" pill
  // and the waits line. Not running: no row (the header's eye icon starts it).
  eyeRow(t, view) {
    const eye = this.eye;
    if (!eye) return null;
    const icon = h_flex().size(18).flex_none().items_center().justify_center().child(eyeIcon(16, t.foreground));
    const status = model.leadStatus(eye, view.listed);
    const line = model.eyeLine(eye, view.listed);
    const said = status === "working" ? eye.report?.msg?.trim() : null;
    const at = this.changes.get(eye.address)?.at;
    const selected = eye.address === view.focusedAgent;
    // Its program ended and a shell took its place: say so, in the muted style.
    const running = model.eyeAgent(eye, view.now, this.changes);
    const waiting = model.eyeWaiting(eye, view.listed) && running === "ok";
    const quiet = running !== "ok";
    return v_flex().id("at-eye").px(8).py(5).flex_none().rounded(8).cursor_pointer()

      .when(Boolean(said) && !quiet, (el) => el.tooltip(said))
      .when(selected, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.openEyeMenu(eye);
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.go(eye.address);
      })
      .child(h_flex().h(20).gap(9).items_center()
        .child(icon)
        .child(div().flex_1().min_w(0).truncate().text_color(quiet || (status === "idle" && !selected) ? t.muted : t.foreground)
          .child(running === "none" ? "Eye · no agent running" : "Eye"))
        .when(running === "starting", (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("Starting the Eye…")))
        .when(!waiting && !quiet, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(at ? model.duration(view.now - at) : ""))
          .child(markSlot(t, status === "done" ? "idle" : status)))
        // Herdr's full pill: the Eye sits above every group header, so the compact "!" would not read.
        .when(waiting, (el) => el.child(div().flex_none().h(18).px(6).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold()
          .text_color(t.blocked).flex().items_center().child("Needs you"))))
      .when(Boolean(line?.kind) && !quiet, (el) => el.child(this.waitLine(t, "at-eye-need", line, view)));
  }

  // The waits line, as in Needs you: the kind in red, then the agent's words in muted, at most two
  // lines; the second starts at the kind's left edge and ends in "…" when cut. Whole text in the
  // tooltip.
  waitLine(t, id, wait, view) {
    const need = hidden() ? { ...wait, msg: null } : wait;
    // The line's width: the list (the window is 320px) less its padding, the row's and the inset.
    const width = (Number.isFinite(view.listWidth) ? view.listWidth : 320) - 22 - 16 - 27 - 22;
    const { first, rest } = model.splitWait(need.kind, need.msg, width);
    return v_flex().id(id).pl(27).pr(22).pt(1).text_size(11.5).line_height("15px")
      .tooltip(need.msg ? `${need.kind}: ${need.msg}` : need.kind)
      .child(h_flex().min_w(0)
        .child(div().flex_none().text_color(t.blocked).child(need.msg ? `${need.kind} · ` : need.kind))
        .when(Boolean(first), (el) => el.child(div().min_w(0).truncate().text_color(t.muted).child(first))))
      .when(Boolean(rest), (el) => el.child(div().min_w(0).truncate().text_color(t.muted).child(rest)));
  }

  // The Eye's menu is an agent's menu (rule 5: the same thing, the same menu).
  openEyeMenu(eye) {
    this.openAgentMenu(eye.address);
  }

  // An agent's menu (a lead, a worker, the Eye): Open, then End…; End asks first.
  openAgentMenu(address) {
    const t = terminals().find((x) => x.address === address);
    const eye = t?.labels?.["tower.eye"] === "1";
    const name = eye ? "the Eye" : t?.name || t?.program?.name || address;
    openOverlay({ mod: "agent-tower", kind: "popup", width: 230, height: 10 + 2 * 31, props: { menu: true, agentActs: address, name, eye, from: this.id } });
  }

  // Right-click on the area row (choice 4): the area's menu (a new task here, its views, then
  // the settings), or the settings straight away.
  openAreaMenu(area = shared(AREA)) {
    if (choice("areaMenu") === "settings") return this.openSwitches();
    const views = viewsOf(area).map((x) => x.id);
    openOverlay({ mod: "agent-tower", kind: "popup", width: 240, height: 10 + (views.length + 2) * 31 + 18, props: { menu: true, areaActs: area, views, from: this.id } });
  }

  openSwitches() {
    const rows = SWITCHES.reduce((n, sw) => n + sw.ids.length, 0);
    openOverlay({ mod: "agent-tower", kind: "popup", width: 260, height: SWITCHES.length * SWITCH_HEAD + rows * SWITCH_ROW + 12, props: { menu: true, signal: true } });
  }

  // Herdr's group label; a click folds it. A fixed gap above, whatever row came before.
  groupHeader(t, g, count, first, onRight) {
    const open = !this.folded.has(g.id);
    return h_flex().id(`at-g-${g.id}`).px(8).mt(first ? 0 : 10).h(24).flex_none().gap(6).items_center().text_size(11).font_medium()
      .cursor_pointer()
      .when(Boolean(onRight), (el) => el.on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        onRight(cx);
      }))
      .hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        open ? this.folded.add(g.id) : this.folded.delete(g.id);
        cx.notify();
      })
      .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
      .when(count != null, (el) => el.child(div().text_color(t.dim).child(String(count))))
      .child(div().flex_1())
      .when(!open, (el) => el.child(chrome("chevron-right").size(11).flex_none().text_color(t.dim)));
  }

  // An explicit open or fold wins; else a tree is open while its task is selected or something in
  // it works or waits.
  treeOpen(item) {
    if (this.matchedIn?.has(item.key)) return true;
    if (this.opened.has(item.key)) return true;
    if (this.folded.has(item.key)) return false;
    return item.activeTree.length > 0;
  }

  toggle(key, open) {
    this.opened.delete(key);
    this.folded.delete(key);
    (open ? this.folded : this.opened).add(key);
  }

  // The fold chip of an item with sub-agents; folded, their count in the most urgent one's colour.
  // count: false when the row needs the room for its title (the chevron alone stays).
  fold(t, key, open, members, urgent, count = true) {
    return control(
      div().id(`at-fold-${key}`).h(18).px(3).gap(3).flex().items_center().rounded(4).text_size(11)
        .text_color(open ? t.dim : t[urgent] ?? t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .child(chrome(`chevron-${open ? "down" : "right"}`).size(11).flex_none())
        .when(!open && count, (el) => el.child(String(members))),
      (cx) => {
        this.toggle(key, open);
        cx.notify();
      },
    );
  }

  // The right-hand columns: fold chip (only when some row in the area has one), age and mark the same
  // width on every row, so a machine name, on the rows that print one, ends at the same edge.
  // shortcut: the machine is not a column reserved on every row (62px of a 268px sidebar cut titles
  // to one letter in the sandbox); reserve it if names of different lengths must start aligned too.
  slots(t, view, machine, chip, age, mark) {
    return [
      // A machine name, or (the title needing the room) the server glyph with the names in its tooltip.
      machine?.glyph ? div().id(machine.id).flex_none().text_color(t.dim).tooltip(machine.tip).child(chrome("server").size(11))
        : machine ? div().max_w(56).flex_none().text_right().truncate().text_size(10).text_color(t.dim).child(machine) : null,
      // Below 300px the title needs every pixel: no empty chip column, no minimum age width.
      (view.wide ? view.chipSlot : chip) ? div().min_w(18).flex_none().flex().justify_end().child(chip ?? "") : null,
      div().when(view.wide, (el) => el.min_w(28)).flex_none().text_right().text_size(11).text_color(age?.color ?? t.dim).child(age?.text ?? ""),
      // undefined: the state already stands at the left, so no mark column (the title gets the room).
      mark === undefined ? null : markSlot(t, mark),
    ].filter(Boolean);
  }

  // Printed only when it is not where the area lives.
  machineLabel(view, machine) {
    return (machine ?? null) === view.home ? null : machine ?? here();
  }

  // A row with only a machine beside its name: the machine, if the name still has its room.
  fitName(view, name, machine) {
    const f = model.fitRow(view.listWidth, view.lineWidth, name, { machine: this.machineLabel(view, machine) });
    return f.compact ? { glyph: f.machine, tip: f.machine, id: `at-mg-${name}` } : f.machine;
  }

  rowMark() {
    return model.ROW_MARKS.includes(shared(ROW_MARK)) ? shared(ROW_MARK) : model.ROW_MARKS[0];
  }

  // What stands at the left of a task row (ROW_MARK): its state as Herdr marks it, or how many
  // agents run in it, tinted by its state. The space's letter said nothing about the task.
  leadIcon(t, item, mark) {
    return rowMark(t, item, mark, this.rowMark());
  }

  // The mark at the right of a task row: none when the state already stands at the left.
  rightMark(mark) {
    return this.rowMark() === "state" ? undefined : mark;
  }

  // The machines a task runs on other than where the area lives: "mac", or "mac +1".
  machinesLabel(view, item) {
    const others = (item.machines ?? [item.machine]).filter((m) => (m ?? null) !== view.home).map((m) => m ?? here());
    return others.length > 1 ? `${others[0]} +${others.length - 1}` : others[0] ?? null;
  }

  ageOf(t, item, view, stale) {
    const down = view.downOn(item.machine);
    // The model's time for it (same changes; its clock at most a minute older).
    const at = item.changed ?? model.changedAt(item, this.changes);
    if (item.leadGone) return { text: "lead gone", color: t.blocked };
    if (down) return { text: `as of ${clock(down)}` };
    // Its still clock already says quiet: the age alone, in the working colour.
    if (stale) return { text: model.duration(view.now - at), color: t.working };
    return at ? { text: model.duration(view.now - at) } : null;
  }

  // What the row's mark says (model.rowWord): a done lead reads as idle once seen, as Herdr shows it.
  markOf(item, _groupId, view) {
    // The model's word (same inputs; its clock at most a minute older), else worked out here.
    if (item.word !== undefined) return item.word;
    return model.rowWord(item, { listed: view.listed, seen: view.seen, now: view.now, changes: this.changes });
  }

  // A click on a Done row counts as seeing it: a lead without a pane leaves Done.
  see(item, groupId) {
    if (groupId !== "done" || !item.lead) return;
    setShared(SEEN, { ...(sharedOr(SEEN) ?? {}), [item.lead.address]: model.changedAt(item, this.changes) });
  }

  // The selected item, for the panel mod (see model.nextSelection). Shared, so the docked list
  // and the window agree. clickedTo: the address a click goes to; the click pins the item to the
  // space that address shows (its pane's space, else the space on screen: a peek stays here).
  select(item, clickedTo) {
    const value = model.selectionOf(item, this.wordCtx);
    if (value?.key !== (shared(SELECTED) ?? null)?.key && shared(MOMENT)) setShared(MOMENT, null);
    if (JSON.stringify(value) !== JSON.stringify(shared(SELECTED) ?? null)) setShared(SELECTED, value);
    if (clickedTo !== undefined) {
      // A search result from another area shows that area, so Details follows.
      if (item?.area && !props()?.overlay && item.area !== this.shownArea()?.id) this.switchArea(item.area);
      const space = agents().find((a) => a.address === clickedTo)?.space ?? shownSpace();
      setShared(PIN, item ? { key: item.key, space } : null);
    }
    return value?.key ?? null;
  }

  followSelection(items, focusNow) {
    // Focus moving to the Eye is no task: the selection stays.
    const focus = this.eyeAddresses?.has(focusNow) ? this.lastFocus : focusNow;
    const shown = shownSpace();
    const pin = shared(PIN) ?? null;
    const next = model.nextSelection({ items, selectedKey: shared(SELECTED)?.key ?? null, pin, focus, lastFocus: this.lastFocus, shown, lastShown: this.lastShown });
    this.lastFocus = focus;
    this.lastShown = shown;
    if (JSON.stringify(next.pin) !== JSON.stringify(pin)) setShared(PIN, next.pin);
    return this.select(next.key ? items.find((i) => i.key === next.key) ?? null : null);
  }

  itemRow(t, item, view, groupId) {
    const need = model.needOf(item);
    // A finished lead's own last sentence, when it gave one.
    const said = groupId === "done" && !hidden() ? item.lead.report?.msg?.trim() || null : null;
    const down = view.downOn(item.machine);
    const mark = this.markOf(item, groupId, view);
    const renaming = this.renaming === item.key;
    const title = model.titleOf(item);
    const selected = item.key === view.selectedKey;
    // Earlier is a directory: one 24 px line per task, nothing under it (unless a search matched inside it).
    const compact = groupId === "earlier" && !this.matchedIn?.has(item.key);
    const open = !compact && this.treeOpen(item);
    const members = compact ? 0 : item.tree.length + item.leftOvers.length;
    // Where it runs stays; the space note gives way to the title (model.fitRow). The fold chip
    // shows no count: "mac +1" beside "› 1" read as the same thing.
    const fit = model.fitRow(view.listWidth, view.lineWidth - (!view.wide && members ? 27 : 0), title, {
      machine: this.machinesLabel(view, item),
      note: view.notes.get(item.key) ?? model.spaceNote(item),
    });
    const note = fit.note;
    const idle = (mark ?? "idle") === "idle" && !selected;
    const lost = !need && model.noAgent(item, view.now, this.changes);
    const urgent = item.tree.reduce((m, r) => ((RANK[r.status] ?? 0) > (RANK[m] ?? 0) ? r.status : m), null);
    const line = h_flex().h(20).gap(9).items_center()
      .child(this.leadIcon(t, item, mark))
      .child(renaming
        ? h_flex().id("at-rename").flex_1().min_w(0).h(22).px(6).rounded(5).border_1().border_color(t.accent).bg(t.background)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => cx.stop_propagation())
          .child(Input.new(this.renameInput).flex_1().h_full().text_size(13).text_color(t.foreground))
        : h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().id(`at-title-${item.key}`).min_w(0).truncate().text_color(idle ? t.muted : t.foreground)
            // A title the row can't hold whole is named whole on hover (estimate, 7px a character).
            .when(7 * [...title].length > view.lineWidth - (fit.machine ? (fit.compact ? 20 : 60) : 0), (el) => el.tooltip(title))
            .child(title))
          // The note gives way first: it shrinks twenty times faster than the title.
          .when(Boolean(note), (el) => el.child(div().min_w(0).max_w(90).flex_shrink(20).truncate().text_color(t.dim).child(`· ${note}`))))
      .when(!renaming, (el) => el.children(this.slots(t, view, fit.compact ? { glyph: fit.machine, tip: item.machines.map((x) => x ?? here()).join(", "), id: `at-mg-${item.key}` } : fit.machine,
        members ? this.fold(t, item.key, open, members, urgent, false) : null,
        this.ageOf(t, item, view, mark === "stale"), this.rightMark(mark))));
    // No tooltip: it covered the next row's wait line; the row names the machines, Details the rest.
    const row = v_flex().id(`at-item-${item.key}`).px(8).py(compact ? 2 : 5).flex_none().rounded(8).cursor_pointer()
      .when(selected, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .when(Boolean(down), (el) => el.opacity(0.6))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.openItemMenu([item], item.key, cx);
      })
      // A task row selects its task and opens its lead; its lead and
      // worker rows open their own. Folding is the chevron's alone.
      .on_click((e, cx) => {
        cx.stop_propagation();
        // Choice 5: a double-click renames, or is a click like any other.
        if (e.click_count >= 2 && choice("doubleClick") === "rename") return this.beginRename(item.key, cx);
        this.enterRow(item, groupId);
        // The first click shows Details too, where the layout has it hidden.
        if (find(layout(), "tower-detail")?.hidden) run("layout.show", { id: "tower-detail" });
        cx.notify();
      })
      .child(line)
      // A lead whose program ended (a shell took its place) is not quietly idle.
      .when(lost, (el) => el.child(div().pl(27).pr(22).pt(1).truncate().text_size(11.5).line_height("15px").text_color(t.blocked).child("no agent running")))
      // The kind in red, the agent's own words after it, at most two lines.
      .when(Boolean(need), (el) => el.child(this.waitLine(t, `at-need-${item.key}`, need, view)))
      .when(Boolean(said), (el) => el.child(div().pl(27).pr(22).pt(1).truncate().text_size(11.5).line_height("15px").text_color(t.muted).child(said)));
    if (!open) return [row];
    // A search that matched inside the task opens its folds too.
    const drawn = model.displayRows(item, (k) => this.opened.has(k) || Boolean(this.matchedIn?.has(item.key)));
    return [
      row,
      ...(item.leadGone ? [] : [this.subRow(t, { t: item.lead, lines: [drawn.length ? "├" : "└"], status: item.status }, view, item, "Lead")]),
      ...drawn.map((r) => (r.fold ? this.foldRow(t, item, r) : this.subRow(t, r, view, item))),
      // Agents whose starter is gone, that name this item's space: one folded line after its
      // real workers; open, their rows.
      ...(item.leftOvers.length ? this.leftOverRows(t, item, view) : []),
    ];
  }

  // Two or more quiet rows under one parent: one line in Herdr's words, "2 done · 10 idle".
  foldRow(t, item, r) {
    return control(h_flex().id(`at-fold-${r.key}`).pl(39).pr(8).h(26).flex_none().rounded(8).items_center()
      .text_size(12).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .children(r.lines.map((l) => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .child(chrome(`chevron-${r.open ? "down" : "right"}`).size(11).flex_none().mr(5))
      .child(model.quietWords(r.rows)),
    (cx) => {
      r.open ? this.opened.delete(r.key) : this.opened.add(r.key);
      cx.notify();
    });
  }

  // A left-over agent: the sub-row look, its program icon, name, machine when not home, age. A click
  // peeks at it like any agent without a pane.
  // "N left over", folded by default (this.opened holds "<item key>:left" when open).
  leftOverRows(t, item, view) {
    const key = `${item.key}:left`;
    const open = this.opened.has(key);
    const n = item.leftOvers.length;
    const line = this.tip(h_flex().id(`at-leftover-${item.key}`).pl(39).pr(8).h(26).flex_none().gap(5).rounded(8).items_center()
      .text_size(11.5).text_color(t.dim).cursor_pointer(), key, "Their starter has ended")
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.openItemMenu(item.leftOvers, key, cx, true, item.key);
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? this.opened.delete(key) : this.opened.add(key);
        cx.notify();
      })
      .child(chrome(`chevron-${open ? "down" : "right"}`).size(11).flex_none())
      .child(`${n} agent${n === 1 ? "" : "s"} left over`);
    return [line, ...(open ? item.leftOvers.map((l) => this.leftRow(t, l, view, true)) : [])];
  }

  // A left-over agent: its program icon and name, the machine when not home; no age (it would
  // only say when Tower noticed it). Nested under an item at the worker inset; in the Left over
  // group at the item inset, the icon in an 18px box so names start with the titles.
  leftRow(t, li, view, nested = false) {
    const k = li.lead;
    const pic = programIcon(k.program, 14, t.foreground);
    const name = k.name || k.template || k.program?.name || model.memberName(li);
    return control(
      h_flex().id(`at-left-${k.address}`).when(nested, (el) => el.pl(39).gap(8)).when(!nested, (el) => el.pl(8).gap(9))
        .pr(8).h(26).flex_none().rounded(8).items_center().text_size(12.5)
        .hover((s) => s.bg(t.hover))
        .when(Boolean(view.downOn(li.machine)), (el) => el.opacity(0.6))
        .when(nested && Boolean(pic), (el) => el.child(pic))
        .when(!nested, (el) => el.child(h_flex().size(18).flex_none().items_center().justify_center().when(Boolean(pic), (el) => el.child(pic))))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(name))
        .children(this.slots(t, view, this.fitName(view, name, li.machine), null, null, null)),
      () => this.go(k.address),
    );
  }

  // Rows that read exactly alike: one row with "×N"; open, one line per member.
  dupRows(t, e, view, groupId) {
    const open = this.opened.has(e.key);
    const first = e.members[0];
    const marks = e.members.map((m) => this.markOf(m, groupId, view));
    const mark = marks.reduce((m, x) => ((RANK[x] ?? 0) > (RANK[m] ?? 0) ? x : m), null);
    const newest = e.members[0]; // groupItems sorts newest first
    const row = this.tip(h_flex().id(`at-dup-${e.key}`).px(8).h(30).flex_none().gap(9).items_center().rounded(8).cursor_pointer(),
      e.key, [e.title, first.space?.name, first.machine ?? here(), `${e.members.length} alike`].filter(Boolean).join(" · "))
      .hover((s) => s.bg(t.hover))
      .when(Boolean(view.downOn(first.machine)), (el) => el.opacity(0.6))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.openItemMenu(e.members, e.key, cx);
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.enterRow(newest, groupId);
        cx.notify();
      })
      .child(this.leadIcon(t, first, mark))
      .child(h_flex().flex_1().min_w(0).gap(5).items_center()
        .child(div().min_w(0).truncate().text_color((mark ?? "idle") === "idle" ? t.muted : t.foreground).child(e.title))
        .child(div().flex_none().text_color(t.dim).child(`×${e.members.length}`))
        .child(div().flex_1()))
      .children(this.slots(t, view, this.fitName(view, e.title, first.machine),
        control(div().id(`at-dupfold-${e.key}`).h(18).px(3).flex().items_center().rounded(4).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .child(chrome(`chevron-${open ? "down" : "right"}`).size(11)), (cx) => {
          this.toggle(e.key, open);
          cx.notify();
        }),
        this.ageOf(t, newest, view, mark === "stale"), this.rightMark(mark)));
    if (!open) return [row];
    return [row, ...e.members.map((m, i) => {
      const at = this.ageOf(t, m, view, marks[i] === "stale");
      return h_flex().id(`at-member-${m.key}`).pl(39).pr(8).h(26).flex_none().gap(9).rounded(8).items_center().text_size(12.5).cursor_pointer()
        .when(m.key === view.selectedKey, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.openItemMenu([m], m.key, cx);
        })
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.enterRow(m, groupId);
          if (find(layout(), "tower-detail")?.hidden) run("layout.show", { id: "tower-detail" });
          cx.notify();
        })
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(model.memberName(m)))
        .child(div().min_w(28).flex_none().text_right().text_size(11).text_color(at?.color ?? t.dim).child(at?.text ?? ""))
        .child(markSlot(t, marks[i]));
    })];
  }

  // Done shows DONE_SHOWN rows, then "N more" (a backstop: Done empties by itself).
  moreRow(t, hidden) {
    return control(
      h_flex().id("at-done-more").pl(39).pr(8).h(26).flex_none().items_center().rounded(8).text_size(12).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .child(hidden ? `${hidden} more` : "Show fewer"),
      (cx) => {
        this.folded.has("done-more") ? this.folded.delete("done-more") : this.folded.add("done-more");
        cx.notify();
      },
    );
  }

  // A lead or worker row; a click opens that terminal (and keeps its task selected).
  subRow(t, r, view, item, label = null) {
    const k = r.t;
    const pic = programIcon(k.program, 14, t.foreground);
    // Lit when shown (a peek wins over the pane behind it), only under the selected task.
    const peeked = shared(PEEKED);
    const on = (peeked ? k.address === peeked : k.address === view.focusedAgent || k.address === view.shownAgent) && item.key === view.selectedKey;
    // A worker names its machine when it is not where the area lives; the lead always names it.
    const where = label === "Lead" ? model.machineOf(k.address) ?? here() : this.machineLabel(view, model.machineOf(k.address));
    const marked = Boolean(this.matchedMembers?.has(k.address));
    return control(
      h_flex().id(`at-sub-${k.address}`)
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.openAgentMenu(k.address);
        })
        .pl(39).pr(8).h(26).flex_none().rounded(8).items_center().text_size(12.5)
        .when(on, (el) => el.bg(t.raised))
        // A search match in this member.
        .when(marked, (el) => el.bg(t.accent + "24"))
        .hover((s) => s.bg(t.hover))
        .when(Boolean(view.downOn(model.machineOf(k.address))), (el) => el.opacity(0.6))
        .children(r.lines.map((l) => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
          .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
          .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
        .when(Boolean(pic), (el) => el.child(pic.mr(8)))
        .child(div().flex_1().min_w(0).truncate().text_color(on || marked ? t.foreground : t.muted).child(label ?? (k.name || k.template || k.program?.name || k.address)))
        // A worker says where it runs when that is not where the area lives (the lead row says it in words).
        .when(Boolean(where), (el) => el.child(div().max_w(72).flex_none().ml(6).mr(5).truncate().text_size(10.5).text_color(t.dim).child(where)))
        .child(markSlot(t, r.status)),
      () => {
        this.select(item, k.address);
        this.go(k.address);
      },
    );
  }

  pendingRow(t, p) {
    return h_flex().id(`at-pending-${p.id}`).px(8).h(30).flex_none().gap(9).items_center().rounded(8)
      .child(h_flex().size(18).flex_none().items_center().justify_center().child(statusMark(t, "working")))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.words))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("Starting…"))
      .child(markSlot(t, this.rightMark("working")));
  }

  selectSpace(space) {
    run("space.select", { id: space.id });
    this.dismiss();
  }

  shellRow(t, space, view) {
    return h_flex().id(`at-shell-${space.id}`).px(8).h(30).flex_none().gap(9).items_center().rounded(8).cursor_pointer()
      .when(space.active, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .when(Boolean(view.downOn(space.machine)), (el) => el.opacity(0.6))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.menuFor = `at-shell-${space.id}`;
        cx.notify();
        openOverlay({ mod: "agent-tower", kind: "popup", width: 250, height: 10 + 2 * 31 + 9, props: { menu: true, from: this.id, keys: [], space: space.id, shellSpace: true } });
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.selectSpace(space);
      })
      .child(spaceIcon(t))
      .child(div().flex_1().min_w(0).truncate().text_color(space.active ? t.foreground : t.muted).child(space.name))
      .children(this.slots(t, view, this.fitName(view, space.name, space.machine), null, null, null));
  }

  // The spaces mod's test for a machine that was rebuilt or replaced.
  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  // The spaces mod's Connect: forget the old machine and add the new one under the same name.
  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const ask = async (args) => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
        }
        const args = ["machine", "add", ...(machine.via ? ["--via", machine.target] : [machine.target]), "--name", name];
        if (machine.session) args.push("--session", machine.session);
        await ask(args);
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // Herdr's machine line, only for machines this area uses and only while one is not connected.
  machineLines(t, onArea, rail, before = []) {
    const lines = this.reach.filter((m) => m.name && (!m.reachable || this.reconnecting[m.name]) && onArea(m.name)).map((m) => {
      const machine = this.listedMachines.find((k) => k.name === m.name) ?? this.reconnecting[m.name]?.machine;
      const repair = this.reconnecting[m.name];
      const rebuilt = this.rebuilt(machine) || Boolean(repair);
      const login = machine?.state === "needs_login" ? `hc machine login ${m.name}` : null;
      const word = rebuilt ? repair?.error || "rebuilt" : login ? "needs login" : `unreachable since ${clock(m.since)}`;
      const icon = chrome("server").size(13).flex_none();
      if (rail) {
        return h_flex().id(`at-machine-${m.name}`).w(32).h(26).flex_none().justify_center().items_center().rounded(6).text_color(t.dim)
          .tooltip(login ? `${m.name} needs a login: run ${login}` : `${m.name} · ${word}`)
          .child(div().relative().child(icon).child(div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(t.dim)));
      }
      return h_flex().id(`at-machine-${m.name}`).h(26).flex_none().px(8).gap(7).items_center().text_size(11).text_color(t.dim)
        .child(icon)
        .child(div().flex_1().min_w(0).truncate().child(m.name))
        .child(div().flex_none().max_w(140).truncate().child(word))
        .when(Boolean(login), (el) => el.child(div().id(`at-login-${m.name}`).flex_none().px(5).py(2).rounded(4)
          .text_color(t.foreground).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
          .tooltip(login)
          .on_click((_e, cx) => {
            cx.stop_propagation();
            cx.write_to_clipboard(login);
            this.copiedLogin = login;
            cx.notify();
          })
          .child(this.copiedLogin === login ? "Copied" : "Copy")))
        .when(rebuilt && Boolean(machine), (el) => el.child(div().id(`at-connect-${m.name}`).flex_none()
          .text_color(repair?.error ? t.blocked : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.reconnect(machine, cx);
          })
          .child(repair?.busy ? "Connecting…" : "Connect")))
        .child(div().size(6).rounded(3).flex_none().bg(t.dim));
    });
    if (!lines.length && !before.length) return null;
    return v_flex().flex_none().py(4).border_t(1).border_color(t.border).when(rail, (el) => el.items_center()).px(rail ? 0 : 8).children([...before, ...lines]);
  }

  // The rail: one 26px cell per row, the mark as a badge, the title in the tooltip.
  railCell(t, id, content, mark, tip, onClick, onRight) {
    const badge = BADGE[mark];
    return this.tip(h_flex().id(id).w(32).h(26).flex_none().justify_center().items_center().rounded(6).cursor_pointer(), id, tip)
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(Boolean(onRight), (el) => el.on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        onRight(cx);
      }))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      })
      .child(div().relative().child(content)
        .when(Boolean(badge), (el) => el.child(div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(t[badge]))));
  }

  railRows(t, sections, shells, view) {
    const eye = this.eye;
    // The Eye first: a click goes to it, or (not running) starts it; its badge sits where the
    // tiles' badges sit.
    const starting = this.eyeStarting();
    const cells = !eye && !this.eyeAllowed() ? [] : [this.railCell(t, "at-rail-eye",
      h_flex().size(18).items_center().justify_center().when(starting, (el) => el.opacity(0.5)).child(eyeIcon(16, eye ? t.foreground : t.dim)),
      eye ? (model.eyeWaiting(eye, view.listed) ? "blocked" : model.leadStatus(eye, view.listed)) : null,
      eye ? "Eye" : starting ? "Starting the Eye…" : "Start the Eye",
      (cx) => (eye ? this.go(eye.address) : starting ? null : this.startEye(cx)),
      eye ? (cx) => {
        this.menuFor = "at-rail-eye";
        cx.notify();
        this.openEyeMenu(eye);
      } : null)];
    for (const { g, entries } of sections) {
      if (g.id === "earlier" && this.folded.has("earlier")) continue;
      cells.push(div().w(20).h(1).my(4).flex_none().bg(t.border));
      for (const e of entries) {
        const item = e.dup ? e.members[0] : e;
        const mark = this.markOf(item, g.id, view);
        const tip = e.dup ? `${e.title} ×${e.members.length}` : model.titleOf(item);
        // The item keeps its tile; a wait shows as the same red badge as the Eye's.
        // The rail has no lead row to open: a click selects the task and opens its lead.
        cells.push(this.railCell(t, `at-rail-${e.key}`, this.leadIcon(t, item, mark), this.rightMark(mark), tip, () => {
          this.enterRow(item, g.id);
        }, (cx) => this.openItemMenu(e.dup ? e.members : [item], `at-rail-${e.key}`, cx)));
      }
    }
    if (shells.length && cells.length) cells.push(div().w(20).h(1).my(4).flex_none().bg(t.border));
    for (const s of shells) {
      cells.push(this.railCell(t, `at-rail-${s.id}`, spaceIcon(t), null, s.name, () => this.selectSpace(s), (cx) => {
        this.menuFor = `at-rail-${s.id}`;
        cx.notify();
        openSpaceMenu(s.id);
      }));
    }
    return cells;
  }

  // The list and the stage are timed for the perf log (the stage's count leaves out its view's,
  // which is logged under the view's own name); the small copies are not.
  render(cx) {
    const p = props();
    const kind = p?.stage ? "stage" : p?.menu || p?.peekBar || p?.paneHead || p?.stageBar || p?.viewBar || p?.textHidden || isToast() ? null : "list";
    return inFrame(() => (kind ? timedRender(kind, () => this.draw(cx)) : this.draw(cx)));
  }

  draw(cx) {
    const t = theme();
    // The settings were read again by the list: this copy reads them too, quietly.
    const configAt = shared(CONFIG_AT) ?? 0;
    if (configAt !== (this.configAt ??= configAt)) {
      this.configAt = configAt;
      cx.spawn(async (cx) => {
        this.config = await loadConfig(true);
        cx.notify();
      });
    }
    if (isToast()) {
      // A broken toast would hide every notification: draw a plain one if anything throws.
      try {
        return this.renderToast(t);
      } catch {
        return div().size_full().px(18).flex().items_center().bg(t.popover).text_color(t.foreground).child(String(props()?.title ?? ""));
      }
    }
    if (props()?.menu) return this.renderMenu(t);
    if (props()?.peekBar) return this.renderPeekBar(t);
    if (props()?.paneHead) return this.renderPaneHead(t);
    if (props()?.stage) return this.renderStage(t, cx);
    if (props()?.stageBar) return this.stageBar(t);
    if (props()?.textHidden) return div().size_full().flex().items_center().justify_center().bg(t.background).text_color(t.dim).child("Text hidden");
    if (props()?.viewBar) return this.viewRow(t);
    this.takeRequest(cx);
    if (!props()?.overlay) {
      // A new copy (Herdr's start, a layout switch) puts the shown view and shape in place once.
      if (!this.placed) {
        this.placed = true;
        applyShape(viewNow().view, viewNow().shape);
      }
      // Folds and opened rows, as they are now, for the next copy.
      const folds = JSON.stringify({ folded: [...this.folded], opened: [...this.opened], earlierShown: true });
      if (folds !== this.savedFolds) {
        this.savedFolds = folds;
        setShared(FOLDS, JSON.parse(folds));
      }
      // Views switch "bar": the layout's bar above the centre shows; otherwise it stays hidden.
      const bar = find(layout(), "tower-viewbar");
      if (bar && Boolean(bar.hidden) !== (viewSwitch() !== "bar")) run(viewSwitch() === "bar" ? "layout.show" : "layout.hide", { id: "tower-viewbar" });
      this.nameKeptTabs();
      this.noteLayout();
      // The shared area is the one shown: a view or a search result in another area moves it.
      const want = shared(AREA);
      if (want && want !== this.area && this.config.areas.some((a) => a.id === want)) this.switchArea(want);
    }
    const now = Date.now();
    const terms = terminals();
    const agentList = agents();
    const listed = new Map(agentList.map((a) => [a.address, a.status]));
    const spaceList = spaces();
    // "New space" made a space: its first terminal leads a task from birth (adopt.js), once it shows.
    if (this.born) {
      const b = now - this.born.at < 60000 ? adopt.bornSpace(this.born, spaceList, terms) : null;
      if (b || now - this.born.at >= 60000) this.born = null;
      if (b) this.label(cx, b.address, adopt.birthLabels(b.space, this.shownArea().id), "The new space could not become a task");
    }
    // Which machines answer, first: per-terminal memory is only dropped for those.
    this.reach = model.reachability(this.reach, this.listedMachines, machines(), now);
    // This copy keeps its own map (read from the shared one once), so a render doesn't convert and
    // rebuild it; what it learns it shares, and its version tells the model's cache.
    if (!this.changes) {
      this.changes = new Map(Object.entries(sharedOr(CHANGES) ?? {}));
      this.changesVersion = 0;
    }
    if (model.trackChanges(this.changes, terms, now, this.reach)) {
      this.changesVersion++;
      setShared(CHANGES, Object.fromEntries(this.changes));
      setShared(CHANGES_V, `${this.id}:${this.changesVersion}`);
    }
    const seen = sharedOr(SEEN) ?? {};
    const unseen = new Set(model.forgettable(Object.keys(seen), terms, this.reach));
    if (unseen.size) setShared(SEEN, Object.fromEntries(Object.entries(seen).filter(([a]) => !unseen.has(a))));
    const downSince = new Map(this.reach.filter((m) => !m.reachable).map((m) => [m.name, m.since]));
    const f = focused();

    const config = this.config;
    // The shown area's Eye (no Eye is ever a work item): its own row, chip, rail cell and start.
    this.eye = model.findEye(terms, EYE_PER_AREA ? this.shownArea()?.id : null, config);
    this.eyeAddresses = new Set(terms.filter((x) => model.isEye(x)).map((x) => x.address));
    // A starting Eye with no agent yet: draw again when its 20 s are up (no event would).
    if (this.eye && model.eyeAgent(this.eye, now, this.changes) === "starting" && this.eyeRecheck !== this.eye.address) {
      this.eyeRecheck = this.eye.address;
      cx.timer.after(model.NO_AGENT_MS + 500, (cx) => cx.notify());
    }
    // The one model every view draws from (model.taskModel).
    const m = model.taskModelOnce({ terms, listed, spaces: spaceList, config, changes: this.changes, changesVersion: this.changesVersion, seen, now,
      titles: sharedOr(TITLES) ?? {}, reach: this.reach, eye: this.eye }, (this.modelMemo ??= {}));
    const allItems = m.all;
    const composeTo = model.composeMode(this.chosen, Boolean(this.eye));
    if (composeTo !== this.composeTo) {
      this.composeTo = composeTo;
      if (this.composing) cx.timer.after(0, () => (composeTo === "eye" ? this.eyeInput : this.input).focus());
    }
    if (m.titles) setShared(TITLES, m.titles);
    this.items = allItems;
    this.pending = this.pending.filter((p) => !allItems.some((i) => i.taskId === p.id));
    // Left-over agents never count as work: they hang off their space's item or sit in Left over.
    const { items: workList, loose } = m;
    const areaOfItem = (item) => item.area;
    const needCounts = model.areaNeeds(workList, areaOfItem);
    // A waiting Eye adds 1 to its area's red count.
    if (EYE_PER_AREA) for (const [a, n] of model.eyeNeeds(terms, config, listed)) needCounts.set(a, (needCounts.get(a) ?? 0) + n);

    const shownArea = this.shownArea();
    const area = shownArea?.id;
    // Words typed to one area's Eye never go to another's: each area keeps its own.
    if (this.composeArea !== area) {
      if (this.composeArea != null) {
        this.eyeDrafts[this.composeArea] = this.eyeInput.value();
        this.eyeInput.set_value(this.eyeDrafts[area] ?? "");
        this.chosen = null;
      }
      this.composeArea = area;
    }
    // Published on load and on every switch; the window keeps its own area and does not publish.
    // Not before the settings are read: the built-in areas would overwrite the shared one.
    if (!props()?.overlay && this.configLoaded && area && shared(AREA) !== area) setShared(AREA, area);
    // What finished unseen in the other areas since you last left them (the experiment's signal).
    const news = model.areaNews(workList, { shown: area, areaOfItem, left: sharedOr(AREA_LEFT) ?? {}, listed, seen, now, changes: this.changes });
    const items = workList.filter((i) => areaOfItem(i) === area);
    const leftHere = loose.filter((i) => areaOfItem(i) === area);
    const pending = this.pending.filter((p) => p.area === area);
    // A started task's space shows as its "Starting…" row until its lead is labelled.
    // The spaces with only shells depend on what the model does (terms, spaces): kept with it.
    const shells = (m.shells ??= model.shellSpaces(spaceList, terms))
      .filter((s) => model.areaOf(config, s.machine, null) === area && !this.pending.some((p) => model.isPendingSpace(p, s)));
    if (this.renaming && !items.some((i) => i.key === this.renaming)) this.renaming = null;

    const home = model.homeMachine(shownArea);
    const view = {
      now,
      home,
      downOn: (machine) => (machine ? downSince.get(machine) ?? null : null),
      focusedAgent: agentList.find((a) => a.focused)?.address ?? f?.terminal ?? null,
      shownAgent: f?.agent ?? null,
      listed,
      seen,
    };
    this.wordCtx = { listed, seen, now, changes: this.changes };
    const started = this.selectNew ? allItems.find((i) => i.taskId === this.selectNew) : null;
    if (started) {
      this.selectNew = null;
      setShared(PIN, { key: started.key, space: null });
      this.select(started);
      const lead = leadOf(started);
      if (lead && hasPane(lead)) run("pane.focus", { terminal: lead });
    }
    view.selectedKey = this.followSelection(allItems, view.focusedAgent);
    if (!props()?.overlay) {
      this.arrive(allItems);
      this.takeAct(allItems, cx);
      this.toastWaits(m.items);
      this.composeFromButton(area, cx);
      if (shared(COMPOSE_CLOSE)) {
        setShared(COMPOSE_CLOSE, null);
        if (this.composing) this.closeComposer(cx);
      }
      // Ctrl-S / pressed while the list was hidden: its search opens now it shows.
      if (shared(SEARCH_OPEN)) {
        const at = shared(SEARCH_OPEN);
        setShared(SEARCH_OPEN, null);
        if (Date.now() - at < 10000) this.openSearch(cx);
      }
    }
    this.recordTick(terms, m.all, now, this.reach, view.focusedAgent, cx);

    const groups = model.groupItems(items, this.changes, now, listed, seen);
    if (pending.length && !groups.some((g) => g.id === "working")) {
      const after = groups.findIndex((g) => g.id === "idle" || g.id === "earlier");
      groups.splice(after < 0 ? groups.length : after, 0, { id: "working", label: "Working", status: "working", items: [] });
    }
    const sections = groups.map((g) => ({ g, entries: model.mergeIdentical(g.id, g.items) }));
    view.notes = model.repeatNotes(sections.flatMap((s) => s.entries));
    view.chipSlot = sections.some((s) => s.entries.some((e) => e.dup || e.tree.length || e.leftOvers.length));
    // The list's width (the window is 320px), and what a row's line has left for its title and
    // extras after the tile, age, mark, paddings and gaps (and the chip column when there is one).
    view.listWidth = props()?.overlay ? 320 : find(layout(), "sidebar")?.size?.px ?? Infinity;
    this.listWidthNow = view.listWidth;
    view.wide = view.listWidth >= model.NARROW_LIST;
    view.lineWidth = view.wide ? view.listWidth - 125 - (view.chipSlot ? 27 : 0) : view.listWidth - 117;
    const onArea = (name) => model.areaOf(config, name, null) === area
      || items.some((i) => i.machine === name) || shells.some((s) => s.machine === name);

    const root = v_flex()
      .id("at-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_color(t.foreground)
      .text_size(13)
      .track_focus(this.h)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        cx.stop_propagation();
        if (this.renaming) this.endRename(cx);
        else if (this.searching) this.closeSearch(cx);
        else if (this.composing && !props()?.overlay) this.closeComposer(cx);
        else this.dismiss();
      });

    if (narrow()) {
      const down = this.machineLines(t, onArea, true);
      return root
        .child(v_flex().id("at-list").flex_1().min_h(0).pt(6).pb(6).items_center().overflow_y_scrollbar()
          .children(this.railRows(t, sections, shells, view)))
        .when(Boolean(down), (el) => el.child(down));
    }

    const rows = [];
    let selectedRow = -1;
    const query = this.searching ? this.searchInput.value().trim() : "";
    const found = query ? model.searchItems([...workList, ...loose], query, here()) : null;
    this.matchedIn = new Set((found ?? []).filter((r) => r.inMember).map((r) => r.item.key));
    this.matchedMembers = new Set((found ?? []).flatMap((r) => [...r.members]));
    if (found) {
      // A result from another area says which.
      for (const { item } of found) {
        const ar = areaOfItem(item);
        if (ar !== area) view.notes.set(item.key, this.config.areas.find((a) => a.id === ar)?.label ?? ar);
      }
      // It counts tasks; a match in a worker is marked on that worker's row.
      rows.push(this.groupHeader(t, { id: "results", label: found.length ? (found.length === 1 ? "1 task" : `${found.length} tasks`) : "Nothing found", status: null }, null, true));
      for (const { item } of found) {
        if (item.key === view.selectedKey) selectedRow = rows.length;
        const g = model.groupItems([item], this.changes, now, listed, seen)[0]?.id ?? "idle";
        rows.push(...(item.leftOver ? [this.leftRow(t, item, view)] : this.itemRow(t, item, view, g)));
      }
    }
    for (const { g, entries } of found ? [] : sections) {
      const extra = g.id === "working" ? pending : [];
      rows.push(this.groupHeader(t, g, g.items.length + extra.length, rows.length === 0));
      if (this.folded.has(g.id)) continue;
      rows.push(...extra.map((p) => this.pendingRow(t, p)));
      const cut = g.id === "done" && entries.length > DONE_SHOWN;
      const shown = cut && this.folded.has("done-more") ? entries.slice(0, DONE_SHOWN) : entries;
      for (const e of shown) {
        if (e.key === view.selectedKey) selectedRow = rows.length;
        rows.push(...(e.dup ? this.dupRows(t, e, view, g.id) : this.itemRow(t, e, view, g.id)));
      }
      if (cut) rows.push(this.moreRow(t, this.folded.has("done-more") ? entries.length - DONE_SHOWN : 0));
    }
    // One or two spaces with only shells: plain rows at the bottom; a group with its fold from three.
    if (shells.length >= 3 && !found) {
      rows.push(this.groupHeader(t, { id: "spaces", label: "Spaces", status: null }, shells.length, rows.length === 0));
      if (!this.folded.has("spaces")) rows.push(...shells.map((s) => this.shellRow(t, s, view)));
    }
    if (leftHere.length && !found) {
      rows.push(this.groupHeader(t, { id: "leftover", label: "Left over", status: null }, leftHere.length, rows.length === 0,
        (cx) => this.openItemMenu(leftHere, "leftover", cx, true)));
      if (!this.folded.has("leftover")) rows.push(...leftHere.map((i) => this.leftRow(t, i, view)));
    }
    if (shells.length && shells.length < 3 && !found) rows.push(div().h(10).flex_none(), ...shells.map((s) => this.shellRow(t, s, view)));

    // The selected row stays in view when the selection changes or the card beside it resizes
    // (tower-stack sizes its card to its content).
    const scrollFor = `${view.selectedKey}|${find(layout(), "tower-detail")?.size?.px ?? ""}`;
    if (selectedRow >= 0 && scrollFor !== this.scrolledFor) this.scroll.scroll_to_item(selectedRow);
    this.scrolledFor = scrollFor;

    const doneLines = this.signal() === "line"
      ? this.config.areas.filter((a) => news.has(a.id)).map((a) => this.doneLine(t, a.id, news.get(a.id), now))
      : [];
    // Views switch "bottom": a row at the foot of the list, far from the area words.
    const bottom = !props()?.overlay && viewSwitch() === "bottom"
      ? v_flex().flex_none().when(Boolean(this.recipeChips(t)), (el) => el.child(div().pt(6).border_t(1).border_color(t.border).child(this.recipeChips(t)))).child(this.viewRow(t, true))
      : null;
    const down = this.machineLines(t, onArea, false, doneLines);
    return root
      // The Eye covers every area: its row sits above the area row, the composer under the plus.
      .when(Boolean(this.eye), (el) => el.child(div().flex_none().pl(8).pr(14).pb(4).child(this.eyeRow(t, view))))
      .child(this.topRow(t, needCounts, news, now))
      .when(!props()?.overlay && viewSwitch() === "menu" && Boolean(this.recipeChips(t)), (el) => el.child(this.recipeChips(t)))
      .when(this.composing, (el) => el.child(this.composer(t, area, listed)))
      .when(this.searching, (el) => el.child(this.searchRow(t)))
      .when(!props()?.overlay && viewSwitch() === "menu" && Boolean(this.backChip(t)), (el) => el.child(h_flex().flex_none().px(16).pb(4).child(this.backChip(t))))
      .child(v_flex().id("at-list").flex_1().min_h(0).pl(8).pr(14).pb(8).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        .when(!items.length && !pending.length && !this.composing, (el) => el.child(div().px(8).pt(4).pb(4).text_size(12).text_color(t.dim)
          .child("No tasks")))
        .children(rows))
      .when(Boolean(bottom), (el) => el.child(bottom))
      .when(Boolean(down), (el) => el.child(down));
  }

  // ── The recorder (needs-timeline.md): the files under <tower folder>/timeline. ──

  // The recorder's lease: model.leaseKeeper on <tower folder>/recorder.lease (no redraw), renewed
  // every 20 s and free after 45 s, looked at every 20 s by each copy that can record (the docked
  // list, the stage). A copy that takes it reads the record again first (another copy wrote it
  // meanwhile), then starts with the old holder's last renewal as its sign of life: a takeover after
  // a reload leaves at most about a minute unrecorded and draws no false "Herdr was closed" band.
  startRecorder(cx) {
    this.rec = null;
    this.recReady = false;
    this.recDirty = false;
    this.screensDirty = false;
    this.flushing = false;
    this.recKeeper = model.leaseKeeper({ path: `${towerDir()}/recorder.lease`, id: this.id, read: (p) => readTextFile(p), write: writeTextFile,
      ms: model.REC_LEASE_MS });
    // Every 20 s: the holder renews (a write, no read); a copy without it looks whether it is free.
    const tick = () => {
      if (this.recKeeper.held()) {
        this.recKeeper.take();
        return;
      }
      this.recKeeper.take().then(async (ok) => {
        if (!ok) return;
        await this.loadRecord();
        this.recReady = true;
        cx.notify();
      });
    };
    cx.spawn(async () => {
      await exec("mkdir", ["-p", recDir()]).catch(() => null);
      tick();
    });
    cx.timer.every(model.REC_LEASE_RENEW_MS, tick);
    cx.timer.every(5000, () => {
      this.flushRecord(false).catch(() => null);
    });
    // The long past: once an hour, and soon after a start.
    cx.timer.after(90000, () => this.movePast());
    cx.timer.every(3600000, () => this.movePast());
  }

  // The record as the files hold it now (events, screens, the newer beat), before recording.
  async loadRecord() {
    this.recText = null;
    this.screens = {};
    this.screensText = null;
    this.started = false;
    this.recordedAll = null;
    {
      const [ev, sc, beat] = await Promise.all([readRecorderFile(`${recDir()}/events.json`), readRecorderFile(`${recDir()}/screens.json`),
        readTextFile(`${recDir()}/beat.json`).catch(() => null)]);
      this.beatText = beat;
      this.recText = ev.text;
      this.screensText = sc.text;
      try {
        this.rec = ev.text ?? ev.big ? JSON.parse(ev.text ?? ev.big) : model.newRecord();
      } catch {
        this.rec = model.newRecord();
      }
      try {
        this.screens = sc.text ?? sc.big ? JSON.parse(sc.text ?? sc.big) : {};
      } catch {
        this.screens = {};
      }
      // The last beat may be newer than events.json's (written on its own while nothing changed).
      try {
        this.rec.beat = Math.max(this.rec.beat ?? 0, Number(JSON.parse(beat ?? "null")?.beat) || 0);
      } catch {}
      // A file found over the limit is written anew, trimmed, at the next flush.
      if (ev.big != null) {
        this.recDirty = true;
        this.recBig = true;
      }
      if (sc.big != null) {
        this.screensDirty = true;
        this.screensBig = true;
      }
    }
  }

  // A recorder JSON file: {value, text}, text being what a write must expect (null when absent or
  // moved aside for being over 1 MiB); fresh() when there is none or it does not parse.
  async readJson(path, fresh) {
    const got = await readRecorderFile(path);
    let value = null;
    try {
      value = got.text ?? got.big ? JSON.parse(got.text ?? got.big) : null;
    } catch {}
    return { value: value ?? fresh(), text: got.text };
  }

  // Writes what readJson read (throws when someone else changed it): the text written.
  async writeJson(path, value, expected) {
    const text = JSON.stringify(value);
    await writeTextFile(path, text, expected);
    return text;
  }

  // The long past (timeline-long.md): what events.json holds past 2 days moves into the task files,
  // which are thinned by age; tasks end and, 90 days later, fold into ended.json; the folder keeps
  // its budget. Only the lease holder; a failure leaves events.json as it was, to try next hour.
  async movePast() {
    if (!this.liveKeys || this.moving || !this.holdsRecorder()) return;
    this.moving = true;
    const dir = recDir();
    try {
      const now = Date.now();
      await exec("mkdir", ["-p", `${dir}/tasks`]);
      const part = model.takeOlder(this.rec, now);
      const idx = await this.readJson(`${dir}/index.json`, model.newIndex);
      const end = await this.readJson(`${dir}/ended.json`, model.newEnded);
      const index = idx.value;
      const ended = end.value;
      // Written again only when something in them changed.
      const indexWas = JSON.stringify({ ...index, at: 0 });
      const endedWas = JSON.stringify(ended);
      const gapKey = (g) => `${g.m}|${g.from}`;
      index.gaps = [...new Map([...index.gaps, ...part.gaps].map((g) => [gapKey(g), g])).values()].sort((x, y) => x.from - y.from);
      const parts = new Map(part.tasks.map((t) => [t.key, t]));
      // Timeline's rebuilt pasts go into the task files too (backfill.json drops them after 7 days).
      const fill = (await this.readJson(`${dir}/backfill.json`, () => ({}))).value;
      // A file is written for new events or rebuilt pasts, or for its daily thinning (a few a pass).
      // An end is the index's: the file gets it at its next write.
      model.settleEnds(index, this.liveKeys, now);
      const touch = new Set([...parts.keys(), ...model.rebuiltTasks(fill, this.rec, index), ...model.thinDue(index, now)]);
      const save = async (key, change) => {
        const path = `${dir}/${index.tasks[key]?.file ?? model.taskFileName(key)}`;
        const got = await this.readJson(path, () => null);
        const file = change(got.value);
        if (!file) return delete index.tasks[key];
        const text = await this.writeJson(path, file, got.text);
        index.tasks[key] = model.indexEntry(file, model.utf8Bytes(text), now);
      };
      for (const key of touch) {
        await save(key, (file) => {
          const f = parts.has(key) ? model.addToTaskFile(file, parts.get(key)) : file;
          if (!f) return null;
          model.addRebuilt(f, fill);
          f.ended = index.tasks[key] ? index.tasks[key].ended : this.liveKeys.has(key) ? null : now;
          model.thinTaskFile(f, now);
          model.fitTaskFile(f, now);
          return f;
        });
      }
      // 90 days after it ended, a task is one line in ended.json; its file goes.
      const fold = async (key) => {
        const e = index.tasks[key];
        const path = `${dir}/${e.file}`;
        const got = await this.readJson(path, () => null);
        // Its end is the index's (a file gets its end only at its next write).
        if (got.value) ended.tasks[key] = model.taskSummary({ ...got.value, ended: e.ended ?? got.value.ended });
        await exec("rm", ["-f", path]);
        delete index.tasks[key];
      };
      for (const [key, e] of Object.entries(index.tasks)) if (e.ended != null && now - e.ended >= model.ENDED_KEEP_MS) await fold(key);
      model.pruneEnded(ended, now);
      // The folder's budget, in the design's order, measured again after each step.
      const du = await exec("du", ["-sk", dir]).catch(() => null);
      let total = Number(du?.stdout?.split(/\s/)[0] ?? 0) * 1024;
      if (total > model.FOLDER_BUDGET) {
        for (const st of model.budgetSteps(index)) {
          if (total <= model.FOLDER_BUDGET) break;
          const before = index.tasks[st.key]?.bytes ?? 0;
          if (!index.tasks[st.key]) continue;
          if (st.step === "fold") await fold(st.key);
          else await save(st.key, (f) => f && (st.step === "looks" ? model.dropOldLooks(f, now) : model.coarsenTask(f, now)));
          total -= before - (index.tasks[st.key]?.bytes ?? 0);
        }
        logTrim("tasks", 1, "passed the 25 MB budget");
      }
      // index.json under the file limit: the tasks ended longest ago fold first.
      for (const [key] of Object.entries(index.tasks).filter(([, e]) => e.ended != null).sort(([, x], [, y]) => x.ended - y.ended)) {
        if (model.utf8Bytes(JSON.stringify(index)) <= model.REC_FILE_MAX) break;
        await fold(key);
      }
      const changed = JSON.stringify({ ...index, at: 0 }) !== indexWas;
      if (JSON.stringify(ended) !== endedWas) await this.writeJson(`${dir}/ended.json`, ended, end.text);
      if (changed) {
        index.at = now;
        await this.writeJson(`${dir}/index.json`, index, idx.text);
      }
      this.rec.moved = part.cut;
      this.recDirty = true;
      setShared(RECORDED, now);
    } catch (e) {
      if (!this.moveFailed) console.log(`agent-tower: timeline: moving the past into ${dir}/tasks failed, events.json keeps it: ${e?.message ?? e}`);
      this.moveFailed = true;
    } finally {
      this.moving = false;
    }
  }

  // Whether this copy writes the record: it holds the lease and has read the record since taking it.
  holdsRecorder() {
    return Boolean(this.recKeeper?.held() && this.recReady && this.rec);
  }

  recordTick(terms, all, now, reach, focus, cx) {
    if (!this.holdsRecorder()) return;
    if (!this.started) {
      this.started = true;
      model.recordStart(this.rec, now, this.recKeeper.otherAt());
      this.recDirty = true;
    }
    // A look is focus inside an active window; Herdr in the background is no look.
    const active = Boolean(window()?.active);
    const look = active ? focus ?? null : undefined;
    // For use.md's time on screen: when this window starts, gains or loses focus, and a beat
    // every 10 minutes while it has it.
    if (!this.useStarted) {
      this.useStarted = true;
      logUse("start", null, null, null);
    }
    if (active !== this.wasActive) {
      this.wasActive = active;
      this.lastBeat = now;
      logUse("active", null, active, null);
    } else if (active && now - (this.lastBeat ?? now) > model.USE_BEAT_MS) {
      this.lastBeat = now;
      logUse("beat", null, null, null);
    }
    // The model was reused (nothing it reads changed) and the look is the same: nothing to record.
    if (all === this.recordedAll && look === this.recordedLook) return;
    this.recordedAll = all;
    this.recordedLook = look;
    this.liveKeys = new Set(all.map((i) => i.key));
    const { dirty, toRead } = model.recordStep(this.rec, { terms, all, now, reach, look });
    if (dirty) this.recDirty = true;
    for (const r of toRead) this.readScreen(r, cx);
  }

  readScreen({ a, at }, cx) {
    cx.spawn(async () => {
      const r = await hc(["read", a, "--lines", "18"]).catch(() => null);
      if (r?.code !== 0 || !r.stdout) return;
      this.screens[`${a}@${at}`] = r.stdout.slice(-model.SCREEN_MAX);
      this.screensDirty = true;
    });
  }

  async flushRecord(force) {
    if (this.flushing || !this.holdsRecorder()) return;
    const now = Date.now();
    // The beat: written with the record, and at a close, so a quit's gap starts at the quit. In
    // between, the recorder lease's renewals are the sign of life (recordStart), so an idle record
    // is not rewritten.
    if (force) this.recDirty = true;
    if (!this.recDirty && !this.screensDirty) return;
    this.flushing = true;
    try {
      const news = Boolean(this.screensDirty || this.recDirty);
      if (this.recDirty) {
        this.recDirty = false;
        this.rec.beat = now;
        model.pruneRecord(this.rec, now);
        // One stringify per flush; the bytes are counted only when they could be over.
        let text = JSON.stringify(this.rec);
        if (!model.fitsBytes(text, model.REC_FILE_MAX)) {
          logTrim("events.json", model.fitRecord(this.rec), this.recBig ? "was over 1 MiB" : "grew too big");
          text = JSON.stringify(this.rec);
        }
        const out = await writeMerged(`${recDir()}/events.json`, this.rec, this.recText, (theirs, mine) => {
          const merged = model.mergeRecords(theirs, mine);
          logTrim("events.json", model.fitRecord(merged), "grew too big");
          return merged;
        }, text);
        this.rec = out.value;
        this.recText = out.text;
      }
      if (this.screensDirty) {
        this.screensDirty = false;
        const all = Object.keys(this.screens).length;
        this.screens = model.keepScreens(this.screens, now, this.rec);
        if (this.screensBig) logTrim("screens.json", all - Object.keys(this.screens).length, "was over 1 MiB");
        const out = await writeMerged(`${recDir()}/screens.json`, this.screens, this.screensText,
          (theirs, mine) => model.keepScreens({ ...theirs, ...mine }, now, this.rec));
        this.screens = out.value;
        this.screensText = out.text;
      }
      // Timeline reads the files again only when there is something new in them.
      if (news) setShared(RECORDED, now);
    } catch {
      // Both writes failed (another writer between our read and write): next tick tries again.
      this.recDirty = true;
    } finally {
      this.flushing = false;
    }
  }

  // A switch between the sidebar layouts (tower, tower-stack, …) is a variant you pick: logged once,
  // by the docked list, when the layout it starts in differs from the last one seen. An area's own
  // layout is not a variant (that switch is logged as the area); the last other one is where an
  // area without its own returns.
  noteLayout() {
    const now = shared("layout");
    const was = shared(LAST_LAYOUT);
    if (!now || now === was) return;
    setShared(LAST_LAYOUT, now);
    const own = (n) => liveConfig.areas.some((a) => a.layout === n);
    if (!own(now) && now !== WINDOW_LAYOUT && shared(BASE_LAYOUT) !== now) setShared(BASE_LAYOUT, now);
    const sidebar = (n) => n && n.startsWith("tower") && n !== WINDOW_LAYOUT && !own(n);
    if (sidebar(was) && sidebar(now)) logUse("layout", was, now, "herdr");
  }

  // After an area switch (in this copy, or in the copies of the area's own window): its selected
  // task, its shape and view, and the terminal it was left on come back, once. Not logged.
  arrive(items) {
    if (!this.configLoaded) return;
    const a = shared(ARRIVE);
    if (!a || a.area !== shared(AREA)) return;
    setShared(ARRIVE, null);
    // Arriving with nothing remembered: still the area's own first task.
    if (Date.now() - a.at > 30000) return;
    // Its own last task, else its first one (Needs you first): never another area's.
    const own = items.filter((i) => i.area === a.area && !i.leftOver);
    const order = ["needs", "pinned", "done", "working", "idle", "earlier"];
    const first = [...own].sort((x, y) => order.indexOf(x.state === "needs" ? "needs" : x.group) - order.indexOf(y.state === "needs" ? "needs" : y.group)
      || (y.changed ?? 0) - (x.changed ?? 0))[0] ?? null;
    const remembered = a.selected ? own.find((i) => i.key === a.selected) ?? null : null;
    const item = remembered ?? first;
    // No task of its own: one of its own spaces, if it has one, not the last area's terminal (AL4).
    if (!item) {
      const space = model.shellSpaces(spaces(), terminals()).find((sp) => model.areaOf(liveConfig, sp.machine, null) === a.area);
      if (space) run("space.select", { id: space.id });
    }
    this.select(item);
    setShared(PIN, item ? { key: item.key, space: null } : null);
    const v = viewNow();
    applyShape(v.view, v.shape);
    // Its own last terminal, else the selected task's lead; in its pane, on the list's screen.
    const focus = (a.focus && own.some((i) => i.live.some((t) => t.address === a.focus)) ? a.focus : null) ?? leadOf(item);
    if (focus && v.view === "list" && hasPane(focus)) run("pane.focus", { terminal: focus });
    else if (a.peek && focus) goTo(focus);
  }

  // Into a task from a view: selected, the list's screen back (the sidebar shown), its lead open
  // (a pane where it has one, else the peek), and the view kept one step back (VIEW.from).
  // agent: open this terminal (its pane, else the peek) instead of the lead. A task from another
  // area brings that area's window first (choice 3), and the new window's list finishes it.
  goInto(item, { agent = null, how = "task" } = {}) {
    if (!item) return;
    const v = viewNow();
    const target = agent ?? leadOf(item);
    const from = v.view !== "list" ? { view: v.view, shape: v.shape } : v.from ?? null;
    const otherArea = item.area && item.area !== shared(AREA);
    if (otherArea && choice("otherArea") === "switch") {
      goArea(item.area, how);
      setView({ view: "list", shape: v.shape }, how);
      setShared(VIEW, { ...viewNow(), from });
      setShared(ARRIVE, { area: item.area, selected: item.key, focus: target, peek: true, at: Date.now() });
      return;
    }
    this.select(item);
    setShared(PIN, { key: item.key, space: null });
    if (otherArea) setShared(AREA, item.area);
    const leaving = shared("layout") === WINDOW_LAYOUT;
    setView({ view: "list", shape: v.shape }, how);
    setShared(VIEW, { ...viewNow(), from });
    // Leaving tower-window is a layout switch: the next layout's list opens it.
    if (leaving) setShared(ARRIVE, { area: item.area ?? shared(AREA), selected: item.key, focus: target, peek: true, at: Date.now() });
    else if (target) goTo(target);
  }

  // A terminal of no task (the Eye): open on the list's screen, the view kept one step back.
  openHere(address, how) {
    const v = viewNow();
    const from = v.view !== "list" ? { view: v.view, shape: v.shape } : v.from ?? null;
    setView({ view: "list", shape: v.shape }, how);
    setShared(VIEW, { ...viewNow(), from });
    goTo(address);
  }

  // A request on the act channel (ACT), carried out here once: by the docked list while it shows,
  // by the stage while the list is hidden.
  takeAct(items, cx) {
    if (!this.configLoaded) return;
    const req = shared(ACT);
    const actor = props()?.stage ? sidebarHidden() && !props().view : !props()?.overlay && !props()?.stage && !sidebarHidden();
    if (!actor) return;
    if (shared(ACTOR) !== this.id) setShared(ACTOR, this.id);
    if (!req) return;
    setShared(ACT, null);
    if (Date.now() - (req.at ?? 0) > 10000) return;
    const byKey = req.key ? items.find((i) => i.key === req.key) ?? null : null;
    const byAddress = req.address ? model.itemHolding(items, req.address) : null;
    if ((req.action === "enter" || req.action === "open") && !byKey && !byAddress && req.address) this.openHere(req.address, req.how ?? "agent");
    else if (req.action === "enter") this.goInto(byKey ?? byAddress, { agent: req.agent ?? null, how: req.how ?? "task" });
    else if (req.action === "open") {
      // An agent clicked in a view: into its task with it open, or (choice 2) a peek over the view.
      if (choice("agentInView") === "into" || viewNow().view === "list") this.goInto(byAddress, { agent: req.address, how: "agent" });
      else {
        this.pick(byAddress, null);
        goTo(req.address);
      }
    } else if (req.action === "pick") this.pick(byKey, req.moment ?? null);
    else if (req.action === "menu") {
      if (req.area) this.openAreaMenu(req.area);
      else if (byKey) this.openItemMenu([byKey], byKey.key, null, false, null, Boolean(props()?.stage));
      else if (req.address) this.openAgentMenu(req.address);
    }
  }

  // The right-click menu of a thing, opened from the click itself (a view's): a task's, an agent's
  // or an area's, "from" the copy that acts.
  openMenuFor(thing, items) {
    const from = shared(ACTOR) ?? this.id;
    // Its tooltip waits until the pointer leaves the thing (ui.menuFor, ui.leftMenuFor).
    this.menuFor = thing?.task?.key ?? thing?.agent ?? thing?.area ?? null;
    if (thing?.task) {
      const item = items.find((i) => i.key === thing.task.key) ?? thing.task;
      openOverlay({ mod: "agent-tower", kind: "popup", width: 250, height: 262, props: {
        menu: true, from, keys: [item.key], space: item.space?.id ?? null, rail: from !== this.id || Boolean(props()?.stage), leftOnly: false,
        leftOf: null, area: shared(AREA), areas: (this.config ?? liveConfig).areas,
      } });
    } else if (thing?.agent) {
      const t = terminals().find((x) => x.address === thing.agent);
      const eye = t?.labels?.["tower.eye"] === "1";
      openOverlay({ mod: "agent-tower", kind: "popup", width: 230, height: 10 + 2 * 31, props: { menu: true, agentActs: thing.agent, name: eye ? "the Eye" : t?.name || t?.program?.name || thing.agent, eye, from } });
    } else if (thing?.area) this.openAreaMenu(thing.area);
  }

  // Selects a task without leaving the view (a Timeline moment, a peek): Details follows.
  pick(item, moment) {
    this.select(item);
    setShared(PIN, item ? { key: item.key, space: null } : null);
    if (item?.area && item.area !== shared(AREA)) setShared(AREA, item.area);
    if (moment) setShared(MOMENT, { key: item?.key ?? null, ...moment });
  }

  // A task clicked in the list (a row, a search hit, a merged member, a rail dot, a done line):
  // into the task (rule 1); while a view is up, choice 1 may keep the view and peek instead.
  enterRow(item, groupId = null) {
    if (!item) return;
    if (groupId) this.see(item, groupId);
    if (viewNow().view !== "list" && choice("listInView") === "peek") {
      const lead = leadOf(item);
      this.select(item, lead);
      if (lead) this.go(lead);
      return;
    }
    this.goInto(item, { how: "click" });
  }

  // A recipe button was pressed (the bar or the views menu): the composer opens on that recipe.
  composeFromButton(area, cx) {
    const c = shared(COMPOSE);
    if (!c) return;
    setShared(COMPOSE, null);
    if (Date.now() - c.at > 10000) return;
    // "New task" from the area's menu: the composer as + opens it.
    if (!c.recipe) return this.openComposer(cx);
    if (!this.config.recipes.some((r) => r.id === c.recipe && r.area === area)) return;
    this.recipeChoice[area] = c.recipe;
    this.openComposer(cx);
    this.chosen = "lead";
  }

  // A kept worker's tab, once Herdr has made it (its herdr.tab label), gets the worker's name;
  // a wish older than a minute is dropped.
  nameKeptTabs() {
    const kept = shared(KEPT) ?? [];
    if (!kept.length) return;
    const now = Date.now();
    const left = kept.filter((k) => {
      if (now - (k.at ?? 0) > 60000) return false;
      const tab = terminals().find((x) => x.address === k.address)?.labels?.["herdr.tab"];
      const found = tab && spaces().flatMap((sp) => sp.tabs).find((tb) => tb.id === tab || tb.id.endsWith(`/${tab}`));
      if (!found) return true;
      if (!found.named) run("tab.rename", { id: found.id, name: k.name });
      return false;
    });
    if (left.length !== kept.length) setShared(KEPT, left);
  }

  // The area's recipe buttons as a row of chips (with the header icon, B, and the foot row, C, whose
  // own rows have no room for them); null when the area has none.
  recipeChips(t) {
    const buttons = buttonsOf(shared(AREA));
    if (!buttons.length) return null;
    return h_flex().id("at-recipes").flex_none().px(16).pb(6).gap(6).items_center()
      .children(buttons.map((r) => control(h_flex().id(`at-rchip-${r.id}`).h(24).px(8).gap(5).min_w(0).items_center().rounded(6).text_size(11.5)
        .text_color(t.muted).border_1().border_color(t.border).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .child(chrome("plus").size(11).flex_none()).child(div().min_w(0).truncate().child(r.label)), () => pressRecipe(r))));
  }

  // The areas, for a bar alone in the window (the list hidden): each name, its Needs you count, a
  // click to it; the shown one in the foreground.
  areaChips(t) {
    const areas = liveConfig.areas;
    if (areas.length < 2) return [];
    const m = model.taskModelOnce({ terms: terminals(), listed: new Map(agents().map((a) => [a.address, a.status])), spaces: spaces(), config: liveConfig,
      changes: new Map(), now: Date.now() }, (this.chipsMemo ??= {}));
    const needs = model.areaNeeds(m.items, (i) => i.area);
    const shown = shared(AREA);
    return areas.map((a) => control(h_flex().id(`at-barea-${a.id}`).h(24).px(6).gap(4).items_center().rounded(6).text_size(11.5).font_medium()
      .text_color(a.id === shown ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground))
      .child(a.label)
      .when((needs.get(a.id) ?? 0) > 0, (el) => el.child(h_flex().h(14).min_w(14).px(4).items_center().justify_center().rounded(4)
        .bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).child(String(needs.get(a.id))))),
    () => goArea(a.id, "click")));
  }

  // "‹ Board": back to the view a task was opened from (one step), where the switch sits.
  backChip(t) {
    const from = viewNow().from;
    const x = from && viewNow().view === "list" ? viewsOf(shared(AREA)).find((y) => y.id === from.view) : null;
    if (!x) return null;
    return control(h_flex().id("at-back").flex_none().h(24).px(7).gap(4).items_center().rounded(6).text_size(11.5).font_medium()
      .text_color(t.foreground).bg(t.hover).hover((s) => s.bg(t.selected))
      .tooltip(`${x.label} (${x.key.replace("ctrl-s ", "Ctrl-S ").toUpperCase()})`)
      .child(chrome("chevron-left").size(12).flex_none()).child(viewIcon(x.icon).size(12).flex_none()).child(x.label),
    () => setView({ view: from.view, shape: from.shape }, "back"));
  }

  // Views switch "menu": a popup under its icon with the views, their keys, and the shape.
  openViewMenu(cx, press) {
    const views = viewsOf(shared(AREA)).map((x) => x.id);
    const buttons = buttonsOf(shared(AREA)).map((r) => ({ id: r.id, label: r.label }));
    openOverlay({ mod: "agent-tower", kind: "popup", width: 240, height: 10 + (views.length + buttons.length + 1) * 31, props: { menu: true, views, buttons } });
  }

  // "view-board" from keys.json: that view; "view-shape" flips the shape.
  viewKey(c) {
    if (c === "search") askSearch();
    else if (c === "area-next") nextArea("key");
    else if (c === "view-shape") setView({ shape: viewNow().shape === "window" ? "sidebar" : "window" }, "key");
    else if (VIEWS.some((v) => `view-${v.id}` === c)) setView({ view: c.slice(5) }, "key");
  }

  // The view icons, always on screen: in the list's header, and in the stage's own bar when the
  // stage takes the whole window. Then the shape toggle while a view other than the list shows.
  // The views as tabs (icons; the shown one named), the shape toggle at the right when a view is up.
  // atBottom: the list's foot, with a border above.
  viewRow(t, atBottom = false) {
    const v = viewNow();
    // Above the centre there is room to name every view; in the list only the shown one.
    const named = (x) => v.view === x.id || Boolean(props()?.viewBar);
    const tab = (x) => control(h_flex().id(`at-view-${x.id}`).h(24).px(7).gap(5).items_center().rounded(6).text_size(11.5).font_medium()
      .text_color(v.view === x.id ? t.foreground : t.dim).when(v.view === x.id, (el) => el.bg(t.hover))
      .hover((s) => s.text_color(t.foreground))
      // Only an unnamed icon gets a tooltip (in the bar every view is named; one there covered the next tab).
      .when(!named(x), (el) => el.tooltip(`${x.label} (${x.key.replace("ctrl-s ", "Ctrl-S ").toUpperCase()})`))
      // The shown view says its name; the others are icons (four names don't fit 268px).
      .child(viewIcon(x.icon).size(13).flex_none()).when(named(x), (el) => el.child(x.label)), () => setView({ view: x.id }, "click"));
    // Alone at the top of the window (the sidebar hidden), it leaves macOS its window buttons.
    const lights = Boolean(props()?.viewBar) && sidebarHidden() && window()?.platform === "macos";
    return h_flex().id("at-views").h(32).flex_none().pl(lights ? 84 : 10).pr(10).gap(2).items_center()
      .when(atBottom, (el) => el.border_t(1).border_color(t.border))
      .when(Boolean(this.backChip(t)), (el) => el.child(this.backChip(t)).child(div().w(6)))
      // Alone in the window, the bar says which area this is, and what needs you in the others.
      .when(Boolean(props()?.viewBar) && sidebarHidden(), (el) => el.children(this.areaChips(t)).child(div().w(1).h(16).mx(8).bg(t.border)))
      .children(viewsOf(shared(AREA)).map(tab))
      .child(div().flex_1())
      // Above the centre: the area's recipe buttons, then the shape toggle.
      .when(Boolean(props()?.viewBar), (el) => el.children(buttonsOf(shared(AREA)).map((r) => control(h_flex().id(`at-btn-${r.id}`).h(24).px(8).gap(5)
        .items_center().rounded(6).text_size(11.5).text_color(t.muted).border_1().border_color(t.border).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(`Start a task with the recipe “${r.label}”`).child(chrome("plus").size(11)).child(r.label), () => pressRecipe(r)))))
      .when(Boolean(this.shapeButton(t)), (el) => el.child(this.shapeButton(t)));
  }

  // The shape toggle, while a view other than the list shows (else null).
  shapeButton(t, inStage = false) {
    const v = viewNow();
    return v.view !== "list" || viewSwitch() === "bar" ? iconButton(t, `at-shape-${v.shape}${inStage ? "-s" : ""}`, v.shape === "window" ? "panel-left" : "monitor",
      () => setView({ shape: v.shape === "window" ? "sidebar" : "window" }, "click"),
      v.shape === "window" ? "The list beside it (Ctrl-S M)" : "The whole window (Ctrl-S M)") : null;
  }

  // The area's view icons, then the shape toggle.
  viewButtons(t, inStage = false) {
    const v = viewNow();
    return [
      ...viewsOf(shared(AREA)).map((x) => iconButton(t, `at-view-${x.id}${inStage ? "-s" : ""}`, null, () => setView({ view: x.id }, "click"),
        `${x.label} (${x.key.replace("ctrl-s ", "Ctrl-S ").toUpperCase()})`, v.view === x.id, viewIcon(x.icon))),
      this.shapeButton(t, inStage),
    ].filter(Boolean);
  }

  initStage(cx) {
    this.initEyeStart();
    this.views = {}; // view id -> {mod} or {error}
    this.viewState = {}; // view id -> the object a view keeps across renders (ui.state)
    this.selectCtx = null;
    cx.spawn(async (cx) => {
      this.config = await loadConfig();
      this.configLoaded = true;
      cx.notify();
    });
    cx.timer.every(60000, (cx) => cx.notify());
    // The perf log goes out from here too, when the docked list isn't there to send it.
    cx.timer.every(30000, () => perfLog.flush());
    // ui.notify(): a redraw asked for outside render, on a short tick.
    cx.timer.every(250, (cx) => {
      if (!this.dirty) return;
      this.dirty = false;
      cx.notify();
    });
    // Hidden in the whole-window shape, the list's copy may stop drawing: the stage can record too.
    this.id = model.newId();
    this.startRecorder(cx);
    // In the whole-window shape the list's copy is hidden: the stage takes the view keys.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        // Only the stage that follows the view takes keys (a pinned one, the watchlist, never).
        if (sidebarHidden() && !props().view) this.viewKey(c);
        cx.notify();
      }
    });
  }

  // Loads a view's file once (dynamic import: a missing or broken view shows a note, never breaks the list).
  loadView(id, cx) {
    if (this.views[id]) return this.views[id];
    this.views[id] = { loading: true };
    cx.spawn(async (cx) => {
      try {
        const mod = await import(`./${id}.js`);
        this.views[id] = typeof mod.render === "function" ? { mod } : { error: `${id}.js has no render(t, m, ui)` };
      } catch (e) {
        this.views[id] = { error: String(e?.message ?? e) };
      }
      cx.notify();
    });
    return this.views[id];
  }

  renderStage(t, cx) {
    const v = viewNow();
    const now = Date.now();
    const terms = terminals();
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    // The list's changes, converted only when its version moved (without one: every render).
    const changesV = shared(CHANGES_V) ?? null;
    if (!this.changesMap || changesV == null || changesV !== this.changesV) {
      this.changesMap = new Map(Object.entries(sharedOr(CHANGES) ?? {}));
      this.changesV = changesV;
    }
    const changes = this.changesMap;
    const seen = sharedOr(SEEN) ?? {};
    const config = this.config ?? model.DEFAULTS;
    const m = model.taskModelOnce({ terms, listed, spaces: spaces(), config, changes, changesVersion: changesV ?? undefined, seen, now,
      titles: sharedOr(TITLES) ?? {}, eye: model.findEye(terms) }, (this.modelMemo ??= {}));
    this.wordCtx = { listed, seen, now, changes };
    this.recordTick(terms, m.all, now, [], focused()?.agent ?? focused()?.terminal ?? null, cx);
    if (sidebarHidden()) this.arrive(m.all);
    this.takeAct(m.all, cx);
    this.takeRequest(cx);
    // A block may be pinned to one view (props.view: the investing window's watchlist).
    const id = props().view ?? (v.view === "list" ? "board" : v.view);
    const loaded = this.loadView(id, cx);
    const ui = {
      now,
      width: this.size?.width ?? 0,
      height: this.size?.height ?? 0,
      area: shared(AREA) ?? null,
      selectedKey: shared(SELECTED)?.key ?? null,
      // What a task row click does: select it and pin it to no space (a view shows none).
      // The grammar's helpers (paths-grammar.md): a task goes in (rule 1); with an agent, that agent
      // opens (rules 2, 3; choice 2); a moment only selects; a right-click opens the thing's menu.
      goInto: (item, { agent } = {}) => (agent ? act({ action: "open", address: agent }) : act({ action: "enter", key: item?.key })),
      select: (item) => act({ action: "enter", key: item?.key }),
      open: (address) => act({ action: "open", address }),
      openTerminal: (address) => act({ action: "open", address }),
      pick: (item, moment = null) => act({ action: "pick", key: item?.key, moment }),
      menu: (thing) => this.openMenuFor(thing, m.all),
      onMenu: (el, thing) => el.on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.openMenuFor(thing, m.all);
      }),
      choices: Object.fromEntries(Object.keys(CHOICES).map((k) => [k, choice(k)])),
      // The thing whose menu was just opened (a task key, an address or an area id): give it no
      // tooltip until the pointer leaves it, then call ui.leftMenuFor().
      menuFor: this.menuFor ?? null,
      leftMenuFor: () => {
        if (!this.menuFor) return;
        this.menuFor = null;
        this.dirty = true;
      },
      // Works after render too (a view's own file read): the stage redraws on its next 250 ms tick.
      notify: () => {
        this.dirty = true;
      },
      state: (this.viewState[id] ??= {}),
      towerDir: towerDir(),
      here: here(),
      shape: v.shape,
      hideText: shared(HIDE_TEXT) === true,
      rowMark: model.ROW_MARKS.includes(shared(ROW_MARK)) ? shared(ROW_MARK) : model.ROW_MARKS[0],
    };
    let body;
    if (loaded.mod) {
      try {
        body = timedRender(id, () => loaded.mod.render(t, m, ui));
      } catch (e) {
        body = div().p(20).text_color(t.blocked).child(`${id} could not be drawn: ${e?.message ?? e}`);
      }
    } else {
      body = div().p(20).text_color(t.dim).child(loaded.error ? `${VIEWS.find((x) => x.id === id)?.label ?? id} isn't available: ${loaded.error}` : "Loading…");
    }
    return v_flex().id("root").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => {
        this.size = size;
        cx.notify();
      })
      // A layout that gives the bar its own block (window_drag, the whole-window shape) says bar: false.
      // With the list hidden and no bar above the centre, the stage shows the switch itself.
      // (Never when the layout gives the bar a block of its own: tower-window.)
      .when(props().bar !== false || (sidebarHidden() && viewSwitch() !== "bar" && !props().view && !find(layout(), "tower-stage-bar")), (el) => el.child(this.stageBar(t)))
      .child(v_flex().flex_1().min_h(0).child(body));
  }

  // The stage's bar: the view's name; alone in the window also the view icons, room for macOS's
  // window buttons, and Herdr's window buttons where the system draws none.
  stageBar(t) {
    const v = viewNow();
    const id = v.view === "list" ? "board" : v.view;
    const alone = sidebarHidden();
    const w = window();
    const winButton = (name, command) => control(h_flex().id(`at-win-${name}`).size(26).flex_none().items_center().justify_center().rounded(6)
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).child(chrome(name).size(13)), () => run(command));
    return h_flex().id("at-stage-bar").size_full().h(36).flex_none().pr(10).gap(4).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .pl(alone && w?.platform === "macos" ? 84 : 12)
      .when(alone, (el) => el.children(this.areaChips(t)).child(div().w(1).h(16).mx(8).bg(t.border)).children([this.barEye(t)].filter(Boolean)))
      .child(div().flex_1().text_size(12.5).font_medium().text_color(t.foreground).child(VIEWS.find((x) => x.id === id)?.label ?? id))
      .children(alone ? this.viewButtons(t, true) : [this.shapeButton(t, true)].filter(Boolean))
      .when(alone && Boolean(w?.buttons), (el) => el.child(winButton("minus", "window.minimize")).child(winButton("square", "window.maximize")).child(winButton("x", "window.close")));
  }

  // The bar alone in the window: the shown area's Eye after the areas. Running: opens it (the view
  // one step back), right-click its menu, a red dot while it waits; else it starts it.
  barEye(t) {
    const area = shared(AREA);
    if (!area || model.eyeOff(liveConfig, area)) return null;
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    const eye = model.findEye(terminals(), EYE_PER_AREA ? area : null, liveConfig);
    const box = (id) => h_flex().id(id).size(26).flex_none().items_center().justify_center().rounded(6);
    if (eye) {
      return control(box("at-bar-eye").relative().text_color(t.foreground).hover((s) => s.bg(t.hover)).tooltip("Eye")
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          act({ action: "menu", address: eye.address });
        })
        .child(eyeIcon(14, t.foreground))
        .when(model.eyeWaiting(eye, listed), (el) => el.child(div().absolute().right(3).bottom(3).size(6).rounded(3).bg(t.blocked))),
      () => act({ action: "open", address: eye.address, how: "bar" }));
    }
    if (this.eyeStarting(area)) return box("at-bar-eye").opacity(0.5).tooltip("Starting the Eye…").child(eyeIcon(14, t.dim));
    return control(box("at-bar-eye").text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Start the Eye")
      .child(eyeIcon(14, t.dim)), (cx) => this.startEye(cx, area));
  }

  openSearch(cx) {
    this.searching = true;
    this.searchInput.focus();
    cx.timer.after(50, () => this.searchInput.focus());
    cx.notify();
  }

  closeSearch(cx) {
    this.searching = false;
    this.searchInput.set_value("");
    cx.notify();
  }

  searchRow(t) {
    return h_flex().id("at-search").flex_none().mx(16).mb(6).h(28).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(chrome("search").size(13).flex_none().text_color(t.dim))
      .child(Input.new(this.searchInput).flex_1().h_full().text_size(12.5).text_color(t.foreground))
      .child(control(div().id("at-search-x").flex_none().text_color(t.dim).hover((s) => s.text_color(t.foreground)).child(chrome("x").size(13)),
        (cx) => this.closeSearch(cx)));
  }

  // What Herdr's toast draws (its login and Copy case too); an agent's toast names its machine and
  // task. A click on an agent's goes into its task with that agent open, bringing its area's window
  // (choice 3) through the act channel; any other runs its action as Herdr's would.
  renderToast(t) {
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const address = (p.action?.name === "agent.focus" || p.action?.name === "agent-tower.into") ? p.action.args?.terminal ?? null : null;
    const w = address ? whereOf(address) : null;
    const body = w?.title ? `${w.word} · ${w.title}` : p.body ?? "";
    return h_flex().id("toast").size_full().px(18).gap(12).items_center().bg(t.popover).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        // The request first: this copy goes with the toast.
        if (address && w?.item) act({ action: "enter", key: w.item.key, agent: address, how: "toast" });
        else if (p.action?.name && p.action.name !== "agent-tower.into") run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[TOAST_DOT[p.level] ?? "accent"]))
      .child(v_flex().flex_1().overflow_hidden()
        .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
        .when(!login && Boolean(body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(body)))
        .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
          .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
            .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              cx.write_to_clipboard(command);
              this.copied = true;
              cx.notify();
            })
            .child(this.copied ? "Copied" : "Copy")))));
  }

  // A worker (or a lead without a pane) that starts waiting gets a toast of its own: Herdr toasts
  // only agents with a pane and no parent. Once per wait, from the docked list.
  toastWaits(items) {
    this.waitToasts ??= new Set();
    const now = new Set();
    // Every agent that waits, not only the task's first (a second worker asking is news too).
    const waiting = items.flatMap((item) => (item.leadGone ? item.tree : [{ t: item.lead, status: item.status }, ...item.tree])
      .filter((r) => r.t && r.status === "blocked").map((r) => ({ item, t: r.t })));
    for (const { item, t } of waiting) {
      const key = `${t.address}:${t.turn ?? 0}`;
      now.add(key);
      if (this.waitToasts.has(key)) continue;
      this.waitToasts.add(key);
      // Herdr already toasts an agent with a pane and no parent.
      if (agents().some((a) => a.address === t.address && a.pane) && !t.parent) continue;
      if (!this.toastsReady) continue;
      notify({ title: `${t.name || t.program?.name || "An agent"} needs you`, body: `${model.machineOf(t.address) ?? here()} · ${model.titleOf(item)}`,
        level: "error", action: { name: "agent-tower.into", args: { terminal: t.address } } });
    }
    for (const k of this.waitToasts) if (!now.has(k)) this.waitToasts.delete(k);
    // The waits already there when the list starts are not news.
    this.toastsReady = true;
  }

  // ── Where a terminal runs: the header of the list's own peek, and of panes in the tower layouts. ──

  initHead() {
    this.want = null; // a new space Keep is waiting for Herdr to make: {id, name}
    this.hovered = false;
  }

  // Keep the peeked terminal where a pane of it can live (model.keepPlan), then close the peek.
  keep(address, plan, name, cx) {
    const overlay = props().overlay;
    const v = viewNow();
    if (v.view !== "list") {
      setView({ view: "list" }, "keep");
      setShared(VIEW, { ...viewNow(), from: { view: v.view, shape: v.shape } });
    }
    // Its tab is called by its number until named: the list names it after the worker.
    const worker = terminals().find((x) => x.address === address)?.name;
    if (worker) setShared(KEPT, [...(shared(KEPT) ?? []).filter((k) => k.address !== address), { address, name: worker, at: Date.now() }]);
    if (plan.how === "space") run("space.select", { id: plan.space.id });
    if (plan.how !== "new") {
      run("terminal.keep", { terminal: address });
      closeOverlay(overlay);
      return;
    }
    // A label with a space id Herdr doesn't know makes that space on the terminal's own machine;
    // render finishes once spaces() has it (this copy stays open until then).
    const sp = `sp${hex32()}`;
    this.want = { id: plan.machine ? `${plan.machine}/${sp}` : sp, name };
    cx.spawn(async (cx) => {
      const r = await hc(["label", address, `herdr.space=${sp}`, `herdr.tab=tb${hex32()}`]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) {
        this.want = null;
        notify({ title: "Couldn't keep it", body: model.errorWords(r), level: "error" });
      }
      cx.notify();
    });
    cx.notify();
  }

  renderPeekBar(t) {
    const address = props().peekBar;
    const overlay = props().overlay;
    if (this.want && spaces().some((s) => s.id === this.want.id)) {
      run("space.rename", { id: this.want.id, name: this.want.name });
      run("space.select", { id: this.want.id });
      this.want = null;
      closeOverlay(overlay);
    }
    const w = whereOf(address);
    const name = w.t?.name || w.t?.template || w.t?.program?.name || address;
    const plan = model.keepPlan(address, w.item, spaces());
    const silent = Boolean(w.machine) && machines().find((m) => m.name === w.machine)?.layout === "unavailable";
    const button = (id, label, onClick, tip) => control(h_flex().id(id).flex_none().h(24).px(8).items_center().rounded(6).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).when(Boolean(tip), (el) => el.tooltip(tip)).child(label), onClick);
    return h_flex().size_full().pl(12).pr(6).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12.5)
      .child(machineChip(t, w.word))
      .when(Boolean(w.title), (el) => el.child(div().flex_none().max_w(320).truncate().font_medium().text_color(t.foreground).child(w.title)))
      .child(div().min_w(0).truncate().text_color(t.muted).child(name))
      .when(Boolean(WORD[w.status]), (el) => el.child(div().flex_none().text_size(11.5).text_color(t[w.status] ?? t.dim).child(WORD[w.status])))
      .child(div().flex_1())
      // A terminal with a pane (a lead, peeked while a view is up): go to it, the list back beside it.
      .child(hasPane(address) ? button("at-goto", "Go to it", () => {
        closeOverlay(overlay);
        act({ action: "enter", address, agent: address });
      }, null)
      : this.want ? div().flex_none().text_color(t.dim).child(`Opening it on ${w.word}…`)
        : silent ? div().flex_none().text_color(t.dim).child(silentWords([w.machine], "kept"))
          : button("at-keep", model.keepWords(plan, w.word), (cx) => this.keep(address, plan, w.title ? `${w.title} · ${name}` : name, cx),
            plan.how === "space" ? `Beside ${plan.space.name}` : plan.how === "new" ? `A tab called “${w.title ? `${w.title} · ${name}` : name}”` : null))
      .child(button("at-peek-x", chrome("x").size(13), () => closeOverlay(overlay), "Close"));
  }

  // Herdr's pane header (the shipped pane mod: icon, name, folder, status, split, zoom, close),
  // with the machine and the task first. Props from Herdr: { pane, terminal }.
  renderPaneHead(t) {
    const p = panes().find((x) => x.pane === props().pane);
    const address = props().terminal ?? p?.terminal;
    if (!p || !address) return div();
    const w = whereOf(address);
    // Its hc name says which worker; the icon already says which program.
    const name = w.t?.name || ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = programIcon(p.program, 14, t.dim);
    const h = home();
    const folder = !p.cwd ? "" : p.cwd === h ? "~" : p.cwd.startsWith(`${h}/`) ? `~${p.cwd.slice(h.length)}` : p.cwd;
    const pane = p.pane;
    const button = (id, icon, command, args) => div().id(id).p(3).rounded(4).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane/${icon}.svg`).size(14));
    const st = p.status;
    return h_flex().id(`at-pane-${pane}`).size_full().px(10).gap(8).items_center().bg(t.background).border_b(1).border_color(t.border).text_size(12)
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane }))
      .child(machineChip(t, w.word))
      .when(Boolean(w.title), (el) => el.child(div().id(`at-ph-task-${pane}`).flex_none().max_w(260).truncate().font_medium().text_color(t.foreground)
        .cursor_pointer().hover((s) => s.text_color(t.accent))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (w.item) act({ action: "enter", key: w.item.key, how: "pane-head" });
        })
        .child(w.title)))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(200).text_color(w.title ? t.muted : t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder))
      .when(st === "working", (el) => el.child(chrome("spinner").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, (el) => el
        .child(button(`at-ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(button(`at-ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(button(`at-ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(button(`at-ph-x-${pane}`, "close", "pane.close", { pane })));
  }

  // ── The item menu: a popup copy of this mod, opened on a right-click. ──

  initMenu() {
    this.h.focus();
    const p = props();
    this.at = p.signal ? 0
      : p.agentPick ? Math.max(0, p.agents.findIndex((a) => a.id === p.current)) : 0;
    this.asking = null; // the addresses "Close" would end, as counted for the question
    this.leadGone = null; // the ended lead's address when the task's lead is gone ("" if unknown)
    this.silent = null; // "<machine> does not answer; nothing was ended", in place of the question
    this.closeKeys = props().keys; // the items whose terminals the question is about
    this.leftOf = null; // whose left-overs the question is about (null: the Left over group)
    this.left = false; // the question is about left-over agents
  }

  // The items the menu was opened on (several for a merged row) that are still there.
  menuItems() {
    const keys = props().keys;
    const terms = terminals();
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    const spaceList = spaces();
    const all = model.workItems(terms, listed, spaceList);
    model.rememberTitles(all, sharedOr(TITLES) ?? {}, terms);
    model.placeLeftOvers(all, spaceList, listed);
    return all.filter((i) => keys.includes(i.key));
  }

  menuActions() {
    const items = this.menuItems();
    const p = props();
    const one = items.length === 1 ? items[0] : null;
    const endLeft = (left, leftOf) => ({ label: `End ${left.length} agent${left.length === 1 ? "" : "s"} left over…`, icon: "x", act: (cx) => {
      this.leftOf = leftOf;
      this.ask(cx, left.map((i) => i.key), true);
    } });
    if (p.leftOnly) return items.length ? [endLeft(items, p.leftOf)] : [];
    return [
      ...(one ? [{ label: "Details", icon: "panel-right", act: () => this.details(one) }] : []),
      // The rail has no row to rename in.
      // Herdr's pin, on the lead: the item stays at the top in Pinned.
      ...(one?.lead && !one.leadGone ? [{ label: one.pinned ? "Unpin" : "Pin to the top", icon: one.pinned ? "pin-off" : "pin", act: () => {
        run("terminal.pin", { terminal: one.lead.address, pinned: !one.pinned });
        closeOverlay(p.overlay);
      } }] : []),
      ...(one?.lead && !p.rail ? [{ label: "Rename", icon: "square-pen", act: () => this.request({ action: "rename" }) }] : []),
      // Not a task yet (an agent's own row, a space with only shells): its space becomes one (adopt.js).
      ...(p.space && (p.shellSpace || (one && !one.taskId)) ? [{ label: "Make a task", icon: "plus", act: () => this.request({ action: "adopt", space: p.space }) }] : []),
      // Herdr's words: "End" for terminals and what they started ("Close" is for spaces and panes).
      ...(items.length ? [{ label: one?.taskId ? "End task…" : items.length > 1 ? `End all ${items.length}…` : "End agent…", icon: "x", act: (cx) => this.ask(cx) }] : []),
      ...(one?.leftOvers.length ? [endLeft(one.leftOvers, one.key)] : []),
      ...(p.space ? [{ label: "Space menu", icon: "layers", divider: true, act: () => {
        closeOverlay(p.overlay);
        openSpaceMenu(p.space);
      } }] : []),
    ];
  }

  // Selects (and pins) the item and shows the panel mod's own column, tower-detail. Without that
  // node, nothing more: run() does not throw, Herdr would toast the failed layout.show.
  // Into the task (selected, lit, its lead in front: rule 10), with Details shown.
  details(item) {
    act({ action: "enter", key: item.key, how: "menu" });
    if (find(layout(), "tower-detail")) run("layout.show", { id: "tower-detail" });
    closeOverlay(props().overlay);
  }

  request(fields) {
    const p = props();
    setShared(REQUEST, { from: p.from, keys: p.keys, ...fields });
    closeOverlay(p.overlay);
  }

  // A machine that does not answer would leave half a task: then the question says so instead.
  checkMachines(cx, addresses, then) {
    cx.spawn(async (cx) => {
      const silent = await silentNow(addresses);
      if (silent.length) this.silent = silentWords(silent, "ended");
      else then();
      cx.notify();
    });
  }

  // keys: what to end (the menu's items, or their left-over agents with left).
  ask(cx, keys = props().keys, left = false) {
    const item = this.menuItems();
    this.closeKeys = keys;
    this.left = left;
    this.asking = closeAll(keys, terminals());
    this.leadGone = !left && item.length === 1 && item[0].taskId && item[0].leadGone ? item[0].lead?.address ?? "" : null;
    this.at = 0;
    this.checkMachines(cx, this.asking, () => {});
    cx.notify();
  }

  // The question was about these terminals; if the item changed since, ask again with the new count.
  // The left-over agents as they are now: an item's, or the Left over group's in that area.
  currentLeft() {
    const p = props();
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    const spaceList = spaces();
    const all = model.workItems(terminals(), listed, spaceList);
    const { loose } = model.placeLeftOvers(all, spaceList, listed);
    if (this.leftOf) return (all.find((i) => i.key === this.leftOf)?.leftOvers ?? []).map((i) => i.key);
    return loose.filter((i) => model.areaOf({ areas: p.areas }, i.machine, i.taskArea) === p.area).map((i) => i.key);
  }

  confirmClose(cx) {
    // Left-overs: the set may have grown or shrunk while the question was open; ask again.
    if (this.left) {
      const keys = this.currentLeft();
      if ([...keys].sort().join("\n") !== [...this.closeKeys].sort().join("\n")) {
        this.closeKeys = keys;
        this.asking = closeAll(keys, terminals());
        if (!this.asking.length) {
          notify({ title: "Nothing was closed", body: "Those agents are gone.", level: "warning" });
          closeOverlay(props().overlay);
        }
        cx.notify();
        return;
      }
    }
    const now = closeAll(this.closeKeys, terminals());
    if (!now.length) {
      notify({ title: "Nothing was closed", body: "That item is gone from the list.", level: "warning" });
      closeOverlay(props().overlay);
    } else if (now.join("\n") !== this.asking.join("\n")) {
      this.asking = now;
      cx.notify();
    } else this.checkMachines(cx, now, () => this.request({ action: "close", keys: this.closeKeys, addresses: now }));
  }

  // "Finished elsewhere": pick the signal; the current one is checked.
  // The switches (SWITCHES), one section each; a pick is remembered and logged.
  renderSignalMenu(t) {
    const p = props();
    const choices = SWITCHES.flatMap((sw) => sw.ids.map((id) => ({ sw, id })));
    const current = (sw) => shared(sw.key) ?? (sw.key === DONE_SIGNAL ? this.config?.doneSignal ?? "dot" : sw.ids[0]);
    const pick = ({ sw, id }) => {
      const from = current(sw);
      if (from !== id) logUse(sw.name, from, id, "menu");
      setShared(sw.key, id);
      closeOverlay(p.overlay);
    };
    return v_flex().id("at-signal").track_focus(this.h).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % choices.length;
        else if (e.key === "up") this.at = (this.at + choices.length - 1) % choices.length;
        else if (e.key === "enter") pick(choices[this.at]);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .children(SWITCHES.map((sw) => v_flex()
        .child(h_flex().h(SWITCH_HEAD).px(8).items_end().pb(3).text_size(11).text_color(t.dim).child(sw.title))
        .children(sw.ids.map((id) => {
          const i = choices.findIndex((c) => c.sw === sw && c.id === id);
          return h_flex().id(`at-sig-${sw.name}-${id}`).h(SWITCH_ROW).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).cursor_pointer()
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => pick(choices[i]))
            .child(div().w(14).flex_none().when(id === current(sw), (el) => el.child(chrome("check").size(14).text_color(t.muted))))
            .child(div().flex_1().child(sw.labels[id]));
        }))));
  }

  // "New space on…": this computer and each connected machine, Herdr's words.
  renderSpaceNewMenu(t) {
    const p = props();
    const pick = (m) => {
      closeOverlay(p.overlay);
      run("space.new", { machine: m ?? "" });
      setShared(COMPOSE_CLOSE, Date.now());
    };
    return v_flex().id("at-spacenew").track_focus(this.h).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % p.machines.length;
        else if (e.key === "up") this.at = (this.at + p.machines.length - 1) % p.machines.length;
        else if (e.key === "enter") pick(p.machines[this.at]);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .children(p.machines.map((m, i) => h_flex().id(`at-sn-${m ?? "here"}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click(() => pick(m))
        .child(chrome("server").size(14).text_color(t.muted))
        .child(div().flex_1().child(`New space on ${m ?? p.word}`))));
  }

  // The views menu (Views switch "menu"): each view with its key, the shown one checked, then the shape.
  renderViewMenu(t) {
    const p = props();
    const v = viewNow();
    const rows = [
      ...VIEWS.filter((x) => p.views.includes(x.id)).map((x) => ({ id: x.id, label: x.label, key: x.key.replace("ctrl-s ", "Ctrl-S ").toUpperCase(), on: v.view === x.id, act: () => setView({ view: x.id }, "click") })),
      ...(p.buttons ?? []).map((r) => ({ id: `btn-${r.id}`, label: `New: ${r.label}`, key: "", on: false, act: () => pressRecipe(r) })),
      ...(v.view !== "list" ? [{ id: "shape", label: v.shape === "window" ? "Show the list beside it" : "Take the whole window", key: "", on: false,
        act: () => setView({ shape: v.shape === "window" ? "sidebar" : "window" }, "click") }] : []),
    ];
    const pick = (r) => {
      closeOverlay(p.overlay);
      r.act();
    };
    return v_flex().id("at-viewmenu").track_focus(this.h).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % rows.length;
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % rows.length;
        else if (e.key === "enter") pick(rows[this.at]);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .children(rows.map((r, i) => h_flex().id(`at-vm-${r.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click(() => pick(r))
        .child(div().w(14).flex_none().when(r.on, (el) => el.child(chrome("check").size(14).text_color(t.muted))))
        .child(div().flex_1().child(r.label))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(r.key))));
  }

  // The End question's buttons, as in Herdr's menus: Keep running on `raised`, the ending one on
  // `solid`; every button has a border, the chosen one in `accent`.
  confirmButtons(t, actions) {
    return h_flex().px(3).pb(3).gap(6).justify_end().children(actions.map((a, i) => h_flex()
      .id(`at-confirm-${i}`).h(26).px(10).items_center().rounded(6).text_size(12).cursor_pointer()
      .border_1().border_color(i === this.at ? t.accent : t.input)
      .bg(a.danger ? t.solid : t.raised)
      .text_color(a.danger ? t.solid_foreground : t.foreground)
      .hover((s) => (a.danger ? s.opacity(0.9) : s.bg(t.hover)))
      .on_click((_e, cx) => a.act(cx))
      .child(a.label)));
  }

  // The Eye's menu is its End question (ending an agent cannot be undone).
  renderEyeMenu(t) {
    const p = props();
    const actions = [
      { label: "Keep the Eye", act: () => closeOverlay(p.overlay) },
      { label: "End the Eye", act: () => {
        setShared(REQUEST, { from: p.from, action: "eye-end", eye: p.eye });
        closeOverlay(p.overlay);
      }, danger: true },
    ];
    return v_flex().id("at-eye-menu").track_focus(this.h).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "right" || e.key === "down") this.at = (this.at + 1) % actions.length;
        else if (e.key === "left" || e.key === "up") this.at = (this.at + actions.length - 1) % actions.length;
        else if (e.key === "enter") actions[this.at]?.act(cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).pt(5).pb(9).whitespace_nowrap().text_color(t.foreground).child("End the Eye?"))
      .child(this.confirmButtons(t, actions));
  }

  // An agent's menu: Open (rule 2), End… (asks: "End <name>?").
  renderAgentActs(t) {
    const p = props();
    if (this.endAsk) {
      const actions = [
        { label: p.eye ? "Keep the Eye" : "Keep it", act: () => closeOverlay(p.overlay) },
        { label: p.eye ? "End the Eye" : "End it", act: () => {
          setShared(REQUEST, { from: p.from, action: "agent-end", address: p.agentActs });
          closeOverlay(p.overlay);
        }, danger: true },
      ];
      return v_flex().id("at-agent-end").track_focus(this.h).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
        .on_key_down((e, cx) => {
          if (e.key === "right" || e.key === "down") this.at = (this.at + 1) % actions.length;
          else if (e.key === "left" || e.key === "up") this.at = (this.at + actions.length - 1) % actions.length;
          else if (e.key === "enter") actions[this.at]?.act(cx);
          else if (e.key === "escape") closeOverlay(p.overlay);
          else return;
          cx.notify();
        })
        .child(div().px(8).pt(5).pb(9).whitespace_nowrap().text_color(t.foreground).child(`End ${p.name}?`))
        .child(this.confirmButtons(t, actions));
    }
    const rows = [
      { id: "open", label: "Open", icon: "terminal", act: () => {
        closeOverlay(p.overlay);
        act({ action: "open", address: p.agentActs });
      } },
      { id: "end", label: p.eye ? "End the Eye…" : "End…", icon: "x", act: (cx) => {
        this.endAsk = true;
        this.at = 1;
        cx.notify();
      } },
    ];
    return this.menuList(t, "at-agent-menu", rows);
  }

  // The area's menu: a new task here, its views, then the settings.
  renderAreaActs(t) {
    const p = props();
    const v = viewNow();
    const rows = [
      { id: "new", label: "New task", icon: "plus", act: () => {
        closeOverlay(p.overlay);
        setShared(COMPOSE, { recipe: null, at: Date.now() });
        if (sidebarHidden()) setView({ shape: "sidebar" }, "menu");
      } },
      ...VIEWS.filter((x) => p.views.includes(x.id)).map((x, i) => ({ id: `view-${x.id}`, label: x.label, glyph: viewIcon(x.icon), on: v.view === x.id,
        key: x.key.replace("ctrl-s ", "Ctrl-S ").toUpperCase(), divider: i === 0, act: () => {
          closeOverlay(p.overlay);
          setView({ view: x.id }, "menu");
        } })),
      { id: "settings", label: "Settings…", icon: "settings", divider: true, act: () => {
        closeOverlay(p.overlay);
        this.openSwitches();
      } },
    ];
    return this.menuList(t, "at-area-menu", rows);
  }

  // A plain menu: rows {id, label, icon | glyph, key?, on?, divider?, act(cx)}, arrows and Enter.
  menuList(t, id, rows) {
    const p = props();
    return v_flex().id(id).track_focus(this.h).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % rows.length;
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % rows.length;
        else if (e.key === "enter") rows[this.at]?.act(cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .children(rows.map((r, i) => v_flex()
        .when(Boolean(r.divider) && i > 0, (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`${id}-${r.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).cursor_pointer()
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => r.act(cx))
          .child((r.glyph ?? chrome(r.icon)).size(14).flex_none().text_color(r.on ? t.foreground : t.muted))
          .child(div().flex_1().when(Boolean(r.on), (el) => el.font_medium()).child(r.label))
          .when(Boolean(r.key), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(r.key))))));
  }

  // The composer's agent picker: the agents with their icons, the current one checked; a pick is
  // remembered for the recipe and used by the next start.
  renderAgentMenu(t) {
    const p = props();
    const pick = (id) => {
      setShared(LEAD_PICK, { ...(shared(LEAD_PICK) ?? {}), [p.recipe]: id });
      setShared(REQUEST, { from: p.from, action: "picked" });
      closeOverlay(p.overlay);
    };
    return v_flex().id("at-agents").track_focus(this.h).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % p.agents.length;
        else if (e.key === "up") this.at = (this.at + p.agents.length - 1) % p.agents.length;
        else if (e.key === "enter") pick(p.agents[this.at].id);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Lead agent"))
      .children(p.agents.map((a, i) => h_flex().id(`at-agent-${a.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click(() => pick(a.id))
        .child(div().w(14).flex_none().when(a.id === p.current, (el) => el.child(chrome("check").size(14).text_color(t.muted))))
        .child(div().w(14).flex_none().when(Boolean(a.program?.icon), (el) => el.child(programIcon(a.program, 14, t.foreground))))
        .child(div().flex_1().truncate().child(a.label))));
  }

  renderMenu(t) {
    const p = props();
    if (p.signal) return this.renderSignalMenu(t);
    if (p.agentActs) return this.renderAgentActs(t);
    if (p.areaActs) return this.renderAreaActs(t);
    if (p.views) return this.renderViewMenu(t);
    if (p.spaceNew) return this.renderSpaceNewMenu(t);
    if (p.agentPick) return this.renderAgentMenu(t);
    if (p.eyeMenu) return this.renderEyeMenu(t);
    const confirming = Boolean(this.asking);
    // A task whose lead is gone counts only its workers.
    const n = this.leadGone != null ? this.asking.filter((a) => a !== this.leadGone).length : this.asking?.length ?? 0;
    const actions = this.silent
      ? [{ label: "Close", act: () => closeOverlay(p.overlay) }]
      : confirming
        ? [{ label: this.left ? (n === 1 ? "Keep it" : "Keep them") : "Keep running", act: () => closeOverlay(p.overlay) },
          { label: n === 1 ? "End it" : this.left ? `End ${n} agents` : `End all ${n}`, act: (cx) => this.confirmClose(cx), danger: true }]
        : this.menuActions();
    // In lead and worker words; a merged row counts its agents.
    // A task is named by its title (rule 10: the question says which task, not "this agent").
    const task = !this.left && p.keys.length === 1 && confirming ? this.menuItems()[0] : null;
    const named = task?.taskId ? model.titleOf(task) : null;
    const short = named && [...named].length > 30 ? `${[...named].slice(0, 29).join("")}…` : named;
    const question = this.silent
      ?? (this.left ? (n === 1 ? "End this agent?" : `End these ${n} agents?`)
        : this.leadGone != null ? `End ${short ? `${short}'s` : "its"} ${n} worker${n === 1 ? "" : "s"}?`
        : short ? `End ${short}?`
        : n === 1 ? "End this agent?"
          : p.keys.length > 1 ? `End these ${n} agents?`
            : `End the lead and its ${n - 1} worker${n === 2 ? "" : "s"}?`);
    return v_flex()
      .id("at-menu")
      .track_focus(this.h)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down" || (confirming && e.key === "right")) this.at = (this.at + 1) % actions.length;
        else if (e.key === "up" || (confirming && e.key === "left")) this.at = (this.at + actions.length - 1) % actions.length;
        else if (e.key === "enter") actions[this.at]?.act(cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .when(confirming, (el) => el
        // The question stays on one line (the popup is wide enough); the machine notice and the
        // left-over question (two sentences) may wrap.
        .child(div().px(8).pt(5).pb(9).text_color(t.foreground).when(!this.silent && !this.left, (el) => el.whitespace_nowrap()).child(question))
        .child(this.confirmButtons(t, actions)))
      .when(!confirming, (el) => el.children(actions.map((a, i) => v_flex()
        .when(Boolean(a.divider) && i > 0, (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`at-mi-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).cursor_pointer()
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => a.act(cx))
          .child(chrome(a.icon).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(a.label))))));
  }
}
