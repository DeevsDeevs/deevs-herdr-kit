// node agent-tower/model.test.mjs: the grouping keeps every agent exactly once and every
// agent-less space once under Shells; Close reaches only its own item.
import assert from "node:assert/strict";
import * as model from "./mods/agent-tower/model.js";

const claude = { key: "claude", name: "Claude Code", agent: true };
const zsh = { key: "shell", name: "zsh", shell: true, agent: false };
const term = (address, space, extra = {}) => ({
  address, state: "live", program: claude, status: "idle", ...extra, labels: { "herdr.space": space, ...extra.labels },
});
const spaces = ["s1", "s2", "s3", "s4", "s5", "s6"].map((id, i) => ({ id, name: `space-${i + 1}`, machine: null }))
  .concat([{ id: "vps/s9", name: "remote", machine: "vps" }]);

const terms = [
  // A labelled task: lead t1, a worker t2 it started, a worker t3 another agent started, t4 under t2.
  term("t1", "s1", { labels: { "task.id": "x1", "task.role": "lead", "task.title": "Ship it" }, status: "working" }),
  term("t2", undefined, { parent: "t1", labels: { "task.id": "x1", "task.role": "worker" }, status: "blocked", report: { kind: "question", msg: "Which branch?" } }),
  term("t3", undefined, { parent: "t9", labels: { "task.id": "x1", "task.role": "worker" } }),
  term("t4", undefined, { parent: "t2", program: zsh, status: undefined }),
  // An unlabelled agent with a sub-agent, and a shell-started agent under a shell.
  term("t5", "s2", { title: "✳ Fix the login form", status: "done" }),
  term("t6", undefined, { parent: "t5", status: "working" }),
  term("t9", "s2", { parent: "t5" }),
  term("t7", "s3", { program: zsh, status: undefined }),
  term("t8", undefined, { parent: "t7" }),
  // An ended agent that is no task: gone from the list.
  term("t10", "s4", { state: "ended" }),
  // Plain shells, one remote.
  term("t11", "s5", { program: zsh, status: undefined }),
  // A new lead that has not reported yet: still a task, so its space is no shell.
  term("t12", "s6", { program: zsh, status: undefined, labels: { "task.id": "y2", "task.role": "lead" } }),
  term("vps/t1", "s9", { program: zsh, status: undefined }),
];

const items = model.workItems(terms, new Map(), spaces);
const shown = items.flatMap((i) => [i.lead, ...i.tree.map((r) => r.t)].filter((t) => t?.state === "live").map((t) => t.address));
const agentsLive = terms.filter((t) => t.state === "live" && (t.status != null || t.program?.agent)).map((t) => t.address);
for (const a of agentsLive) assert.equal(shown.filter((x) => x === a).length, 1, `${a} shown once`);
assert.equal(new Set(shown).size, shown.length, "nothing twice");

const task = items.find((i) => i.taskId === "x1");
assert.deepEqual(task.tree.map((r) => [r.t.address, r.lines.join("")]), [["t2", "├"], ["t4", "│└"], ["t3", "└"]]);
assert.equal(model.titleOf(task), "Ship it");
assert.deepEqual(model.needOf(task), { t: terms[1], kind: "Asks you", msg: "Which branch?" });
// Waits in words: what kind of wait it is, never the bare kind.
const waitOf = (extra) => model.needOf(model.workItems([term("k1", "s1", extra)], new Map(), spaces)[0]).kind;
assert.equal(waitOf({ status: "blocked", report: { kind: "auth" } }), "Needs sign-in");
assert.equal(waitOf({ status: "blocked", report: { kind: "permission" } }), "Needs permission");
assert.equal(waitOf({ status: "blocked" }), "Waiting on you");
assert.equal(waitOf({ status: "error" }), "Stopped with an error");

const fix = items.find((i) => i.key === "agent:t5");
assert.equal(model.titleOf(fix), "Fix the login form");
assert.equal(model.spaceNote(fix), "space-2");
assert.equal(model.needOf(fix), null, "finishing is not needing you");
const NOW = 100 * 86400e3;
const H = 3600e3;
const fresh = (list, at = NOW - 60e3) => new Map(list.map((t) => [t.address, { at }]));
const changes = fresh(terms);
// Done: with a pane, Herdr's word decides; without one, it lasts 12h or until clicked here.
assert.ok(model.finishedUnseen(fix, new Map(), {}, NOW, changes), "a fresh paneless done lead is Done");
assert.ok(!model.finishedUnseen(fix, new Map(), {}, NOW, fresh(terms, NOW - 13 * H)), "it ages out after 12h");
assert.ok(model.finishedUnseen(fix, new Map([["t5", "done"]]), {}, NOW, fresh(terms, NOW - 13 * H)), "with a pane it waits for a look");
const seenAt = model.changedAt(fix, changes);
assert.ok(!model.finishedUnseen(fix, new Map(), { t5: seenAt }, NOW, changes), "a click clears it");
const later = new Map([...changes, ["t6", { at: NOW }]]);
assert.ok(model.finishedUnseen(fix, new Map(), { t5: seenAt }, NOW, later), "a new change after the click shows it again");
assert.deepEqual(fix.tree.map((r) => r.t.address), ["t6", "t9"]);

assert.ok(items.some((i) => i.key === "agent:t8"), "an agent a shell started is its own item");
assert.ok(!items.some((i) => i.key.includes("t10")), "an ended unlabelled agent is gone");

const groups = model.groupItems(items, changes, NOW);
assert.deepEqual(groups.map((g) => g.id), ["needs", "done", "idle"]);
assert.deepEqual(groups[0].items.map((i) => i.key), ["task:x1"], "Needs you holds only blocked items");
assert.deepEqual(groups[1].items.map((i) => i.key), ["agent:t5"]);
assert.equal(groups[1].label, "Done");
assert.equal(groups.flatMap((g) => g.items).length, items.length, "every item in one group");
// Done: most recent first.
const done2 = term("t20", "s3", { status: "done" });
const both = model.workItems([...terms, done2], new Map(), spaces);
const order = model.groupItems(both, new Map([...changes, ["t5", { at: NOW - 2 * H }], ["t6", { at: NOW - 2 * H }], ["t9", { at: NOW - 2 * H }], ["t20", { at: NOW - H }]]), NOW).find((g) => g.id === "done");
assert.deepEqual(order.items.map((i) => i.key), ["agent:t20", "agent:t5"]);
// Earlier: idle for a day or more, and a Done that aged out lands there too.
const old2 = new Map([...changes, ["t8", { at: NOW - 25 * H }], ["t5", { at: NOW - 30 * H }], ["t6", { at: NOW - 30 * H }], ["t9", { at: NOW - 30 * H }]]);
const g2 = model.groupItems(items, old2, NOW);
assert.deepEqual(g2.map((g) => g.id), ["needs", "idle", "earlier"]);
assert.deepEqual(g2.find((g) => g.id === "earlier").items.map((i) => i.key).sort(), ["agent:t5", "agent:t8"]);
// A stale Working item sorts first in Working.
const w = [term("w1", "s1", { status: "working" }), term("w2", "s2", { status: "working" })];
const wi = model.workItems(w, new Map(), spaces);
const wg = model.groupItems(wi, new Map([["w1", { at: NOW - 60e3 }], ["w2", { at: NOW - 30 * 60e3 }]]), NOW);
assert.deepEqual(wg[0].items.map((i) => i.key), ["agent:w2", "agent:w1"]);
assert.ok(model.isStale(wi[1], new Map([["w2", { at: NOW - 30 * 60e3 }]]), NOW));

