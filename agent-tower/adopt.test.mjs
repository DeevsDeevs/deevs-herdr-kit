// node adopt.test.mjs: old Herdr spaces become tasks (adopt.js, tower-adopt). A made-up machine set
// with every shape BUILD2-ADOPT lists; the dry run's mapping; the labels read back through model.js as
// one task per space; apply, a second apply that changes nothing, one space, a failed label; and
// tower-adopt's request and answer through a made-up inbox.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as model from "./mods/agent-tower/model.js";
import { adoptPlan, labelsOf, lineOf, runAdopt, beforeNew, bornSpace, birthLabels, joinLabels, rowSpace } from "./mods/agent-tower/adopt.js";

setTimeout(() => {
  console.error("adopt.test.mjs took over 30 s");
  process.exit(1);
}, 30000).unref();

const H = 3600e3, D = 24 * H;
const NOW = Date.UTC(2026, 10, 15, 12);
const claude = { key: "claude", name: "Claude Code", agent: true, shell: false };
const pi = { key: "pi", name: "pi", agent: true, shell: false };
const zsh = { key: "shell", name: "zsh", agent: false, shell: true };

const config = {
  areas: [{ id: "work", label: "Work", machines: ["work-vps"] }, { id: "personal", label: "Personal", default: true }],
  recipes: [],
};

const spaceList = [];
const terms = [];
const agentRows = [];
let n = { "": 0, "work-vps": 0, "home-box": 0 };
const space = (name, machine = null, named = true) => {
  const local = `s${spaceList.filter((s) => s.machine === machine).length + 1}`;
  const s = { id: machine ? `${machine}/${local}` : local, local, index: spaceList.length, name, named, folder: `~/work/${name}`, machine, active: false, tabs: [] };
  spaceList.push(s);
  return s;
};
// One terminal; tab: its tab index in the space (null: no pane, started by another terminal).
const term = (s, { program = claude, status = "idle", tab = 0, parent = null, state = "live", title = "", labels = {}, quietDays = 9 } = {}) => {
  const m = s.machine ?? "";
  n[m] += 1;
  const address = `${s.machine ? `${s.machine}/` : ""}t${n[m]}`;
  const t = {
    address, state, program, status: program.agent ? (state === "live" ? status : "done") : undefined, title,
    parent: parent?.address, status_ms: NOW - quietDays * D, created_ms: NOW - (quietDays + 3) * D,
    labels: { ...(parent ? {} : { "herdr.space": s.local }), where: `${s.name} / ${program.name}`, ...labels },
  };
  terms.push(t);
  if (state === "live" && program.agent && tab != null) agentRows.push({ address, pane: `${address}-p`, space: s.id, tab_index: tab, status: t.status });
  return t;
};

// 1. One agent with a pane (most common): eight of them, three on the work server.
for (const [name, m, days] of [["invoice parser", null, 8], ["garden plan", null, 12], ["thesis notes", "home-box", 10], ["recipe box", null, 14],
  ["billing sync", "work-vps", 7], ["search index", "work-vps", 9], ["rate limiter", "work-vps", 11], ["router setup", "home-box", 13]]) {
  term(space(name, m), { title: `✳ ${name}`, quietDays: days });
}
// 2. Two to four agents in separate tabs, none started by another.
{
  const s = space("tax forms");
  term(s, { tab: 0, quietDays: 6 });
  term(s, { program: pi, tab: 1, quietDays: 6 });
  term(s, { tab: 2, quietDays: 8 });
}
// 3. One agent with a pane and 13 children without panes.
{
  const s = space("ledger export", "work-vps");
  const lead = term(s, { status: "working", quietDays: 0 });
  for (let i = 0; i < 13; i++) term(s, { parent: lead, tab: null, status: i < 2 ? "working" : "idle", quietDays: 0 });
}
// 4. Agents plus a plain shell tab.
{
  const s = space("docs site");
  term(s, { tab: 0, quietDays: 9 });
  term(s, { program: zsh, tab: 1 });
}
// 5. A space whose only terminal is a shell (the separate row at the bottom).
term(space("course notes"), { program: zsh });
// 6. Live and many finished terminals: 6 live, 10 finished.
{
  const s = space("bond ladder", "work-vps");
  const lead = term(s, { status: "working", quietDays: 0 });
  for (let i = 0; i < 5; i++) term(s, { parent: lead, tab: null, quietDays: 0 });
  for (let i = 0; i < 10; i++) term(s, { parent: lead, tab: null, state: "ended", quietDays: 1 });
}
// 7. A space that already hosts a Tower task, plus an unrelated older agent in another tab.
{
  const s = space("tower build");
  const lead = term(s, { tab: 0, status: "working", quietDays: 0, labels: { "task.id": "k7x2q", "task.role": "lead", "task.title": "Tower build", "task.area": "work", "task.by": "raw" } });
  term(s, { parent: lead, tab: null, labels: { "task.id": "k7x2q", "task.role": "worker" }, quietDays: 0 });
  term(s, { tab: 1, title: "✳ Old sidebar notes", quietDays: 20 });
}
// 8. An unnamed space (Herdr names it after its folder) and a finished-only space.
term(space("~", null, false), { title: "✳ Bird feeder", quietDays: 5 });
term(space("old probe", "home-box"), { state: "ended", quietDays: 16 });
// 9. The Personal area's Eye, in a space of its own: never touched.
term(space("eye"), { quietDays: 0, labels: { "tower.eye": "1", "tower.area": "personal" } });
// 10. Titles. An unnamed space Herdr named after its repo folder keeps that name, not the lead's
// stale conversation title. A home-folder name (Downloads, the user's name) gives way to the lead's
// own title. A title another task already has gets the machine, else a number.
term(space("billing-api", null, false), { title: "✳ Old chat about logging", quietDays: 4 });
term(space("Downloads", "home-box"), { title: "✳ garden plan", quietDays: 3 });
term(space("me"), { title: "✳ Bird feeder", quietDays: 2 });
// 11. One name, two spaces on different machines: --space needs the id.
term(space("notes"), { quietDays: 1 });
term(space("notes", "home-box"), { quietDays: 1 });


