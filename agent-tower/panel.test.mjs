// node agent-tower/panel.test.mjs: the panel's words for each situation, the masking, the segment
// budget, report matching, read timing, and read.py on a made-up transcript and a real git repo.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as panel from "./mods/agent-tower-panel/panel.js";
// The read.py runs below leave no __pycache__ in the mod folder.
process.env.PYTHONDONTWRITEBYTECODE = "1";

// The whole test takes under a second; a hang (a call that waits on the machine) fails it fast.
setTimeout(() => {
  console.error("panel.test.mjs took over 30 s");
  process.exit(1);
}, 30000).unref();

const NOW = 10 * 86400000;
const M = 60000;
const claude = { key: "claude", name: "Claude Code", agent: true };
const term = (address, extra = {}) => ({ address, state: "live", program: claude, status: "idle", ...extra, labels: { ...extra.labels } });
const spaces = [{ id: "s1", name: "herdr", machine: null }, { id: "vps/s2", name: "remote", machine: "vps" }];
const terms = [
  term("t1", { labels: { "herdr.space": "s1", "task.id": "x1", "task.role": "lead", "task.title": "Ship it", "task.recipe": "work-lead", "task.ask": " Merge the PR now? " }, status: "done", cwd: "/start", foreground: { cwd: "/repo" } }),
  term("t2", { parent: "t1", name: "x1-build", labels: { "task.id": "x1" }, status: "working" }),
  term("vps/t3", { parent: "t1", name: "x1-ask", labels: { "task.id": "x1" }, status: "blocked", report: { kind: "auth", msg: "Sign in to GitHub again." } }),
  term("t4", { labels: { "task.id": "x1" }, state: "ended", finished_ms: NOW - 3600000 }),
  term("t5", { labels: { "task.id": "x1" }, state: "ended", finished_ms: NOW - 2 * 86400000 }),
  term("t6", { labels: { "herdr.space": "s1" }, title: "Fix the login form" }),
  term("t7", { labels: { "herdr.space": "s1" }, program: { key: "shell", agent: false }, status: undefined }),
  term("t8", { status: "blocked", report: {} }),
];
const selection = { key: "task:x1", lead: "t1", members: ["t1", "t2", "vps/t3"], title: "Ship it" };
const changes = { t1: { at: NOW - M }, t2: { at: NOW - 5 * M } };

assert.equal(panel.detailOf(null, terms, new Map(), spaces, {}), null);
assert.deepEqual(panel.detailOf({ key: "agent:t9", lead: "t9", members: ["t9"], title: "Old" }, terms, new Map(), spaces, {}), { gone: true, title: "Old" });

// A lead seen in its pane reads idle (agents() says so); a worker is never done; ages from the sidebar's clock only.
const d = panel.detailOf(selection, terms, new Map([["t1", "idle"]]), spaces, changes);
assert.equal(d.title, "Ship it");
assert.equal(d.leadRow.status, "idle");
assert.equal(d.leadRow.at, NOW - M);
assert.deepEqual(d.workers.map((w) => [w.t.address, w.status, w.at]), [["t2", "working", NOW - 5 * M], ["vps/t3", "blocked", null]]);
assert.deepEqual(d.needs.map((n) => [n.t.address, n.kind, n.sentence]), [["vps/t3", "Needs sign-in", "Sign in to GitHub again."]]);
assert.deepEqual([d.ask.t.address, d.ask.text], ["t1", "Merge the PR now?"], "no need published (an older list): the lead's own task.ask");
assert.equal(d.space.name, "herdr");
// The tooltip's folder: the lead's launch folder while it exists (a cd, in or out of the task, moves
// nothing); where it runs now once the lead's read found the launch folder gone (moved by hand).
assert.deepEqual([d.cwd, d.liveCwd], ["/start", "/repo"]);
assert.equal(panel.shownFolder(d, null), "/start", "not read yet: the launch folder");
assert.equal(panel.shownFolder(d, { launch_gone: false }), "/start", "a cd out of the task: still its folder");
assert.equal(panel.shownFolder(d, { launch_gone: true }), "/repo", "the launch folder gone: where it runs now");
// A blocked agent without a kind or a sentence: the list's "Waiting on you", no sentence.
const lone = panel.detailOf({ key: "agent:t8", lead: "t8", members: ["t8"] }, terms, new Map(), spaces, {});
assert.deepEqual(lone.needs.map((n) => [n.kind, n.sentence, n.isLead]), [["Waiting on you", null, true]]);

// What the list publishes wins: its task.ask (here a sub-lead's), its title, its seen rule.
const sub = panel.detailOf({ ...selection, need: { by: "t2", kind: "Asks you", text: " Which branch? " }, status: "idle", title: "Ship" }, terms, new Map(), spaces, changes);
assert.deepEqual([sub.ask.t.address, sub.ask.text], ["t2", "Which branch?"]);
assert.equal(panel.detailOf({ ...selection, need: { by: "vps/t3", kind: "Needs sign-in", text: "x" } }, terms, new Map(), spaces, changes).ask, null, "a blocked agent's need is its block, not an ask");
assert.equal(panel.detailOf({ ...selection, need: null }, terms, new Map(), spaces, changes).ask, null, "the list says nothing waits");
assert.equal(sub.leadRow.status, "idle", "done, but the row no longer shows it as Done");
assert.equal(panel.detailOf({ ...selection, status: "done" }, terms, new Map(), spaces, changes).leadRow.status, "done");
// working-wins: a task Working by its workers keeps its lead's unseen Done on the lead's line.
assert.equal(panel.detailOf({ ...selection, status: "working", leadWord: "done" }, terms, new Map(), spaces, changes).leadRow.status, "done", "the lead's unseen Done under a Working task");
assert.equal(panel.detailOf({ ...selection, status: "working", leadWord: "idle" }, terms, new Map(), spaces, changes).leadRow.status, "idle", "seen: idle");
assert.equal(panel.detailOf({ key: "agent:t6", lead: "t6", members: ["t6"], title: "shad" }, [term("t6", { title: "π - shad" })], new Map(), spaces, {}).title, "shad", "the list's title, not the terminal's");
// A done worker stays done (it finished and reported), as in the list.
assert.equal(panel.statusOf(term("w", { status: "done" }), new Map()), "done");