// Identical rows: pi's "π - shad" is "shad"; headless runs alike merge; a title that still repeats
// gets the lead's name or its bare address.
assert.equal(model.ownTitle({ title: "π - shad", program: { name: "pi", key: "pi" } }), "shad");
const runs = ["vps/t40", "vps/t41", "vps/t42"].map((a) => term(a, undefined, { title: "investing" }));
const treed = [term("vps/t43", undefined, { title: "investing" }), term("vps/t44", undefined, { parent: "vps/t43" })];
const ri = model.workItems([...runs, ...treed], new Map(), spaces);
const merged = model.mergeIdentical("idle", ri);
assert.equal(merged.length, 2);
const dup = merged.find((e) => e.dup);
assert.deepEqual([dup.title, dup.members.length], ["investing", 3]);
assert.deepEqual([...model.repeatNotes(merged)], [["agent:vps/t43", "t43"]]);
assert.equal(model.memberName(dup.members[0]), "t40");

// The home machine is not printed: the area's first configured machine, else the most common.
assert.equal(model.homeMachine({ machines: ["home-server", "vps"] }), "home-server");
assert.equal(model.homeMachine({}), null, "no machines listed: this computer, never a majority");
assert.equal(model.homeMachine({ machines: [] }), null);

// The title wins. Below 300px of list no machine is printed; at any width the machine goes
// first, then the chip's count, then the note, until the title has room for 16 characters.
const meta = { machine: "home-server", count: 3, note: "investing" };
const title = "figma tokens export";
// The title wins: the note goes, then the count; the machine is named only when the whole title
// fits beside it, else it is a glyph (compact), never gone.
assert.deepEqual(model.fitRow(221, 500, title, meta), { ...meta, compact: false }, "room for all");
const whole = 7 * [...title].length;
const costs = { machine: 6 * 11 + 9, count: 6.5 + 3, note: 7 * 11 + 5 };
assert.deepEqual(model.fitRow(221, whole + costs.machine + costs.count, title, meta), { machine: "home-server", compact: false, count: 3, note: null }, "the space note goes first");
assert.deepEqual(model.fitRow(221, whole + costs.count + 25, title, meta), { machine: "home-server", compact: true, count: 3, note: null }, "the machine shrinks to a glyph before the title is cut");
assert.deepEqual(model.fitRow(221, whole + costs.count + 10, title, meta), { machine: null, compact: false, count: 3, note: null }, "no glyph when that alone lets the whole title fit");
assert.deepEqual(model.fitRow(221, 40, title, meta), { machine: "home-server", compact: true, count: null, note: null }, "never gone");
assert.deepEqual(model.fitRow(221, 7 * 3 + costs.machine, "fig", { machine: "home-server" }), { machine: "home-server", compact: false, count: null, note: null }, "a short title leaves room");

// The other area's pill: blocked agents only (not Done, not left-overs).
const pillTerms = [
  term("p1", "s1", { status: "blocked", labels: { "task.id": "w1", "task.role": "lead", "task.area": "work" } }),
  term("p2", "s2", { status: "done", labels: { "task.id": "w2", "task.role": "lead", "task.area": "work" } }),
  term("p3", "s3", { status: "idle", labels: { "task.id": "w3", "task.role": "lead", "task.area": "work" } }),
  term("p4", "s3", { parent: "p3", status: "blocked" }),
  term("p5", undefined, { parent: "gone9", status: "blocked" }),
  term("p6", "s4", { status: "working" }),
];
const pillItems = model.workItems(pillTerms, new Map(), spaces);
const pillConfig = { areas: [{ id: "work", label: "Work" }, { id: "personal", label: "Personal", default: true }] };
const pillArea = (i) => model.areaOf(pillConfig, i.machine, i.taskArea);
assert.deepEqual([...model.areaNeeds(pillItems, pillArea)], [["work", 2]], "two Work items wait (one through a worker); done, working and left-over do not count");

const shells = model.shellSpaces(spaces, terms).map((s) => s.id);
assert.deepEqual(shells, ["s4", "s5", "vps/s9"]);

// Close: the task's own terminals only; an unlabelled agent and what it started, live only.
assert.deepEqual(model.closeSet("task:x1", terms), ["t1", "t2", "t3"]);
assert.deepEqual(model.closeSet("agent:t5", terms), ["t5", "t6", "t9"]);
assert.deepEqual(model.closeSet("agent:nope", terms), []);

// Areas: the label wins, then the machine list, then the default; old config keys still load.
const config = { areas: [{ id: "work", label: "Work", machines: ["vps"] }, { id: "personal", label: "Personal", default: true }] };
assert.equal(model.areaOf(config, null, "work"), "work");
assert.equal(model.areaOf(config, "vps", null), "work");
assert.equal(model.areaOf(config, null, null), "personal");
const old = model.withOldKeys({ activities: config.areas, recipes: [{ id: "r", activity: "work" }] });
assert.deepEqual([old.areas, old.recipes[0].area], [config.areas, "work"]);
assert.equal(model.withOldKeys({ areas: [], activities: config.areas }).areas.length, 0, "areas wins over activities");

// A started lead is labelled with its recipe's area, in the same call as its other labels.
assert.deepEqual(model.leadPairs({ id: "x1", words: "Ship it", recipe: "work-lead", area: "work", lead: "claude-opus" }),
  ["task.id=x1", "task.role=lead", "task.title=Ship it", "task.by=raw", "task.recipe=work-lead", "task.area=work", "task.lead=claude-opus"]);
const started = model.workItems([term("t1", "s1", { labels: { "task.id": "x1", "task.role": "lead", "task.area": "work" } })], new Map(), spaces)[0];
assert.equal(model.areaOf(config, started.machine, started.taskArea), "work", "a labelled lead stays in its area");

// The panel mod's selection: key, live lead, live members, title; an item found by any member.
assert.deepEqual(model.selectionOf(task), { key: "task:x1", lead: "t1", members: ["t1", "t2", "t3", "t4"], title: "Ship it", ids: ["x1"], area: null,
  status: null, need: { by: "t2", kind: "Asks you", text: "Which branch?" } });
assert.equal(model.selectionOf(task, { listed: new Map(), seen: {}, now: NOW, changes: new Map() }).status, "blocked", "the row's word");
assert.equal(model.selectionOf(null), null);
assert.equal(model.itemHolding(items, "t4").key, "task:x1", "a worker's worker finds its task");
assert.equal(model.itemHolding(items, "t11"), null, "a plain shell is no item");

// A task's title outlives its lead's record; ids on no terminal are dropped.
const orphan = [term("t30", undefined, { labels: { "task.id": "zz1", "task.role": "worker" } })];
const oi = model.workItems(orphan, new Map(), spaces);
assert.equal(model.titleOf(oi[0]), "zz1", "without memory the id shows");
assert.deepEqual(model.rememberTitles(oi, { zz1: "Gone-lead", old9: "Forgotten" }, orphan), { zz1: "Gone-lead" });
assert.equal(model.titleOf(oi[0]), "Gone-lead");
assert.deepEqual(model.rememberTitles(items, {}, terms), { x1: "Ship it" }, "a seen title is remembered");
assert.equal(model.rememberTitles(items, { x1: "Ship it" }, terms), null, "nothing new, nothing written");

