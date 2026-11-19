// node names.test.mjs: names in Herdr's own screens (model.wantedNames, tower-names) and an area's Eye
// without a click (model.checkEyeRequest, tower-eye). Made-up spaces: Herdr's own names, names we set,
// a name someone typed (a converted space), two tasks in one space, another machine, an Eye, an Eye
// started by hand; and both scripts' requests and answers through a made-up inbox.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as model from "./mods/agent-tower/model.js";

const agent = { agent: true, name: "Claude Code" };
const term = (address, labels, more = {}) => ({ address, state: "live", status: "idle", program: agent, labels, ...more });
const lead = (address, id, title, sp, tb, more = {}) =>
  term(address, { "task.id": id, "task.role": "lead", "task.title": title, "herdr.space": sp, "herdr.tab": tb, ...more });
const space = (id, name, named, tabs, machine = null) => ({ id, name, named, machine, tabs: tabs.map(([tid, tname, tnamed], i) => ({ id: tid, index: i + 1, name: tname, named: tnamed })) });

const terms = [
  // One task, Herdr's own names everywhere: a lead, a worker, a shell.
  lead("t1", "a1", "Invoice CSV export", "sp1", "tb1"),
  term("t2", { "task.id": "a1", "herdr.space": "sp1", "herdr.tab": "tb2" }, { name: "a1-snow-gear", parent: "t1" }),
  term("t3", { "task.id": "a1", "task.role": "shell", "herdr.space": "sp1", "herdr.tab": "tb3" }, { status: null, program: { agent: false, name: "zsh" }, cwd: "/home/me/shop" }),
  // Converted: the space's name was typed by someone; its task now has another title.
  lead("t4", "a2", "Billing schema check", "sp2", "tb4"),
  // Ours: the name we set is still there.
  lead("t5", "a3", "Garden plan", "sp3", "tb5", { "tower.space-name": "garden", "tower.tab-name": "lead" }),
  // Ours once, then renamed by someone.
  lead("t6", "a4", "Reading list", "sp4", "tb6", { "tower.space-name": "Reading" }),
  // Two tasks in one space.
  lead("t7", "a5", "Alpha", "sp5", "tb7"),
  lead("t8", "a6", "Beta", "sp5", "tb8"),
  // Another machine: its ids carry the machine, its labels don't.
  lead("work-vps/t1", "a7", "Load test", "sp6", "tb9"),
  // An Eye.
  term("t9", { "tower.eye": "1", "tower.area": "Work", "herdr.space": "sp7", "herdr.tab": "tb10" }),
  // A space of plain shells, no task: not ours to name.
  term("t10", { "herdr.space": "sp8", "herdr.tab": "tb11" }, { status: null, program: { agent: false, name: "zsh" } }),
];
const spaceList = [
  space("sp1", "~/shop", false, [["tb1", "1", false], ["tb2", "2", false], ["tb3", "3", false]]),
  space("sp2", "Billing", true, [["tb4", "1", false]]),
  space("sp3", "garden", true, [["tb5", "lead", true]]),
  space("sp4", "My books", true, [["tb6", "Mine", true]]),
  space("sp5", "shared", true, [["tb7", "1", false], ["tb8", "2", false]]),
  space("work-vps/sp6", "~", false, [["work-vps/tb9", "1", false]], "work-vps"),
  space("sp7", "Eye · Work", true, [["tb10", "1", false]]),
  space("sp8", "notes", true, [["tb11", "1", false]]),
];
const items = model.workItems(terms, new Map(), spaceList);
const wanted = model.wantedNames({ terms, spaces: spaceList, items });
const byId = Object.fromEntries(wanted.map((s) => [s.id, s]));

