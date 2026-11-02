// How a session's stream port is reached. A session's stream listens on its
// own machine's 127.0.0.1 only. Here that is direct; another machine gets an
// ssh -L run as a herdr-core terminal. That ssh runs `sleep` as its command
// and so ends by itself once the stream it carries closes: nothing to clean
// up after a reload or a crash.

import { hc, appHome, readTextFile } from "herdr";
import { connect as tcp } from "net";
import { unlink, mkdir } from "fs/promises";
import { SETTINGS } from "./settings.js";

const LOGS = () => `${appHome()}/data/agent-browser`;

// Herdr's other machines with what reaching them takes. Temporary ones are skipped like the app does.
export async function remoteMachines() {
  const r = await hc(["machine", "ls", "--json"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "hc machine ls failed");
  return (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
}

async function listening(port) {
  try {
    const s = await tcp("127.0.0.1", port);
    await s.close();
    return true;
  } catch {
    return false;
  }
}

async function alive(name) {
  const r = await hc(["get", name, "--json"]).catch(() => null);
  if (!r || r.code !== 0) return false;
  try { return JSON.parse(r.stdout).state === "live"; } catch { return false; }
}

// ssh owns the port once it logged binding it and did not log failing to:
// anything else answering there could be another user's listener.
async function forwarding(log, port) {
  // readTextFile, not fs: fs reads only under $HOME, and the app folder can be elsewhere.
  const text = (await readTextFile(log).catch(() => "")) ?? "";
  if (text.includes(`cannot listen to port: ${port}`)) return "failed";
  return text.includes(`Local forwarding listening on 127.0.0.1 port ${port}.`) ? "bound" : "waiting";
}

async function sshError(log) {
  const text = (await readTextFile(log).catch(() => "")) ?? "";
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("debug"));
  return { text, last: lines.at(-1) || "ssh exited" };
}

// Where the ssh to a machine goes: settings first, then the machine's own target.
function sshFor(machine) {
  const own = SETTINGS.ssh?.[machine.name];
  if (own) return { args: own.args ?? [], target: own.target };
  if (machine.via || !machine.target) return null;
  return { args: [], target: machine.target };
}

async function tunnel(cx, machine, remotePort, seconds = 30, label = "tunnel") {
  const ssh = sshFor(machine);
  if (!ssh) throw new Error(`${machine.name} is reached through a command, not ssh: set SETTINGS.ssh for it`);
  await mkdir(LOGS(), { recursive: true }).catch(() => {});
  let last = "ssh failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 12000);
    if (await listening(port)) continue;
    const name = `ab-tunnel-${port}`;
    const log = `${LOGS()}/ssh-${port}.log`;
    const argv = [
      SETTINGS.sshBinary, ...ssh.args,
      // Its own connection: a shared ControlMaster would keep the forward after this ssh ends.
      "-o", "ControlPath=none",
      "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10",
      "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
      "-o", "LogLevel=DEBUG1", "-E", log,
      "-L", `127.0.0.1:${port}:127.0.0.1:${remotePort}`,
      ssh.target, "sleep", String(seconds),
    ];
    const r = await hc(["run", "--bg", "--rm", "--no-parent", "--no-notify", "--json", "--name", name, "--label", `agent-browser=${label}`, "--", ...argv]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "hc run failed");
    let ok = 0;
    for (let i = 0; i < 60 && ok < 2; i++) {
      const state = await forwarding(log, port);
      if (state === "failed" || (i > 2 && !(await alive(name)))) break;
      ok = state === "bound" && (await listening(port)) ? ok + 1 : 0;
      if (ok < 2) await cx.sleep(150);
    }
    if (ok === 2) {
      unlink(log).catch(() => {});
      return { port, name };
    }
    const err = await sshError(log);
    last = err.last;
    unlink(log).catch(() => {});
    await hc(["kill", name]).catch(() => {});
    // A taken port is worth another try; anything else would fail the same way.
    if (!/address already in use|cannot listen to port/i.test(err.text)) break;
  }
  throw new Error(last);
}

// A page the session's browser has on its own machine (127.0.0.1 there), for
// your browser here: a tunnel that lasts ten minutes, or longer while your
// browser keeps a connection open. One per machine and port, reused while up.
const pages = new Map();
export async function pageTunnel(cx, machine, remotePort) {
  const key = `${machine.name}:${remotePort}`;
  const had = pages.get(key);
  if (had && (await alive(had.name))) return had.port;
  const made = await tunnel(cx, machine, remotePort, 600, "page");
  pages.set(key, made);
  return made.port;
}

// One way into one session's stream port. `close` drops what `open` built.
export function connector(machine, port) {
  let made = null;
  return {
    async open(cx) {
      if (!machine.name) return { http: `http://127.0.0.1:${port}`, port };
      made = await tunnel(cx, machine, port);
      return { http: `http://127.0.0.1:${made.port}`, port: made.port };
    },
    close() {
      if (made) hc(["kill", made.name]).catch(() => {});
      made = null;
    },
  };
}