// Titles are capped at 80 characters, by character.
assert.equal([...model.capTitle("é".repeat(100))].length, 80);
assert.ok(model.leadPairs({ id: "a", words: "x".repeat(300), recipe: "r", area: "w", lead: "pi" })[2].length === "task.title=".length + 80);

// A lead whose agent reported a state, then left (a shell took over), for 20 s.
const shellLead = model.workItems([term("t31", "s1", { program: zsh, status: undefined, created_ms: NOW - 30e3, labels: { "task.id": "q1", "task.role": "lead" } })], new Map(), spaces)[0];
const hadState = (at) => new Map([["t31", { word: null, at, had: true }]]);
assert.ok(model.noAgent(shellLead, NOW, hadState(NOW - 30e3)));
assert.ok(!model.noAgent(shellLead, NOW, hadState(NOW - 5e3)), "not before 20 s");
assert.ok(!model.noAgent(shellLead, NOW, new Map()), "never reported a state: starting, or on its own first prompt");
assert.ok(!model.noAgent(task, NOW, new Map()), "a lead that is an agent");

// Never half a task: which machines do not answer; hc errors in words.
const reach = [{ name: null, reachable: true }, { name: "rem", reachable: false }, { name: "vps", reachable: true }];
assert.deepEqual(model.silentMachines(["t1", "rem/t1", "vps/t2"], reach), ["rem"]);
assert.equal(model.errorWords({ stderr: '{"error":{"message":"rem is not reachable","hint":"hc machine ls shows when it comes back"}}' }),
  "rem is not reachable (hc machine ls shows when it comes back)");
assert.equal(model.errorWords({ stderr: "plain words\n" }), "plain words");