// Ended workers: what terminals() still holds from the last day and what hc ls --all lists; never the lead.
const fromHc = [{ address: "t1", state: "finished" }, { address: "vps/t9", name: "x1-lint", state: "finished", exit_code: 1 }, { address: "t4", state: "finished" }];
assert.deepEqual(panel.endedOf(["x1"], fromHc, terms, "t1", NOW).map((e) => e.t.address), ["t4", "vps/t9"]);
assert.deepEqual(panel.endedOf([], fromHc, terms, "t1", NOW), []);
// A task folds in an old sub-lead's own id; its ended top lead is not a worker.
const folded = [...fromHc, { address: "vps/t10", state: "finished", labels: { "task.id": "y2" } }, { address: "t0", state: "finished", labels: { "task.id": "x1", "task.role": "lead" } }];
assert.deepEqual(panel.endedOf(["x1", "y2"], folded, terms, undefined, NOW).map((e) => e.t.address), ["t4", "t1", "vps/t9", "vps/t10"]);
assert.deepEqual(panel.detailOf({ ...selection, ids: ["x1", "y2"] }, terms, new Map(), spaces, {}).ids, ["x1", "y2"]);
assert.deepEqual(d.ids, ["x1"], "no ids published: the task's own");

// The footer's check. A machine whose members ended or moved to another task drops out of the
// reads, so its old answer no longer holds the age (it said "checked 7h ago" in red for good).
const reads = { "": { at: NOW - M }, "home-server": { at: NOW - 7 * 60 * M } };
assert.deepEqual(panel.checkedOf(reads, new Set(), "", NOW), { text: "checked 7h ago", warn: true, reading: false }, "the old bug, kept by every machine ever read");
panel.dropGone(reads, new Set([""]));
assert.deepEqual(Object.keys(reads), [""]);
assert.deepEqual(panel.checkedOf(reads, new Set(), "", NOW), { text: "checked 1m ago", warn: false, reading: false });
// A machine with live members that doesn't answer keeps its last age, in red; the next good read clears it.
const away = { "": { at: NOW - M }, vps: { at: NOW - 6 * 60 * M } };
assert.deepEqual(panel.checkedOf(away, new Set(["vps"]), "", NOW), { text: "checked 6h ago", warn: true, reading: false });
away.vps = { at: NOW, fails: 0, failedAt: null };
assert.deepEqual(panel.checkedOf(away, new Set(), "", NOW), { text: "checked 1m ago", warn: false, reading: false });
// The lead's machine down: its state line says so in red, the footer doesn't repeat it.
assert.equal(panel.checkedOf({ vps: { at: NOW - 60 * M } }, new Set(["vps"]), "vps", NOW).warn, false);
// Reading, never read and failed since the last good read.
assert.equal(panel.checkedOf({ "": { at: NOW - M, reading: true } }, new Set(), "", NOW).text, "checking…");
assert.deepEqual(panel.checkedOf({ "": { fails: 1, failedAt: NOW } }, new Set(), "", NOW), { text: "couldn't check", warn: true, reading: false });
assert.equal(panel.checkedOf({ "": { at: NOW - M, failedAt: NOW } }, new Set(), "", NOW).warn, true);
// A machine that came back is read again at once: a changed signature makes the read due.
assert.ok(panel.readDue({ at: NOW - 6 * 60 * M, fails: 0, signature: "old" }, { anyWorking: false, signature: "new", now: NOW }) <= 0);
assert.ok(panel.readDue({ at: NOW - 6 * 60 * M, fails: 0, signature: "same" }, { anyWorking: false, signature: "same", now: NOW }) <= 0);

// Settings: defaults when missing or broken, old keys still load.
assert.equal(panel.settingsFrom(null), panel.DEFAULTS);
assert.equal(panel.settingsFrom("{nope"), panel.DEFAULTS);
assert.equal(panel.settingsFrom(JSON.stringify({ activities: [{ id: "w", label: "W" }], recipes: [{ id: "r", label: "R", activity: "w" }] })).recipes[0].area, "w");

// On screen only when nothing above it is hidden and it is its stack's active child.
const tower = (hidden) => ({ id: "work-body", type: "row", children: [
  { id: "main", type: "block", content: { tab: "active" } },
  { id: "tower-detail", type: "column", hidden, children: [{ id: "tower-panel", type: "block", content: { mod: "agent-tower-panel" } }] },
] });
assert.equal(panel.blockShown(tower(false), "agent-tower-panel"), true);
assert.equal(panel.blockShown(tower(true), "agent-tower-panel"), false);
assert.equal(panel.blockShown({ type: "stack", active: "files", children: [{ id: "files" }, { id: "p", content: { mod: "agent-tower-panel" } }] }, "agent-tower-panel"), false);

// tower-solo: whichever opened last stays.
assert.equal(panel.nodeShown(tower(false), "tower-detail"), true);
assert.equal(panel.soloHide(true, true, { herdr: false }), "tower-detail", "Files opened while Details was open");
assert.equal(panel.soloHide(true, true, null), "panel", "Details opened while Files was open");
assert.equal(panel.soloHide(true, true, { herdr: true }), "panel");
assert.equal(panel.soloHide(false, true, null), null);

assert.equal(panel.duration(30000), "<1m");
assert.equal(panel.duration(3 * 86400000), "3d");

// Masking: keys go, query strings go, paths and plain words stay.
assert.equal(panel.mask("key sk-abc123def456 and ghp_AbCdEf123456 ok"), "key ••• and ••• ok");
assert.equal(panel.mask("Bearer abc.def-123"), "•••");
assert.equal(panel.mask("AKIAABCDEFGHIJKLMNOP"), "•••");
assert.equal(panel.mask("see https://github.com/o/r/pull/4?token=x#frag now"), "see https://github.com/o/r/pull/4 now");
assert.equal(panel.mask("commit 3f2a9c0d1e4b5a6978c0d1e2f3a4b5c6d7e8f9a0"), "commit •••");
assert.equal(panel.mask("/home/me/code/kit/agent-tower"), "/home/me/code/kit/agent-tower");

