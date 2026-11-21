// Antigravity (agy): in the agents and the picker's list, its first message after -i, and its folder
// trusted for the session with --settings (model.trustArgv, the worker script run for real with sh in
// a made-up home: nothing written there).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as model from "./mods/agent-tower/model.js";

const def = model.parseConfig(null).config;
assert.deepEqual(def.agents.find((a) => a.id === "agy"), { id: "agy", label: "Antigravity", argv: ["agy", "-i"] });
assert.equal(model.leadAgent(def, def.recipes[0], "agy").id, "agy", "can be picked for a lead");
assert.equal(model.eyeAgentOf({ ...def, roles: { ...def.roles, eye: "agy" } }, "work").id, "agy", "and for an Eye");
assert.equal(model.workerAgent({ ...def, roles: { ...def.roles, worker: "agy" } }, def.recipes[0]).id, "agy", "and for workers");
assert.ok(model.needsTrust(["/opt/bin/agy", "-i"]) && !model.needsTrust(["claude"]));
// --settings right after agy, so Herdr's appended first message still lands right after -i.
const trusted = model.trustArgv(def.agents.find((a) => a.id === "agy").argv, "/made/up/pond-k1");
const argv = [...model.withEnv({ TOWER_TASK: "k1" }, trusted), "first message"];
assert.deepEqual(argv.slice(-5), ["agy", "--settings", '{"trustedWorkspaces":["/made/up/pond-k1"]}', "-i", "first message"]);
// An argv that carries its own --settings is left as written; other agents too.
for (const own of [["agy", "--settings", "/made/up/s.json", "-i"], ["agy", "--settings={}", "-i"], ["claude", "--model", "opus"]]) {
  assert.equal(model.trustArgv(own, "/made/up/x"), own);
  assert.equal(model.workerScript(own), `#!/bin/sh\nexec ${model.shellQuote(own)} "$@"\n`);
}
// The real path, as agy compares it: ~ is that machine's home, a link its target.
const real = (dir, home) => execFileSync("sh", ["-c", model.REAL_DIR_SCRIPT, "real", dir], { env: { ...process.env, HOME: home }, encoding: "utf8" }).trim();

const home = realpathSync(mkdtempSync(join(tmpdir(), "agy-test-")));
const task = join(home, "tasks/pond-k1");
mkdirSync(task, { recursive: true });
symlinkSync(task, join(home, "link"));
assert.equal(real("~/tasks/pond-k1", home), task);
assert.equal(real(join(home, "link"), home), task);

// The worker command for agy: its script runs agy --settings <its folder's real path> -i "<brief>",
// the path JSON-quoted (a quote, a backslash, a space), and writes no settings.
const bin = join(home, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "agy"), '#!/bin/sh\nfor a; do printf "[%s]" "$a"; done\n');
writeFileSync(join(bin, "worker-agy"), model.workerScript(["agy", "-i"]));
chmodSync(join(bin, "agy"), 0o755);
chmodSync(join(bin, "worker-agy"), 0o755);
const sub = join(task, 'a "made-up" \\ survey');
mkdirSync(sub);
symlinkSync(sub, join(home, "sub-link"));
const out = execFileSync(join(bin, "worker-agy"), ["a brief, with 'quotes'"], { cwd: join(home, "sub-link"), env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
const words = out.slice(1, -1).split("][");
assert.equal(words.length, 4, out);
assert.deepEqual([words[0], words[2], words[3]], ["--settings", "-i", "a brief, with 'quotes'"]);
assert.deepEqual(JSON.parse(words[1]), { trustedWorkspaces: [sub] });
assert.ok(!existsSync(join(home, ".gemini")), "no settings written");
assert.equal(model.workerScript(["claude"]), '#!/bin/sh\nexec claude "$@"\n', "other agents' scripts unchanged");

// A lead without the skill is told to start workers with the worker script ($TOWER_WORKER), which
// trusts an agy worker's folder for its session; with no script (it could not be written), the argv as before.
const noSkill = { ...def, skill: null, roles: { ...def.roles, worker: "agy" } };
const workersLine = (worker) => model.firstMessage(def.recipes[1], noSkill, "k1", "made-up words", false, null, worker).split("\n").at(-2);
assert.equal(workersLine("/made/up/bin/worker-agy"), "Start workers with: /made/up/bin/worker-agy (on another machine: agy -i)");
assert.equal(workersLine("/made up/bin/worker-agy"), "Start workers with: '/made up/bin/worker-agy' (on another machine: agy -i)");
assert.equal(workersLine("agy -i"), "Start workers with: agy -i");
assert.equal(workersLine(null), "Start workers with: agy -i");
// The script is on the lead's machine only: a worker that needs no trust step keeps its argv, which
// works on every machine.
const claudeWorkers = { ...def, skill: null };
assert.equal(model.firstMessage(def.recipes[1], claudeWorkers, "k1", "made-up words", false, null, "/made/up/bin/worker-claude-opus").split("\n").at(-2),
  `Start workers with: ${model.shellQuote(model.workerAgent(claudeWorkers, def.recipes[1]).argv)}`);
const lead = { address: "t1", state: "live", program: { agent: true }, labels: { "task.id": "k1", "task.title": "Pond survey" } };
const joined = model.joinMessage(def.recipes[1], noSkill, { taskId: "k1", lead, live: [lead] }, "lead", "made-up words", false, "/made/up/bin/worker-agy");
assert.ok(joined.includes("\nStart workers with: /made/up/bin/worker-agy (on another machine: agy -i)\n"), joined);
rmSync(home, { recursive: true, force: true });
console.log("ok agy");