// The full contract says what the tower skill's Lead part says, in the same order, so a lead gets
// the same rules with or without the skill. Checked against the skill itself when it is here.
const leadRules = [
  "Plan and delegate; don't do the work yourself.",
  "You must ask the person through",
  "task.ask=<one plain sentence, under 140 characters>",
  "first thing next turn:",
  "brief on the run line (hc tracks it)",
  "--label task.role=worker --name",
  "--cwd <dir> [--on <machine>] <agent command>",
  "short, lowercase, unique in the task",
  "never a shared one such as /tmp or a home folder",
  "never the bare name",
  "lists them all",
  "Before starting a new worker, reuse an idle worker of the task when its context fits the new work",
  "(a sub-lead) is started the same way, with",
  "A brief gives: goal, what the worker owns, what it must not touch, when it is done, a result file path it can write.",
  "the parent field of hc get for your own terminal",
  "use the tower skill if you have it.",
  "After starting workers, hc read each once: a folder-trust or sign-in prompt stalls a new worker without telling you.",
  "Routine prompts (trusting the folder you chose): answer with",
  "Permissions, sign-ins, anything that deletes or sends: ask the person.",
  "hc wait --children any --timeout 100 (under the 120 s tool limit), never poll.",
  "On a report, read it and wait again; on blocked, error or exit,",
  "hc file read --on <machine> <path>",
  "Start the last message of every turn with one or two plain sentences, no ids or paths: where the task stands, what happens now. Details after.",
  "At a milestone save a chain link",
  "When the work is done, say so; leave ending the workers to the person.",
];
const inOrder = (text, label) => leadRules.reduce((at, words) => {
  const i = text.indexOf(words, at);
  assert.ok(i >= 0, `${label}: "${words}" in order`);
  return i + words.length;
}, 0);
const fullDefault = model.parseConfig(null).config;
inOrder(model.firstMessage({ id: "r" }, fullDefault, "x1", "w", false), "contract");
// The brief line names the configured skill, and leaves it out when none is configured.
assert.ok(model.firstMessage({ id: "r" }, { ...fullDefault, skill: "kit" }, "x1", "w", false).includes("; use the kit skill if you have it."));
const noSkillMsg = model.firstMessage({ id: "r" }, { ...fullDefault, skill: null }, "x1", "w");
assert.ok(noSkillMsg.includes("You are a worker on task x1.\"") && !noSkillMsg.includes("skill if you have it"));
const { readFileSync, existsSync } = await import("node:fs");
const skillFile = `${process.env.HOME}/.agents/skills/tower/SKILL.md`;
if (existsSync(skillFile)) {
  const skillText = readFileSync(skillFile, "utf8");
  inOrder(skillText.slice(skillText.indexOf("## Lead"), skillText.indexOf("## Worker")).replace(/`/g, "").replace(/\s+/g, " "), "skill");
}
// The skill check runs on the lead's machine with the name as an argument, never in the script.
assert.deepEqual(model.skillCheck("tower"), ["-c", 'test -f "$HOME/.agents/skills/$1/SKILL.md"', "sh", "tower"]);
assert.deepEqual(model.skillCheck("tower", true).slice(2), ["sh", "tower"]);
assert.ok(model.skillCheck("tower", true)[1].startsWith("grep -qx '## Eye'"), "the Eye needs the skill's Eye part");
assert.equal(model.skillCheck("a; rm -rf ~"), null);
assert.equal(model.skillCheck(null), null);

// Left over: agents whose starter ended and was removed are never work items of their own.
// A real case on home-server: eight agents with parent home-server/t1x (gone), where='investing / 1'.
const sr = (address, extra = {}) => term(`home-server/${address}`, undefined, extra);
const investSpace = { id: "home-server/s20", name: "investing", machine: "home-server" };
const leftNames = ["desk-core", "desk-scout", "verify-1", "verify-2", "verify-3", "verify-4", "verify-5", "brief"];
const leftTerms = [
  sr("t1", { labels: { "herdr.space": "s20" }, status: "idle", title: "investing" }),
  sr("t9", { parent: "home-server/t1", status: "working" }),
  ...leftNames.map((name, i) => sr(`t2${i}`, { name, parent: "home-server/t1x", labels: { where: "investing / 1" } })),
  // No where label: a loose left-over; and a parent on a machine this computer does not see.
  sr("t40", { name: "stray", parent: "home-server/t3z" }),
  sr("t41", { name: "from-mac", parent: "laptop/t5q" }),
];
const leftItems = model.workItems(leftTerms, new Map([["home-server/t1", "idle"]]), [...spaces, investSpace]);
assert.equal(leftItems.filter((i) => i.leftOver).length, 9, "eight with where, one without");
assert.ok(!leftItems.find((i) => i.key === "agent:home-server/t41").leftOver, "a parent we cannot see is not gone");
const placed = model.placeLeftOvers(leftItems, [...spaces, investSpace], new Map([["home-server/t1", "idle"]]));
const investing = placed.items.find((i) => i.key === "agent:home-server/t1");
assert.deepEqual(investing.leftOvers.map((i) => i.lead.name), leftNames, "they join the investing item");
assert.deepEqual(investing.tree.map((r) => r.t.address), ["home-server/t9"], "its real worker stays in its tree");
assert.deepEqual(placed.loose.map((i) => i.lead.name), ["stray"]);
assert.ok(!placed.items.some((i) => i.leftOver), "no left-over is a work item");
// They never count: the investing item stays idle though eight left-overs are idle or done.
const doneLeft = model.workItems(leftTerms.map((t) => (t.name === "brief" ? { ...t, status: "done" } : t)), new Map(), [...spaces, investSpace]);
const doneWork = model.placeLeftOvers(doneLeft, [...spaces, investSpace], new Map()).items;
const lg = model.groupItems(doneWork, fresh(leftTerms), NOW);
assert.ok(!lg.find((g) => g.id === "done"), "a done left-over puts nothing in Done");
assert.equal(lg.flatMap((g) => g.items).length, doneWork.length);
// Closing the left-overs reaches exactly them.
assert.deepEqual(investing.leftOvers.flatMap((i) => model.closeSet(i.key, leftTerms)), leftNames.map((_, i) => `home-server/t2${i}`));

// A clicked item stays selected when focus moves back (a peek closed), until another click or
// the shown space changes to one other than the pin's; without a pin, selection follows focus.
const sel = (o) => model.nextSelection({ items, selectedKey: null, pin: null, focus: null, lastFocus: null, shown: "s1", lastShown: "s1", ...o });
const pinFix = { key: "agent:t5", space: "s1" };
assert.deepEqual(sel({ pin: pinFix, selectedKey: "agent:t5", focus: "t1", lastFocus: "t9" }), { key: "agent:t5", pin: pinFix }, "a peek closing moves focus; the click holds");
assert.deepEqual(sel({ pin: pinFix, focus: "t1", shown: "s2", lastShown: "s1" }), { key: "task:x1", pin: null }, "another space shown: focus leads again");
assert.deepEqual(sel({ pin: { key: "agent:t5", space: "s2" }, shown: "s2", lastShown: "s1" }).pin, { key: "agent:t5", space: "s2" }, "the space the click went to keeps it");
assert.deepEqual(sel({ pin: { key: "agent:gone", space: "s1" }, selectedKey: "agent:gone" }), { key: null, pin: null }, "a gone item drops");
assert.deepEqual(sel({ focus: "t4", lastFocus: "t1" }), { key: "task:x1", pin: null }, "no pin: focus picks the item");
assert.deepEqual(sel({ focus: "t11", lastFocus: "t1", selectedKey: "task:x1" }), { key: null, pin: null }, "focus on no item clears it");

// Finished elsewhere: what finished unseen in another area since you last left it.
const newsTerms = [
  // Ten background runs in Personal finishing within three minutes, one later, one blocked.
  ...Array.from({ length: 10 }, (_, i) => term(`b${i}`, undefined, { status: "done" })),
  term("b10", undefined, { status: "done" }),
  term("b11", undefined, { status: "blocked" }),
  // Work, where you are looking: its own finish is not news.
  term("w9", undefined, { status: "done", labels: { "task.id": "wk", "task.role": "lead", "task.area": "work" } }),
];
const at = (min) => NOW - 60 * 60e3 + min * 60e3;
const newsChanges = new Map(newsTerms.map((t, i) => [t.address, { at: t.address === "b10" ? at(50) : at(5 + (i % 10) * 0.3) }]));
const newsItems = model.workItems(newsTerms, new Map(), spaces);
const newsArea = (i) => model.areaOf(pillConfig, i.machine, i.taskArea);
const newsOf = (left, shown = "work", extra = {}) => model.areaNews(newsItems, { shown, areaOfItem: newsArea, left, listed: new Map(), seen: {}, now: NOW, changes: newsChanges, ...extra });
const personal = newsOf({}).get("personal");
assert.equal(personal.length, 11, "a batch of ten and a later one: one entry for the area, so one signal");
assert.equal(personal[0].key, "agent:b10", "newest first");
assert.ok(!personal.some((i) => i.key === "agent:b11"), "a blocked one is the red count's, not news");
assert.ok(!newsOf({}).has("work"), "the area on screen has no news");
assert.deepEqual(newsOf({ personal: at(10) }).get("personal").map((i) => i.key), ["agent:b10"], "only what finished after you last left");
assert.ok(!newsOf({ personal: at(60) }).has("personal"), "switching in and out moves the stamp: nothing left");
assert.ok(!newsOf({}, "personal").has("personal"), "switched in: no signal on the shown area");
assert.ok(!newsOf({}, "work", { seen: Object.fromEntries(newsTerms.filter((t) => t.address.startsWith("b")).map((t) => [t.address, newsChanges.get(t.address).at])) }).has("personal"), "all seen: gone");

// Roles: which agent each start uses. Defaults: Claude Code with Fable for leads and the Eye,
// with Opus for workers.
const def = model.parseConfig(null).config;
assert.equal(model.leadAgent(def, def.recipes[0]).id, "claude-fable");
assert.equal(model.workerAgent(def, def.recipes[0]).id, "claude-opus");
assert.equal(def.roles.eye, "claude-fable");
assert.deepEqual(def.agents.map((a) => a.id), ["claude-fable", "claude-opus", "claude-sonnet", "pi", "codex"]);
// An old file (activities, a recipe with argv, no agents/roles/skill) still loads; its argv leads.
const oldFile = model.parseConfig({ activities: [{ id: "work", label: "Work" }], recipes: [{ id: "here", label: "Lead here", activity: "work", argv: ["claude"], rules: ["Be brief."] }] });
assert.deepEqual(oldFile.bad, []);
assert.deepEqual(model.leadAgent(oldFile.config, oldFile.config.recipes[0]).argv, ["claude"], "an old recipe's argv wins for the lead");
assert.equal(model.workerAgent(oldFile.config, oldFile.config.recipes[0]).id, "claude-opus");
// A recipe's own lead and worker; a pick in the composer wins for the lead; roles fill in per role.
const own = model.parseConfig({ roles: { lead: "pi" }, recipes: [{ id: "r1", label: "R", area: "work", lead: "claude-opus", worker: "claude-sonnet" }, { id: "r2", label: "R2", area: "work" }] }).config;
assert.equal(model.leadAgent(own, own.recipes[0]).id, "claude-opus");
assert.equal(model.leadAgent(own, own.recipes[0], "codex").id, "codex", "your pick");
assert.equal(model.leadAgent(own, own.recipes[0], "gone").id, "claude-opus", "a pick no longer listed is ignored");
assert.equal(model.leadAgent(own, own.recipes[1]).id, "pi", "roles.lead");
assert.equal(model.workerAgent(own, own.recipes[0]).id, "claude-sonnet");
assert.equal(model.workerAgent(own, own.recipes[1]).id, "claude-opus", "roles.worker from the defaults");
assert.deepEqual(own.roles.namer, def.roles.namer);
// A part in the wrong shape falls back and is named.
const badFile = model.parseConfig({ agents: [{ id: "x", label: "X", argv: [] }], roles: { namer: "claude" }, skill: 3 });
assert.deepEqual(badFile.bad, ["agents", "roles", "skill"]);
assert.deepEqual([badFile.config.agents, badFile.config.skill], [def.agents, "tower"]);
// The lead's first message: with the skill, one plain line after the rules (no ids, paths or
// usage text: those are in its environment); without, the contract.
const r = { id: "r", rules: ["Use the repo's Makefile."], worker: "claude-sonnet" };
assert.equal(model.firstMessage(r, def, "x1", "fix the build"), "Use the repo's Makefile.\nLead this with the tower skill (questions to me go through task.ask): fix the build");
assert.deepEqual(model.withEnv({ TOWER_TASK: "x1", NONE: null, TOWER_WORKER: "claude --model sonnet" }, ["claude", "--model", "opus"]),
  ["env", "TOWER_TASK=x1", "TOWER_WORKER=claude --model sonnet", "claude", "--model", "opus"]);
const noSkill = model.parseConfig({ skill: null }).config;
const long = model.firstMessage(r, noSkill, "x1", "fix the build").split("\n");
assert.equal(long[0], "Use the repo's Makefile.");
assert.ok(long[1].startsWith("You lead task x1. Plan and delegate"), "the full contract");
assert.equal(long.at(-2), "Start workers with: claude --model sonnet --permission-mode auto");
assert.equal(long.at(-1), "Task: fix the build");
assert.equal(model.shellQuote(["claude", "--append", "it's a test", ""]), "claude --append 'it'\\''s a test' ''");
// The namer: the prompt right after -p (Claude's --tools eats every word after it), else last.
assert.deepEqual(model.namerArgs(def.roles.namer, "P"), ["-p", "P", "--model", "haiku", "--no-session-persistence", "--tools", ""]);
assert.deepEqual(model.namerArgs(["llm", "-m", "small"], "P"), ["-m", "small", "P"]);

// The Eye: the newest live terminal labelled tower.eye=1; other Eyes are ordinary items.
const eyes = [
  term("e1", "s1", { created_ms: 1, labels: { "tower.eye": "1" } }),
  term("e2", "s1", { created_ms: 5, labels: { "tower.eye": "1" } }),
  term("e3", "s1", { created_ms: 9, state: "ended", labels: { "tower.eye": "1" } }),
];
assert.equal(model.findEye(eyes).address, "e2", "newest live one");
assert.equal(model.findEye(terms), null);
assert.deepEqual(model.eyeLine(term("e4", "s1", { status: "blocked", report: { kind: "question" }, labels: { "task.ask": "Which recipe for the VPN work?" } }), new Map()),
  { kind: "Asks you", msg: "Which recipe for the VPN work?" }, "it waits on you: task.ask, Needs-you style");
assert.equal(model.eyeLine(term("e5", "s1", { status: "working", report: { msg: "Starting two leads" } }), new Map()), null, "working: one line (its sentence is the tooltip)");
assert.equal(model.eyeLine(term("e6", "s1", { status: "idle" }), new Map()), null, "nothing to say: one line");
// A waiting Eye: hc send without --force refuses a blocked terminal, so any wait means "open it".
assert.equal(model.eyeWait(term("w1", "s1", { status: "blocked", report: { kind: "question" }, labels: { "task.ask": "Which recipe?" } }), new Map()), "open");
assert.equal(model.eyeWait(term("w5", "s1", { status: "error" }), new Map()), "open");
assert.equal(model.eyeWait(term("w6", "s1", { status: "working" }), new Map()), null);
assert.equal(model.eyeWait(null, new Map()), null);

// The composer's two modes: the Eye by default while one runs, Lead when none does or you chose it.
assert.equal(model.composeMode(null, true), "eye", "with an Eye running the composer opens on it");
assert.equal(model.composeMode(null, false), "lead");
assert.equal(model.composeMode("lead", true), "lead", "a recipe chip picked since it opened");
assert.equal(model.composeMode("eye", false), "lead", "never an Eye that does not run");
// Never type into a shell: the Eye must run an agent; its first 20 s count as starting.
const shellEye = (created) => term("e9", "s1", { program: zsh, status: undefined, created_ms: created, labels: { "tower.eye": "1" } });
assert.equal(model.eyeAgent(shellEye(NOW - 5e3), NOW, new Map()), "starting");
assert.equal(model.eyeAgent(shellEye(NOW - 30e3), NOW, new Map()), "none");
assert.equal(model.eyeAgent(term("e8", "s1", { status: "idle" }), NOW, new Map()), "ok");
assert.equal(model.eyeAgent(null, NOW, new Map()), null);
// Pasted line breaks become one space each, so words don't run together.
assert.equal(model.oneLine('first "q" line\nsecond $HOME line\r\n\n  -third `x` \\n '), 'first "q" line second $HOME line -third `x` \\n');
assert.equal(model.oneLine("a  b\tc"), "a  b\tc", "spaces without a line break stay");
// A recipe naming an agent the settings lack is named once.
assert.deepEqual(model.unknownAgents(model.parseConfig({ recipes: [{ id: "a", label: "Typo", area: "work", lead: "claude-fabel" }, { id: "b", label: "Fine", area: "work", worker: "pi" }] }).config), ["Typo"]);
// Requests from the future are refused like stale ones.
assert.equal(model.checkRequest({ recipe: "work-lead", words: "x" }, fullDefault, -3 * 60e3).why, "its time is more than two minutes ahead");
assert.ok(model.checkRequest({ recipe: "work-lead", words: "x" }, fullDefault, -60e3).ok, "a small clock skew is fine");
// The Eye's first message: its rules first; with the skill one plain line, without the full text.
const eyeCfg = model.parseConfig({ eye: { rules: ["Speak English."] } }).config;
assert.equal(model.eyeMessage(eyeCfg), "Speak English.\nYou are the Eye of the Tower: follow the tower skill's Eye part.");
const eyeLong = model.eyeMessage({ ...eyeCfg, skill: null });
assert.ok(!/\/(Users|home)\//.test(eyeLong), "no paths on your screen");
for (const words of ["hc ls --json", "task.role=lead", "task.ask", "$TOWER_NEW", "$TOWER_CONFIG", "hc send <lead address>", "never from memory", "Never do task work yourself", "Never end or close anything unless they ask", "ask them", "one or two plain sentences"]) {
  assert.ok(eyeLong.includes(words), words);
}
assert.ok(eyeLong.startsWith("Speak English.\n"));
assert.deepEqual(eyeCfg.eye, { folder: null, rules: ["Speak English."] }, "eye settings fill in (its own folder by default)");
// The inbox: one actor at a time; a stale lease is free.
assert.ok(model.mayAct(null, "a", NOW));
assert.ok(model.mayAct({ id: "a", at: NOW - 1000 }, "a", NOW));
assert.ok(!model.mayAct({ id: "b", at: NOW - 1000 }, "a", NOW), "another copy holds it");
assert.ok(model.mayAct({ id: "b", at: NOW - 50e3 }, "a", NOW), "nobody renewed it for 45 s: free");
// Requests: what to start, or why not, in words.
const inCfg = model.parseConfig({}).config;
assert.deepEqual(model.checkRequest({ recipe: "work-lead", words: "  fix the VPN  ", agent: "pi" }, inCfg, 5000),
  { ok: true, recipe: inCfg.recipes[0], words: "fix the VPN", agent: "pi" });
assert.deepEqual(model.checkRequest({ recipe: "work-lead", words: "x" }, inCfg, 3 * 60e3), { ok: false, why: "too old" });
assert.equal(model.checkRequest({ recipe: "nope", words: "x" }, inCfg, 0).why, 'there is no recipe "nope"; the settings have work-lead, personal-lead');
assert.equal(model.checkRequest({ recipe: "work-lead", words: " " }, inCfg, 0).why, "no words: say what to do");
assert.match(model.checkRequest({ recipe: "work-lead", words: "x", agent: "gpt" }, inCfg, 0).why, /^there is no agent "gpt"/);
assert.equal(model.checkRequest(null, inCfg, 0).why, "not a request: it is not a JSON object");

// A waits line in two: whole words after the kind on the first line, the rest on the second
// (which truncates with an ellipsis); never a word cut on the first.
const msg = "Use WireGuard or OpenVPN on the travel router?";
const two = model.splitWait("Asks you", msg, 181);
assert.equal(`${two.first} ${two.rest}`, msg, "nothing lost");
assert.ok(two.first.length > 0 && 6 * ("Asks you".length + 3 + two.first.length) <= 181, "the first line fits");
assert.ok(msg.startsWith(two.first) && msg.split(" ").includes(two.first.split(" ").at(-1)), "whole words");
assert.deepEqual(model.splitWait("Asks you", "short", 400), { first: "short", rest: "" });
assert.deepEqual(model.splitWait("Waiting on you", null, 181), { first: "", rest: "" });
assert.equal(model.splitWait("Asks you", "Supercalifragilisticexpialidociousword next", 100).first, "", "a word too long starts the second line");

// Names fit the sidebar: the namer is asked for four words under 26 characters; up to 28 kept.
assert.ok(model.namePrompt("x").includes("in at most four words, under 26 characters"));
assert.equal(model.acceptName("Travel router VPN setup\n"), "Travel router VPN setup");
assert.equal(model.acceptName("x".repeat(28)), "x".repeat(28));
assert.equal(model.acceptName("x".repeat(29)), null, "longer than 28: your words stay");
assert.equal(model.acceptName("two\nlines"), null);

// Per-terminal memory forgets gone terminals, but only on machines that answered and showed
// terminals in this read: a quiet machine, or an empty read after a start, loses nothing.
const live2 = [term("t1", "s1"), term("vps/t2", undefined), term("rem/t5", undefined)];
const reach2 = [{ name: null, reachable: true }, { name: "vps", reachable: true }, { name: "rem", reachable: false }];
assert.deepEqual(model.forgettable(["t1", "t9", "vps/t2", "vps/t8", "rem/t5", "rem/t6", "gone/t3"], live2, reach2), ["t9", "vps/t8"],
  "gone here and on vps; rem is quiet; a machine with no terminals in the read keeps its entries");
assert.deepEqual(model.forgettable(["t9"], [], reach2), [], "an empty read forgets nothing");
const ch = new Map([["t1", { word: null, turn: undefined, at: NOW - 60e3 }], ["t9", { word: "idle", at: NOW - 7 * 86400e3 }], ["rem/t6", { word: "idle", at: NOW - 7 * 86400e3 }]]);
model.trackChanges(ch, live2, NOW, reach2);
assert.ok(!ch.has("t9") && ch.has("rem/t6") && ch.has("t1"), "a week-old gone terminal goes; the quiet machine's stays");
const keptTitles = model.rememberTitles([], { old1: "Old task" }, live2, reach2);
assert.equal(keptTitles, null, "a quiet machine: no title is dropped");
assert.deepEqual(model.rememberTitles([], { old1: "Old task" }, live2, reach2.slice(0, 2)), {}, "all answered: a task with no terminal left loses its title");
assert.equal(model.rememberTitles([], { old1: "Old task" }, [], []), null, "an empty read drops nothing");

// A lead that set task.ask needs you, whatever its state, until it clears it; a working lead's
// label is stale (it clears it first thing). Workers' labels don't count.
const asking = (status, extra = {}) => model.workItems([
  term("a1", "s1", { status, labels: { "task.id": "ak1", "task.role": "lead", "task.ask": "What URL should origin be?" }, ...extra }),
  term("a2", undefined, { parent: "a1", status: "idle", labels: { "task.id": "ak1", "task.role": "worker" } }),
], new Map(), spaces)[0];
assert.deepEqual(model.needOf(asking("done")), { t: asking("done").lead, kind: "Asks you", msg: "What URL should origin be?" });
assert.equal(model.needOf(asking("idle")).kind, "Asks you");
assert.equal(model.needOf(asking("working")), null, "working again: the label is stale");
assert.equal(model.groupItems([asking("done")], new Map([["a1", { at: NOW - 60e3 }], ["a2", { at: NOW - 60e3 }]]), NOW)[0].id, "needs", "Needs you, not Done");
assert.deepEqual([...model.areaNeeds([asking("done")], () => "work")], [["work", 1]], "it counts in the area's number");
const cleared = model.workItems([term("a3", "s1", { status: "done", labels: { "task.id": "ak2", "task.role": "lead", "task.ask": "" } })], new Map(), spaces)[0];
assert.equal(model.needOf(cleared), null, "a cleared label: it leaves");
const workerAsk = model.workItems([
  term("a4", "s1", { status: "idle", labels: { "task.id": "ak3", "task.role": "lead" } }),
  term("a5", undefined, { parent: "a4", status: "idle", labels: { "task.id": "ak3", "task.role": "worker", "task.ask": "x" } }),
], new Map(), spaces)[0];
assert.equal(model.needOf(workerAsk), null, "a worker's label does not count");
// The namer names the outcome; the Eye's message names the settings file really read.
assert.ok(model.namePrompt("x").includes("not who does it or how") && model.namePrompt("x").includes("under 26 characters"));
assert.ok(!model.eyeMessage(fullDefault).includes("config.json"), "the settings file is in the Eye's environment, not its message");

assert.equal(model.duration(30e3), "<1m");
assert.equal(model.duration(13 * 60e3), "13m");
assert.equal(model.duration(18 * 3600e3), "18h");
// A row is a task: a lead that another task's lead started (an old sub-lead with its own id, on
// another machine) is part of the starter's task; so are its workers. The row knows its machines.
const sub = [
  term("r1", "s1", { status: "idle", labels: { "task.id": "top", "task.role": "lead", "task.title": "Tower" } }),
  term("vps/t5", undefined, { parent: "r1", status: "idle", labels: { "task.id": "lab", "task.role": "lead", "task.ask": "Which option?" } }),
  term("vps/t6", undefined, { parent: "vps/t5", status: "working", labels: { "task.id": "lab", "task.role": "worker" } }),
  ...[7, 8, 9].map((n) => term(`vps/t${n}`, undefined, { parent: "vps/t5", status: "idle", labels: { "task.id": "lab", "task.role": "worker" } })),
  term("vps/t10", undefined, { parent: "vps/t5", state: "ended", labels: { "task.id": "lab", "task.role": "worker" } }),
  // The new contract: a sub-lead carries the top id as a worker.
  term("r2", undefined, { parent: "r1", status: "idle", labels: { "task.id": "top", "task.role": "worker" } }),
];
const [one, ...others] = model.workItems(sub, new Map(), spaces);
assert.equal(others.length, 0, "one row");
assert.deepEqual([one.key, one.lead.address, one.ids, one.machines], ["task:top", "r1", ["top", "lab"], [null, "vps"]]);
assert.deepEqual(model.needOf(one), { t: sub[1], kind: "Asks you", msg: "Which option?" }, "a sub-lead's ask is the task's");
// Working rows and the rows above them are listed; the idle rest fold into one line.
assert.deepEqual(one.activeTree.map((r) => [r.t.address, r.lines]), [["vps/t5", ["├"]], ["vps/t6", ["│", "└"]]]);
assert.deepEqual(one.quiet.map((r) => r.t.address), ["vps/t7", "vps/t8", "vps/t9", "r2"]);
assert.deepEqual(model.closeSet("task:top", sub), ["r1", "r2", "vps/t10", "vps/t5", "vps/t6", "vps/t7", "vps/t8", "vps/t9"], "End reaches every folded id");
// Nothing working: everything under the lead is quiet.
const calm = model.workItems(sub.map((t) => ({ ...t, status: "idle" })), new Map(), spaces)[0];
assert.deepEqual([calm.activeTree.length, calm.quiet.length], [0, 6]);

assert.equal(model.quietWords(one.quiet), "4 idle");
assert.equal(model.agentCount(one), 7, "the lead and six live workers run agents");
assert.equal(model.workingCount(one), 1, "one of them works now");
// As drawn: a sub-lead's quiet workers fold under the sub-lead; one quiet row is just listed.
const drawn = (open) => model.displayRows(one, (k) => open.includes(k)).map((r) => (r.fold ? `fold:${r.rows.length}:${r.lines.join(".")}` : `${r.t.address}:${r.lines.join(".")}`));
assert.deepEqual(drawn([]), ["vps/t5:├", "vps/t6:│.├", "fold:3:│.└", "r2:└"]);
assert.deepEqual(drawn(["task:top:quiet:vps/t5:idle"]), ["vps/t5:├", "vps/t6:│.├", "fold:3:│.└", "vps/t7:│..├", "vps/t8:│..├", "vps/t9:│..└", "r2:└"]);
assert.deepEqual(model.displayRows(calm).filter((r) => r.fold).map((r) => r.rows.length), [2], "nothing works: the lead's two quiet children fold, their own stay under the fold");
// A done worker stays Done, but only the lead's Done makes the task Done.
const doneWorker = model.workItems([
  term("d1", "s1", { status: "working", labels: { "task.id": "dw", "task.role": "lead" } }),
  term("d2", undefined, { parent: "d1", status: "done", labels: { "task.id": "dw", "task.role": "worker" } }),
  term("d3", undefined, { parent: "d1", status: "idle", labels: { "task.id": "dw", "task.role": "worker" } }),
], new Map(), spaces)[0];
assert.deepEqual([doneWorker.tree[0].status, doneWorker.top], ["done", "working"]);
assert.equal(model.quietWords(doneWorker.quiet), "1 done · 1 idle");
// Herdr's pin on the lead keeps the item in Pinned, above Needs you, whatever its age.
const pinTerms = [
  term("q1", "s1", { status: "idle", labels: { "task.id": "pn", "task.role": "lead", "herdr.pinned": "1" } }),
  term("q2", "s2", { status: "blocked", labels: { "task.id": "nd", "task.role": "lead" } }),
];
const pinGroups = model.groupItems(model.workItems(pinTerms, new Map(), spaces), new Map([["q1", { at: NOW - 40 * H }]]), NOW);
assert.deepEqual(pinGroups.map((g) => [g.id, g.items.map((i) => i.key)]), [["pinned", ["task:pn"]], ["needs", ["task:nd"]]]);

// Keep: here when the shown space is the task's own on that machine; else that space; else a new one.
const keepItem = { space: { id: "vps/s9", name: "remote", machine: "vps" } };
assert.equal(model.keepPlan("vps/t4", keepItem, [{ id: "vps/s9", active: true }]).how, "here");
assert.equal(model.keepWords(model.keepPlan("vps/t4", keepItem, [{ id: "vps/s9", active: true }]), "vps"), "Open as a tab here");
assert.equal(model.keepWords(model.keepPlan("vps/t4", keepItem, [{ id: "s1", active: true }]), "vps"), "Open as a tab on vps");
assert.equal(model.keepWords(model.keepPlan("mac/t7", keepItem, []), "mac"), "Open as a tab on mac");
assert.equal(model.keepPlan("t3", { space: null }, []).how, "new");
// Search: every word, in the title, a machine or a worker's name; a worker match opens the tree.
assert.deepEqual(model.searchItems([one, calm], "tower vps").map((r) => [r.item.key, r.inMember]), [["task:top", true], ["task:top", true]]);
assert.deepEqual(model.searchItems([one], "TOWER").map((r) => r.inMember), [false]);
assert.deepEqual(model.searchItems([one], "this computer").length, 1, "the lead's machine word");
assert.deepEqual(model.searchItems([one], "   "), []);
assert.deepEqual(model.searchItems([one], "nothing-like-it"), []);

// The one model: areas in config order (empty ones too), items with their area, group (the pin
// wins), state (ignoring the pin), word, need and age; the Eye is never an item.
const tmConfig = { areas: [{ id: "work", label: "Work", machines: ["vps"] }, { id: "personal", label: "Personal", default: true }], recipes: [] };
const tmTerms = [...pinTerms, term("e1", "s3", { labels: { "tower.eye": "1" } })];
const tm = model.taskModel({ terms: tmTerms, listed: new Map(), spaces, config: tmConfig, changes: new Map([["q1", { at: NOW - 40 * H }], ["q2", { at: NOW - H }]]), now: NOW, eye: tmTerms[2] });
assert.deepEqual(tm.areas, [{ id: "work", label: "Work", home: "vps", todo: false }, { id: "personal", label: "Personal", home: null, todo: false }]);
assert.deepEqual(tm.items.map((i) => [i.key, i.area, i.group, i.state, i.word]), [["task:pn", "personal", "pinned", "earlier", "idle"], ["task:nd", "personal", "needs", "needs", "blocked"]]);
assert.deepEqual(tm.items[1].need, { by: "q2", kind: "Waiting on you", text: null });
assert.deepEqual(tm.titles, null, "no task titles to learn");
assert.equal(model.itemArea(tmConfig, { machine: "vps", taskArea: null }), "work");

// A pin made in a view (no space) holds through space changes; a list pin still drops.
assert.equal(model.nextSelection({ items, selectedKey: null, pin: { key: "task:x1", space: null }, focus: null, lastFocus: null, shown: "s2", lastShown: "s1" }).key, "task:x1");
assert.equal(model.nextSelection({ items, selectedKey: null, pin: { key: "task:x1", space: "s1" }, focus: null, lastFocus: null, shown: "s2", lastShown: "s1" }).pin, null);

// The recorder: lanes once, a change per word or turn, ended when finished or missed, machine
// gaps open and close, a Herdr gap after a long silence, looks, pruning, merging, screens.
{
  const T0 = NOW - 10 * 60e3;
  const rec = model.recordStart({ ...model.newRecord(), beat: T0 - 10 * 60e3 }, T0);
  assert.deepEqual(rec.gaps, [{ m: "herdr", from: T0 - 10 * 60e3, to: T0 }]);
  const lead = term("r1", "s1", { status: "working", turn: 1, status_ms: T0 - 5e3, labels: { "task.id": "rx", "task.role": "lead", "task.title": "Rec" } });
  const wk = term("vps/t2", undefined, { parent: "r1", status: "blocked", turn: 1, report: { msg: "Which one?" }, labels: { "task.id": "rx", "task.role": "worker" } });
  const all1 = model.taskModel({ terms: [lead, wk], listed: new Map(), spaces, config: tmConfig, changes: new Map(), now: T0 }).all;
  const down = [{ name: null, reachable: true }, { name: "vps", reachable: false, since: T0 - 1e3 }];
  const r1 = model.recordStep(rec, { terms: [lead, wk], all: all1, now: T0, reach: down, look: "r1" });
  assert.equal(r1.dirty, true);
  assert.deepEqual(Object.keys(rec.lanes).sort(), ["r1", "vps/t2"]);
  assert.deepEqual([rec.lanes["vps/t2"].task, rec.lanes["vps/t2"].taskTitle, rec.lanes["vps/t2"].role, rec.lanes["vps/t2"].machine], ["task:rx", "Rec", "worker", "vps"]);
  assert.deepEqual(rec.events.map((e) => [e.a, e.s, e.at, e.msg]), [["r1", "working", T0 - 5e3, null], ["vps/t2", "blocked", T0, "Which one?"]], "local time from status_ms, remote time ours");
  assert.deepEqual(r1.toRead, [{ a: "vps/t2", at: T0 }]);
  assert.deepEqual(rec.gaps.at(-1), { m: "vps", from: T0 - 1e3, to: null });
  assert.deepEqual(model.recordStep(rec, { terms: [lead, wk], all: all1, now: T0 + 1e3, reach: down, look: "r1" }).dirty, false, "nothing new");
  const up = [{ name: null, reachable: true }, { name: "vps", reachable: true }];
  const ended = { ...lead, state: "finished", finished_ms: T0 + 2e3 };
  // vps answers and shows another terminal, so a missing one there is gone.
  model.recordStep(rec, { terms: [ended, term("vps/t9", "s9", { program: zsh, status: undefined })], all: [], now: T0 + 3e3, reach: up, look: null });
  assert.deepEqual(rec.events.slice(-2).map((e) => [e.a, e.s, e.at]), [["r1", "ended", T0 + 2e3], ["vps/t2", "ended", T0 + 3e3]], "finished, and missed on a machine that answers");
  assert.deepEqual(rec.gaps.at(-1).to, T0 + 3e3);
  assert.deepEqual(rec.looks.map((l) => l.a), ["r1", null]);
  const merged = model.mergeRecords({ beat: 1, lanes: { x: { task: "t" } }, events: [{ a: "x", s: "idle", at: 5 }], looks: [], gaps: [{ m: "vps", from: T0 - 1e3, to: null }] }, rec);
  assert.ok(merged.lanes.x && merged.events[0].a === "x" && merged.gaps.find((g) => g.m === "vps").to === T0 + 3e3);
  const old = { ...model.newRecord(), lanes: { o: { created: 0 } }, events: [{ a: "o", s: "idle", at: 1 }, { a: "o", s: "done", at: 2 }, { a: "o", s: "working", at: NOW }] };
  assert.deepEqual(model.pruneRecord(old, NOW).events.map((e) => e.at), [2, NOW], "the last event before the cut stays");
  assert.deepEqual(Object.keys(model.keepScreens({ [`a@${NOW}`]: "x", [`a@${NOW - 27 * H}`]: "y" }, NOW)), [`a@${NOW}`]);
}

// use.md: switches counted per target, keys apart; time only while active, cut at a quit.
{
  const at = (min) => new Date(NOW + min * 60000).toISOString();
  const log = [
    { at: at(0), what: "start" }, { at: at(0), what: "active", to: true },
    { at: at(10), what: "view", from: "list", to: "board", how: "click" },
    { at: at(20), what: "active", to: false }, { at: at(50), what: "active", to: true },
    { at: at(55), what: "view", from: "board", to: "timeline", how: "key" },
    { at: at(60), what: "beat" }, { at: at(500), what: "start" },
    { at: at(500), what: "rowMark", from: "state", to: "agents", how: "menu" },
  ].map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n";
  const md = model.useSummary(log, NOW + 501 * 60000);
  assert.ok(md.includes("(3 switches)"), md);
  assert.ok(md.includes("| board | 1 | 0 |") && md.includes("about 15 min"), "board: 10 min active, then 5 after coming back");
  assert.ok(md.includes("| timeline | 1 | 1 |") && md.includes("| timeline | 1 | 1 | " + at(55).slice(0, 16).replace("T", " ") + " | about 5 min |"), "timeline stops at the last line before the quit");
  assert.ok(md.includes("list about 10 min"), "the list before any switch");
  assert.ok(md.includes("## Left of a task"));
}

// One order and one set of wait words for every view.
assert.deepEqual(model.GROUPS.map((g) => g.id), ["pinned", "needs", "done", "working", "idle", "earlier"]);
assert.equal(model.waitWords({ report: { kind: "permission" } }), "Needs permission");
assert.equal(model.waitWords({ status: "error" }), "Stopped with an error");

// M4: an area may name its window's layout, its views and its recipe buttons; a wrong shape falls back.
{
  const areas = [{ id: "investing", label: "Investing", layout: "tower-investing", views: ["list", "timeline", "watchlist"], buttons: ["research"] }];
  assert.deepEqual(model.parseConfig({ areas }).config.areas, areas);
  assert.deepEqual(model.parseConfig({ areas: [{ ...areas[0], views: "timeline" }] }).bad, ["areas"]);
  const at = (min) => new Date(NOW + min * 60000).toISOString();
  const md = model.useSummary([
    { at: at(0), what: "start" }, { at: at(0), what: "active", to: true },
    { at: at(1), what: "area", from: "work", to: "investing", how: "key" }, { at: at(21), what: "area", from: "investing", to: "work", how: "click" },
    { at: at(26), what: "beat" },
  ].map((l) => JSON.stringify(l)).join("\n"), NOW + 30 * 60000);
  assert.ok(md.includes("## Areas") && md.includes("| investing | 1 | 1 |") && md.includes("about 20 min") && md.includes("| work | 1 | 0 |"), md);
}

// An old recipe's argv overrides its lead: those recipes are named for a toast.
assert.deepEqual(model.argvRecipes({ recipes: [{ label: "Old", argv: ["claude"] }, { label: "New", lead: "codex" }] }), ["Old"]);

// The workers' command is a script running the argv exactly, whatever its quoting.
assert.equal(model.workerScript(["codex", "-c", 'model_reasoning_effort="medium"']), `#!/bin/sh\nexec codex -c 'model_reasoning_effort="medium"' "$@"\n`);
assert.equal(model.workerFile("recipe:x/y"), "worker-recipe_x_y");
// The Eye waits when it set task.ask (and isn't working), like a lead.
const askingEye = { address: "e", status: "idle", labels: { "task.ask": "English or French?" } };
assert.deepEqual(model.eyeLine(askingEye, new Map()), { kind: "Asks you", msg: "English or French?" });
assert.equal(model.eyeWaiting({ ...askingEye, status: "working" }, new Map()), false);
// "no agent running" only for a lead that reported a state before (not one on its own first prompt).
{
  const shellLead = { address: "l1", state: "live", status: null, program: zsh, created_ms: NOW - 60e3, labels: { "task.id": "nl", "task.role": "lead" } };
  const it = model.workItems([shellLead], new Map(), spaces)[0];
  assert.equal(model.noAgent(it, NOW, new Map([["l1", { word: null, at: NOW - 60e3 }]])), false, "never reported: still starting");
  assert.equal(model.noAgent(it, NOW, new Map([["l1", { word: null, at: NOW - 60e3, had: true }]])), true, "reported, then gone");
}

// An Eye's lane says so (Timeline leaves Eyes out, even ended ones).
{
  const rec = model.newRecord();
  const eye = term("e9", "s1", { status: "idle", labels: { "tower.eye": "1" } });
  model.recordStep(rec, { terms: [eye], all: model.workItems([eye], new Map(), spaces), now: NOW });
  assert.equal(rec.lanes.e9.eye, true);
}

// Done and idle workers fold apart under their parent (rule 4).
{
  const mix = [term("m1", "s1", { status: "working", labels: { "task.id": "mx", "task.role": "lead" } }),
    ...["m2", "m3"].map((a) => term(a, undefined, { parent: "m1", status: "done", labels: { "task.id": "mx", "task.role": "worker" } })),
    ...["m4", "m5", "m6"].map((a) => term(a, undefined, { parent: "m1", status: "idle", labels: { "task.id": "mx", "task.role": "worker" } }))];
  const rows = model.displayRows(model.workItems(mix, new Map(), spaces)[0]);
  assert.deepEqual(rows.map((r) => (r.fold ? `${r.rows.length} ${model.quietWords(r.rows)}` : r.t.address)), ["2 2 done", "3 3 idle"]);
}

console.log("model ok");