// Reports: first sentence, paths as file names; a closing question; the ask not said twice.
assert.equal(panel.shortPaths(panel.firstSentence("Done: wrote /tmp/x/report.md. More here.")), "Done: wrote report.md.");
assert.equal(panel.endedWithQuestion("Built it.\n\nTests pass. Should I merge?"), "Should I merge?");
assert.equal(panel.endedWithQuestion("Should I merge?\n\nDone."), null);
// Under the Asks you card: a message ending with a question goes (the card says it); a report stays as context.
assert.equal(panel.underAsk({ text: "I checked the cause.\n\nFirst question: should the list stay?", color: "foreground" }), null);
assert.deepEqual(panel.underAsk({ text: "Built it.", color: "foreground" }), { text: "Built it.", color: "foreground" });
assert.equal(panel.underAsk(null), null);

// Cut: over 135 characters or more than two line breaks; the folded form ends with "…".
assert.equal(panel.clip("one two three", 9), "one two…");
assert.equal(panel.clip("short", 9), "short");
assert.equal(panel.widthScale(340, 49), 1);
assert.equal(panel.widthScale(420, 49), 1, "never above the 340px look");
assert.equal(panel.widthScale(undefined, 49), 1);
assert.ok(panel.widthScale(252, 49) < 0.75);
assert.equal(panel.isCut("x".repeat(100), 3, 0.7), true, "a narrow panel folds sooner");
assert.equal(panel.isCut("short"), false);
assert.equal(panel.isCut("a\nb\nc\nd"), true);
assert.equal(panel.isCut("x".repeat(136)), true);
assert.equal(panel.folded("a\nb\nc\nd"), "a b c d", "cut only for its breaks: as prose it all fits, no …");
assert.equal(panel.isCut("a\nb\nc", 2), true, "under the Asks you card: two lines");
assert.equal(panel.isCut("a\nb", 2), false);
assert.equal(panel.isCut("x".repeat(80), 2), false);
assert.equal(panel.folded("a\nb\nc", 2), "a b c");

// The real-agent test's message: the fold never ends on a list marker (E2E-FIX 5).
const listed = "All three files are written, and the water worker has now confirmed it wrote three short sentences. This was the last report.\n\n- /var/tmp/tower-e2e/work/tea.txt\n- /var/tmp/tower-e2e/work/coffee.txt\n- /var/tmp/tower-e2e/work/water.txt\n\nThe three workers are still running, and I left them for you to end.";
const fold = panel.folded(listed);
assert.ok(fold.startsWith("All three files are written") && fold.endsWith("…"), fold);
assert.ok(!/(^|\s)[-*+•]\s*…$/.test(fold) && !fold.includes(" - "), `no lone marker: ${fold}`);
for (const n of [120, 125, 126, 128, 130, 135, 140]) assert.ok(!/[-*+•]…$/.test(panel.clip(panel.prose(listed), n)), `clip at ${n}`);
assert.equal(panel.prose("## Done\n\n**Tests** pass in `src/a_b.rs`.\n\n```sh\nmake\n```\n1. First _one_\n> quoted"), "Done Tests pass in src/a_b.rs. First one quoted");
assert.equal(panel.clip("Ends on a list - item", 16), "Ends on a list…");
assert.ok(panel.folded("word ".repeat(60)).length <= panel.CUT_CHARS + 1);

// Segments: whole ones drop from the tail past 48 characters; the first always stays.
const words = (segs) => segs.map((s) => s.text).join(" · ");
assert.equal(words(panel.fit([{ text: "x".repeat(60) }, { text: "y" }])), "x".repeat(60));

const pr = (failing = 0, running = 0) => ({ number: 412, failing, running });
const repo = (r) => ({ name: "app", upstream: "origin/f", ahead: 0, changed: 0, pr: null, ...r });
assert.equal(words(panel.codeSummary([repo({ changed: 19, pr: pr(2) })])), "2 checks failing · PR #412 · 19 changed");
assert.equal(panel.codeSummary([repo({ changed: 19, pr: pr(2) })])[0].color, "ansi1");
assert.equal(words(panel.codeSummary([repo({ ahead: 3, changed: 19, pr: pr() })])), "3 commits unpushed · PR #412 · 19 changed");
assert.equal(panel.codeSummary([repo({ ahead: 3 })])[0].color, undefined, "unpushed is not a warning");
assert.equal(words(panel.codeSummary([repo({ ahead: 1 })])), "1 commit unpushed · all committed");
assert.equal(words(panel.codeSummary([repo({ upstream: null, changed: 19 })])), "19 changed · never pushed");
assert.equal(words(panel.codeSummary([repo({ upstream: null, remote: false, changed: 2 })])), "2 changed · no remote");
assert.equal(words(panel.codeSummary([repo({ pr: pr() })])), "PR #412 · all committed");
assert.equal(words(panel.codeSummary([repo({ pr: pr(0, 2), changed: 1 })])), "checks running · PR #412 · 1 changed");
assert.equal(words(panel.codeSummary([repo({ pr: pr(1) })])), "1 check failing · PR #412 · all committed");
assert.equal(words(panel.codeSummary([repo({ pr: pr(1), changed: 20, ahead: 1 }), repo({ pr: pr(1), changed: 21, ahead: 1 }), repo({ changed: 0 })])), "3 repos · 2 checks failing · 2 commits unpushed", "the changed count drops past 48");
assert.equal(words(panel.savedSummary({ ago_ms: 60 * M }, 5 * M)), "Saved progress 1h ago · newer work unsaved");
assert.equal(words(panel.savedSummary({ ago_ms: 60 * M }, 55 * M)), "Saved progress 1h ago");

