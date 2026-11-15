// gpui-kit, gpui-base and herdr for perf runs: elements are counted, not drawn, and every builder
// call is counted (in Herdr each one crosses into the host). Commands, file reads and writes, and
// setShared are logged in globalThis.__fx.log as {what, at} when there is a log. Data comes from
// globalThis.__fx: {files, shared, elements, calls} at least; fixture, props, layout, log for whole mods.
const fx = () => globalThis.__fx;
const note = (what) => fx().log?.push({ what, at: Date.now() });

const el = () => {
  fx().elements++;
  const self = new Proxy({}, {
    get(_, k) {
      if (k === "then") return undefined;
      return (...a) => {
        fx().calls++;
        if (k === "when") return a[0] ? a[1](self) : self;
        return self;
      };
    },
  });
  return self;
};
// Anything else the mods call methods on (a scroll handle, a focus handle): every call returns itself.
const any = () => new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : () => any()), apply: () => any() });

export const div = el, svg = el, image = el, h_flex = el, v_flex = el, canvas = el;
export const Input = { new: () => el() };
export class View {}
export const ScrollHandle = { new: () => any() };
export const InputState = {
  new: (opts = {}) => {
    let value = opts.value ?? "";
    return { value: () => value, set_value: (v) => { value = v; }, on() {}, focus() {}, blur() {}, is_focused: () => false, select_all() {}, set_placeholder() {} };
  },
};

const THEME = new Proxy({}, { get: (_, k) => (typeof k === "string" ? (k === "font_size" ? 13 : "#808080") : undefined) });
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export const terminals = () => copy(fx().fixture?.terms ?? []);
export const agents = () => copy(fx().fixture?.agents ?? []);
export const spaces = () => copy(fx().fixture?.spaces ?? []);
export const machines = () => copy(fx().fixture?.machines ?? []);
export const panes = () => [];
export const focused = () => fx().focused ?? null;
export const theme = () => THEME;
export const props = () => fx().props;
export const layout = () => fx().layout;
export const layouts = () => ["tower", "tower-window", "tower-work", "tower-personal", "tower-investing"];
export const home = () => "/home/me";
export const appHome = () => "/home/me/.config/herdr-app";
export const window = () => ({ platform: "macos", active: fx().active ?? true });
export const shared = (k) => copy(fx().shared[k]);
export const setShared = (k, v) => {
  note(`setShared ${k}`);
  fx().shared[k] = copy(v);
  fx().sharedSet = (fx().sharedSet ?? 0) + 1;
  return null;
};
export const readTextFile = (p) => {
  note(`read ${p.split("/").slice(-2).join("/")}`);
  if (p.endsWith("/read.py")) return Promise.resolve("# read.py");
  return Promise.resolve(fx().files[p] ?? null);
};
export const writeTextFile = (p, text) => {
  note(`write ${p.split("/").slice(-2).join("/")}`);
  fx().files[p] = text;
  return Promise.resolve(null);
};
export const watchFolder = () => new Promise(() => {});
export const nextCommand = () => new Promise(() => {});
export const knownAgents = () => Promise.resolve([]);
export const notify = () => note("notify");
export const openOverlay = () => note("openOverlay");
export const closeOverlay = () => null;
export const run = (cmd) => note(`run ${cmd}`);

export const hc = (args) => {
  note(`hc ${args.slice(0, 2).join(" ")}`);
  // Whole calls, for tests that check what was labelled.
  fx().hcCalls?.push(args);
  const f = fx().fixture ?? {};
  if (args[0] === "machine") return Promise.resolve({ code: 0, stdout: JSON.stringify({ machines: (f.machines ?? []).map((m) => ({ name: m.name })) }) });
  // hc ls --all --label task.id=<id>: the task's terminals, those Herdr already dropped (fixture.gone) too.
  if (args[0] === "ls") {
    const label = args[args.indexOf("--label") + 1] ?? "";
    const [k, v] = label.split("=");
    const all = [...(f.terms ?? []), ...(f.gone ?? [])].filter((t) => !k || t.labels?.[k] === v);
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ terminals: all }) });
  }
  if (args[0] === "read") return Promise.resolve({ code: 0, stdout: "╭──╮\n│ ● working │\n╰──╯" });
  return Promise.resolve({ code: 0, stdout: "" });
};
export const exec = (cmd, args = [], opts = {}) => {
  // read.py runs as sh -c 'python3 -c "$1" "$2"' tower <script> <request>.
  if (cmd === "sh" && args[2] === "tower") {
    const req = JSON.parse(args[4] ?? "{}");
    const kind = req.turns ? "turns" : req.tasks ? "tasks" : "panel";
    note(`exec read.py ${kind}${req.chain ? " +chain" : ""}${opts.on ? " (remote)" : ""}`);
    const now = Date.now() / 1000;
    if (req.turns) return Promise.resolve({ code: 0, stdout: JSON.stringify({ now, turns: { terminals: {}, folders: {} } }), stderr: "" });
    if (req.tasks) return Promise.resolve({ code: 0, stdout: JSON.stringify({ now, tasks: [] }), stderr: "" });
    const task = (req.lead_cwd ?? "").split("/").pop() || "task";
    if (!fx().fixture?.readOut) return Promise.resolve({ code: 1, stdout: "", stderr: "" });
    // As read.py: the chain only when asked for.
    const out = JSON.parse(fx().fixture.readOut(task));
    if (req.chain) out.chain = { chain: task, title: `Link of ${task} at ${Date.now()}`, next: null, ago_s: 60 };
    else delete out.chain;
    return Promise.resolve({ code: 0, stdout: JSON.stringify(out), stderr: "" });
  }
  note(`exec ${cmd}${args[0] && !args[0].startsWith("-") ? ` ${args[0].split("/").pop()}` : ""}`);
  return Promise.resolve({ code: 0, stdout: "", stderr: "" });
};
