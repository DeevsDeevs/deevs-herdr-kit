// Preloaded by test.mjs into a test that hung: once the test prints its "ok" line, it waits a moment
// and prints, as "[hang]" lines, what still keeps node alive: process.getActiveResourcesInfo(), each
// live handle (a child process with its command, a socket or pipe with its fd), and where each live
// timer was made. Its own timers are unref'd, so they never keep the process alive themselves.
const OK = /(^|\s)ok(\s|\(|$)/;
const realTimeout = globalThis.setTimeout;
const timers = new Map();
for (const name of ["setTimeout", "setInterval"]) {
  const real = globalThis[name];
  globalThis[name] = function (fn, ms, ...rest) {
    const where = new Error().stack.split("\n").slice(2, 6).map((l) => l.trim()).join(" < ");
    let t;
    const wrapped = typeof fn === "function" && name === "setTimeout" ? (...a) => (timers.delete(t), fn(...a)) : fn;
    t = real.call(this, wrapped, ms, ...rest);
    timers.set(t, `${name}(${ms ?? 0} ms) at ${where}`);
    return t;
  };
}
for (const name of ["clearTimeout", "clearInterval"]) {
  const real = globalThis[name];
  globalThis[name] = function (t) {
    timers.delete(t);
    return real.call(this, t);
  };
}

let reported = false;
function report() {
  if (reported) return;
  reported = true;
  const say = (s) => process.stderr.write(`[hang] ${s}\n`);
  say(`active resources: ${JSON.stringify(process.getActiveResourcesInfo())}`);
  for (const h of process._getActiveHandles?.() ?? []) {
    const kind = h?.constructor?.name ?? typeof h;
    if (kind === "ChildProcess") say(`child process: ${h.spawnargs?.join(" ")} (pid ${h.pid})`);
    else if (kind === "Socket" || kind === "Pipe") say(`${kind}: fd ${h._handle?.fd ?? "?"}${h === process.stdout ? " (stdout)" : h === process.stderr ? " (stderr)" : h === process.stdin ? " (stdin)" : ""}`);
    else if (kind !== "Timeout") say(`handle: ${kind}`);
  }
  for (const [t, where] of timers) if (t?.hasRef?.() !== false && !t?._destroyed) say(`timer ${where}`);
}

const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  if (OK.test(String(chunk).trimEnd().split("\n").at(-1) ?? "")) realTimeout(report, 500).unref();
  return write(chunk, ...rest);
};