// Report owners: own machine stripped, bare ids on the lead's machine, peers dropped, name breaks ties.
const ws = [{ t: { address: "t2", name: "x1-build" } }, { t: { address: "vps/t3", name: "x1-ask" } }];
assert.equal(panel.reportOwner("t2 x1-build", ws, null, ["vps"]).t.address, "t2");
assert.equal(panel.reportOwner("mac-air/t2", ws, null, ["vps"]).t.address, "t2", "this app's own machine name maps to a bare id");
assert.equal(panel.reportOwner("t3", ws, "vps", ["vps"]).t.address, "vps/t3", "a bare id from a lead on vps");
assert.equal(panel.reportOwner("vps/t3 x1-ask", ws, null, ["vps"]).t.address, "vps/t3");
assert.equal(panel.reportOwner("t9 x1-ask", ws, null, ["vps"]).t.address, "vps/t3", "the name when the id is not a member");
assert.equal(panel.reportOwner("t5q", ws, null, ["vps"]), null, "a peer");
const reports = panel.reportsFor([{ from: "t2", text: "old", ago_ms: 9 * M }, { from: "t2", text: "new", ago_ms: 3 * M }, { from: "vps/t3", text: "stale", ago_ms: 2 * 86400000 }], ws, null, ["vps"]);
assert.deepEqual([...reports].map(([a, r]) => [a, r.text]), [["t2", "new"]]);

// The state line.
const read = (r) => ({ found: true, written_ago_ms: 40000, open_tool: false, last: { text: "Hi.", ago_ms: 12 * M }, turn_ago_ms: 5 * M, compact_ago_ms: null, ...r });
const line = (s) => s && [s.word, ...s.meta.map((m) => m.text)].join(" · ");
assert.equal(line(panel.stateLine({ status: "done", at: NOW - 2 * M }, null, false, NOW)), "Done 2m ago");
assert.equal(line(panel.stateLine({ status: "idle", at: NOW - 3 * 3600000 }, null, false, NOW)), "Idle for 3h");
assert.equal(line(panel.stateLine({ status: "working", at: NOW - 12 * M }, read({ written_ago_ms: 9 * M }), false, NOW)), "Working for 12m", "quiet under 10 minutes says nothing");
const moving = panel.stateLine({ status: "working", at: NOW - 47 * M }, read({ written_ago_ms: 31 * M }), true, NOW);
assert.deepEqual([line(moving), moving.meta[0].color], ["Working for 47m · quiet 31m", "dim"]);
const quiet = panel.stateLine({ status: "working", at: NOW - 47 * M }, read({ written_ago_ms: 31 * M }), false, NOW);
assert.deepEqual([line(quiet), quiet.meta[0].color], ["Working for 47m · quiet 31m", "ansi1"]);
assert.equal(panel.stateLine({ status: "working", at: NOW - 47 * M }, read({ written_ago_ms: 31 * M, open_tool: true }), false, NOW).meta[0].color, "dim", "a tool call is still running");
assert.equal(line(panel.stateLine({ status: "working", at: NOW - 12 * M }, read({ written_ago_ms: 20 * M }), true, NOW)), "Working for 12m · quiet since it started");
assert.equal(line(panel.stateLine({ status: "working", at: NOW - 47 * M }, read({ compact_ago_ms: 20 * M, last: { text: "x", ago_ms: 30 * M } }), false, NOW)), "Working for 47m · compacted 20m ago");
assert.equal(panel.stateLine({ status: "blocked", at: NOW - 9 * M }, null, false, NOW), null, "the block says it");
assert.equal(line(panel.stateLine(null, null, false, NOW)), "Ended");
assert.equal(line(panel.stateLine({ status: "done", at: NOW - 20000 }, null, false, NOW)), "Done just now");
assert.equal(line(panel.stateLine({ status: "working", at: NOW - 20000 }, null, false, NOW)), "Working");
assert.deepEqual(["working", "idle", "blocked", "done"].map((s) => panel.sinceWords(s, 5 * M)), ["working for 5m", "idle for 5m", "waiting for 5m", "done 5m ago"]);
const frozen = panel.stateLine({ status: "working", at: NOW - M }, null, false, NOW, { name: "work-vps" });
assert.deepEqual([line(frozen), frozen.meta[0].color], ["Was working · work-vps doesn't answer", "ansi1"]);

// The message slot: the transcript's words, never hc's short status line.
assert.deepEqual(panel.messageOf("done", read(), true), { text: "Hi.", color: "foreground" });
assert.deepEqual(panel.messageOf("working", read(), true), { text: "Hi.", color: "dim", prefix: "Last said 12m ago: " });
assert.deepEqual(panel.messageOf("working", read({ turn_ago_ms: 20 * M }), true), { text: "Hi.", color: "muted", prefix: "Said 12m ago, still working: " }, "a note from the turn still running");
assert.equal(panel.activityWords("Running for a in $(hc ls --json --all | jq -r '.terminals[]')"), "Running a command");
assert.equal(panel.activityWords("Waiting for a worker report"), "Waiting for a worker report");
assert.ok(panel.activityWords("Reading ".repeat(20)).length <= 60);
assert.equal(panel.activityWords("  "), null);
assert.deepEqual(panel.messageOf("blocked", read({ turn_ago_ms: 20 * M }), true).prefix, "Last said 12m ago: ");
// Working on a new prompt it hasn't answered: what it was asked, an hc message as plain words.
assert.deepEqual(panel.messageOf("working", read({ prompt: { text: '<hc from="t4c tower-lab">Fix the footer.</hc>', ago_ms: 5 * M } }), true),
  { text: "From t4c tower-lab: Fix the footer.", color: "muted", prefix: "Asked 5m ago: " });
// A compaction never hides the last real message.
assert.equal(panel.messageOf("idle", read({ compact_ago_ms: 20 * M, last: { text: "x", ago_ms: 30 * M } }), true).text, "x");
assert.equal(panel.messageOf("idle", read({ last: { text: "the tower pan", cut: true, ago_ms: M } }), true).text, "the tower…cut, go to the agent for the rest");
// No conversation: why.
assert.equal(panel.messageOf("idle", { found: false }, true, { program: "Codex", where: "work-vps" }).text, "No Codex conversation found on work-vps");
assert.equal(panel.messageOf("idle", { found: false, ambiguous: true }, true, { program: "pi", where: "this computer" }).text,
  "Two pi agents share this folder on this computer");