const fixture = { terms, spaces: spaceList, agents: agentRows, config, now: NOW, home: "/home/me" };
let k = 0;
const ids = () => `id${++k}`;

// The dry run: one line per space, in Herdr's order; the Eye's space is never touched.
const plan = adoptPlan(fixture, ids);
// Each line: the space, its id, its machine and how long it has been quiet, then what it becomes.
assert.deepEqual(plan.map(lineOf), [
  "invoice parser [s1] (this computer, quiet 8d) → \"invoice parser\" in personal: lead t1",
  "garden plan [s2] (this computer, quiet 12d) → \"garden plan\" in personal: lead t2",
  "thesis notes [home-box/s1] (home-box, quiet 10d) → \"thesis notes\" in personal: lead home-box/t1",
  "recipe box [s3] (this computer, quiet 14d) → \"recipe box\" in personal: lead t3",
  "billing sync [work-vps/s1] (work-vps, quiet 7d) → \"billing sync\" in work: lead work-vps/t1",
  "search index [work-vps/s2] (work-vps, quiet 9d) → \"search index\" in work: lead work-vps/t2",
  "rate limiter [work-vps/s3] (work-vps, quiet 11d) → \"rate limiter\" in work: lead work-vps/t3",
  "router setup [home-box/s2] (home-box, quiet 13d) → \"router setup\" in personal: lead home-box/t2",
  "tax forms [s4] (this computer, quiet 6d) → \"tax forms\" in personal: lead t4, workers t5 t6",
  "ledger export [work-vps/s4] (work-vps, working now) → \"ledger export\" in work: lead work-vps/t4, +13 started by them",
  "docs site [s5] (this computer, quiet 9d) → \"docs site\" in personal: lead t7, shell t8",
  "course notes [s6] (this computer, quiet 9d) → \"course notes\" in personal: lead t9",
  "bond ladder [work-vps/s5] (work-vps, working now) → \"bond ladder\" in work: lead work-vps/t18, +5 started by them, 10 finished, untouched",
  "tower build [s7] (this computer, working now): left alone, hosts task k7x2q; t12 becomes its own task \"tower build 2\" in work",
  "~ [s8] (this computer, quiet 5d) → \"Bird feeder\" in personal: lead t13",
  "old probe [home-box/s3] (home-box, quiet 16d): left alone, nothing live",
  "eye [s9] (this computer, quiet <1m): left alone, the Eye's",
  "billing-api [s10] (this computer, quiet 4d) → \"billing-api\" in personal: lead t15",
  "Downloads [home-box/s4] (home-box, quiet 3d) → \"garden plan · home-box\" in personal: lead home-box/t4",
  "me [s11] (this computer, quiet 2d) → \"Bird feeder 2\" in personal: lead t16",
  "notes [s12] (this computer, quiet 1d) → \"notes\" in personal: lead t17",
  "notes [home-box/s5] (home-box, quiet 1d) → \"notes · home-box\" in personal: lead home-box/t5",
]);
// Titles: every task's title is unique, a real space's name wins over a fallback, and no task
// takes a title a live task already has (case aside).
const titles = plan.flatMap((e) => [...(e.lead ? [e.title] : []), ...(e.apart ?? []).map((x) => x.title)]);
assert.equal(new Set(titles.map((x) => x.toLowerCase())).size, titles.length);
assert.equal(plan.find((e) => e.space === "garden plan").title, "garden plan", "the real space keeps its name");
assert.ok(!titles.includes("Tower build") && titles.includes("tower build 2"));
// The lead is the first agent in Herdr's order, whatever the terminal numbers say.
const swapped = { ...fixture, agents: [...agentRows].sort((a, b) => (a.address === "t6" ? -1 : b.address === "t6" ? 1 : 0)) };
assert.equal(adoptPlan(swapped, ids).find((e) => e.space === "tax forms").lead, "t6");

