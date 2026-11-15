# One read for the tower panel on one machine: the lead's transcript, how long each worker's own
# transcript has been quiet, git for the members' folders, the branch's pull request and the newest
# chain link. argv[1]: JSON {lead?: {pid, argv, cwd}, workers: [{key, pid, argv, cwd}], cwds,
# lead_cwd?, chain, gh_skip: [root]}. Prints JSON (at most 64 KB). Every time is "seconds ago" on
# this machine's clock: the mod never compares clocks.
# find_transcript and its helpers come from agent-images/extract.py (same kit, MIT).
import concurrent.futures
import datetime
import glob
import json
import os
import re
import subprocess
import sys
import time

HOME = os.path.expanduser("~")
NOW = time.time()
TAIL = 2 * 1024 * 1024
MESSAGE_MAX = 4000
REPORT_MAX = 600
PROMPT_MAX = 300
HC_FROM = re.compile(r'<hc from="([^"]+)"[^>]*>(.*?)(?:</hc>|$)', re.S)


def tree(root):
    out = subprocess.run(["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True).stdout
    kids = {}
    for row in out.splitlines():
        parts = row.split()
        if len(parts) == 2:
            kids.setdefault(int(parts[1]), []).append(int(parts[0]))
    pids, todo = [], [root]
    while todo:
        p = todo.pop()
        pids.append(p)
        todo.extend(kids.get(p, []))
    return pids


def open_jsonl(pids):
    # No pid, nothing to ask: on macOS `lsof -p ""` would list every open file on the machine.
    if not pids:
        return
    if os.path.isdir("/proc"):
        for p in pids:
            for fd in glob.glob(f"/proc/{p}/fd/*"):
                try:
                    path = os.readlink(fd)
                except OSError:
                    continue
                if path.endswith(".jsonl"):
                    yield path
    else:
        out = subprocess.run(["lsof", "-Fn", "-p", ",".join(map(str, pids))], capture_output=True, text=True, timeout=10).stdout
        for row in out.splitlines():
            if row.startswith("n") and row.endswith(".jsonl"):
                yield row[1:]


def newest(pattern):
    files = glob.glob(pattern)
    return max(files, key=os.path.getmtime) if files else None


def find_transcript(pid, argv, cwd):
    pids = tree(pid) if pid else []
    for p in pids:
        try:
            sid = json.load(open(f"{HOME}/.claude/sessions/{p}.json"))["sessionId"]
        except (OSError, ValueError, KeyError):
            continue
        hit = glob.glob(f"{HOME}/.claude/projects/*/{sid}.jsonl")
        if hit:
            return hit[0]
    for path in open_jsonl(pids):
        if "/.codex/sessions/" in path or "/.pi/agent/sessions/" in path or "/.claude/projects/" in path:
            return path
    if "--session" in argv:
        path = os.path.expanduser(argv[argv.index("--session") + 1])
        if os.path.isfile(path):
            return path
    name = os.path.basename(argv[0]) if argv else ""
    if name == "pi" and cwd:
        return newest(f"{HOME}/.pi/agent/sessions/--{cwd.strip('/').replace('/', '-')}--/*.jsonl")
    return None


def ago(stamp):
    if not isinstance(stamp, str):
        return None
    try:
        # Python before 3.11 (macOS's own python3 is 3.9) takes only 3 or 6 fraction digits.
        stamp = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], stamp.replace("Z", "+00:00"))
        return max(0, NOW - datetime.datetime.fromisoformat(stamp).timestamp())
    except ValueError:
        return None