assert.equal(panel.messageOf("idle", read({ last: null }), true).text, "No message yet");
assert.equal(panel.messageOf("ended", null, false).text, "Lead ended");
// A message that ends with a question folds to the question, so it stays in view.
const asking = `I checked the cause and had the lab's code read for what the board needs. ${"More detail here. ".repeat(12)}\n\nFirst question: should the list stay visible?`;
assert.equal(panel.folded(asking), "… First question: should the list stay visible?");
assert.ok(panel.folded(asking, 2, 0.4).startsWith("… First question:"), "narrow: still the question, cut at its end");
assert.equal(panel.prose("Short version:\n---\nPlan *A*"), "Short version: Plan A", "a rule is not text");

assert.equal(panel.folderOf("/home/me/work/tasks/rate-limiter"), "rate-limiter");
assert.equal(panel.folderOf("/Users/a/garden/"), "garden");

// Reads: at once the first time; on a status change once READ_FLOOR_MS has passed since the last
// read (a busy task changes every second); then every 60 s while working, 5 min otherwise; 5 min
// after three failures; 30 min when python3 is missing.
assert.equal(panel.readDue(undefined, { signature: "a", now: NOW }), 0);
const ok = { at: NOW - 30000, signature: "a", fails: 0 };
assert.ok(panel.readDue(ok, { anyWorking: true, signature: "a", now: NOW }) > 0);
assert.ok(panel.readDue(ok, { anyWorking: true, signature: "b", now: NOW }) <= 0, "a change after the floor reads now");
assert.equal(panel.readDue({ ...ok, at: NOW - 5000 }, { anyWorking: true, signature: "b", now: NOW }), panel.READ_FLOOR_MS - 5000, "a change inside the floor waits for it");
assert.equal(panel.readDue({ ...ok, at: NOW - 61000 }, { anyWorking: true, signature: "a", now: NOW }) <= 0, true);
assert.equal(panel.readDue({ ...ok, at: NOW - 61000 }, { anyWorking: false, signature: "a", now: NOW }) > 0, true);
assert.equal(panel.readDue({ fails: 3, failedAt: NOW - 2 * M, signature: "a" }, { anyWorking: true, signature: "b", now: NOW }), 3 * M);
assert.equal(panel.readDue({ missing: true, failedAt: NOW - 10 * M, signature: "a" }, { signature: "b", now: NOW }), 20 * M);

