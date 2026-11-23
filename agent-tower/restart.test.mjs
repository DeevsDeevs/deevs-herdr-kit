// node restart.test.mjs: Restart lead. The item menu offers it only for a task whose lead's terminal
// lives on in its shell ("lead ended"), with a start Tower can read back and a conversation read.py
// found for sure; the line typed for each shipped agent (folder, environment, flags, session); and
// read.py's lead_session on made-up transcripts. Made-up names only.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PYTHONDONTWRITEBYTECODE = "1";
setTimeout(() => {
  console.error("restart.test.mjs took over 30 s");
  process.exit(1);
}, 30000).unref();
const stubs = new URL("./perf/mod-stubs.mjs", import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (["gpui-kit", "gpui-base", "herdr"].includes(s) ? { url: stubs, shortCircuit: true } : next(s, c)) });
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
const model = await import("./mods/agent-tower/model.js");
const { default: List } = await import("./mods/agent-tower/main.js");

// ── The model: the start read back from hc's argv, when it is offered, the line typed. ──
const NOW = 10 * 86400000;
const WORKER = "TOWER_WORKER=/made/up/bin/worker-claude-opus";
const wrap = (...run) => ["zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "env", "TOWER_TASK=k1", WORKER, ...run];
const shell = { key: "shell", name: "zsh", shell: true, agent: false };
const lead = (argv, extra = {}) => ({ address: "t1", state: "live", status: null, program: shell, pid: 41, foreground: { pid: 41, argv: ["zsh", "-i"] },
  cwd: "/made/up/barn", created_ms: NOW - 3600e3, argv, ...extra, labels: { "task.id": "k1", "task.role": "lead", "task.lead": "claude-fable", ...extra.labels } });
const quit = (at = NOW - 60e3, had = true, address = "t1") => new Map([[address, { word: null, turn: 3, at, had }]]);
const item = (t, more = {}) => ({ key: "task:k1", taskId: "k1", lead: t, leadGone: false, live: [t], ...more });
const config = model.parseConfig({}).config;
const line = (t, session, cfg = config, folder = t.cwd) => {
  const start = model.restartable(item(t), NOW, quit(undefined, true, t.address), cfg);
  return start && model.restartLine(start, folder, session, model.resumeWords(cfg, t, start.program), model.shellKind(t));
};
const ENV = `env TOWER_TASK=k1 ${WORKER}`;

// Each shipped agent: its folder, Tower's environment, the lead's own flags, its resume words.
assert.equal(line(lead(wrap("claude", "--model", "fable", "--permission-mode", "auto", "Lead the made-up barn survey.")), "c-1"),
  `cd /made/up/barn && ${ENV} claude --model fable --permission-mode auto --resume c-1`);
assert.equal(line(lead(wrap("codex", "--no-daemon", "Lead the made-up barn survey."), { labels: { "task.lead": "codex" } }), "x-2"),
  `cd /made/up/barn && ${ENV} codex --no-daemon resume x-2`);
assert.equal(line(lead(wrap("pi", "Lead the made-up barn survey."), { labels: { "task.lead": "pi" } }), "p-3"),
  `cd /made/up/barn && ${ENV} pi --session p-3`);
// agy: the trust flag Tower added stays; -i (its first message) goes.
assert.equal(line(lead(wrap("agy", "--settings", '{"trustedWorkspaces":["/made/up/barn"]}', "-i", "Lead the made-up barn survey."), { labels: { "task.lead": "agy" } }), "a-4"),
  `cd /made/up/barn && ${ENV} agy --settings '{"trustedWorkspaces":["/made/up/barn"]}' --conversation a-4`);
// A folder with a space is quoted; a lead on another machine (Herdr's remote wrapper) reads back the same.
assert.equal(line(lead(wrap("pi", "Go.")), "p-5", config, "/made/up/hay loft"), `cd '/made/up/hay loft' && ${ENV} pi --session p-5`);
const remote = ["sh", "-c", 'shell=${SHELL:-/bin/sh}\ncase … exec "$shell" -lic \'"$@"; exec "$0" -li\' "$shell" "$@" ;;\nesac', "sh", "env", "TOWER_TASK=k1", WORKER, "pi", "Go."];
assert.equal(line(lead(remote, { address: "vps/t1" }), "p-6"), `cd /made/up/barn && ${ENV} pi --session p-6`);
// The settings may give an agent its own resume words.
const own = model.parseConfig({ agents: [{ id: "claude-fable", label: "Claude", argv: ["claude"], resume: ["--resume={session}", "--fork-session"] }] });
assert.deepEqual(own.bad, []);
assert.equal(line(lead(wrap("claude", "Go.")), "c-7", own.config), `cd /made/up/barn && ${ENV} claude --resume=c-7 --fork-session`);
// An agent's own resume words only for its own program: one now running Codex gives a Claude lead Claude's.
const moved = model.parseConfig({ agents: [{ id: "claude-fable", label: "Fast", argv: ["codex", "--no-daemon"], resume: ["resume", "{session}"] }] }).config;
assert.equal(line(lead(wrap("claude", "--model", "fable", "Go.")), "c-8", moved), `cd /made/up/barn && ${ENV} claude --model fable --resume c-8`);
// The id goes in as it is ($& and the like are not replacement patterns); a word starting with = is quoted (zsh's =cmd).
assert.equal(line(lead(wrap("pi", "Go.")), "a$&b$'c$`d$$"), `cd /made/up/barn && ${ENV} pi --session 'a$&b$'\\''c$\`d$$'`);
assert.equal(model.shellQuote(["=ls", "a=b"]), "'=ls' a=b");
// fish: its own quoting (\\ and \' are escapes inside its single quotes).
const fishLead = lead(wrap("agy", "--settings", '{"trustedWorkspaces":["/made/up/a\\b"]}', "-i", "Go."), { labels: { "task.lead": "agy" }, foreground: { pid: 41, argv: ["/usr/bin/fish", "-i"] } });
assert.equal(line(fishLead, "a-9"), `cd /made/up/barn && ${ENV} agy --settings '{"trustedWorkspaces":["/made/up/a\\\\b"]}' --conversation a-9`);
assert.equal(model.fishQuote(["it's"]), "'it\\'s'");
// The agent's own word: the last resume line its program printed in the terminal.
const quits = {
  claude: "Resume this session with:\nclaude --resume 3983-aaaa\n",
  codex: "Token usage: total=5\nTo continue this session, run:\n  codex resume 01a2-bbbb\nOr run codex resume and select it.\n",
  pi: "To resume this session: pi --session 01a2-cccc\n",
  agy: "Resume with -c (or command below):\nagy --conversation=1643-dddd\n",
};
assert.deepEqual(Object.entries(quits).map(([p, text]) => model.saidSession(text, p)), ["3983-aaaa", "01a2-bbbb", "01a2-cccc", "1643-dddd"]);
assert.equal(model.saidSession(`${quits.claude}$ cd /x && env TOWER_TASK=k1 claude --model fable --resume 3983-aaaa\n${quits.claude.replace("3983-aaaa", "77ee-later")}`, "claude"), "77ee-later", "the last one");
assert.equal(model.saidSession("$ env TOWER_TASK=k1 claude --model fable --resume 3983-aaaa\n", "claude"), null, "a typed line is not the agent's word");
assert.equal(model.saidSession(quits.pi, "claude"), null, "another program's line");
// What read.py is asked: the program, the agent's argv as started, its folder, its start and its quit as
// Tower saw them (seconds ago), and hc's own quit time on the lead's machine, as it is.
const start = model.restartable(item(lead(wrap("claude", "--model", "fable", "Go."))), NOW, quit(), config);
assert.deepEqual(model.restartAsk(lead([]), start, NOW, quit(), null, NOW - 61e3),
  { restart: { program: "claude", argv: ["claude", "--model", "fable", "Go."], cwd: "/made/up/barn", created_s: 3600, finished_s: 60, quit_ms: NOW - 61e3 } });
assert.equal(model.restartAsk(lead([]), start, NOW, quit(), "3983-aaaa").restart.named, "3983-aaaa");

// Not offered: anything else.
const good = wrap("claude", "Go.");
const none = (why, t, changes = quit(), cfg = config, more = {}) => assert.equal(model.restartable(item(t, more), NOW, changes, cfg), null, why);
assert.ok(model.restartable(item(lead(good)), NOW, quit(), config), "the case it is for");
none("its agent runs", lead(good, { status: "idle" }));
none("Herdr sees an agent in front", lead(good, { program: { key: "claude", agent: true } }));
none("its agent quit less than 20 s ago", lead(good), quit(NOW - 5e3));
none("it never reported a state (still starting)", lead(good), quit(NOW - 60e3, false));
none("its terminal ended", lead(good), quit(), config, { leadGone: true });
none("a replaced lead is a shell", lead(good, { labels: { "task.role": "shell" } }));
none("a replaced lead still running is a worker", lead(good, { labels: { "task.role": "worker" } }));
none("another program runs in its shell", lead(good, { foreground: { pid: 77, argv: ["vim"] } }));
none("what is in front is not known", lead(good, { foreground: undefined }));
none("a shell whose quoting is not known", lead(good, { foreground: { pid: 41, argv: ["nu"] } }));
none("an agent typed into a plain shell: its start is unknown", lead(["/usr/bin/zsh"]));
none("a start that is not Tower's", lead(["zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "claude", "Go."]));
none("another task's environment", lead(wrap("claude", "Go."), { labels: { "task.id": "k2" } }));
none("no message after the program", lead(["zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "env", "TOWER_TASK=k1", "claude"]));
none("a program without resume words", lead(wrap("gemini", "Go."), { labels: { "task.lead": "gem" } }));
none("resume turned off in the settings", lead(good), quit(),
  model.parseConfig({ agents: [{ id: "claude-fable", label: "Claude", argv: ["claude"], resume: null }] }).config);
assert.deepEqual(model.parseConfig({ agents: [{ id: "a", label: "A", argv: ["a"], resume: ["--resume"] }] }).bad, ["agents"], "resume words must name {session}");

// ── The list and its menu (two copies of the mod), under the perf stubs. ──
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const now = Date.now();
const claude = { key: "claude", name: "Claude Code", agent: true };
const term = (address, labels, extra = {}) => ({ address, state: "live", status: "idle", program: claude, status_ms: now - 600e3, created_ms: now - 3600e3, cwd: `/made/up/${labels["task.id"]}`, ...extra, labels });
const ended = (address, task, extra = {}) => term(address, { "task.id": task, "task.role": "lead", "task.title": `Made-up ${task}`, "task.lead": "claude-fable", ...extra.labels },
  { status: undefined, status_ms: now - 61e3, turn: 3, program: shell, pid: 50, foreground: { pid: 50, argv: ["zsh", "-i"] },
    argv: ["zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "env", `TOWER_TASK=${task}`, "claude", "--model", "fable", `Lead ${task}.`], ...extra });
const lookups = {}; // task folder → how many lookups
const gone = new Set(); // task folders whose conversation is no longer the lead's (written since the quit)
const fx = (globalThis.__fx = {
  fixture: {
    terms: [
      ended("t1", "barn"), term("t2", { "task.id": "barn", "task.role": "worker" }, { parent: "t1" }),
      // Its conversation is not known for sure (read.py found none).
      ended("t3", "loft"),
      // Its agent runs.
      term("t4", { "task.id": "shed", "task.role": "lead", "task.title": "Made-up shed", "task.lead": "claude-fable" }),
      // A lead replaced by a New lead: a shell now, and the task's lead is t6.
      ended("t5", "hay", { labels: { "task.id": "hay", "task.role": "shell", "task.was": "lead" } }),
      term("t6", { "task.id": "hay", "task.role": "lead", "task.title": "Made-up hay", "task.lead": "claude-fable" }),
      // More ended leads, one per case below.
      ended("t7", "mill"), ended("t8", "pier"), ended("t9", "dock"), ended("tb", "wharf"), ended("tc", "silo"),
      // hc has no time for its quit: nothing is asked of read.py, nothing offered.
      ended("te", "byre", { status_ms: null }),
    ],
    agents: [], spaces: [], machines: [],
  },
  files: {}, props: {}, log: [], hcCalls: [], elements: 0, calls: 0,
  shared: { "agent-tower.changes": Object.fromEntries(["t1", "t3", "t5", "t7", "t8", "t9", "tb", "tc", "te"].map((a) => [a, { word: null, turn: 3, at: now - 60e3, had: true }])) },
  layout: { id: "root", children: [{ id: "sidebar", size: { px: 300 }, children: [{ id: "tower-list", content: { mod: "agent-tower" } }] }] },
  // barn's agent printed its resume line when it quit.
  // hc get: the terminal as hc's core has it (its status_ms is when the agent's status went).
  hcGet: (address) => fx.fixture.terms.find((t) => t.address === address),
  readText: { t1: "● done\nResume this session with:\nclaude --resume c-said\n$ ", ...Object.fromEntries(["t7", "t8", "t9", "tb", "tc", "td"].map((a) => [a, "made-up\n~/made/up ❯                 19:05"])) },
  restartOut: (r) => {
    const task = r.cwd.split("/").pop();
    lookups[task] = (lookups[task] ?? 0) + 1;
    if (task === "loft" || gone.has(task)) return null;
    return { session: r.named ?? `c-${task}`, path: `/made/up/c-${task}.jsonl` };
  },
});
const timers = [];
const cx = { notify() {}, focus_handle: () => ({ focus() {} }), stop_propagation() {}, spawn: (f) => void Promise.resolve().then(() => f(cx)).catch(() => null),
  timer: { every: (ms, f) => (timers.push({ ms, f }), { cancel() {} }), after: (ms, f) => (timers.push({ ms, f, once: true }), { cancel() {} }) } };
const fire = () => timers.splice(0).forEach((t) => (t.once ? t.f(cx) : timers.push(t)));
const list = new List();
list.init({}, cx);
await settle();
list.render(cx);
list.trackTick(cx);
await settle();
// Asked once per ended lead that may be offered, never for a running or a replaced one; barn's with
// the id its agent printed.
assert.deepEqual(fx.restartAsks.map((r) => r.cwd.split("/").pop()).sort(), ["barn", "dock", "loft", "mill", "pier", "silo", "wharf"]);
assert.deepEqual(fx.restartAsks.find((r) => r.cwd === "/made/up/barn"), { program: "claude", argv: ["claude", "--model", "fable", "Lead barn."], cwd: "/made/up/barn",
  created_s: fx.restartAsks[0].created_s, finished_s: fx.restartAsks[0].finished_s, quit_ms: now - 61e3, named: "c-said" });
assert.equal(fx.restartAsks.find((r) => r.cwd === "/made/up/mill").named, undefined, "no line: read.py matches by transcript");
list.trackTick(cx);
await settle();
assert.equal(fx.restartAsks.length, 7, "one lookup per quit");

const menu = new List();
const labels = (key) => {
  fx.props = { menu: true, from: list.id, keys: [key], overlay: "o1" };
  menu.init(fx.props, cx);
  return menu.menuActions().map((a) => a.label);
};
const choose = async (key) => {
  fx.props = { menu: true, from: list.id, keys: [key], overlay: "o1" };
  menu.init(fx.props, cx);
  menu.menuActions().find((a) => a.label === "Restart lead").act(cx);
  fx.props = {};
  list.render(cx);
  await settle();
};
const sends = () => (fx.hcExecs ?? []).filter(([a]) => a[0] === "send").map(([a, o]) => [...a, o.timeout]);
const toasts = () => (fx.notes ?? []).splice(0).map((n) => n.body);
assert.deepEqual(labels("task:barn").slice(0, 6), ["Details", "Peek", "Pin to the top", "Rename", "New lead", "Restart lead"], "after New lead");
assert.ok(!labels("task:loft").includes("Restart lead"), "unsure: not offered");
assert.ok(!labels("task:shed").includes("Restart lead"), "its agent runs: not offered");
assert.ok(!labels("task:hay").includes("Restart lead"), "a replaced lead: not offered");
assert.ok(!labels("task:byre").includes("Restart lead"), "hc has no time for its quit: not offered");
fx.props = { menu: true, from: list.id, keys: ["task:barn"], overlay: "o1", rail: true };
menu.init(fx.props, cx);
assert.ok(menu.menuActions().some((a) => a.label === "Restart lead"), "the rail's menu too");

// Chosen: looked up again, then typed into the lead's own terminal by an hc send Herdr stops after
// 6 s; labels untouched; not offered again while under way, and a second request says so.
await choose("task:barn");
assert.equal(lookups.barn, 2, "looked up again at the click");
assert.deepEqual(sends(), [["send", "--", "t1", "cd /made/up/barn && env TOWER_TASK=barn claude --model fable --resume c-said", 6000]]);
assert.equal(fx.hcCalls.filter((a) => a[0] === "label" || a[0] === "send").length, 0, "the same lead: no label changes, no unbounded send");
assert.ok(!labels("task:barn").includes("Restart lead"), "one restart at a time per task");
list.restartLead(cx, "task:barn");
assert.deepEqual(toasts(), ["a restart of this lead is under way"]);
assert.equal(sends().length, 1);
// A minute after the send with its agent still gone: the start-failed toast says why.
fire();
assert.deepEqual(toasts(), ["claude did not start in the lead's terminal"]);

// A send that fails (a line being written in the shell held it past 6 s: Herdr stopped hc, which drops
// it untyped): the toast says why, and nothing waits on it.
fx.hcExec = (args) => (args[0] === "send" ? Promise.reject(new Error("hc took longer than 6 s and was stopped")) : Promise.resolve({ code: 0, stdout: "", stderr: "" }));
await choose("task:mill");
assert.deepEqual(toasts(), ["nothing was typed: a line is being written in its shell"]);
assert.ok(labels("task:mill").includes("Restart lead"), "offered again: nothing is under way");
fx.hcExec = (args) => Promise.resolve({ code: 1, stdout: "", stderr: "made-up hc error" });
await choose("task:mill");
assert.deepEqual(toasts(), ["made-up hc error"]);
delete fx.hcExec;
// A line the person is writing in the shell (hc would type onto it once it has waited a minute): nothing is sent.
const typed = sends().length;
fx.readText.t7 = "made-up\n~/made/up ❯ echo half-typed";
await choose("task:mill");
assert.deepEqual(toasts(), ["nothing was typed: its shell's last line is not a known empty prompt"]);
assert.equal(sends().length, typed);
// A continuation prompt is an unfinished command: nothing is sent either.
fx.readText.t7 = "made-up\n$ git commit -m \"made-up\ndquote> ";
await choose("task:mill");
assert.deepEqual(toasts(), ["nothing was typed: its shell's last line is not a known empty prompt"]);
assert.equal(sends().length, typed);
fx.readText.t7 = "made-up\n$ ";
assert.equal(model.promptBare("user@host:~$ "), true);
assert.equal(model.promptBare("~/made/up\n❯                       19:08"), true, "a clock on the right");
assert.equal(model.promptBare("~/made/up ❯ echo half      19:07"), false);
assert.equal(model.promptBare(""), false, "nothing read: not known to be free");
for (const p of ["dquote> ", "quote>", "cmdand> ", "cmdand quote> ", "pipe> ", "heredoc> ", "> "]) assert.equal(model.promptBare(`x\n${p}`), false, `continuation prompt ${p}`);

// Since the quit another terminal took the conversation up: the click's lookup finds it, nothing is sent.
const before = sends().length;
gone.add("pier");
await choose("task:pier");
assert.deepEqual(toasts(), ["its last conversation is not known for sure"]);
assert.equal(sends().length, before);
// Something else came to the front between the click and the send: nothing is sent.
fx.props = { menu: true, from: list.id, keys: ["task:dock"], overlay: "o1" };
menu.init(fx.props, cx);
menu.menuActions().find((a) => a.label === "Restart lead").act(cx);
fx.props = {};
list.render(cx);
fx.fixture.terms.find((t) => t.address === "t9").foreground = { pid: 99, argv: ["vim", "notes.md"] };
await settle();
assert.deepEqual(toasts(), ["its terminal runs something else now"]);
assert.equal(sends().length, before);

// A send still waiting holds the restart however long it takes (no timer lets a second one in).
fx.hcExec = (args) => (args[0] === "send" ? new Promise(() => {}) : Promise.resolve({ code: 0, stdout: "", stderr: "" }));
await choose("task:wharf");
fire();
assert.ok(!labels("task:wharf").includes("Restart lead"), "held while its send has not returned");
list.restartLead(cx, "task:wharf");
assert.deepEqual(toasts(), ["a restart of this lead is under way"]);
delete fx.hcExec;
// Its agent came back and quit again: a new quit, looked up and offered again within the hold.
list.changes.set("tb", { word: null, turn: 5, at: Date.now() + 1, had: true });
fx.shared["agent-tower.changes"].tb = list.changes.get("tb");
fx.fixture.terms.find((t) => t.address === "tb").turn = 5;
await new Promise((r) => setTimeout(r, 5));
const realNow0 = Date.now;
Date.now = () => realNow0() + 21000;
list.trackTick(cx);
await settle();
assert.ok(labels("task:wharf").includes("Restart lead"), "a new quit after the restart");
Date.now = realNow0;

// A lookup that never answers is asked again a minute later.
fx.fixture.terms.push(ended("td", "yard"));
list.changes.set("td", { word: null, turn: 3, at: now - 60e3, had: true });
fx.restartHang = (r) => r.cwd === "/made/up/yard";
const yard = () => fx.restartAsks.filter((r) => r.cwd === "/made/up/yard").length;
list.trackTick(cx);
await settle();
list.trackTick(cx);
await settle();
assert.equal(yard(), 1, "asked once while it may still answer");
const realNow = Date.now;
Date.now = () => realNow() + 61000;
list.changes.set("td", { word: null, turn: 3, at: now - 60e3, had: true });
list.trackTick(cx);
await settle();
Date.now = realNow;
assert.equal(yard(), 2, "asked again after a minute without an answer");
fx.props = {};

// ── read.py's lead_session, on made-up transcripts in a made-up home: only the conversation the lead
// was started with, only when nothing says it left it. Times in seconds ago; the lead's terminal
// started 3600 s ago, its agent quit 60 s ago (hc's time unless a case gives another). ──
const home = mkdtempSync(join(tmpdir(), "tower-restart-"));
const at = (s) => new Date(Date.now() - s * 1000).toISOString();
const jsonl = (path, lines, mtimeAgo) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const t = new Date(Date.now() - mtimeAgo * 1000);
  utimesSync(path, t, t);
};
const said = "Lead task k1 with the tower skill: survey the made-up barn.";
const WORKS = "Count the owls. You are a worker on task k1; use the tower skill if you have it.";
const ask = (req) => JSON.parse(execFileSync("python3", [new URL("./mods/agent-tower-panel/read.py", import.meta.url).pathname, JSON.stringify({ restart: req })], { encoding: "utf8", env: { ...process.env, HOME: home } })).restart;
const askIn = (dir, program, argv, more = {}) => ask({ program, argv, cwd: dir, created_s: 3600, finished_s: 60, quit_ms: Date.now() - (more.finished_s ?? 60) * 1000, ...more });
let rooms = 0;
const room = () => {
  const dir = join(home, `room-${++rooms}`);
  mkdirSync(dir);
  return dir;
};
// A Claude conversation in a folder: begun `began` s ago with `text`, last written `written` s ago.
const cIn = (dir, id, began, written, text) => jsonl(join(home, ".claude/projects", dir.replace(/[^A-Za-z0-9]/g, "-"), `${id}.jsonl`),
  [{ type: "user", timestamp: at(began), cwd: dir, sessionId: id, message: { role: "user", content: text } }], written);
const asLead = (dir, more) => askIn(dir, "claude", ["claude", "--model", "fable", said], more);

// Offered: its start message, begun with the terminal, its own exit line naming it.
const plain = room();
cIn(plain, "c-lead", 3590, 300, said);
cIn(plain, "c-worker", 3000, 20, WORKS);
assert.equal(asLead(plain, { named: "c-lead" })?.session, "c-lead", "the plain case; a worker written later does not count");
// No exit line: only an agent that died at work (written just before the quit).
assert.equal(asLead(plain), null, "no exit line, and it had gone quiet 4 minutes before the quit");
const crash = room();
cIn(crash, "c-lead", 3590, 90, said);
assert.equal(asLead(crash)?.session, "c-lead", "a crash at work");
assert.equal(asLead(crash, { quit_ms: undefined }), null, "without hc's time of the quit");
assert.equal(asLead(crash, { created_s: 7200 }), null, "begun long after the terminal started");
assert.equal(askIn(crash, "claude", ["claude", "Lead another made-up task."]), null, "another first message");
assert.equal(asLead(crash, { finished_s: 4000 }), null, "written after its agent quit");
assert.equal(asLead(crash, { cwd: join(home, "gone") }), null, "its folder is gone");
assert.equal(asLead(crash, { named: "../x" }), null, "an id of another shape");
// (1) An agent the person ran by hand in the lead's terminal after the quit: its exit line names it.
const byHand = room();
cIn(byHand, "c-lead", 3590, 300, said);
cIn(byHand, "c-hand", 200, 100, "Look at the made-up barn roof.");
assert.equal(asLead(byHand, { named: "c-hand" }), null, "the last line names another");
assert.equal(asLead(byHand, { named: "c-lead" }), null, "another conversation there written after it");
// (2) A worker's exit line quoted in the lead's scrollback (it read the worker), the lead died after.
const quoted = room();
cIn(quoted, "c-lead", 3590, 90, said);
cIn(quoted, "w-2", 3000, 80, WORKS);
assert.equal(asLead(quoted, { named: "w-2" }), null, "a line naming a worker's conversation");
// (3) A stale line: restarted, then /resume into an older conversation, then killed.
const stale = room();
cIn(stale, "c-lead", 3590, 2000, said);
cIn(stale, "c-old", 90000, 30, "Sort the made-up hay.");
assert.equal(asLead(stale, { named: "c-lead" }), null, "an older conversation written after it");
// (4) The lead had /resumed into a worker's conversation and worked there.
const intoWorker = room();
cIn(intoWorker, "c-lead", 3590, 3000, said);
cIn(intoWorker, "w-1", 3500, 70, WORKS);
assert.equal(asLead(intoWorker, { named: "w-1" }), null, "its line names the worker's");
assert.equal(asLead(intoWorker), null, "no line: quiet for 50 minutes before the quit");
// (5) A quit Tower saw late: hc's time wins, and the conversation was taken up in another pane since.
const late = room();
cIn(late, "c-lead", 3590, 60, said);
assert.equal(asLead(late, { named: "c-lead", finished_s: 25, quit_ms: Date.now() - 3000e3 }), null, "written 49 minutes after hc saw the quit");
assert.equal(asLead(late, { named: "c-lead", finished_s: 25, quit_ms: Date.now() - 70e3 })?.session, "c-lead", "the same with hc's quit 10 s before the last write");
// (6) /clear then more work: its line names the new conversation (New lead is the way there).
const cleared = room();
cIn(cleared, "c-lead", 3590, 300, said);
cIn(cleared, "c-clear", 250, 100, "<command-name>/clear</command-name>\n<command-message>clear</command-message>");
assert.equal(asLead(cleared, { named: "c-clear" }), null);
assert.equal(asLead(cleared), null);
// Codex 0.166 (first message in a UserMessage item) and pi: offered in the plain case; after /new with
// a message that names the task, nothing either way.
const day = (s) => { const d = new Date(Date.now() - s * 1000); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`; };
const inCodex = (dir, id, began, written, text) => jsonl(join(home, ".codex/sessions", day(began), `rollout-${id}.jsonl`), [
  { type: "session_meta", timestamp: at(began), payload: { id, cwd: dir } },
  { type: "response_item", timestamp: at(began - 1), payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions" }] } },
  { type: "event_msg", timestamp: at(began - 1), payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text }] } } }], written);
const piIn = (dir, id, began, written, text) => jsonl(join(home, ".pi/agent/sessions", `--${dir.replace(/^\//, "").replaceAll("/", "-")}--`, `${id}.jsonl`),
  [{ type: "session", id, timestamp: at(began), cwd: dir }, { type: "message", id: "1", timestamp: at(began - 1), message: { role: "user", content: [{ type: "text", text }] } }], written);
const codexRoom = room();
inCodex(codexRoom, "x-lead", 3590, 300, said);
assert.equal(askIn(codexRoom, "codex", ["codex", "--no-daemon", said], { named: "x-lead" })?.session, "x-lead");
inCodex(codexRoom, "x-new", 1790, 65, "You are still the lead of task barn: read the chain and go on.");
assert.equal(askIn(codexRoom, "codex", ["codex", said], { named: "x-new" }), null, "Codex after /new");
assert.equal(askIn(codexRoom, "codex", ["codex", said], { named: "x-lead" }), null);
const piRoom = room();
piIn(piRoom, "p-lead", 3590, 300, said);
assert.equal(askIn(piRoom, "pi", ["pi", said], { named: "p-lead" })?.session, "p-lead");
piIn(piRoom, "p-new", 1790, 65, "Give me a summary of task progress so far.");
assert.equal(askIn(piRoom, "pi", ["pi", said], { named: "p-new" }), null, "pi after /new");
assert.equal(askIn(piRoom, "pi", ["pi", said]), null);
// agy: the exact match Timeline uses for an ended agy, not one it has left; its line must name it.
// Its conversation's folder is born when written here, so this lead started 5 s ago and quit 1 s ago.
const barn = room();
const agyHome = join(home, ".gemini/antigravity-cli");
jsonl(join(agyHome, "brain", "a-lead", ".system_generated/logs/transcript.jsonl"),
  [{ step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: at(4), content: `<USER_REQUEST>\n${said}\n</USER_REQUEST>` }], 2);
const agyArgv = ["agy", "--settings", `{"trustedWorkspaces":["${barn}"]}`, "-i", said];
const agy = (more) => askIn(barn, "agy", agyArgv, { created_s: 5, finished_s: 1, ...more });
writeFileSync(join(agyHome, "history.jsonl"), "");
assert.equal(agy()?.session, "a-lead");
assert.equal(agy({ named: "a-lead" })?.session, "a-lead");
assert.equal(agy({ named: "a-other" }), null, "its line names another");
writeFileSync(join(agyHome, "history.jsonl"), JSON.stringify({ display: "/clear", timestamp: Date.now() - 100e3, workspace: barn, conversationId: "a-lead" }) + "\n");
assert.equal(agy({ named: "a-lead" }), null, "left with /clear");
assert.equal(askIn(barn, "gemini", ["gemini", said]), null, "an agent it has no lookup for");
console.log("ok restart.test.mjs");
