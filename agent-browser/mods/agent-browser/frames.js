// Live pictures in a mod. image() reads files under the app home and caches
// them by path, and Herdr clears that cache only for paths its watcher sees.
// So every frame gets a name of its own in a watched folder that is not a mod
// (no main.js: never loaded, never reloaded). A frame shows only after its
// write finished, the previous one stays under it while the new one decodes,
// and deleting a file is what frees its decoded copy.

import { image, div } from "gpui-kit";
import { appHome, watchFolder } from "herdr";
import { writeFile, unlink, mkdir, readdir } from "fs/promises";

export const FOLDER = "mods/agent-browser-frames";
// Herdr drops a picture from its cache when its watcher reports the file. A
// frame drawn before that report vanishes and loads again, the one under it
// showing meanwhile: the page jumps back a frame. So a frame waits until the
// watcher has reported it, then for the app's own 80 ms batch. A fixed wait was
// too short where reports come late (macOS under load).
const AFTER_REPORT_MS = 100;
// A report that never comes (a batch another waiter took) holds a frame no longer.
const MAX_HOLD_MS = 500;
const abs = (rel) => `${appHome()}/${rel}`;
// The time a frame was written is in its name, so any copy can sweep the folder.
const stamp = (name) => parseInt(name.split("-").at(-2) ?? "", 36);
// Pictures of other people's pages: backups that honour cache tags (restic
// --exclude-caches, borg, tar --exclude-caches) leave the folder out.
const TAG = "CACHEDIR.TAG";

// Resolves once the watcher reported `name`, or after MAX_HOLD_MS. Started
// before the write, so the report can't land before anyone listens.
function reported(name, cx) {
  let done = false;
  const heard = (async () => {
    while (!done) {
      const paths = await watchFolder(abs(FOLDER));
      // A batch naming the folder itself means "everything changed".
      if (paths.some((p) => p.endsWith(`/${name}`) || p.endsWith(`/${FOLDER}`))) return;
    }
  })().catch(() => cx.sleep(MAX_HOLD_MS));
  return Promise.race([heard, cx.sleep(MAX_HOLD_MS)]).finally(() => { done = true; });
}

export async function sweep(maxAgeMs) {
  try {
    await mkdir(abs(FOLDER), { recursive: true }).catch(() => {});
    const names = await readdir(abs(FOLDER));
    if (!names.includes(TAG)) await writeFile(abs(`${FOLDER}/${TAG}`), "Signature: 8a477f597d28d172789f06886806bc55\n# live page pictures from the agent-browser Herdr mod\n");
    const now = Date.now();
    for (const name of names) {
      if (name === TAG) continue;
      const t = stamp(name);
      if (!Number.isFinite(t) || now - t > maxAgeMs) await unlink(abs(`${FOLDER}/${name}`)).catch(() => {});
    }
  } catch {}
}

export class Frames {
  constructor(prefix) {
    this.prefix = prefix;
    this.seq = 0;
    this.shownSeq = 0;
    this.shown = [];
    this.busy = false;
    this.last = null;
    this.lastAt = 0;
    this.cleared = false;
  }

  // Newest frame wins: one arriving while the previous is being written is dropped.
  async push(bytes, cx) {
    if (this.busy) return false;
    this.busy = true;
    const seq = ++this.seq;
    const name = `${this.prefix}-${Date.now().toString(36)}-${seq}.jpg`;
    const rel = `${FOLDER}/${name}`;
    const heard = reported(name, cx);
    try {
      await writeFile(abs(rel), bytes);
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
    this.last = bytes;
    this.lastAt = Date.now();
    await heard;
    await cx.sleep(AFTER_REPORT_MS);
    // Frames overlap while they wait: one overtaken by a newer frame is never drawn.
    if (this.cleared || seq < this.shownSeq) {
      unlink(abs(rel)).catch(() => {});
      return false;
    }
    this.shownSeq = seq;
    this.shown.push(rel);
    cx.notify();
    while (this.shown.length > 2) {
      const gone = this.shown.shift();
      await cx.sleep(50);
      unlink(abs(gone)).catch(() => {});
    }
    return true;
  }

  // A quiet page sends no frames; rewrite the last one before a sweep takes it.
  async keepAlive(cx, olderThanMs) {
    if (this.last && Date.now() - this.lastAt > olderThanMs) await this.push(this.last, cx);
  }

  get empty() {
    return this.shown.length === 0;
  }

  view() {
    return this.shown.map((rel) => div().id(rel).absolute().inset_0().child(image(rel).size_full()));
  }

  clear() {
    this.cleared = true;
    for (const rel of this.shown) unlink(abs(rel)).catch(() => {});
    this.shown = [];
    this.last = null;
  }
}
