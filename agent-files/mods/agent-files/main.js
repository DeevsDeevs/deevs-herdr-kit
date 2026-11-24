// A lazy file browser for the focused pane's folder, with bounded read-only previews, that also
// moves files between this computer and the machine a space runs on.
// From Herdr's shipped `files` mod (Apache-2.0, LICENSE-Herdr.txt); changed: the menu, drops,
// paste, downloads and uploads (transfer.js, transfer.sh), and staging folders left out.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window,
  hc, home, appHome, writeTextFile, terminals, run, props, openOverlay, closeOverlay, setShared } from "herdr";
import * as T from "./transfer.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
// A load Herdr cuts off at its time limit never finishes, not even its finally; after this
// long one counts as gone and the next refresh may start another.
const GIVE_UP = 120000;
const running = (since) => Boolean(since) && Date.now() - since < GIVE_UP;
const lapsed = (since, ms) => !since || Date.now() - since >= ms;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) if (!fields[i + 1].startsWith(T.STAGE)) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// Transfers live in files and hc terminals, never in a render: a closed panel or a render Herdr
// cut off loses nothing. Every copy of the mod shares this module.
const ROOT = () => `${appHome()}/agent-files/transfers`;
const SCRIPT = () => `${appHome()}/mods/agent-files/transfer.sh`;
const DOWNLOADS = () => `${home()}/Downloads`;
// What a menu asked for, carried out by a panel: a popup's own tasks may not outlive it.
const queue = [];
let draining = 0, reading = 0, readAt = 0;
// Per transfer: the log read so far and its progress; the last list read.
const progress = new Map();
let transfers = [];

const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);
const join = (folder, name) => (folder.endsWith("/") ? folder + name : `${folder}/${name}`);

async function startTransfer({ kind, from, src, to, dest }) {
  const id = T.newId(), dir = `${ROOT()}/${id}`;
  const info = { kind, name: src.replace(/\/+$/, "").split("/").pop(), src, dest, from: from ?? null, to: to ?? null, started: Date.now() };
  const made = await exec("mkdir", ["-p", dir]);
  if (made.code !== 0) throw new Error(made.stderr);
  await writeTextFile(`${dir}/info.json`, JSON.stringify(info), null);
  const fail = (why) => writeTextFile(`${dir}/status`, `failed\n${why}\n`, null);
  progress.set(id, { offset: 0, p: T.START });
  let machines = null;
  if (from || to) {
    const r = await hc(["machine", "ls", "--json"]);
    try { machines = JSON.parse(r.stdout); } catch {}
  }
  const fromTarget = from ? T.sshTarget(machines, from) : "", toTarget = to ? T.sshTarget(machines, to) : "";
  if (fromTarget === null || toTarget === null) return fail(`${from ?? to} is not reached over ssh`);
  const r = await hc(T.runArgs({ script: SCRIPT(), root: ROOT(), id, from: fromTarget, src, to: toTarget, dest }));
  if (r.code !== 0) return fail(r.stderr || r.stdout);
}

// The files a copy in Finder (or a file manager) left on the clipboard.
async function pastedPaths(text) {
  if (window()?.platform !== "macos") return T.clipboardPaths(text);
  const r = await exec("osascript", ["-l", "JavaScript", "-e", T.MAC_CLIPBOARD]);
  return r.code === 0 ? T.clipboardPaths(r.stdout) : [];
}

async function perform(job) {
  if (job.action === "download") return startTransfer({ kind: "download", from: job.on, src: job.path, to: null, dest: DOWNLOADS() });
  if (job.action === "clear") return exec("rm", ["-rf", `${ROOT()}/${job.id}`]).then(() => { transfers = transfers.filter((x) => x.id !== job.id); progress.delete(job.id); });
  const paths = job.action === "paste" ? await pastedPaths(job.text) : job.paths;
  for (const src of paths) await startTransfer({ kind: "upload", from: null, src, to: job.on, dest: job.path });
}

// One read of every transfer: new log since last time, and whether each still runs.
async function readTransfers() {
  const sent = new Map([...progress].map(([id, v]) => [id, v.offset]));
  const r = await exec("sh", [SCRIPT(), "read", ROOT(), ...[...sent].map(([id, o]) => `${id}=${o}`)]);
  if (r.code !== 0) return false;
  const now = Date.now(), before = new Map(transfers.map((x) => [x.id, x.state]));
  const list = T.parseRead(r.stdout).map((rec) => {
    // One read at a time (readTick), so the offset sent is still this one's.
    const had = progress.get(rec.id), from = sent.get(rec.id) ?? 0;
    const p = T.advance(had && from ? had.p : T.START, rec.chunk);
    progress.set(rec.id, { offset: rec.size, p });
    return { id: rec.id, info: rec.info, ...T.stateOf(rec, now), pct: T.percent(p), rate: p.rate };
  }).sort((a, b) => (b.info.started ?? 0) - (a.info.started ?? 0));
  // Gone from disk (cleared, or a day old): forget it, or the panel would keep reading every second.
  const kept = new Set(list.map((x) => x.id));
  for (const id of sent.keys()) if (!kept.has(id)) progress.delete(id);
  transfers = list;
  return list.some((x) => x.state === "done" && x.info.kind === "upload" && before.get(x.id) === "running");
}

// The terminal "Send path" types into, when it is on the machine the path is on.
function sendTarget(on) {
  const address = focused()?.terminal;
  if (!address || machineOf(address) !== (on ?? null)) return null;
  const term = terminals().find((t) => t.address === address);
  return term?.program?.name ?? "terminal";
}