// read.py: a Claude transcript (by --session), a worker quiet for 20 minutes, a repo with changes and no upstream.
const dir = mkdtempSync(join(tmpdir(), "tower-read-"));
const at = (s) => new Date(Date.now() - s * 1000).toISOString();
// Seconds between a made-up time and read.py's now, to 10 s: the time passing between writing the
// file and reading it (Python starts slowly on a Mac) must not move an exact check.
const ago10 = (now, x) => (x == null ? null : Math.round((now - x) / 10) * 10);
const lines = [
  { type: "user", timestamp: at(900), message: { role: "user", content: '<hc from="t2 x1-build">Built it. Result in /tmp/r.md</hc>' } },
  { type: "assistant", timestamp: at(600), message: { id: "m1", role: "assistant", content: [{ type: "text", text: "First part." }] } },
  { type: "assistant", timestamp: at(600), message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Should I merge?" }] } },
  { type: "system", subtype: "compact_boundary", timestamp: at(1200) },
  { type: "user", timestamp: at(300), message: { role: "user", content: "go on" } },
  { type: "assistant", timestamp: at(200), message: { id: "m2", role: "assistant", content: [{ type: "tool_use", id: "u1" }] } },
];
writeFileSync(join(dir, "lead.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
// The worker last moved 20 minutes ago; Claude Code then appended an untimestamped record to the
// idle session, which moves the file's mtime but not the worker (review r1, 5).
writeFileSync(join(dir, "worker.jsonl"), `${JSON.stringify({ ...lines[1], timestamp: at(1200) })}\n${JSON.stringify({ type: "mode", mode: "default" })}\n`);
// A repo with one changed file and an untracked folder of two: three files, no remote.
execFileSync("git", ["init", "-q", "-b", "feature/x", join(dir, "repo")]);
writeFileSync(join(dir, "repo", "a.txt"), "a");
execFileSync("mkdir", ["-p", join(dir, "repo", "mod")]);
writeFileSync(join(dir, "repo", "mod", "b.js"), "b");
writeFileSync(join(dir, "repo", "mod", "c.js"), "c");
// A clean repo beside it, under the lead's folder: not the task's. One with changes under a member's
// folder that is not a repo is (a task in ~/code/tower works in ~/code/tower/kit).
execFileSync("git", ["init", "-q", join(dir, "other")]);
execFileSync("git", ["init", "-q", join(dir, "kit")]);
writeFileSync(join(dir, "kit", "new.js"), "n");
// The same repo through a symlink (macOS's temp folder is one): listed once.
symlinkSync(join(dir, "repo"), join(dir, "link"));
const script = readFileSync(new URL("./mods/agent-tower-panel/read.py", import.meta.url), "utf8");
const out = JSON.parse(execFileSync("python3", ["-c", script, JSON.stringify({
  lead: { pid: null, argv: ["claude", "--session", join(dir, "lead.jsonl")], cwd: dir },
  workers: [{ key: "t2", pid: null, argv: ["claude", "--session", join(dir, "worker.jsonl")] }],
  cwds: [dir, join(dir, "repo", "mod"), join(dir, "link", "mod")], lead_cwd: dir, chain: false, gh_skip: [],
})], { encoding: "utf8" }));
assert.equal(out.lead.found, true);
assert.equal(out.lead.last.text, "First part.\n\nShould I merge?");
assert.ok(Math.abs(out.lead.last.ago_s - 600) < 5 && Math.abs(out.lead.turn_ago_s - 300) < 5 && Math.abs(out.lead.compact_ago_s - 1200) < 5);
assert.equal(out.lead.open_tool, true);
assert.deepEqual(out.lead.reports.map((r) => [r.from, r.text]), [["t2 x1-build", "Built it. Result in /tmp/r.md"]]);
assert.ok(out.workers.t2.written_s > 1100, "last moved from the newest timestamped record, not the mtime");
assert.equal(out.lead.prompt.text, "go on");
assert.deepEqual(out.repos.map((r) => [r.name, r.branch, r.upstream, r.remote, r.changed, r.pr]), [["repo", "feature/x", null, false, 3, null], ["kit", out.repos[1]?.branch, null, false, 1, null]],
  "a member's own repo, and one under a member's folder with changes; untracked files counted one by one");

// Without /proc (macOS) and without a pid, read.py must not run lsof: "lsof -p ''" lists every
// open file on the machine (the Mac's test took minutes). Here lsof is made to fail loudly.
const noProc = execFileSync("python3", ["-c", `
import importlib.util, os, subprocess, sys
sys.argv = ["read.py", "{}"]
spec = importlib.util.spec_from_file_location("read", ${JSON.stringify(new URL("./mods/agent-tower-panel/read.py", import.meta.url).pathname)})
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r.os.path.isdir = lambda p: False if p == "/proc" else os.path.isdir(p)
def boom(*a, **k): raise AssertionError("lsof ran with no pid")
r.subprocess.run = boom
print(list(r.open_jsonl([])))
`], { encoding: "utf8" }).trim();
assert.equal(noProc, "[]");

// One ps for every agent a run asks about, and on macOS one lsof for all their processes; each agent
// still gets its own transcript from it.
const batched = execFileSync("python3", ["-c", `
import importlib.util, json, os, sys
sys.argv = ["read.py", "{}"]
spec = importlib.util.spec_from_file_location("read", ${JSON.stringify(new URL("./mods/agent-tower-panel/read.py", import.meta.url).pathname)})
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r.os.path.isdir = lambda p: False if p == "/proc" else os.path.isdir(p)
calls = []
class Out:
    def __init__(self, text): self.stdout = text
def fake(cmd, *a, **k):
    calls.append(cmd[0])
    if cmd[0] == "ps": return Out("100 1\\n101 100\\n200 1\\n201 200\\n")
    if cmd[0] == "lsof": return Out("p101\\nn/home/me/.codex/sessions/2026/11/15/a.jsonl\\np201\\nn/home/me/.pi/agent/sessions/--home-me--/b.jsonl\\n")
    raise AssertionError(cmd)
r.subprocess.run = fake
r.HOME = "/nowhere"
r.open_prefetch([p for root in (100, 200) for p in r.tree(root)])
print(json.dumps([r.find_transcript(100, ["codex"], None), r.find_transcript(200, ["pi"], None), calls]))
`], { encoding: "utf8" }).trim();
assert.deepEqual(JSON.parse(batched), ["/home/me/.codex/sessions/2026/11/15/a.jsonl", "/home/me/.pi/agent/sessions/--home-me--/b.jsonl", ["ps", "lsof"]]);

// read.py turns (Timeline's backfill): start, end, how each turn ended, its question-tool waits.
const tl = [
  { type: "user", timestamp: at(3600), message: { role: "user", content: "plan the release" } },
  { type: "assistant", timestamp: at(3500), message: { id: "a", role: "assistant", content: [{ type: "text", text: "Planned.\n\nShip on Friday?" }] } },
  { type: "user", timestamp: at(3000), message: { role: "user", content: "yes, and check the notes" } },
  { type: "assistant", timestamp: at(2900), message: { id: "b", role: "assistant", content: [{ type: "tool_use", id: "q1", name: "AskUserQuestion" }, { type: "tool_use", id: "r1", name: "Read" }] } },
  { type: "user", timestamp: at(2890), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "r1" }] } },
  { type: "user", timestamp: at(2500), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "q1" }] } },
  { type: "assistant", timestamp: at(2400), message: { id: "c", role: "assistant", content: [{ type: "text", text: "Done?" }, { type: "tool_use", id: "x", name: "Bash" }] } },
  { type: "user", timestamp: at(2390), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x" }] } },
  { type: "user", timestamp: at(600), message: { role: "user", content: "next" } },
  { type: "assistant", timestamp: at(500), message: { id: "d", role: "assistant", content: [{ type: "tool_use", id: "q2", name: "AskUserQuestion" }] } },
];
writeFileSync(join(dir, "turns.jsonl"), tl.map((l) => JSON.stringify(l)).join("\n") + "\n");
const tAnswer = JSON.parse(execFileSync("python3", ["-c", script, JSON.stringify({ turns: { terminals: [{ key: "t9", argv: ["claude", "--session", join(dir, "turns.jsonl")] }] } })], { encoding: "utf8" }));
const T = tAnswer.turns.terminals.t9;
const rel = (x) => ago10(tAnswer.now, x);
assert.equal(T.program, "claude");
assert.ok(Math.abs(rel(T.covers) - 3600) < 5, "covers: the earliest time read");
assert.deepEqual(T.turns.map((t) => [rel(t.start), rel(t.end), t.ended, t.question ?? null, t.asks.map(([f, to]) => [rel(f), rel(to)])]), [
  [3600, 3500, "question", "Ship on Friday?", []],
  [3000, 2390, "answer", null, [[2900, 2500]]],
  [600, 500, "ask-tool", null, [[500, null]]],
], "a question only when the last words end on ? with no tool call after; each wait matched to its own answer");
// Unchanged since the caller's copy: no turns again.
const again = JSON.parse(execFileSync("python3", ["-c", script, JSON.stringify({ turns: { terminals: [{ key: "t9", argv: ["claude", "--session", join(dir, "turns.jsonl")] }], have: { [T.path]: [T.mtime, T.size] } } })], { encoding: "utf8" }));
assert.deepEqual([again.turns.terminals.t9.same, again.turns.terminals.t9.turns], [true, undefined]);
// Codex: task_started and user_message are one turn; request_user_input is a question tool.
const cx = [
  { timestamp: at(900), type: "event_msg", payload: { type: "task_started" } },
  { timestamp: at(899), type: "event_msg", payload: { type: "user_message", message: "fix it" } },
  { timestamp: at(800), type: "response_item", payload: { type: "function_call", name: "request_user_input", call_id: "c1" } },
  { timestamp: at(700), type: "response_item", payload: { type: "function_call_output", call_id: "c1" } },
  { timestamp: at(650), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixed." }] } },
];
execFileSync("mkdir", ["-p", join(dir, ".codex")]);
writeFileSync(join(dir, ".codex", "rollout.jsonl"), cx.map((l) => JSON.stringify(l)).join("\n") + "\n");
const cAnswer = JSON.parse(execFileSync("python3", ["-c", script, JSON.stringify({ turns: { terminals: [{ key: "c", argv: ["codex", "--session", join(dir, ".codex", "rollout.jsonl")] }] } })], { encoding: "utf8" }));
assert.deepEqual(cAnswer.turns.terminals.c.turns.map((t) => [ago10(cAnswer.now, t.start), t.ended, t.asks.length]), [[900, "answer", 1]]);

// Read back only as far as since_s: a 10-hour transcript of about 6 MB, asked for its last hour,
// is read in 1 MB blocks to just past the hour, not whole; asked for a day, whole.
const long = [];
for (let k = 36000; k > 0; k -= 6) long.push(JSON.stringify(k % 600 === 0
  ? { type: "user", timestamp: at(k), message: { role: "user", content: `step ${k}` } }
  : { type: "assistant", timestamp: at(k), message: { id: `m${k}`, role: "assistant", content: [{ type: "text", text: "x".repeat(80) }] } }));
const longWritten = Date.now() / 1000;
writeFileSync(join(dir, "long.jsonl"), long.join("\n") + "\n");
const span = (since) => JSON.parse(execFileSync("python3", ["-c", script, JSON.stringify({ turns: { terminals: [{ key: "l", argv: ["claude", "--session", join(dir, "long.jsonl")] }], since_s: since } })], { encoding: "utf8" })).turns.terminals.l;
const hour = span(3600);
assert.ok(hour.covers <= Date.now() / 1000 - 3600 && hour.read < hour.size && !hour.capped, `an hour: ${hour.read} of ${hour.size}`);
assert.ok(hour.turns.every((t) => t.end >= Date.now() / 1000 - 3600 - 5) && hour.turns.length >= 5);
const day = span(86400);
assert.equal(day.read, day.size, "a day reaches the start: read whole");
assert.ok(Math.abs(longWritten - day.covers - 36000) < 10, "covers: the file's first record");

// Timeline's long past, on a made-up home: transcripts of agents in /home/me/work/ledger.
const me = join(dir, "me");
const cwd = "/home/me/work/ledger";
const jsonl = (path, lines) => {
  execFileSync("mkdir", ["-p", join(path, "..")]);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
};
const claudeSay = (start, end, said, extra = {}) => [
  { type: "user", timestamp: at(start), cwd, sessionId: extra.sid, message: { role: "user", content: said } },
  { type: "assistant", timestamp: at(end), cwd, message: { id: `m${start}`, role: "assistant", content: [{ type: "text", text: "Done." }] } },
];
const ledger = join(me, ".claude/projects/-home-me-work-ledger");
const briefA = "Export the ledger to CSV. You are a worker on task k7-ledger; use the tower skill if you have it.";
const briefB = "Check the totals. You are a worker on task k7-ledger; use the tower skill if you have it.";
jsonl(join(ledger, "aaaa.jsonl"), claudeSay(7200, 3700, briefA, { sid: "aaaa" }));
jsonl(join(ledger, "bbbb.jsonl"), claudeSay(7190, 7000, briefB, { sid: "bbbb" }));
jsonl(join(ledger, "cccc.jsonl"), claudeSay(3000, 2000, "what is on my calendar?", { sid: "cccc" }));
// Codex writes its instructions first: the brief sits past 64 KB.
const local = (s) => { const d = new Date(Date.now() - s * 1000); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`; };
const codexDay = local(5000);
const codexRun = (start, end, folder, said) => [
  { timestamp: at(start), type: "session_meta", payload: { id: `cx-${start}`, cwd: folder } },
  { timestamp: at(start), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "x".repeat(150000) }] } },
  { timestamp: at(start - 1), type: "event_msg", payload: { type: "user_message", message: said } },
  { timestamp: at(end), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Checked." }] } },
];
jsonl(join(me, ".codex/sessions", codexDay, "rollout-a.jsonl"), codexRun(5000, 4000, cwd, "Review the export. You are a worker on task k7-ledger; use the tower skill if you have it."));
jsonl(join(me, ".codex/sessions", codexDay, "rollout-b.jsonl"), codexRun(5001, 4100, "/home/me/elsewhere", "Plan the trip. You are a worker on task q2-trip;"));
jsonl(join(me, ".pi/agent/sessions/--home-me-work-ledger--/2026_pi.jsonl"), [
  { type: "session", id: "pi-1", timestamp: at(900), cwd },
  { type: "message", id: "u", timestamp: at(900), message: { role: "user", content: [{ type: "text", text: "<hc from=\"t3 lead\">Sum the rows. You are a worker on task k7-ledger.</hc>" }] } },
  { type: "message", id: "a", timestamp: at(800), message: { role: "assistant", content: [{ type: "text", text: "Summed." }] } },
]);
// The lead's run line, its brief in a variable on the line before.
jsonl(join(me, ".claude/projects/-home-me-work/lead.jsonl"), [
  { type: "user", timestamp: at(7300), cwd: "/home/me/work", message: { role: "user", content: "rewrite the ledger export" } },
  { type: "assistant", timestamp: at(7210), cwd: "/home/me/work", message: { id: "l1", role: "assistant", content: [{ type: "tool_use", id: "b1", name: "Bash", input: {
    command: `B="${briefA}"\nhc run --bg --outlive-parent --label task.id=k7-ledger --label task.role=worker --name k7-ledger-export --cwd ~/work/ledger claude "$B"` } }] } },
]);
const readAs = (req) => JSON.parse(execFileSync("python3", ["-c", script, JSON.stringify(req)], { encoding: "utf8", env: { ...process.env, HOME: me } }));

// read.py: launch_gone says whether the lead's launch folder is there on that machine.
assert.equal(readAs({ launch: me }).launch_gone, false);
assert.equal(readAs({ launch: join(me, "moved-away") }).launch_gone, true);
assert.equal("launch_gone" in readAs({}), false, "not asked: not said");
// (e) An ended agent has no pid: its transcript is found by program, folder and [created, finished].
const ended = (program, created_s, finished_s, argv = [program], folder = cwd) => readAs({ turns: { since_s: 86400, terminals: [{ key: "x", pid: null, argv, cwd: folder, created_s, finished_s }] } }).turns.terminals.x;
assert.equal(ended("claude", 7205, 3690, ["claude", briefA])?.path, join(ledger, "aaaa.jsonl"), "two fit the window: the brief on the argv tells them apart");
assert.equal(ended("claude", 7205, 3690), null, "two fit and both started at once: none rather than a guess");
assert.equal(ended("claude", 7195, 6990)?.path, join(ledger, "bbbb.jsonl"), "only one fits a short window");
assert.equal(ended("claude", 3005, 1990)?.turns.length, 1, "the ended agent's turns, as for a live one");
assert.equal(ended("codex", 5010, 3990)?.path, join(me, ".codex/sessions", codexDay, "rollout-a.jsonl"), "Codex: the created day, session_meta's cwd");
assert.equal(ended("codex", 5010, 3990, ["codex"], "/home/me/nowhere"), null);
assert.equal(ended("pi", 905, 790)?.program, "pi");
assert.equal(ended("pi", 600, 100), null, "started before created: not this agent");

// (f) Agents hc has forgotten: transcripts whose first message names the task.
const found = readAs({ tasks: { ids: ["k7-ledger"], since_s: 86400 } });
const rows = found.tasks.map((t) => [t.task, t.program, t.cwd, t.session, t.name ?? null, ago10(found.now, t.first), ago10(found.now, t.last), t.turns.length]);
assert.deepEqual(rows, [
  ["k7-ledger", "claude", cwd, "aaaa", "k7-ledger-export", 7200, 3700, 1],
  ["k7-ledger", "claude", cwd, "bbbb", null, 7190, 7000, 1],
  ["k7-ledger", "codex", cwd, "cx-5000", null, 5000, 4000, 1],
  ["k7-ledger", "pi", cwd, "pi-1", null, 900, 800, 1],
], "workers of the task only, oldest first; a name where a lead's run line on this machine gives one");
assert.deepEqual(readAs({ tasks: { ids: ["q2-trip"] } }).tasks.map((t) => t.session), ["cx-5001"]);
const unchanged = readAs({ tasks: { ids: ["k7-ledger"], since_s: 86400, have: { [found.tasks[0].path]: [found.tasks[0].mtime, found.tasks[0].size] } } });
assert.deepEqual([unchanged.tasks[0].same, unchanged.tasks[0].turns], [true, undefined]);

// The chain link's title when chain.mjs falls back to the file name: saved with --title from text
// that starts with "##", or carrying a frontmatter title.
const chainCli = join(process.env.HOME, ".agents/skills/chains/chain.mjs");
if (existsSync(chainCli)) {
  const repoDir = join(dir, "chained");
  execFileSync("git", ["init", "-q", repoDir]);
  execFileSync("node", [chainCli, "save", "night", "--title", "Overnight progress on the tower", "--next", "Look at it."], { cwd: repoDir, input: "## Status\n\nDone.\n" });
  const linked = () => JSON.parse(execFileSync("python3", ["-c", script, JSON.stringify({ workers: [], cwds: [], lead_cwd: repoDir, chain: true, chains: ["night"], gh_skip: [] })], { encoding: "utf8" })).chain;
  assert.equal(linked().title, "Overnight progress on the tower", "not the file name");
  const file = readdirSync(join(repoDir, ".chains", "night"))[0];
  const path = join(repoDir, ".chains", "night", file);
  writeFileSync(path, readFileSync(path, "utf8").replace("---\n", '---\ntitle: "Overnight progress, PR #12"\n'));
  assert.equal(linked().title, "Overnight progress, PR #12", "a frontmatter title wins");
  // Only the task's own chain, on its main branch: a worker's branch or another chain is not this task's.
  execFileSync("node", [chainCli, "fork", "night", "worker"], { cwd: repoDir });
  execFileSync("node", [chainCli, "save", "night", "--branch", "worker", "--parent", file, "--title", "A worker's note", "--next", "x"], { cwd: repoDir, input: "w\n" });
  execFileSync("node", [chainCli, "save", "other", "--title", "Another task", "--next", "x"], { cwd: repoDir, input: "o\n" });
  assert.equal(linked().title, "Overnight progress, PR #12");
}

// A past moment from Timeline: its words; a stretch still going is live (no kept screen shown).
const from = new Date(2026, 10, 15, 5, 36).getTime();
assert.deepEqual(panel.thenWords({ word: "working", at: from, to: from + 170 * M, looked: null }, NOW),
  { word: "Working", span: "05:36–08:26 · 2h", looked: null, live: false });
assert.deepEqual(panel.thenWords({ word: "blocked", at: from, to: null, looked: 19 * M }, from + 30 * M),
  { word: "Waiting on you", span: "since 05:36 · 30m", looked: "you looked after 19m", live: true });
assert.equal(panel.thenWords({ word: "blocked", at: from, to: from + M, looked: null }, NOW).looked, "not looked at yet");
assert.equal(panel.screenTail("a\nb\nc\n\n", 2), "b\nc");

console.log("panel ok");
