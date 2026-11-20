// Antigravity (agy): in the agents and the picker's list, its first message after -i, and the trust
// step (model.TRUST_SCRIPT) run for real with sh and jq on made-up settings in a made-up home.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as model from "./mods/agent-tower/model.js";

const def = model.parseConfig(null).config;
assert.deepEqual(def.agents.find((a) => a.id === "agy"), { id: "agy", label: "Antigravity", argv: ["agy", "-i"] });
assert.equal(model.leadAgent(def, def.recipes[0], "agy").id, "agy", "can be picked for a lead");
assert.equal(model.eyeAgentOf({ ...def, roles: { ...def.roles, eye: "agy" } }, "work").id, "agy", "and for an Eye");
assert.equal(model.workerAgent({ ...def, roles: { ...def.roles, worker: "agy" } }, def.recipes[0]).id, "agy", "and for workers");
assert.ok(model.needsTrust(["/opt/bin/agy", "-i"]) && !model.needsTrust(["claude"]));
// Herdr appends the first message to the argv: for agy it lands right after -i.
const argv = [...model.withEnv({ TOWER_TASK: "k1" }, def.agents.find((a) => a.id === "agy").argv), "first message"];
assert.deepEqual(argv.slice(-3), ["agy", "-i", "first message"]);

const home = realpathSync(mkdtempSync(join(tmpdir(), "agy-test-")));
const file = join(home, ".gemini/antigravity-cli/settings.json");
const trust = (dir) => execFileSync("sh", ["-c", model.TRUST_SCRIPT, "trust", dir], { env: { ...process.env, HOME: home }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const task = join(home, "tasks/pond-k1");
mkdirSync(task, { recursive: true });
// agy never ran here: no file is made.
assert.equal(trust(task), "absent");
assert.ok(!existsSync(join(home, ".gemini")), "nothing made");
// Added once, at the end, other keys and order kept, mode 600; ~ is this home; a link counts as its real path.
mkdirSync(join(home, ".gemini/antigravity-cli"), { recursive: true });
const before = { permissions: { allow: ["command(hc)"] }, toolPermission: "always-proceed", trustedWorkspaces: ["/made/up/b", "/made/up/a"], later: 1 };
writeFileSync(file, `${JSON.stringify(before, null, 2)}\n`);
chmodSync(file, 0o600);
assert.equal(trust("~/tasks/pond-k1"), "added");
const after = JSON.parse(readFileSync(file, "utf8"));
assert.deepEqual(Object.keys(after), Object.keys(before));
assert.deepEqual(after, { ...before, trustedWorkspaces: ["/made/up/b", "/made/up/a", task] });
assert.equal(statSync(file).mode & 0o777, 0o600);
execFileSync("ln", ["-s", task, join(home, "link")]);
assert.equal(trust(join(home, "link")), "there", "kept when present");
assert.equal(JSON.parse(readFileSync(file, "utf8")).trustedWorkspaces.length, 3, "added once");
// Not the JSON expected: left as it is.
for (const text of ["{ not json", '{"trustedWorkspaces": "x"}', "[]"]) {
  writeFileSync(file, text);
  assert.equal(trust(task), "bad", text);
  assert.equal(readFileSync(file, "utf8"), text);
}
// No list yet: one is made with the folder.
writeFileSync(file, '{"toolPermission": "x"}\n');
assert.equal(trust(task), "added");
assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { toolPermission: "x", trustedWorkspaces: [task] });

// The worker command for agy: its script trusts the folder it runs in, then runs agy -i "<brief>".
writeFileSync(file, '{"trustedWorkspaces": []}\n');
const bin = join(home, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "agy"), '#!/bin/sh\nfor a; do printf "[%s]" "$a"; done\n');
writeFileSync(join(bin, "worker-agy"), model.workerScript(["agy", "-i"]));
chmodSync(join(bin, "agy"), 0o755);
chmodSync(join(bin, "worker-agy"), 0o755);
const sub = join(task, "survey");
mkdirSync(sub);
const out = execFileSync(join(bin, "worker-agy"), ["a brief, with 'quotes'"], { cwd: sub, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
assert.equal(out, "[-i][a brief, with 'quotes']");
assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).trustedWorkspaces, [sub]);
assert.equal(model.workerScript(["claude"]), '#!/bin/sh\nexec claude "$@"\n', "other agents' scripts unchanged");

// A lead without the skill is told to start workers with the worker script ($TOWER_WORKER), which
// trusts an agy worker's folder; with no script (it could not be written), the argv as before.
const noSkill = { ...def, skill: null, roles: { ...def.roles, worker: "agy" } };
const workersLine = (worker) => model.firstMessage(def.recipes[1], noSkill, "k1", "made-up words", false, null, worker).split("\n").at(-2);
assert.equal(workersLine("/made/up/bin/worker-agy"), "Start workers with: /made/up/bin/worker-agy");
assert.equal(workersLine("/made up/bin/worker-agy"), "Start workers with: '/made up/bin/worker-agy'");
assert.equal(workersLine("agy -i"), "Start workers with: agy -i");
assert.equal(workersLine(null), "Start workers with: agy -i");
const lead = { address: "t1", state: "live", program: { agent: true }, labels: { "task.id": "k1", "task.title": "Pond survey" } };
const joined = model.joinMessage(def.recipes[1], noSkill, { taskId: "k1", lead, live: [lead] }, "lead", "made-up words", false, "/made/up/bin/worker-agy");
assert.ok(joined.includes("\nStart workers with: /made/up/bin/worker-agy\n"), joined);
rmSync(home, { recursive: true, force: true });
console.log("ok agy");