function menuItems(m) {
  if (m.transfer) return [...(m.path ? [["Copy path", "copy", "copy"]] : []), ...(m.finished ? [["Clear", "clear", "x"]] : [])];
  const to = sendTarget(m.on);
  return [
    ...(m.root ? [] : [["Download", "download", "download"]]),
    ...(m.dir ? [["Paste", "paste", "clipboard"]] : []),
    ["Copy path", "copy", "copy"],
    ...(to ? [[`Send path to ${to}`, "send", "terminal"]] : []),
  ];
}

function openMenu(m) {
  const items = menuItems(m);
  if (items.length) openOverlay({ mod: "agent-files", kind: "popup", width: 230, height: 10 + 31 * items.length, props: { menu: m } });
}

// A right-click menu, as a popup copy of this mod.
class Menu {
  constructor(cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(item, cx) {
    const m = props().menu;
    closeOverlay(props().overlay);
    if (item[1] === "copy") return cx.write_to_clipboard(m.path);
    if (item[1] === "send") {
      cx.write_to_clipboard(`${T.quotePath(m.path)} `);
      return run("terminal.paste");
    }
    queue.push({ action: item[1], on: m.on, path: m.path, id: m.transfer, text: item[1] === "paste" ? cx.read_from_clipboard() : undefined });
    setShared("agent-files.queue", Date.now());
  }

  render() {
    const t = theme(), list = menuItems(props().menu);
    return v_flex().id("af-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") list[this.at] && this.choose(list[this.at], cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => h_flex().id(`af-mi-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground).cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.choose(it, cx))
        .child(svg(`mods/agent-files/${it[2]}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().truncate().child(it[0]))));
  }
}

export default class Files extends View {
  init(_props, cx) {
    if (props()?.menu) { this.menu = new Menu(cx); return; }
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Map(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    this.readTick(cx, true);
    cx.timer.every(1000, cx => this.readTick(cx, false));
  }

  // Carries out what menus asked for, one job after another.
  drain(cx) {
    if (!queue.length || !lapsed(draining, 20000)) return;
    const since = draining = Date.now();
    cx.spawn(async cx => {
      try { while (queue.length) await perform(queue.shift()).catch(e => { this.error = String(e); }); }
      finally { if (draining === since) draining = 0; this.readTick(cx, true); cx.notify(); }
    });
  }

  // Reads the transfers every second while one runs, else every 10 seconds.
  readTick(cx, force) {
    const live = progress.size > transfers.length || transfers.some(x => x.state === "running");
    if (!lapsed(reading, 20000) || (!force && !live && Date.now() - readAt < 10000)) return;
    const since = reading = readAt = Date.now();
    cx.spawn(async cx => {
      try { if (await readTransfers()) this.refresh(cx); }
      catch {}
      finally { if (reading === since) reading = 0; cx.notify(); }
    });
  }

  upload(paths, dest, cx) {
    if (!paths?.length || !dest) return;
    queue.push({ action: "upload", on: this.on, path: dest, paths });
    this.drain(cx);
    cx.notify();
  }

  transferRows(t) {
    return transfers.map(x => {
      const done = x.state === "done", failed = x.state === "failed";
      const right = done ? "Done" : failed ? "Failed" : x.pct == null ? "" : `${x.pct}%${x.rate ? ` · ${x.rate}` : ""}`;
      const menu = { transfer: x.id, on: x.info.kind === "upload" ? x.info.to : null, path: done ? join(x.info.dest, x.name) : x.info.dest, finished: x.state !== "running" };
      return v_flex().id(`af-t-${x.id}`).flex_none().px(8).py(6).gap(2).rounded(7).hover(s => s.bg(t.hover))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openMenu(menu); })
        .child(h_flex().gap(7).items_center()
          .child(svg(`mods/agent-files/${x.info.kind}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child(done ? x.name : x.info.name))
          .child(div().flex_none().text_size(11.5).text_color(done ? t.done : failed ? t.ansi1 : t.muted).child(right)))
        .when(failed, el => el.child(div().pl(21).text_size(11.5).text_color(t.dim).truncate().child(x.reason)));
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Map(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || running(this.loading)) return;
    const context = this.context, started = this.loading = Date.now();
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.loading === started) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !running(this.pending.get(path))) {
        const context = this.context, started = Date.now();
        this.pending.set(path, started);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.pending.get(path) === started) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: settings().font_size,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openMenu({ on: this.on, path: join(this.root, path), dir: entry.dir }); })
        .when(entry.dir, el => el.on_drop((e, cx) => { cx.stop_propagation(); this.upload(e.paths, join(this.root, path), cx); }))
        .child(entry.dir ? svg(`mods/agent-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/agent-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (this.menu) return this.menu.render();
    if (key() !== this.context?.key) this.refresh(cx);
    if (queue.length) this.drain(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .when(Boolean(this.root), el => el
          .on_mouse_down("right", (_e, cx) => openMenu({ on: this.on, path: this.root, dir: true, root: true }))
          .on_drop((e, cx) => this.upload(e.paths, this.root, cx)))
        .children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")))
      .when(transfers.length > 0, el => el.child(v_flex().id("af-transfers").flex_none().max_h(176).overflow_y_scroll().p(6).border_t(1).border_color(t.border)
        .children(this.transferRows(t))));
  }
}
