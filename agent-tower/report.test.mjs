// Whom a worker reports to: the tower skill's Worker lines run under dash, bash and zsh against a fake
// hc, and the lead lookup in the mod's own worker texts. Never a shell, an ended terminal, a terminal
// running no agent, an empty or "null" address; a parent hc cannot read stays the fallback.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as model from "./mods/agent-tower/model.js";

const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
assert.ok(has("jq"), "jq is needed");
const root = mkdtempSync(join(tmpdir(), "tower-report-"));
const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "hc"), `#!/bin/sh
f() { printf '%s' "$1" | tr / _; }
case "$1" in
  get) [ -f "$FAKE/get-$(f "$2")" ] || { echo "not found" >&2; exit 4; }; cat "$FAKE/get-$(f "$2")" ;;
  ls) [ -f "$FAKE/ls" ] || { echo "core down" >&2; exit 1; }; cat "$FAKE/ls" ;;
  send) printf '%s\\n' "$2" >>"$FAKE/sent" ;; # the address
  *) exit 2 ;;
esac
`, { mode: 0o755 });

// A terminal as hc get shows it (status: an object, or null when no agent reports); a message with
// a backslash-n in it, which echo in dash and zsh would turn into a line break.
const get = (address, { state = "live", agent = true, labels = {}, parent = null } = {}) => ({
  address, state, parent, labels: { "task.id": "k1", ...labels },
  status: agent ? { app: "claude-code", state: "done", msg: "line one\\nline two" } : null,
});
const ls = (...terms) => ({ terminals: terms.map((t) => ({ address: t.address, state: t.state, status: t.status?.state ?? null })) });
const me = (parent) => get("t9", { parent, labels: { "task.role": "worker" } });
const lead = (address = "t4") => get(address, { labels: { "task.role": "lead" } });

const cases = [
  ["parent a live lead", { me: me("t1"), terms: [get("t1", { labels: { "task.role": "lead" } })], ls: ls(lead()) }, "t1"],
  ["parent a sub-lead", { me: me("t2"), terms: [get("t2", { labels: { "task.role": "worker" } })], ls: ls(lead()) }, "t2"],
  ["parent carries task.was", { me: me("t1"), terms: [get("t1", { labels: { "task.role": "worker", "task.was": "lead" } })], ls: ls(lead()) }, "t4"],
  ["parent a shell", { me: me("t1"), terms: [get("t1", { agent: false, labels: { "task.role": "shell", "task.was": "lead" } })], ls: ls(lead()) }, "t4"],
  ["parent a shell, no lead found", { me: me("t1"), terms: [get("t1", { agent: false, labels: { "task.role": "shell", "task.was": "lead" } })], ls: ls() }, null],
  ["parent ended", { me: me("t1"), terms: [get("t1", { state: "finished", labels: { "task.role": "lead" } })], ls: ls(lead()) }, "t4"],
  ["parent's agent exited", { me: me("t1"), terms: [get("t1", { agent: false, labels: { "task.role": "lead" } })], ls: ls(get("t1", { agent: false })) }, null],
  ["parent's agent exited, another lead", { me: me("t1"), terms: [get("t1", { agent: false, labels: { "task.role": "lead" } })], ls: ls(get("t1", { agent: false }), lead()) }, "t4"],
  ["no parent", { me: me(null), terms: [], ls: ls(lead()) }, "t4"],
  ["no parent, no lead", { me: me(null), terms: [], ls: ls() }, null],
  ["parent unreadable, no lead found", { me: me("mac/t1"), terms: [], ls: ls() }, "mac/t1"],
  ["parent unreadable, a lead found", { me: me("t1"), terms: [], ls: ls(lead()) }, "t4"],
  ["lookup failing, parent unreadable", { me: me("mac/t1"), terms: [], ls: null }, "mac/t1"],
  ["lookup failing, parent a shell", { me: me("t1"), terms: [get("t1", { agent: false, labels: { "task.role": "shell" } })], ls: null }, null],
  ["lookup failing, no parent", { me: me(null), terms: [], ls: null }, null],
];

function run(shell, script, c, n) {
  const fake = join(root, `case-${n}`);
  rmSync(fake, { recursive: true, force: true });
  mkdirSync(fake);
  for (const t of [c.me, ...c.terms]) writeFileSync(join(fake, `get-${t.address.replaceAll("/", "_")}`), JSON.stringify(t));
  if (c.ls) writeFileSync(join(fake, "ls"), JSON.stringify(c.ls));
  const argv = shell === "zsh" ? ["-f", "-c", script] : ["-c", script];
  const out = execFileSync(shell, argv, { env: { ...process.env, FAKE: fake, HC_TERMINAL_ID: "t9", PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const sent = existsSync(join(fake, "sent")) ? readFileSync(join(fake, "sent"), "utf8") : null;
  return { out, sent };
}

const skillFile = `${process.env.HOME}/.agents/skills/tower/SKILL.md`;
if (existsSync(skillFile)) {
  const text = readFileSync(skillFile, "utf8");
  const part = text.slice(text.indexOf("## Worker"), text.indexOf("## Eye"));
  const script = part.match(/```sh\n([\s\S]*?)```/)[1].replace(/^ {2}/gm, "");
  const shells = ["dash", "bash", "zsh"].filter(has);
  assert.ok(shells.length >= 2, `shells here: ${shells}`);
  for (const shell of shells) {
    cases.forEach(([name, c, want], n) => {
      const { out, sent } = run(shell, script, c, n);
      assert.equal(sent, want && `${want}\n`, `${shell}, ${name}: ${want ? `one send to ${want}` : "no send"}`);
      if (!want) assert.match(out, /no one to report to/, `${shell}, ${name}: says so`);
    });
  }
} else console.log("no tower skill here: the skill's lines are not run");

// The lead lookup the mod writes into a list worker's first message and the lead's brief line:
// a lead running an agent, else nothing (never "null").
const config = model.DEFAULTS;
const item = { taskId: "k1", labelTitle: "Made-up task", lead: { address: "t1", state: "live", status: "idle", labels: {} }, live: [] };
const texts = [model.joinMessage(config.recipes[1], config, item, "worker", "w", true), model.firstMessage({ id: "r" }, config, "k1", "w", false)];
for (const text of texts) {
  const expr = text.match(/--label task\.role=lead \| jq -r '([^']+)'/)[1];
  const look = (input) => execFileSync("jq", ["-r", expr], { input: JSON.stringify(input), encoding: "utf8" }).trim();
  assert.equal(look(ls()), "", "no lead: nothing");
  assert.equal(look(ls(get("t1", { agent: false }))), "", "a lead with no agent: nothing");
  assert.equal(look(ls(get("t1", { agent: false }), lead())), "t4");
}
rmSync(root, { recursive: true, force: true });
console.log("report ok");
