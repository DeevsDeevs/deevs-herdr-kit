// Stubs for io.test.mjs: t47's perf stubs (elements, terminals, shared state), with files that behave
// like Herdr's (a write names the text it expects, and fails when the file changed), a find that can
// be made to fail, a watch the test fires, and every exec counted.
export * from "./perf/mod-stubs.mjs";
const fx = () => globalThis.__fx;
export const appHome = () => "/made/up/app";
export const readTextFile = (p) => Promise.resolve(fx().files[p] ?? null);
export const writeTextFile = (p, text, expected) => {
  if ((fx().files[p] ?? null) !== (expected ?? null)) return Promise.reject(new Error("The file changed outside Herdr"));
  fx().files[p] = text;
  return Promise.resolve(null);
};
export const watchFolder = (dir) => new Promise((ok) => fx().watchers.push({ dir, ok }));
export const exec = (cmd, args = []) => {
  fx().execs.push(cmd);
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
export const hc = () => Promise.resolve({ code: 0, stdout: JSON.stringify({ machines: [] }) });
