// One live connection to a session's stream: frames, tabs, url and what the
// agent is doing, with input going back the same way. Reconnects on its own.

import { WebSocket } from "websocket";
import { describe, jpegSize, pageOf } from "./lib.js";
import { Frames } from "./frames.js";

const reason = (e) => String(e?.message ?? e ?? "failed").replace(/^Error: /, "");
// The socket takes 8 writes in flight; past that it refuses them.
const IN_FLIGHT = 6;

// Frames written but not yet on screen, at most.
const FRAMES_IN_FLIGHT = 2;

export class Feed {
  // `live`: show every frame. Without it (a Herdr that never frees a shown
  // picture) only the first frame and the ones asked for with refresh() are shown.
  constructor(prefix, conn, fps, live = true) {
    this.conn = conn;
    this.fps = fps;
    this.live = live;
    this.frames = new Frames(prefix);
    this.phase = "connecting";
    this.error = null;
    this.page = null;
    this.frameAt = null;
    this.latest = null;
    this.want = true;
    this.url = null;
    this.tabs = [];
    this.activity = [];
    this.arrivals = [];
    this.http = null;
    this.ws = null;
    this.queue = [];
    this.pending = 0;
    this.inFlight = 0;
    this.taken = null;
    this.stopped = false;
    this.settles = 0;
  }

  start(cx) {
    cx.spawn(async (cx) => this.loop(cx));
    return this;
  }

  stop() {
    this.stopped = true;
    this.ws?.close().catch(() => {});
    this.ws = null;
    this.queue = [];
    this.conn.close();
    this.frames.clear();
  }

  get title() {
    return this.activeTab?.title ?? null;
  }

  get activeTab() {
    return this.tabs.find((t) => t.active) ?? null;
  }

  get rate() {
    return Math.round(this.arrivals.filter((t) => Date.now() - t < 3000).length / 3);
  }

  async loop(cx) {
    let backoff = 1000;
    while (!this.stopped) {
      try {
        this.phase = "connecting";
        cx.notify();
        const { http, port } = await this.conn.open(cx);
        // Stopped meanwhile: the throw lands in the cleanup below.
        if (this.stopped) throw null;
        this.http = http;
        // Live: the daemon sends the next frame only once this one is acked, so
        // frames never pile up between it and the picture. Older daemons ignore it.
        this.ws = await WebSocket.connect(`ws://127.0.0.1:${port}/?maxFps=${this.fps}${this.live ? "&pacing=ack" : ""}`);
        if (this.stopped) throw null;
        this.phase = "live";
        this.liveAt = Date.now();
        this.error = null;
        backoff = 1000;
        cx.notify();
        for (;;) {
          const msg = await this.ws.read();
          if (this.stopped) throw null;
          if (typeof msg === "string") this.handle(msg, cx);
        }
      } catch (e) {
        if (!this.stopped) this.error = reason(e);
      }
      this.ws?.close().catch(() => {});
      this.ws = null;
      this.http = null;
      this.queue = [];
      this.conn.close();
      if (this.stopped) break;
      this.phase = "error";
      cx.notify();
      await cx.sleep(backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  }

  handle(text, cx) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    switch (m.type) {
      case "frame": {
        const now = Date.now();
        this.arrivals.push(now);
        while (now - this.arrivals[0] >= 3000) this.arrivals.shift();
        if (typeof m.data !== "string") return;
        this.latest = { data: m.data, at: m.metadata?.timestamp ?? now, width: m.metadata?.deviceWidth, seq: m.seq };
        if (this.live || this.want) this.show(cx);
        return;
      }
      case "tabs":
        this.tabs = Array.isArray(m.tabs) ? m.tabs : [];
        break;
      case "url":
        if (m.url && m.url !== this.url) this.settle(cx);
        this.url = m.url ?? this.url;
        break;
      case "command":
        // Every CLI call starts with an internal launch; it says nothing about the agent.
        if (m.action === "launch") return;
        this.activity.unshift({ id: m.id, text: describe(m), at: m.timestamp ?? Date.now(), done: false, ms: null });
        this.activity.length = Math.min(this.activity.length, 40);
        break;
      case "result": {
        // Not result.success: agent-browser 0.41 sends false for every command.
        const a = this.activity.find((x) => x.id === m.id);
        if (!a) return;
        a.done = true;
        a.ms = m.duration_ms ?? null;
        break;
      }
      default:
        return;
    }
    cx.notify();
  }

  // Writes the newest frame, unless one is still being written. Decoding
  // happens only here: the reader must keep reading, or the socket closes.
  // At most FRAMES_IN_FLIGHT frames between the socket and the picture; a frame is
  // acked once written, which lets the daemon send the next.
  show(cx) {
    const f = this.latest;
    if (!f || f === this.taken || this.inFlight >= FRAMES_IN_FLIGHT) return;
    this.taken = f;
    this.inFlight++;
    this.want = false;
    const bytes = Buffer.from(f.data, "base64");
    const page = pageOf(jpegSize(bytes), f.width);
    cx.spawn(async (cx) => {
      const shown = await this.frames.push(bytes, cx, () => {
        if (this.live && f.seq != null) this.send({ type: "ack", seq: f.seq });
      });
      this.inFlight--;
      if (shown) {
        this.page = page ?? this.page;
        this.frameAt = f.at;
      } else if (!this.live) {
        this.want = true;
      }
      // A page that went quiet meanwhile still ends on its last frame.
      if (this.live && !this.stopped) this.show(cx);
    });
  }

  // Without live pictures: show the newest frame now, or the next one to come.
  refresh(cx) {
    this.want = true;
    this.show(cx);
  }

  // Without live pictures, after input or a navigation. A click's result paints a
  // while later, so look again as it settles; a page that didn't repaint sends
  // no new frame, so the later looks cost nothing.
  settle(cx) {
    if (this.live) return;
    const n = ++this.settles;
    for (const ms of [600, 1500, 3000]) {
      cx.spawn(async (cx) => {
        await cx.sleep(ms);
        if (n === this.settles && !this.stopped) this.refresh(cx);
      });
    }
  }

  // Input keeps its order and stays within the socket's limit; pointer moves
  // give way when it falls behind.
  send(msg, droppable = false) {
    if (!this.ws || (droppable && this.queue.length + this.pending > 2)) return;
    this.queue.push(JSON.stringify(msg));
    this.pump();
  }

  pump() {
    const ws = this.ws;
    while (ws && this.pending < IN_FLIGHT && this.queue.length) {
      const text = this.queue.shift();
      this.pending++;
      ws.write(text).catch(() => {}).then(() => {
        this.pending--;
        if (this.ws === ws) this.pump();
      });
    }
  }

  // A daemon command (navigate, back, tab_switch, close) through the stream port's HTTP side.
  async command(body) {
    if (!this.http) throw new Error("not connected");
    const r = await fetch(`${this.http}/api/command`, {
      method: "POST",
      headers: { Origin: this.http, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${r.status}`);
    return j?.data ?? null;
  }
}