// Labels only, and only on live top-level terminals: no child, finished terminal or Eye.
const calls = plan.flatMap(labelsOf);
assert.equal(calls.length, 23);
assert.deepEqual(calls.find(([a]) => a === "work-vps/t4"), ["work-vps/t4", `task.id=${plan[9].id}`, "task.role=lead", "task.title=ledger export", "task.area=work", "task.by=adopt"]);
assert.deepEqual(calls.find(([a]) => a === "t8"), ["t8", `task.id=${plan[10].id}`, "task.role=shell"]);
const byAddress = new Map(terms.map((t) => [t.address, t]));
assert.ok(calls.every(([a]) => byAddress.get(a).state === "live" && !byAddress.get(a).parent), "only live terminals opened in the space itself");

// Read back through the model: one task per space, in the right area; nothing loose; the only space
// left without a task is the one with nothing live; children follow their lead.
const labelled = JSON.parse(JSON.stringify(terms));
const by = new Map(labelled.map((t) => [t.address, t]));
for (const [a, ...pairs] of calls) for (const p of pairs) by.get(a).labels[p.slice(0, p.indexOf("="))] = p.slice(p.indexOf("=") + 1);
const m = model.taskModel({ terms: labelled, listed: new Map(agentRows.map((a) => [a.address, a.status])), spaces: spaceList, config, changes: new Map(), now: NOW });
assert.equal(m.items.length, 21);
assert.equal(m.loose.length, 0);
assert.deepEqual(model.shellSpaces(spaceList, labelled).map((s) => s.name), ["old probe"]);
const item = (title) => m.items.find((i) => model.titleOf(i) === title);
assert.equal(item("ledger export").live.length, 14, "the lead and its 13 children");
assert.equal(item("ledger export").area, "work");
assert.equal(item("course notes").lead.address, "t9", "a shell-only space: its shell leads");
assert.ok(item("docs site").live.some((t) => t.address === "t8"), "the plain shell belongs to its task");
assert.equal(item("Tower build").taskId, "k7x2q", "the task already there is untouched");
assert.equal(item("tower build 2").lead.address, "t12");
assert.equal(item("tower build 2").area, "work", "beside a Work task, an older agent goes to Work, whatever its machine");

