// Stubs for io.test.mjs: t47's perf stubs (elements, terminals, shared state), with files that behave
// like Herdr's (a write names the text it expects, and fails when the file changed), a find that can
// be made to fail, a watch the test fires, and every exec counted.
export * from "./perf/mod-stubs.mjs";
const fx = () => globalThis.__fx;
export const appHome = () => "/made/up/app";
// fx().hold[path]: a promise the read waits on (a slow disk), to catch what runs meanwhile.
export const readTextFile = (p) => (fx().hold?.[p] ?? Promise.resolve()).then(() => fx().files[p] ?? null);
export const writeTextFile = (p, text, expected) => {
  if ((fx().files[p] ?? null) !== (expected ?? null)) return Promise.reject(new Error("The file changed outside Herdr"));
  fx().files[p] = text;
  return Promise.resolve(null);
};
export const watchFolder = (dir) => new Promise((ok) => fx().watchers.push({ dir, ok }));
// run with its arguments too (fx().runs), for tests that check where something was started.
export const run = (cmd, args) => {
  fx().log?.push({ what: `run ${cmd}`, at: Date.now() });
  fx().runs?.push([cmd, args]);
};
export const exec = (cmd, args = [], opts = {}) => {
  fx().execs.push(cmd);
  fx().execArgs?.push(args);
  // A task's folder (model.MKDIR_SCRIPT): made, with ~ as the made-up home; fx().noMkdir fails it.
  if (cmd === "sh" && args[2] === "mk") {
    fx().made?.push([opts.on ?? null, args[3]]);
    if (fx().noMkdir) return Promise.resolve({ code: 1, stdout: "", stderr: "mkdir: Permission denied" });
    return Promise.resolve({ code: 0, stdout: `${args[3].replace(/^~/, "/home/me")}\n`, stderr: "" });
  }
  // The first of a task's folders that is there (model.FIRST_DIR_SCRIPT); fx().gone lists those that are not.
  if (cmd === "sh" && args[2] === "dir") {
    (fx().looked ??= []).push([opts.on ?? null, ...args.slice(3)]);
    const first = args.slice(3).find((d) => !fx().gone?.includes(d));
    return Promise.resolve(first ? { code: 0, stdout: first, stderr: "" } : { code: 1, stdout: "", stderr: "" });
  }
  // agy's trust step (model.TRUST_SCRIPT): fx().trusted gets [machine, folder, starts run so far];
  // fx().trustWord is its answer (default added).
  if (cmd === "sh" && args[2] === "trust") {
    (fx().trusted ??= []).push([opts.on ?? null, args[3], fx().runs?.length ?? 0]);
    return Promise.resolve({ code: 0, stdout: `${fx().trustWord ?? "added"}\n`, stderr: "" });
  }
  // The worker script (main.js workerCommand), only when fx().scripts is a list: written, its path
  // printed (the tower folder's bin/ here, ~/.config/agent-tower/bin/ elsewhere).
  if (cmd === "sh" && args[2] === "w" && fx().scripts) {
    const path = `${args[4] || "/home/me/.config/agent-tower/bin"}/${args[3]}`;
    fx().scripts.push([opts.on ?? null, path, args[5]]);
    return Promise.resolve({ code: 0, stdout: path, stderr: "" });
  }
  // The namer (main.js askNamer): fx().namer(prompt) gives its answer, or a promise of one.
  if (cmd === "sh" && args[1] === '"$@" </dev/null' && fx().namer) {
    const prompt = args.find((a) => a.includes("<task>"));
    (fx().namerAsked ??= []).push(prompt);
    return Promise.resolve(fx().namer(prompt)).then((name) => ({ code: name ? 0 : 1, stdout: name ? `${name}\n` : "", stderr: "" }));
  }
  const files = fx().files;
  if (cmd === "find") {
    if (fx().failFind > 0) {
      fx().failFind--;
      return Promise.reject(new Error("find failed"));
    }
    if (args.includes("-delete")) return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    const depth0 = args[args.indexOf("-maxdepth") + 1] === "0";
    const roots = args.slice(0, args.indexOf("-maxdepth"));
    const out = depth0 ? roots.filter((p) => p in files)
      : Object.keys(files).filter((p) => roots.some((r) => p.startsWith(`${r}/`) && !p.slice(r.length + 1).includes("/")) && p.endsWith(".json"));
    return Promise.resolve({ code: 0, stdout: out.join("\n"), stderr: "" });
  }
  if (cmd === "rm") for (const p of args.filter((a) => !a.startsWith("-"))) delete files[p];
  return Promise.resolve({ code: 0, stdout: "", stderr: "" });
};
// Toasts with what they said (fx().notes), still logged as "notify".
export const notify = (n) => {
  (fx().notes ??= []).push(n);
  fx().log?.push({ what: "notify", at: Date.now() });
};
export const hc = (args) => {
  fx().hcCalls?.push(args);
  // hc get: the fixture's terminal as it is now (fx().getLabels[address] overrides its labels: a
  // label written that the list has not read yet).
  if (args[0] === "get") {
    const t = fx().fixture.terms.find((x) => x.address === args[1]);
    const labels = { ...(t?.labels ?? {}), ...(fx().getLabels?.[args[1]] ?? {}) };
    return Promise.resolve(t ? { code: 0, stdout: JSON.stringify({ ...t, labels }) } : { code: 1, stdout: "", stderr: "no such terminal" });
  }
  // hc machine ls: the fixture's machines (their state as given).
  return Promise.resolve({ code: 0, stdout: JSON.stringify({ machines: args[0] === "machine" ? fx().fixture.machines ?? [] : [] }) });
};
// Elements that remember their ids and tooltips (fx().ids, fx().tips), for checks on what a render built.
const recording = () => {
  fx().elements++;
  let myId = null;
  const self = new Proxy({}, {
    get(_, k) {
      if (k === "then") return undefined;
      return (...a) => {
        fx().calls++;
        if (k === "id") {
          myId = a[0];
          (fx().ids ??= new Set()).add(a[0]);
        }
        if (k === "tooltip") (fx().tips ??= []).push([myId, a[0]]);
        if (k === "when") return a[0] ? a[1](self) : self;
        return self;
      };
    },
  });
  return self;
};
export const div = recording, svg = recording, image = recording, h_flex = recording, v_flex = recording;