assert.deepEqual(wanted.map((s) => s.id), ["sp1", "sp2", "sp3", "sp4", "sp5", "work-vps/sp6", "sp7"], "every space holding a task or an Eye, none other");
assert.deepEqual([byId.sp1.state, byId.sp1.to, byId.sp1.anchor], ["change", "Invoice CSV export", "t1"], "Herdr's name: the task's title, recorded on its lead");
assert.deepEqual(byId.sp1.tabs.map((tb) => [tb.to, tb.state, tb.anchor]), [["lead", "change", "t1"], ["snow-gear", "change", "t2"], ["shell", "change", "t3"]],
  "a worker's tab: its hc name without the task id");
{
  // Only its own task's id goes; a name without it, or the id alone, stays as it is.
  const w = (name) => term("w1", { "task.id": "a1", "task.role": "worker", "herdr.space": "sp1", "herdr.tab": "tb2" }, { name, parent: "t1" });
  const tabOf = (name) => {
    const ts = [terms[0], w(name)];
    return model.wantedNames({ terms: ts, spaces: [spaceList[0]], items: model.workItems(ts, new Map(), [spaceList[0]]) })[0].tabs[1].to;
  };
  assert.deepEqual(["study-v01", "a9-api-review", "a1-", "a1-api-review"].map(tabOf), ["study-v01", "a9-api-review", "a1-", "api-review"]);
  // A worker opened as a tab: Herdr names the tab after its hc name and counts it as named. That name
  // is Herdr's, not a person's: it becomes the role. A name someone typed there stays.
  const kept = (tabName, ours = null, worker = w("a1-snow-gear")) => {
    const sp = space("sp1", "Invoice CSV export", true, [["tb1", "lead", true], ["tb2", tabName, true]]);
    const ts = [{ ...terms[0], labels: { ...terms[0].labels, "tower.space-name": "Invoice CSV export", "tower.tab-name": "lead" } },
      ours ? { ...worker, labels: { ...worker.labels, "tower.tab-name": ours } } : worker];
    const tb = model.wantedNames({ terms: ts, spaces: [sp], items: model.workItems(ts, new Map(), [sp]) })[0].tabs[1];
    return [tb.to, tb.state];
  };
  assert.deepEqual(kept("a1-snow-gear"), ["snow-gear", "change"]);
  assert.deepEqual(kept("Gear list"), ["snow-gear", "named"]);
  // Once the mod has named that tab, an hc name typed back is the person's and stays.
  assert.deepEqual(kept("a1-snow-gear", "snow-gear"), ["snow-gear", "named"]);
  const devserver = term("w2", { "task.id": "a1", "task.role": "shell", "herdr.space": "sp1", "herdr.tab": "tb2" }, { name: "devserver", status: null, program: { agent: false, name: "zsh" } });
  assert.deepEqual(kept("devserver", null, devserver), ["shell", "change"], "a shell kept as a tab: Herdr's hc name");
  assert.deepEqual(kept("devserver", "shell", devserver), ["shell", "named"], "typed back after the mod named it: the person's");
}
assert.deepEqual([byId.sp2.state, byId.sp2.from, byId.sp2.to], ["named", "Billing", "Billing schema check"], "a typed name stays, with the title --named would give");
assert.deepEqual([byId.sp2.tabs[0].to, byId.sp2.tabs[0].alt], ["lead · Billing schema check", "lead"], "its lead's tab says the task while the space doesn't; lead once it does");
assert.deepEqual([byId.sp3.state, byId.sp3.to, byId.sp3.tabs[0].state], ["change", "Garden plan", "same"], "still ours: follows the title");
assert.deepEqual([byId.sp4.state, byId.sp4.tabs[0].state], ["named", "named"], "renamed by someone after us: theirs now");
assert.deepEqual([byId.sp5.state, byId.sp5.tabs.map((tb) => tb.to)], ["tasks", ["lead · Alpha", "lead · Beta"]], "two tasks: the space keeps its name");
assert.deepEqual([byId["work-vps/sp6"].state, byId["work-vps/sp6"].to, byId["work-vps/sp6"].tabs[0].id], ["change", "Load test", "work-vps/tb9"], "another machine");
assert.deepEqual([byId.sp7.state, byId.sp7.tabs[0].to], ["same", "Eye"], "the Eye's space keeps its name; its tab is Eye");