// runAdopt: a dry run calls no label; apply labels; a second apply finds every space a task.
const sent = [];
const env = (state) => ({ ...fixture, terms: state, label: async (address, pairs) => {
  sent.push([address, ...pairs]);
  const t = state.find((x) => x.address === address);
  for (const p of pairs) t.labels[p.slice(0, p.indexOf("="))] = p.slice(p.indexOf("=") + 1);
  return { code: 0, stderr: "" };
} });
const live = JSON.parse(JSON.stringify(terms));
const dry = await runAdopt({}, env(live));
assert.equal(sent.length, 0);
assert.ok(dry.ok && !dry.applied && dry.text.endsWith("Dry run: nothing changed. tower-adopt --apply makes 20 tasks."), dry.text);
const done = await runAdopt({ apply: true }, env(live));
assert.ok(done.ok && done.applied && done.text.endsWith("Done: 20 tasks made."), done.text);
assert.equal(sent.length, 23);
const again = await runAdopt({ apply: true }, env(live));
assert.equal(sent.length, 23, "a second apply labels nothing");
assert.ok(again.text.split("\n").slice(0, -2).every((l) => /left alone/.test(l)), again.text);
// One space, by name (any case) or id; an unknown one says so.
const one = await runAdopt({ space: "Tax Forms" }, env(JSON.parse(JSON.stringify(terms))));
assert.equal(one.text.split("\n")[0], 'tax forms [s4] (this computer, quiet 6d) → "tax forms" in personal: lead t4, workers t5 t6');
// --area with --space: that space's area instead of its machine's; alone, or unknown, it says why.
const moved = await runAdopt({ space: "billing sync", area: "personal", apply: true }, env(JSON.parse(JSON.stringify(terms))));
assert.match(moved.text.split("\n")[0], /→ "billing sync" in personal: lead work-vps\/t1$/);
assert.ok(sent.at(-1).includes("task.area=personal"));
for (const k of ["area", "title", "lead"]) assert.deepEqual(await runAdopt({ [k]: "work" }, env(terms)), { ok: false, why: "--area, --title and --lead need --space: they set one space's task" });
assert.deepEqual(await runAdopt({ space: "tax forms", area: "garden" }, env(terms)), { ok: false, why: 'no area "garden"; the areas are work, personal' });
assert.deepEqual(await runAdopt({ space: "nowhere" }, env(terms)), { ok: false, why: 'no space named "nowhere"' });
// By hand, space by space (the Mac lead's approved table): --space by id or name, --title, --lead.
const unlabelled = () => env(JSON.parse(JSON.stringify(terms)));
// A name two spaces share asks for the id; the id works.
assert.deepEqual(await runAdopt({ space: "notes" }, unlabelled()), { ok: false, why: '"notes" names 2 spaces: give its id (s12 on this computer, home-box/s5 on home-box)' });
assert.match((await runAdopt({ space: "home-box/s5" }, unlabelled())).text, /^notes \[home-box\/s5\] \(home-box, quiet 1d\) → "notes" in personal: lead home-box\/t5\n/,
  "alone, its title clashes only with tasks that exist");
// --title and --lead: the dry run says exactly what --apply then labels.
const byHand = { space: "s4", title: "Tax return 2026", lead: "t6", area: "work" };
const handDry = await runAdopt(byHand, unlabelled());
assert.equal(handDry.text.split("\n")[0], 'tax forms [s4] (this computer, quiet 6d) → "Tax return 2026" in work: lead t6, workers t4 t5');
const sentBefore = sent.length;
const handDone = await runAdopt({ ...byHand, apply: true }, unlabelled());
assert.equal(handDone.text.split("\n")[0], handDry.text.split("\n")[0]);
assert.deepEqual(sent.slice(sentBefore).map(([a, ...p]) => [a, p.filter((x) => !x.startsWith("task.id="))]), [
  ["t6", ["task.role=lead", "task.title=Tax return 2026", "task.area=work", "task.by=adopt"]],
  ["t4", ["task.role=worker"]], ["t5", ["task.role=worker"]],
]);
// Refused, with a plain reason: a lead from another space, a finished one, an unknown one; a title
// another task has; a hand-made choice for a space that hosts a task.
assert.deepEqual(await runAdopt({ space: "tax forms", lead: "t1" }, unlabelled()), { ok: false, why: "t1 is not in tax forms [s4]" });
const finished = terms.find((t) => t.state === "ended").address;
assert.deepEqual(await runAdopt({ space: "bond ladder", lead: finished }, unlabelled()), { ok: false, why: `${finished} can't lead: it has finished` });
assert.deepEqual(await runAdopt({ space: "s4", lead: "t999" }, unlabelled()), { ok: false, why: "no terminal t999" });
assert.deepEqual(await runAdopt({ space: "s4", title: "tower BUILD" }, unlabelled()), { ok: false, why: '"tower BUILD" is already another task\'s title' });
assert.deepEqual(await runAdopt({ space: "tower build", title: "x" }, unlabelled()), { ok: false, why: "tower build [s7] is left alone: it hosts task k7x2q" });
assert.equal(sent.length, sentBefore + 3, "no refused request labelled anything");

// A label that fails (a machine link down) is reported, and the rest still go.
const failing = { ...env(JSON.parse(JSON.stringify(terms))), label: async (a) => (a.startsWith("work-vps/") ? { code: 1, stderr: "machine work-vps: not connected" } : { code: 0 }) };
const partial = await runAdopt({ apply: true }, failing);
assert.equal(partial.ok, false);
assert.match(partial.text, /Not labelled \(run it again for these\): work-vps\/t1: machine work-vps: not connected/);