def texts(content, kinds):
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    return [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") in kinds]


def records(path, tail):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        if size > tail:
            f.seek(size - tail)
            f.readline()
        for line in f:
            try:
                yield json.loads(line)
            except ValueError:
                continue


# One pass over the tail of a transcript, whatever wrote it, as a list of events:
# ("say", id, text, ago) an assistant's words; ("prompt", text, ago) a new turn; ("tool", name, call
# id, ago) a call was made; ("result", call id, ago) one was answered; ("compact", ago).
def events(d):
    kind = d.get("type")
    at = ago(d.get("timestamp"))
    # Claude Code
    if kind == "assistant" and isinstance(d.get("message"), dict):
        m = d["message"]
        for b in m.get("content") or []:
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip():
                yield ("say", m.get("id"), b["text"], at)
            elif isinstance(b, dict) and b.get("type") == "tool_use":
                yield ("tool", b.get("name"), b.get("id"), at)
        return
    if kind == "user" and isinstance(d.get("message"), dict):
        content = d["message"].get("content")
        if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    yield ("result", b.get("tool_use_id"), at)
        elif not d.get("isMeta") and not d.get("isCompactSummary"):
            yield ("prompt", "\n".join(texts(content, ("text",))), at)
        return
    if kind == "system" and d.get("subtype") == "compact_boundary":
        yield ("compact", at)
        return
    if kind == "summary":
        yield ("compact", None)
        return
    # Codex
    p = d.get("payload") if isinstance(d.get("payload"), dict) else {}
    if kind == "response_item":
        if p.get("type") == "message" and p.get("role") == "assistant":
            text = "\n".join(texts(p.get("content"), ("output_text",)))
            if text.strip():
                yield ("say", p.get("id"), text, at)
        elif p.get("type") == "message" and p.get("role") == "user":
            text = "\n".join(texts(p.get("content"), ("input_text",)))
            if "<hc from=" in text:
                yield ("prompt", text, at)
        elif p.get("type") in ("function_call", "custom_tool_call", "local_shell_call"):
            yield ("tool", p.get("name"), p.get("call_id"), at)
        elif p.get("type") in ("function_call_output", "custom_tool_call_output"):
            yield ("result", p.get("call_id"), at)
        return
    if kind == "event_msg":
        if p.get("type") in ("task_started", "user_message"):
            yield ("prompt", p.get("message") or "", at)
        elif p.get("type") == "context_compacted":
            yield ("compact", at)
        return
    if kind == "compacted":
        yield ("compact", at)
        return
    # pi
    if kind == "message" and isinstance(d.get("message"), dict):
        m = d["message"]
        role = m.get("role")
        if role == "assistant":
            for b in m.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip():
                    yield ("say", d.get("id"), b["text"], at)
                elif isinstance(b, dict) and b.get("type") == "toolCall":
                    yield ("tool", b.get("name"), b.get("id"), at)
        elif role == "toolResult":
            yield ("result", m.get("toolCallId"), at)
        elif role == "user":
            yield ("prompt", "\n".join(texts(m.get("content"), ("text",))), at)
        return
    if kind == "compaction":
        yield ("compact", at)


def read_transcript(path, tail, with_text):
    out = {"written_s": None, "open_tool": False}
    last = None  # [id, [texts], ago]
    turn = compact = prompt = None
    reports = {}
    for d in records(path, tail):
        # Last moved: the newest timestamped record. Claude Code appends untimestamped ones
        # (mode, title, last-prompt) to sessions that sit idle, which would move the mtime.
        stamped = ago(d.get("timestamp")) if isinstance(d, dict) else None
        if stamped is not None and (out["written_s"] is None or stamped < out["written_s"]):
            out["written_s"] = stamped
        for e in events(d):
            if e[0] == "say":
                if last and last[0] == e[1] and e[1] is not None:
                    last[1].append(e[2])
                    last[2] = e[3]
                else:
                    last = [e[1], [e[2]], e[3]]
                out["open_tool"] = False
            elif e[0] == "tool":
                out["open_tool"] = True
            elif e[0] == "result":
                out["open_tool"] = False
            elif e[0] == "prompt":
                out["open_tool"] = False
                turn = e[2]
                if e[1].strip():
                    prompt = [e[1].strip(), e[2]]
                if with_text:
                    for who, said in HC_FROM.findall(e[1]):
                        reports[who] = {"from": who, "text": said.strip()[:REPORT_MAX], "ago_s": e[2]}
            elif e[0] == "compact":
                compact = e[1] if e[1] is not None else out["written_s"]
    if out["written_s"] is None:
        out["written_s"] = max(0, NOW - os.path.getmtime(path))
    if not with_text:
        return out
    text = "\n\n".join(t.strip() for t in last[1]) if last else None
    out.update({
        "last": {"text": text[:MESSAGE_MAX], "cut": len(text) > MESSAGE_MAX, "ago_s": last[2]} if last else None,
        "turn_ago_s": turn,
        "prompt": {"text": prompt[0][:PROMPT_MAX], "ago_s": prompt[1]} if prompt else None,
        "compact_ago_s": compact,
        "reports": sorted(reports.values(), key=lambda r: r["ago_s"] if r["ago_s"] is not None else 1e12)[:40],
    })
    return out


# ---- Turns, for Timeline's backfill: when each turn started and ended, and how it ended.

# Tools that put a question to the person and wait for the answer.
QUESTION_TOOLS = {"AskUserQuestion", "request_user_input", "ask_user", "askUserQuestion", "question"}
# Turns read back from the end, a block more each time, until a record is older than since; never
# more than TURNS_CAP (the answer says when it stopped there).
TURNS_BLOCK = 1024 * 1024
TURNS_CAP = 256 * 1024 * 1024
TURNS_MAX = 500
QUESTION_MAX = 200


# The first timestamp at or after `offset` (a few lines in), as seconds ago; None if there is none.
def first_ago(path, offset):
    with open(path, "rb") as f:
        f.seek(offset)
        if offset:
            f.readline()
        for _ in range(200):
            line = f.readline()
            if not line:
                return None
            try:
                stamp = ago(json.loads(line).get("timestamp"))
            except (ValueError, AttributeError):
                continue
            if stamp is not None:
                return stamp
    return None


# How much of a transcript's end to read so it reaches `since_ago` seconds back: blocks doubling
# from the end, each checked by its first timestamp only, until one is older or the file starts.
# Returns (bytes, capped).
def tail_since(path, since_ago):
    size = os.path.getsize(path)
    tail = TURNS_BLOCK
    while tail < size:
        if tail >= TURNS_CAP:
            return TURNS_CAP, True
        first = first_ago(path, size - tail)
        if first is not None and first >= since_ago:
            return tail, False
        tail *= 2
    return size, False


def ends_with_question(text):
    last = (text or "").strip().split("\n\n")[-1].strip()
    return last if last.endswith("?") else None


# (turns, covers): turns [{start, end, ended, question?, asks}] in epoch seconds on this clock, oldest
# first; covers: the earliest time read (the tail's start), so what lies before it shows as unknown.
# A turn starts at a prompt and ends at its last event. ended: "ask-tool" (a question tool left
# unanswered), "question" (its last words end on "?" and no tool call came after them), "answer", or
# None (it said nothing). asks: every question-tool wait in the turn, [from, to or None].
def turns_of(path, tail):
    out, cur, earliest = [], None, None
    epoch = lambda a: None if a is None else round(NOW - a, 3)

    def done(t):
        if t is None:
            return
        asks = [[epoch(a), epoch(t["answered"].get(cid))] for cid, a in t["asks"]]
        open_ask = any(to is None for _, to in asks)
        question = ends_with_question(t["said"]) if t["said"] is not None and t["said_last"] else None
        ended = "ask-tool" if open_ask else "question" if question else "answer" if t["said"] is not None else None
        row = {"start": epoch(t["start"]), "end": epoch(t["end"]), "ended": ended, "asks": asks}
        if question and not open_ask:
            row["question"] = question.split("\n")[-1][-QUESTION_MAX:]
        out.append(row)

    for d in records(path, tail):
        stamped = ago(d.get("timestamp")) if isinstance(d, dict) else None
        if stamped is not None and (earliest is None or stamped > earliest):
            earliest = stamped
        for e in events(d):
            at = e[-1] if e[0] != "compact" else None
            if e[0] == "prompt":
                if at is None:
                    continue
                # Codex says task_started and user_message for one turn: the second joins the first.
                if cur and not cur["events"]:
                    continue
                done(cur)
                cur = {"start": at, "end": at, "said": None, "said_last": False, "asks": [], "answered": {}, "events": 0}
                continue
            if cur is None or at is None:
                continue
            cur["events"] += 1
            cur["end"] = min(cur["end"], at)
            if e[0] == "say":
                cur["said"], cur["said_last"] = e[2], True
            elif e[0] == "tool":
                cur["said_last"] = False
                if e[1] in QUESTION_TOOLS:
                    cur["asks"].append((e[2], at))
            elif e[0] == "result" and e[1] is not None:
                cur["answered"].setdefault(e[1], at)
    done(cur)
    return out[-TURNS_MAX:], epoch(earliest)


def program_of(path):
    return "codex" if "/.codex/" in path else "pi" if "/.pi/" in path else "claude"


# Every transcript written in a folder since `since` (epoch seconds): Claude's and pi's by their
# folder-named directories, Codex's by the cwd in each recent session's first line.
def folder_transcripts(cwd, since):
    cwd = cwd.rstrip("/") or "/"
    found = glob.glob(f"{HOME}/.claude/projects/{re.sub(r'[^A-Za-z0-9]', '-', cwd)}/*.jsonl")
    found += glob.glob(f"{HOME}/.pi/agent/sessions/--{cwd.strip('/').replace('/', '-')}--/*.jsonl")
    days = {time.strftime("%Y/%m/%d", time.localtime(t)) for t in (since, (since + NOW) / 2, NOW)}
    for day in days:
        for path in glob.glob(f"{HOME}/.codex/sessions/{day}/*.jsonl"):
            try:
                with open(path, "rb") as f:
                    first = json.loads(f.readline() or b"{}")
            except (OSError, ValueError):
                continue
            if (first.get("payload") or {}).get("cwd", "").rstrip("/") == cwd:
                found.append(path)
    return sorted({p for p in found if os.path.getmtime(p) >= since}, key=os.path.getmtime)


def turns_entry(path, since, have, tail):
    st = os.stat(path)
    entry = {"path": path, "program": program_of(path), "mtime": st.st_mtime, "size": st.st_size}
    if have.get(path) == [st.st_mtime, st.st_size]:
        entry["same"] = True
    else:
        read, capped = (tail, tail < st.st_size) if tail else tail_since(path, NOW - since)
        turns, covers = turns_of(path, read)
        entry["turns"] = [t for t in turns if t["end"] >= since]
        # covers: the earliest time read, the file's first record when it was read whole.
        entry.update({"covers": covers, "read": min(read, st.st_size), "capped": capped})
    return entry


def turns_request(req):
    since = NOW - float(req.get("since_s") or 86400)
    have = {k: list(v) for k, v in (req.get("have") or {}).items()}
    tail = int(req.get("tail") or 0)
    terminals, folders = {}, {}
    for spec in req.get("terminals") or []:
        path = find_transcript(spec.get("pid"), spec.get("argv") or [], spec.get("cwd"))
        terminals[spec.get("key")] = turns_entry(path, since, have, tail) if path else None
    for cwd in req.get("folders") or []:
        folders[cwd] = [turns_entry(p, since, have, tail) for p in folder_transcripts(cwd, since)]
    return {"terminals": terminals, "folders": folders}


def agent(spec, with_text):
    path = find_transcript(spec.get("pid"), spec.get("argv") or [], spec.get("cwd"))
    if not path:
        return {"found": False}
    try:
        return {"found": True, **read_transcript(path, TAIL if with_text else 256 * 1024, with_text)}
    except OSError:
        return {"found": False}


def git(root, *args):
    r = subprocess.run(["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, *args], capture_output=True, text=True, timeout=10)
    return r.stdout if r.returncode == 0 else None


# The repos the members' folders are in, and, under a member's folder that is not a repo, the repos
# one level down that hold work: changes or unpushed commits. A folder of clean repos says nothing
# about what the task touched.
def roots(cwds):
    found, under = [], []
    for cwd in cwds:
        if not cwd or not os.path.isdir(cwd):
            continue
        # Real paths: git gives the resolved one, a folder reached through a symlink (macOS's /tmp and
        # /var are links to /private) would otherwise list the same repo twice.
        top = git(cwd, "rev-parse", "--show-toplevel")
        if top:
            top = os.path.realpath(top.strip())
            if top not in found:
                found.append(top)
        else:
            under += [os.path.realpath(os.path.dirname(g)) for g in sorted(glob.glob(os.path.join(cwd, "*", ".git")))]
    return found, [r for r in dict.fromkeys(under) if r not in found]


def repos(cwds):
    found, under = roots(cwds)
    out = [repo(r) for r in found[:10]]
    for r in under:
        if len(out) >= 10:
            break
        info = repo(r)
        if info["changed"] or info["ahead"]:
            out.append(info)
    return out


def repo(root):
    status = git(root, "status", "--porcelain=v2", "-b", "-uall") or ""
    remote = bool((git(root, "remote") or "").strip())
    r = {"root": root, "name": os.path.basename(root), "branch": None, "upstream": None, "remote": remote, "ahead": 0, "changed": 0}
    for line in status.splitlines():
        if line.startswith("# branch.head "):
            r["branch"] = line[14:]
        elif line.startswith("# branch.upstream "):
            r["upstream"] = line[18:]
        elif line.startswith("# branch.ab "):
            r["ahead"] = int(line.split()[2].lstrip("+"))
        elif line and line[0] in "12u?":
            r["changed"] += 1
    stamp = (git(root, "log", "-1", "--format=%ct") or "").strip()
    r["commit_ago_s"] = max(0, NOW - int(stamp)) if stamp.isdigit() else None
    head = (git(root, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD") or "").strip()
    default = head.split("/", 1)[1] if "/" in head else None
    r["default"] = r["branch"] == default if default else r["branch"] in ("main", "master")
    return r


def login(script, *args, cwd=None, timeout=20):
    shell = os.environ.get("SHELL") or "sh"
    return subprocess.run([shell, "-lc", script, "tower", *args], capture_output=True, text=True, cwd=cwd, timeout=timeout)


FAILING = {"FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR", "STARTUP_FAILURE"}
RUNNING = {"IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"}


# gh's answer reduced to counts and the URL; None: no pull request; "missing": no gh here.
def pull_request(root):
    r = login('command -v gh >/dev/null || exit 127; exec gh pr view --json number,state,reviewDecision,statusCheckRollup,url', cwd=root)
    if r.returncode == 127:
        return "missing"
    if r.returncode != 0:
        return None
    try:
        pr = json.loads(r.stdout)
    except ValueError:
        return None
    checks = pr.get("statusCheckRollup") or []
    word = lambda c: (c.get("conclusion") or c.get("state") or c.get("status") or "").upper()
    return {
        "number": pr.get("number"),
        "state": (pr.get("state") or "").lower(),
        "review": (pr.get("reviewDecision") or "").lower().replace("_", " ") or None,
        "failing": sum(1 for c in checks if word(c) in FAILING),
        "running": sum(1 for c in checks if word(c) in RUNNING or (c.get("status") or "").upper() in RUNNING),
        "checks": len(checks),
        "url": pr.get("url") if str(pr.get("url", "")).startswith("https://github.com/") else None,
    }


ROOT_MARK = "\n--tower-chains-root--\n"


# chain.mjs titles a link by its body's first "# " heading, else its file name. A link saved
# with --title whose text starts with "##" (or one with a frontmatter title) ends up titled by
# its file name: then the title comes from the file itself.
def link_title(path, file):
    try:
        with open(path, errors="replace") as f:
            text = f.read(65536)
    except OSError:
        text = ""
    front = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.S)
    if front:
        named = re.search(r"^title:\s*(.+)$", front.group(1), re.M)
        if named:
            return named.group(1).strip().strip('"').replace('\\"', '"')
        text = text[front.end():]
    # The file name holds the --title it was saved with (lower case, at most 80 characters),
    # unless it was saved without one ("chain-link").
    words = re.sub(r"^\d{4}-\d{2}-\d{2}-\d+-", "", file[:-3] if file.endswith(".md") else file)
    words = re.sub(r"-\d+$", "", words).replace("-", " ").strip()
    if words and words != "chain link":
        return words[:1].upper() + words[1:]
    heading = re.search(r"^#{1,6}\s+(.+)$", text, re.M)
    if heading:
        return heading.group(1).strip()
    for line in text.splitlines():
        line = line.strip().strip("#*_> ").strip()
        if line:
            return line[:120]
    return words


# The newest link the lead saved for this task: a chain named by one of the task's ids, its main
# branch (workers save on branches of their own). Never the folder's newest link of any chain.
def chain(cwd, names):
    script = os.path.join(HOME, ".agents/skills/chains/chain.mjs")
    if not os.path.isfile(script):
        return "missing"
    if not names:
        return None
    r = login(f's="$1"; shift; node "$s" root || exit 1; for n; do printf %s "{ROOT_MARK}"; node "$s" list "$n" --json --max 50 || echo "[]"; done',
              script, *names, cwd=cwd if cwd and os.path.isdir(cwd) else None)
    if r.returncode != 0:
        return None
    root, *lists = r.stdout.split(ROOT_MARK)
    links = []
    for text in lists:
        try:
            listed = json.loads(text)
        except ValueError:
            continue
        links += [c for c in listed if isinstance(c, dict) and (c.get("branch") or "main") == "main" and c.get("created")] if isinstance(listed, list) else []
    if not links:
        return None
    latest = max(links, key=lambda c: c["created"])
    title, file = latest.get("title"), latest.get("file") or ""
    if not title or title == file[:-3]:
        title = link_title(os.path.join(root.strip(), latest.get("chain") or "", file), file)
    return {"chain": latest.get("chain"), "title": title, "next": latest.get("nextStep"), "ago_s": ago(latest.get("created"))}


def main():
    req = json.loads(sys.argv[1])
    # Timeline's backfill asks for turns only.
    if "turns" in req:
        sys.stdout.write(json.dumps({"now": NOW, "turns": turns_request(req["turns"])}))
        return
    out = {}
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        linked = pool.submit(chain, req.get("lead_cwd"), req.get("chains") or []) if req.get("chain") else None
        if req.get("lead"):
            out["lead"] = agent(req["lead"], True)
        out["workers"] = {w["key"]: agent(w, False) for w in req.get("workers") or []}
        out["repos"] = repos(req.get("cwds") or [])
        skip = set(req.get("gh_skip") or [])
        asks = {r["root"]: pool.submit(pull_request, r["root"]) for r in out["repos"]
                if r["upstream"] and not r["default"] and r["root"] not in skip}
        for r in out["repos"]:
            pr = asks[r["root"]].result() if r["root"] in asks else "skipped" if r["root"] in skip else None
            if pr == "missing":
                out["gh"] = False
                pr = None
            r["pr"] = pr
        if linked:
            out["chain"] = linked.result()
    text = json.dumps(out)
    while len(text) > 64000 and out.get("lead", {}).get("reports"):
        out["lead"]["reports"].pop()
        text = json.dumps(out)
    sys.stdout.write(text)


if __name__ == "__main__":
    main()