// Two shell tabs: each says its folder.
const twoShells = model.wantedNames({
  terms: [lead("t1", "a1", "X", "sp1", "tb1"),
    term("t2", { "task.id": "a1", "task.role": "shell", "herdr.space": "sp1", "herdr.tab": "tb2" }, { status: null, program: { agent: false }, cwd: "/home/me/api" }),
    term("t3", { "task.id": "a1", "task.role": "shell", "herdr.space": "sp1", "herdr.tab": "tb3" }, { status: null, program: { agent: false }, cwd: "/home/me/web/" })],
  spaces: [space("sp1", "X", false, [["tb1", "1", false], ["tb2", "2", false], ["tb3", "3", false]])],
  items: model.workItems([lead("t1", "a1", "X", "sp1", "tb1"),
    term("t2", { "task.id": "a1", "task.role": "shell", "herdr.space": "sp1", "herdr.tab": "tb2" }, { status: null, program: { agent: false }, cwd: "/home/me/api" }),
    term("t3", { "task.id": "a1", "task.role": "shell", "herdr.space": "sp1", "herdr.tab": "tb3" }, { status: null, program: { agent: false }, cwd: "/home/me/web/" })], new Map(), []),
});
assert.deepEqual(twoShells[0].tabs.map((tb) => tb.to), ["lead", "shell · api", "shell · web"]);

// What to do: only names that are ours, the space before its tabs.
const changes = model.nameChanges(wanted);
assert.deepEqual(changes.filter((c) => c.id.startsWith("sp1") || c.id === "tb1" || c.id === "tb2" || c.id === "tb3").map((c) => [c.kind, c.id, c.to]),
  [["space", "sp1", "Invoice CSV export"], ["tab", "tb1", "lead"], ["tab", "tb2", "snow-gear"], ["tab", "tb3", "shell"]]);
assert.ok(!changes.some((c) => c.id === "sp2" || c.id === "sp4" || c.id === "sp5" || c.id === "tb6"), "never a typed name, nor a shared space");

// --named: the typed names too.
const all = model.wantedNames({ terms, spaces: spaceList, items, named: true });
assert.deepEqual(model.nameChanges(all).filter((c) => ["sp2", "sp4", "tb6"].includes(c.id)).map((c) => c.to), ["Billing schema check", "Reading list", "lead"]);

// One space, by id or name.
assert.deepEqual(model.wantedNames({ terms, spaces: spaceList, items, only: "Billing" }).map((s) => s.id), ["sp2"]);
assert.deepEqual(model.wantedNames({ terms, spaces: spaceList, items, only: "work-vps/sp6" }).map((s) => s.id), ["work-vps/sp6"]);

// The dry run's text: old → new; a typed name shows both outcomes side by side.
const dry = model.namesText(wanted);
assert.ok(dry.includes('sp1  "~/shop"  →  "Invoice CSV export"\n  tab tb1  "1"  →  "lead"'), dry);
assert.ok(dry.includes('sp2  "Billing"  kept: "Billing"  |  with --named: "Billing schema check"\n  tab tb4  "1"  →  "lead · Billing schema check"  |  with --named: "lead"'), dry);
assert.ok(dry.includes('sp5  "shared"  kept: 2 tasks live there'), dry);
assert.ok(dry.includes('  tab tb6  "Mine"  kept: "Mine"  |  with --named: "lead"'), dry);
assert.ok(dry.endsWith("Dry run: nothing changed. tower-names --apply renames 3 spaces and 8 tabs. 3 names someone typed stay; --named gives them the name shown."), dry.split("\n").pop());
assert.ok(model.namesText(wanted, { apply: true, failed: 2 }).includes("Renamed 9 of 11; 2 could not be labelled."));
assert.equal(model.namesText([]), "No space holds a task.\nDry run: nothing changed. tower-names --apply renames 0 spaces and 0 tabs.");