// From now on. "New space": the space that was not there before, on that machine, once its first
// terminal is live; its labels make that terminal lead a task titled with the space's name.
const before = beforeNew(spaceList, null);
const fresh = { id: "s99", local: "s99", index: 99, name: "new notes", named: true, folder: "~", machine: null };
const otherMachine = { id: "home-box/s99", local: "s99", index: 100, name: "elsewhere", named: true, folder: "~", machine: "home-box" };
assert.equal(bornSpace(before, [...spaceList, fresh], terms), null, "no terminal in it yet");
const shellThere = { address: "t90", state: "live", program: zsh, labels: { "herdr.space": "s99" } };
assert.deepEqual(bornSpace(before, [...spaceList, otherMachine, fresh], [...terms, shellThere]), { space: fresh, address: "t90" });
assert.deepEqual(birthLabels(fresh, "personal", "nw1"), ["task.id=nw1", "task.role=lead", "task.title=new notes", "task.area=personal", "task.by=space"]);
// An agent opened later in a tab joins its space's task when that task came from New space or adopt,
// and only when the space holds that one task; never an Eye, and never a child (it follows its parent).
const later = (address, local, extra = {}) => ({ address, state: "live", program: claude, status: "idle", labels: { "herdr.space": local, ...extra } });
const taxId = live.find((t) => t.address === "t4").labels["task.id"];
const local = (name) => spaceList.find((x) => x.name === name).local;
const after = [...live, later("t91", local("tax forms")), later("t92", local("tower build")), later("t93", local("tax forms"), { "tower.eye": "1" }),
  { ...later("t94", local("tax forms")), labels: {}, parent: "t91" }];
assert.deepEqual(joinLabels({ terms: after, spaces: spaceList }), [["t91", `task.id=${taxId}`, "task.role=worker"]],
  "tax forms (adopted) takes t91; tower build (two tasks) never; the Eye and t94 (a child) are not asked");
const raw = [...terms, later("t95", local("tower build"))];
assert.deepEqual(joinLabels({ terms: raw, spaces: spaceList }), [], "a task tower-new started is never joined");
// The row menu's "Make a task": the space the row stands for.
const notes = spaceList.find((x) => x.name === "course notes");
assert.equal(rowSpace(notes, spaceList), notes, "a shell space row");
assert.equal(rowSpace({ key: "agent:t1", space: spaceList[0], lead: terms[0] }, spaceList), spaceList[0], "an agent row");

// tower-adopt: writes {adopt: {apply, space}} to the inbox, prints the answer's text, exits 0 or 1.
async function towerAdopt(args, answer) {
  const dir = mkdtempSync(join(tmpdir(), "tower-adopt-"));
  const child = spawn(new URL("./mods/agent-tower/tower-adopt", import.meta.url).pathname, args, { env: { ...process.env, AGENT_TOWER_DIR: dir } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  let request = null;
  for (let i = 0; i < 100 && !request; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const name = (() => { try { return readdirSync(join(dir, "inbox")).find((f) => !f.startsWith(".")); } catch { return null; } })();
    if (!name) continue;
    request = JSON.parse(readFileSync(join(dir, "inbox", name), "utf8"));
    writeFileSync(join(dir, "outbox", `.${name}`), JSON.stringify(answer));
    renameSync(join(dir, "outbox", `.${name}`), join(dir, "outbox", name));
  }
  const code = await new Promise((r) => child.on("exit", r));
  return { request: request?.adopt, out, code };
}
const t1 = await towerAdopt(["--space", "tax forms"], { ok: true, text: "tax forms → ...\nDry run: nothing changed." });
assert.deepEqual([t1.request, t1.out, t1.code], [{ apply: false, space: "tax forms" }, "tax forms → ...\nDry run: nothing changed.\n", 0]);
const t3 = await towerAdopt(["--space", "work-vps/s1", "--area", "personal", "--title", "Billing \"sync\"", "--lead", "work-vps/t1"], { ok: true, text: "x" });
assert.deepEqual(t3.request, { apply: false, space: "work-vps/s1", area: "personal", title: 'Billing "sync"', lead: "work-vps/t1" });
const t2 = await towerAdopt(["--apply"], { ok: false, why: "2 label calls failed", text: "…\nNot labelled: …" });
assert.deepEqual([t2.request, t2.code], [{ apply: true }, 1]);
const usage = await new Promise((r) => spawn(new URL("./mods/agent-tower/tower-adopt", import.meta.url).pathname, ["--nope"]).on("exit", r));
assert.equal(usage, 2);

console.log("adopt ok");