// ── tower-eye's request ──
const config = { ...model.DEFAULTS, areas: [{ id: "Work", label: "Work" }, { id: "Personal", label: "Personal", default: true }, { id: "Investing", label: "Investing", eye: false }] };
const eyes = [
  term("t9", { "tower.eye": "1", "tower.area": "Work", "herdr.space": "sp7" }),
  // Started by hand with the mod's own arguments: in "Eye · Personal", never labelled.
  term("t11", { "herdr.space": "sp9" }),
];
const eyeSpaces = [space("sp7", "Eye · Work", true, []), space("sp9", "Eye · Personal", true, [])];
const ask = (req, t = eyes, age = 0) => model.checkEyeRequest(req, config, t, eyeSpaces, age);
assert.deepEqual([ask({}).do, ask({}).area], ["status", "Personal"], "status, in the default area");
assert.equal(ask({ do: "start", area: "Work" }).eye.address, "t9", "Work's Eye runs");
assert.deepEqual([ask({ do: "start" }).eye, ask({ do: "start" }).byHand?.address, ask({ do: "start" }).name], [null, "t11", "Eye · Personal"], "the one started by hand is found");
assert.equal(ask({ do: "start", area: "Personal" }, [eyes[0], { ...eyes[1], address: "mac/t11" }]).byHand, null, "only on this computer");
assert.match(ask({ do: "start", area: "Nope" }).why, /no area "Nope"; the settings have Work, Personal, Investing/);
assert.match(ask({ do: "start", area: "Investing" }).why, /Investing has no Eye/);
assert.match(ask({ do: "end", area: "Personal", by: "Work" }).why, /this is Work's Eye; Personal is another area/);
assert.equal(ask({ do: "status", by: "Work" }).ok, true, "any Eye may look");
assert.match(ask({ do: "restart" }).why, /not status, start or end/);
assert.match(ask({ do: "end" }, [], 3 * 60 * 1000).why, /too old/);
const old = [term("t12", { "tower.eye": "1" })];
assert.match(ask({ do: "end", area: "Personal" }, old).why, /serves every area: end it from its menu/);
assert.equal(ask({ do: "end", area: "Work" }, eyes).eye.address, "t9");
assert.equal(model.eyeStatusText(config, eyes, (a) => a === "Personal"), "Work: t9, idle\nPersonal: starting\nInvesting: no Eye (eye: false)");
assert.equal(model.eyeStatusText(config, old), "Work: t12, idle (the Eye for every area)\nPersonal: t12, idle (the Eye for every area)\nInvesting: no Eye (eye: false)");

// ── The scripts: each writes its request to the inbox, prints the answer's text, exits 0 or 1. ──
async function script(name, args, answer, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  const child = spawn(new URL(`./mods/agent-tower/${name}`, import.meta.url).pathname, args, { env: { ...process.env, AGENT_TOWER_DIR: dir, TOWER_AREA: "", ...env } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  let request = null;
  for (let i = 0; i < 100 && !request; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const file = (() => { try { return readdirSync(join(dir, "inbox")).find((f) => !f.startsWith(".")); } catch { return null; } })();
    if (!file) continue;
    request = JSON.parse(readFileSync(join(dir, "inbox", file), "utf8"));
    writeFileSync(join(dir, "outbox", `.${file}`), JSON.stringify(answer));
    renameSync(join(dir, "outbox", `.${file}`), join(dir, "outbox", file));
  }
  const code = await new Promise((r) => child.on("exit", r));
  return { request, out, code };
}
const n1 = await script("tower-names", [], { ok: true, text: "sp1 ...\nDry run: nothing changed." });
assert.deepEqual([n1.request.names, n1.out, n1.code], [{ apply: false, named: false }, "sp1 ...\nDry run: nothing changed.\n", 0]);
const n2 = await script("tower-names", ["--apply", "--named", "--space", 'Billing "old"'], { ok: false, why: "1 label call failed", text: "…" });
assert.deepEqual([n2.request.names, n2.code], [{ apply: true, named: true, space: 'Billing "old"' }, 1]);
const e1 = await script("tower-eye", ["start", "--area", "Work"], { ok: true, address: "t9", text: "Started Work's Eye: t9." });
assert.deepEqual([e1.request.eye, e1.out, e1.code], [{ do: "start", area: "Work" }, "Started Work's Eye: t9.\n", 0]);
const e2 = await script("tower-eye", [], { ok: true, text: "Work: none" }, { TOWER_AREA: "Work" });
assert.deepEqual(e2.request.eye, { do: "status", by: "Work" });
// tower-new --title: the new task's name goes with the request (--yours: the person's own); the words as typed.
const s1 = await script("tower-new", ["--title", 'Cache to "Redis"', "work-lead", "so, I want the cache\tmoved"], { ok: true, task: "k1", starting: true });
assert.deepEqual([s1.request.title, s1.request.yours, s1.request.words, s1.request.recipe, s1.code], ['Cache to "Redis"', undefined, "so, I want the cache\tmoved", "work-lead", 0]);
const s2 = await script("tower-new", ["--title", "Bird song guide", "--yours", "personal-lead", "a guide to the bird songs"], { ok: true, task: "k2", starting: true });
assert.deepEqual([s2.request.title, s2.request.yours], ["Bird song guide", true]);
// Other control characters (ESC, form feed, DEL) are dropped, so the request stays JSON; tabs and lines are escaped.
const s3 = await script("tower-new", ["--title", "Cache\x1b[1m to Redis", "work-lead", "fix\x1bthe\fcache\x7f\tnow\nplease"], { ok: true, task: "k3", starting: true });
assert.deepEqual([s3.request?.title, s3.request?.words], ["Cache[1m to Redis", "fixthecache\tnow\nplease"]);
// Usage errors exit 2 and write nothing: --yours alone, an empty or missing title, a title for a task that exists.
for (const args of [["--yours", "work-lead", "w"], ["--title", "", "work-lead", "w"], ["--title"], ["--title", "X", "--task", "k1", "work-lead", "w"]]) {
  const dir = mkdtempSync(join(tmpdir(), "tower-new-"));
  const r = spawnSync(new URL("./mods/agent-tower/tower-new", import.meta.url).pathname, args, { env: { ...process.env, AGENT_TOWER_DIR: dir } });
  assert.deepEqual([r.status, String(r.stderr).startsWith("usage: tower-new [--title"), readdirSync(dir)], [2, true, []], args.join(" "));
}
const e3 = await script("tower-eye", ["end"], { ok: false, why: "no" });
assert.deepEqual([e3.request.eye, e3.code], [{ do: "end" }, 1]);
for (const [name, args] of [["tower-names", ["--nope"]], ["tower-eye", ["stop"]], ["tower-eye", ["--area"]]]) {
  const code = await new Promise((r) => spawn(new URL(`./mods/agent-tower/${name}`, import.meta.url).pathname, args).on("exit", r));
  assert.equal(code, 2, `${name} ${args.join(" ")}`);
}

// ── A raw title and Herdr's trimming (the raw-title trimming case) ──
{
  const want = (ts, sps) => model.wantedNames({ terms: ts, spaces: sps, items: model.workItems(ts, new Map(), sps) });
  const raw = "so garden plan task - i want to sort the seed list into a planting calendar - we will ";
  // Our label holds the name as we sent it; Herdr stored it trimmed. Still ours: it follows the namer's title.
  const ts = [lead("t1", "j1", "Garden planting calendar", "sp1", "tb1", { "task.by": "llm", "tower.space-name": raw, "tower.tab-name": `lead · ${raw}` })];
  const w = want(ts, [space("sp1", raw.trim(), true, [["tb1", `lead · ${raw.trim()}`, true]])]);
  assert.deepEqual([w[0].state, w[0].to, w[0].tabs[0].state, w[0].tabs[0].to], ["change", "Garden planting calendar", "change", "lead"]);
  // A title that is still the words typed names nothing: the space keeps "New task", the tab "lead".
  const born = [lead("t2", "j2", raw, "sp2", "tb2", { "task.by": "raw", "tower.space-name": "New task", "tower.tab-name": "lead" })];
  const w2 = want(born, [space("sp2", "New task", true, [["tb2", "lead", true]])]);
  assert.deepEqual([w2[0].state, w2[0].tabs[0].state], ["wait", "same"]);
  assert.deepEqual(model.nameChanges(w2), []);
  assert.ok(model.namesText(w2).includes('sp2  "New task"  kept until the task has its title'));
  // Even in a space someone named, a raw title never goes into the lead's tab.
  const w3 = want([lead("t3", "j3", raw, "sp3", "tb3", { "task.by": "raw", "tower.tab-name": "lead" })], [space("sp3", "Trips", true, [["tb3", "lead", true]])]);
  assert.equal(w3[0].tabs[0].to, "lead");
}
// ── herdr.space holds whatever id Herdr made the space under: an old one may be a name, "/" and all ──
{
  assert.equal(model.localOf("plots/garden", null), "plots/garden");
  assert.equal(model.localOf("box/plots/garden", "box"), "plots/garden");
  assert.equal(model.localOf("box/sp1", "box"), "sp1");
  for (const [id, machine, address] of [["garden plots", null, "t1"], ["plots/garden", null, "t1"], ["box/plots/garden", "box", "box/t1"]]) {
    const ts = [{ ...lead(address, "k1", "Recipe box", localOf(id, machine), "tb1"), address }];
    const sps = [space(id, "old", false, [[machine ? `${machine}/tb1` : "tb1", "1", false]], machine)];
    const w = model.wantedNames({ terms: ts, spaces: sps, items: model.workItems(ts, new Map(), sps) });
    assert.deepEqual([w.length, w[0]?.to, w[0]?.tabs[0]?.to], [1, "Recipe box", "lead"], id);
  }
  function localOf(id, machine) {
    return model.localOf(id, machine);
  }
}
// ── Where a task lives without a recipe folder: <taskRoot>/<slug>-<id> ──
{
  assert.equal(model.slugOf("so garden plan task - i want to start"), "so-garden-plan-task");
  assert.equal(model.slugOf("Fix: the café's CSV, again!"), "fix-café-s-csv", "small words go");
  assert.equal(model.slugOf("Cache to Redis"), "cache-to-redis", "\"to\" stays");
  assert.equal(model.slugOf("The notes of a walk and the songs for an album with captions"), "notes-walk-songs-album");
  assert.equal(model.slugOf("Supercalifragilisticexpialidocious and more words"), "supercalifragilisticexpialidocio");
  assert.equal(model.slugOf("!!!"), "");
  const config = model.parseConfig({ taskRoot: "/srv/work/", areas: [{ id: "work", label: "Work", taskRoot: "~/jobs" }, { id: "personal", label: "Personal" }] }).config;
  assert.equal(model.taskFolder(config, "work", "Billing schema check", "b7"), "~/jobs/billing-schema-check-b7");
  assert.equal(model.taskFolder(config, "personal", "Garden plan", "g2"), "/srv/work/garden-plan-g2");
  assert.equal(model.taskFolder(model.DEFAULTS, "personal", "", "g3"), "~/tasks/g3");
  assert.equal(model.taskFolder(model.DEFAULTS, "personal", null, "g4"), "~/tasks/g4", "no title yet: the id alone");
  const bad = model.parseConfig({ taskRoot: 7 });
  assert.deepEqual([bad.bad, bad.config.taskRoot], [["taskRoot"], "~/tasks"]);
  assert.deepEqual(model.parseConfig({ areas: [{ id: "w", label: "W", taskRoot: 3 }] }).bad, ["areas"]);
}
// ── A new lead or worker inside a task ──
{
  const config = model.DEFAULTS;
  const recipe = config.recipes.find((r) => r.id === "personal-lead");
  const shell = term("t1", { "task.id": "g1", "task.role": "lead", "task.title": "Garden plan", "task.by": "you", "task.area": "personal", "tower.space-name": "Garden plan", "herdr.space": "sp1", "herdr.tab": "tb1" },
    { status: null, program: { agent: false, name: "zsh" }, cwd: "/home/me/tasks/garden-plan-g1" });
  const worker = term("t2", { "task.id": "g1", "task.role": "worker" }, { parent: "t1", cwd: "/home/me/tasks/garden-plan-g1/notes" });
  const items = model.workItems([shell, worker], new Map(), [space("sp1", "Garden plan", true, [["tb1", "lead", true]])]).map((i) => ({ ...i, area: "personal" }));
  const item = items[0];
  // checkJoin: the task by id, lead or worker, an Eye's own area only.
  assert.equal(model.checkJoin({ task: "g1" }, items, config).as, "lead");
  assert.equal(model.checkJoin({ task: "g1", as: "worker" }, items, config).item, item);
  assert.match(model.checkJoin({ task: "g1", as: "boss" }, items, config).why, /not lead or worker/);
  assert.match(model.checkJoin({ task: "nope" }, items, config).why, /no task "nope"/);
  assert.match(model.checkJoin({ task: "g1", area: "work" }, items, config).why, /in Personal; this is Work's Eye/);
  // Its folder: the lead's, unless that is a home folder.
  assert.equal(model.joinFolder(item), "/home/me/tasks/garden-plan-g1");
  for (const cwd of ["/home/me", "/home/me/", "/Users/me", "/root", "~", null]) assert.equal(model.joinFolder({ ...item, lead: { ...shell, cwd } }), null, String(cwd));
  // Labels: the new lead keeps the title, who gave it and our space name; the old lead whose program ended is a shell.
  assert.deepEqual(model.joinPairs(item, "lead", recipe, "claude-opus"), ["task.id=g1", "task.role=lead", "task.title=Garden plan", "task.by=you",
    "task.recipe=personal-lead", "task.area=personal", "task.lead=claude-opus", "tower.tab-name=lead", "tower.space-name=Garden plan"]);
  assert.deepEqual(model.joinPairs(item, "worker", recipe, "claude-opus"), ["task.id=g1", "task.role=worker"]);
  assert.deepEqual(model.oldLeadPairs(item), ["task.role=shell"]);
  assert.deepEqual(model.oldLeadPairs({ lead: { ...shell, status: "idle" }, leadGone: false }), ["task.role=worker"], "still an agent: a worker");
  assert.equal(model.oldLeadPairs({ lead: { ...shell, state: "finished" }, leadGone: true }), null, "an ended terminal keeps its labels");
  // First messages: with the skill one line more than a start's; without, the full contract; a worker's says where to report.
  const withSkill = model.joinMessage(recipe, config, item, "lead", "make a planting calendar", true);
  assert.equal(withSkill, 'You are the new lead of task g1, "Garden plan", taking over from its earlier lead: its terminals and its chain say where it stands.\nLead task g1 with the tower skill (questions to me go through task.ask): make a planting calendar');
  const full = model.joinMessage(recipe, config, item, "lead", "make a planting calendar", false);
  assert.ok(full.startsWith("You are the new lead of task g1") && full.includes("You lead task g1.") && full.endsWith("Task: make a planting calendar"));
  const w = model.joinMessage(recipe, config, item, "worker", "water the beans", true);
  assert.ok(w.startsWith('You are a worker on task g1, "Garden plan"; use the tower skill if you have it.') && w.includes("--label task.role=lead | jq -r '.terminals[].address'") && w.endsWith("Task: water the beans"), w);
  for (const words of ["Do exactly the task below", "Start no other agents unless it says so", "--label task.id=g1 --label task.role=worker", "Put long answers in a result file", "report to your parent"]) assert.ok(w.includes(words), words);
  // findJoined: the live terminal in a new tab of that space, not one the task had.
  const join = { space: "sp1", machine: null, tabsBefore: new Set(["tb1"]), members: new Set(["t1", "t2"]) };
  const sps = [space("sp1", "Garden plan", true, [["tb1", "lead", true], ["tb2", "lead", true]])];
  assert.equal(model.findJoined(join, sps, [shell, worker]), null);
  const fresh = term("t3", { "herdr.space": "sp1", "herdr.tab": "tb2" });
  assert.equal(model.findJoined(join, sps, [shell, worker, fresh]).terminal, fresh);
}
console.log("names ok");
