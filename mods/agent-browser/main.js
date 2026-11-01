// Agent browser: every agent-browser session on this computer and on Herdr's
// other machines, live. The overview is a grid of cards; a card opens the
// session in its own window (or a tab), where you can watch it or take control.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, theme, settings, props, openOverlay, closeOverlay, updates, readTextFile, appHome } from "herdr";
import { DISCOVER, parseDiscovery, sessionKey, slug, host, brief, ago, normalizeUrl, toPage, cdpModifiers, keyMessages, textMessages } from "./lib.js";
import { SETTINGS } from "./settings.js";
import { remoteMachines, connector } from "./connect.js";
import { Feed } from "./stream.js";
import { sweep } from "./frames.js";

const ICON = "mods/agent-browser/icon.svg";
const MIN_CARD = 260;
const GAP = 12;
const reason = (e) => String(e?.message ?? e ?? "failed").replace(/^Error: /, "");
const newId = () => Math.random().toString(36).slice(2, 8);
// A quiet page sends no frames, so its last one is rewritten before the sweep would take it.
const KEEP_MS = 2 * 60 * 1000;
const SWEEP_MS = 6 * 60 * 1000;

// Herdr frees a shown picture when its file is deleted only after 0.1.11
// (ccbc8c5, which also added this sentence to the AGENTS.md it writes). Older
// ones keep every picture ever shown, so they get stills instead of a stream.
const FREES_PICTURES = "Saving an asset under `mods/` updates every";
async function livePictures() {
  const [a, b, c] = String(updates()?.app?.version ?? "").split(".").map(Number);
  if (a > 0 || b > 1 || (b === 1 && c > 11)) return true;
  const doc = await readTextFile(`${appHome()}/AGENTS.md`).catch(() => null);
  return Boolean(doc?.includes(FREES_PICTURES));
}

const STILLS = "This Herdr keeps every picture it has shown in memory, so pictures here are stills. Herdr newer than 0.1.11 makes them live.";

async function discover(name) {
  const r = await exec("sh", ["-c", DISCOVER], name ? { on: name } : {});
  const found = parseDiscovery(r.stdout);
  if (r.code !== 0 && !found.sessions.length) throw new Error(r.stderr.trim() || `exit ${r.code}`);
  return found;
}

function button(t, id, label, onClick, { tip, on = false, danger = false } = {}) {
  return h_flex()
    .id(id)
    .h(24)
    .px(8)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(6)
    .text_size(12)
    .bg(on ? t.accent : danger ? t.blocked : t.raised)
    .text_color(on ? t.accent_foreground : danger ? "#ffffff" : t.muted)
    .cursor_pointer()
    .hover((s) => s.bg(on ? t.accent : danger ? t.blocked : t.hover).text_color(on ? t.accent_foreground : danger ? "#ffffff" : t.foreground))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    // A press on a control is not a window drag.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .child(label);
}

function dot(color) {
  return div().size(7).flex_none().rounded(4).bg(color);
}

function statusOf(t, feed, session) {
  if (!session.port) return { color: t.dim, text: `no stream (${session.engine})` };
  if (!feed) return { color: t.dim, text: "paused" };
  if (feed.phase === "live") {
    const kind = feed.live ? "live" : "still";
    const age = feed.frameAt ? ago(Date.now() - feed.frameAt) : null;
    return { color: t.working, text: !age ? `${kind} · waiting for a frame` : age === "now" ? `${kind} · now` : `${kind} · frame ${age} old` };
  }
  if (feed.phase === "error") return { color: t.blocked, text: feed.error ?? "disconnected" };
  return { color: t.idle, text: "connecting…" };
}

function closeButton(t) {
  const overlay = props()?.overlay;
  return overlay ? button(t, "ab-close", "✕", () => closeOverlay(overlay), { tip: "Close" }) : null;
}

class Overview {
  init(cx) {
    this.copy = newId();
    this.machines = [];
    this.feeds = new Map();
    this.width = 0;
    this.scanned = false;
    this.live = null;
    this.lastRender = Date.now();
    this.h = cx.focus_handle();
    this.h.focus();
    cx.spawn(async () => { await sweep(SWEEP_MS); });
    cx.timer.every(60 * 1000, (cx) => cx.spawn(async () => { await sweep(SWEEP_MS); }));
    this.scan(cx);
    cx.timer.every(SETTINGS.scanEveryMs, (cx) => this.scan(cx));
  }

  scan(cx) {
    if (this.scanning) return;
    this.scanning = true;
    const started = Date.now();
    cx.spawn(async (cx) => {
      try {
        if (this.live === null) this.live = await livePictures();
        let others = [];
        let othersError = null;
        try { others = await remoteMachines(); } catch (e) { othersError = reason(e); }
        let list = [{ name: null, state: "connected" }, ...others];
        if (SETTINGS.machines) list = list.filter((m) => SETTINGS.machines.includes(m.name));
        this.machines = await Promise.all(list.map(async (m) => {
          if (m.state !== "connected") return { ...m, sessions: [], error: String(m.state).replace(/_/g, " ") };
          try {
            const d = await discover(m.name);
            return { ...m, os: d.os, sessions: d.sessions, error: null };
          } catch (e) {
            return { ...m, sessions: [], error: reason(e) };
          }
        }));
        this.othersError = othersError;
        this.scanned = true;
        this.sync(cx, started);
      } finally {
        this.scanning = false;
        cx.notify();
      }
    });
  }

  // Cards stream only while they are drawn: every scan ends in a notify, so a
  // shown overview renders at least once between two scans, and one that
  // hasn't for a few is hidden. Measured from the scan's start, so a slow
  // machine can't make a shown overview look hidden.
  sync(cx, started) {
    const hidden = started - this.lastRender > SETTINGS.scanEveryMs * 2.5;
    const want = new Map();
    if (!hidden) {
      for (const m of this.machines) {
        for (const s of m.sessions) if (s.port) want.set(this.feedKey(m, s), { m, s });
      }
    }
    for (const [key, feed] of this.feeds) {
      if (!want.has(key)) {
        feed.stop();
        this.feeds.delete(key);
      }
    }
    for (const [key, { m, s }] of want) {
      if (!this.feeds.has(key)) this.feeds.set(key, new Feed(`${this.copy}-${slug(key)}`, connector(m, s.port), SETTINGS.cardFps, this.live).start(cx));
    }
    for (const feed of this.feeds.values()) cx.spawn(async (cx) => { await feed.frames.keepAlive(cx, KEEP_MS); });
  }

  feedKey(m, s) {
    return `${sessionKey(m.name, s)}|${s.pid}|${s.port}`;
  }

  feedFor(m, s) {
    return this.feeds.get(this.feedKey(m, s)) ?? null;
  }

  open(m, s, asTab) {
    const p = { view: "viewer", machine: m.name, session: s.session, dir: s.dir };
    if (asTab) run("tab.new", { name: s.session, mod: "agent-browser", props: p });
    else openOverlay({ mod: "agent-browser", kind: "window", key: `ab-${slug(sessionKey(m.name, s))}`, width: 0.66, height: 0.78, props: p });
  }

  close() {
    for (const feed of this.feeds.values()) feed.stop();
    this.feeds.clear();
  }

  card(t, m, s, w) {
    const feed = this.feedFor(m, s);
    const st = statusOf(t, feed, s);
    const last = feed?.activity[0];
    const url = feed?.url ?? feed?.activeTab?.url ?? s.url;
    const id = slug(sessionKey(m.name, s));
    return v_flex()
      .id(`ab-card-${id}`)
      .w(w)
      .flex_none()
      .rounded(10)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .overflow_hidden()
      .cursor_pointer()
      .hover((x) => x.border_color(t.accent))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.open(m, s, false);
      })
      .child(
        div()
          .relative()
          .w_full()
          .h(Math.round(w * 0.5625))
          .bg(t.canvas)
          .children(feed ? feed.frames.view() : [])
          .when(!feed || feed.frames.empty, (el) =>
            el.child(h_flex().absolute().inset_0().items_center().justify_center().px(12).text_size(11.5).text_color(t.dim).child(st.text))),
      )
      .child(
        v_flex()
          .p(10)
          .gap(3)
          .child(
            h_flex()
              .gap(7)
              .items_center()
              .child(dot(st.color))
              .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).text_color(t.foreground).child(s.session))
              .when(Boolean(s.namespace), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(s.namespace)))
              .child(button(t, `ab-tab-${id}`, "tab", () => this.open(m, s, true), { tip: "Open as a tab" })),
          )
          .child(div().truncate().text_size(12).text_color(t.muted).child(feed?.title || host(url) || "—"))
          .child(div().truncate().text_size(11).text_color(t.dim).child(brief(url)))
          .child(div().truncate().text_size(11).text_color(t.dim).child(last ? `→ ${last.text} · ${ago(Date.now() - last.at)}` : st.text)),
      );
  }

  render(cx) {
    this.lastRender = Date.now();
    const t = theme();
    const zoom = settings().zoom || 1;
    const width = (this.width || 900) / zoom;
    const inner = Math.max(MIN_CARD, width - 28);
    const cols = Math.max(1, Math.floor((inner + GAP) / (MIN_CARD + GAP)));
    const cardW = Math.floor((inner - GAP * (cols - 1)) / cols);
    const total = this.machines.reduce((n, m) => n + m.sessions.length, 0);

    const section = (m) => {
      const label = m.name ?? "this computer";
      return v_flex()
        .gap(8)
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .text_size(12)
            .child(dot(m.error ? t.blocked : t.working))
            .child(div().font_semibold().text_color(t.foreground).child(label))
            .child(div().text_color(t.dim).child(m.error ? m.error : `${m.sessions.length} session${m.sessions.length === 1 ? "" : "s"}`)),
        )
        .when(m.sessions.length > 0, (el) =>
          el.child(h_flex().flex_wrap().gap(GAP).children(m.sessions.map((s) => this.card(t, m, s, cardW)))));
    };

    return v_flex()
      .id("ab-root")
      .size_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .track_focus(this.h)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1) {
          this.width = size.width;
          cx.notify();
        }
      })
      .on_key_down((e, cx) => {
        if (e.key === "escape" && props()?.overlay) {
          cx.stop_propagation();
          closeOverlay(props().overlay);
        }
      })
      .child(
        h_flex()
          .h(42)
          .flex_none()
          .px(14)
          .gap(9)
          .items_center()
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .child(svg(ICON).size(15).text_color(t.accent))
          .child(div().font_semibold().text_size(13.5).child("Agent browsers"))
          .child(div().text_size(12).text_color(t.dim).child(this.scanned ? `${total} live` : "looking…"))
          .child(div().flex_1())
          .when(Boolean(this.othersError), (el) => el.child(div().text_size(11).text_color(t.blocked).truncate().child(this.othersError)))
          .child(closeButton(t) ?? div()),
      )
      .when(this.live === false, (el) =>
        el.child(div().flex_none().px(14).py(6).text_size(11.5).text_color(t.muted).bg(t.raised).child(`${STILLS} Each card shows its first frame.`)))
      .child(
        v_flex()
          .id("ab-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(14)
          .gap(18)
          .children(this.machines.map(section))
          .when(this.scanned && total === 0, (el) =>
            el.child(
              v_flex()
                .gap(6)
                .py(24)
                .items_center()
                .text_size(12.5)
                .text_color(t.dim)
                .child("No agent-browser sessions right now.")
                .child(div().text_size(11.5).child("They show up here as soon as an agent runs agent-browser open <url>.")),
            )),
      );
  }
}

class Viewer {
  init(cx, p) {
    this.machine = p.machine ?? null;
    this.session = p.session;
    this.dir = p.dir ?? null;
    this.copy = newId();
    this.live = null;
    this.lastRender = Date.now();
    this.pokes = 0;
    this.feed = null;
    this.found = null;
    this.os = null;
    this.ended = false;
    this.control = false;
    this.note = null;
    this.armedClose = 0;
    this.showLog = false;
    this.pressed = null;
    this.lastPoint = null;
    this.lastMove = 0;
    this.h = cx.focus_handle();
    this.url = InputState.new({ placeholder: "Go to…" });
    this.shownUrl = "";
    this.url.on("submit", (_e, cx) => {
      // What was typed is now the address being followed: the real one replaces it when it arrives.
      this.shownUrl = this.url.value();
      this.navigate(this.url.value(), cx);
    });
    this.scan(cx);
    cx.timer.every(SETTINGS.scanEveryMs, (cx) => this.scan(cx));
  }

  // Like the overview, it streams only while drawn: a session tab in the
  // background costs nothing.
  scan(cx) {
    if (this.scanning) return;
    this.scanning = true;
    const started = Date.now();
    cx.spawn(async (cx) => {
      try {
        if (this.live === null) this.live = await livePictures();
        if (started - this.lastRender > SETTINGS.scanEveryMs * 2.5) {
          this.feed?.stop();
          this.feed = null;
          this.found = null;
          return;
        }
        const d = await discover(this.machine);
        this.os = d.os;
        const s = d.sessions.find((x) => x.session === this.session && (!this.dir || x.dir === this.dir)) ?? null;
        this.ended = !s;
        this.lookupError = null;
        const same = s && this.found && s.pid === this.found.pid && s.port === this.found.port;
        if (!same) {
          this.feed?.stop();
          this.feed = null;
          this.found = null;
          // Another daemon under this name is another browser: start by only watching it.
          this.control = false;
          if (s?.port) {
            const m = this.machine ? (await remoteMachines()).find((x) => x.name === this.machine) : { name: null };
            if (!m) throw new Error(`${this.machine} is not one of Herdr's machines`);
            this.feed = new Feed(`${this.copy}-${slug(sessionKey(this.machine, s))}`, connector(m, s.port), SETTINGS.viewerFps, this.live).start(cx);
          }
          // Only now: a failed machine lookup above leaves it unset, so the next scan tries again.
          this.found = s;
        }
        if (this.feed) await this.feed.frames.keepAlive(cx, KEEP_MS);
      } catch (e) {
        this.lookupError = reason(e);
      } finally {
        this.scanning = false;
        cx.notify();
      }
    });
  }

  close() {
    this.feed?.stop();
    this.feed = null;
  }

  say(text, cx) {
    this.note = { text, at: Date.now() };
    cx.notify();
    cx.timer.after(4000, (cx) => {
      if (this.note && Date.now() - this.note.at >= 3900) this.note = null;
      cx.notify();
    });
  }

  act(body, cx) {
    const feed = this.feed;
    if (!feed) return;
    cx.spawn(async (cx) => {
      try { await feed.command(body); } catch (e) { this.say(`${body.action}: ${reason(e)}`, cx); }
    });
  }

  navigate(text, cx) {
    const url = normalizeUrl(text);
    if (url) this.act({ action: "navigate", url }, cx);
  }

  // Stills only: after input settles, show what it did.
  poke(cx) {
    if (!this.feed || this.feed.live) return;
    const n = ++this.pokes;
    cx.timer.after(600, (cx) => {
      if (n === this.pokes) this.feed?.refresh(cx);
    });
  }

  mouse(e, eventType, button) {
    const page = this.feed?.page;
    if (!this.control || !page) return;
    // A release, or a drag, outside the page still has to reach it.
    const clamp = eventType === "mouseReleased" || (eventType === "mouseMoved" && this.pressed);
    const at = toPage(e.local_position, e.bounds, page.width, page.height, clamp);
    if (!at) return;
    this.lastPoint = at;
    const msg = { type: "input_mouse", eventType, x: at.x, y: at.y, button, modifiers: cdpModifiers(e.modifiers, this.os) };
    if (eventType !== "mouseMoved") msg.clickCount = Math.max(1, e.click_count ?? 1);
    this.feed.send(msg, eventType === "mouseMoved");
  }

  screen(t) {
    const feed = this.feed;
    const st = this.found ? statusOf(t, feed, this.found) : null;
    const message = this.lookupError
      ? this.lookupError
      : this.ended
        ? `${this.session} has ended.`
        : !feed || feed.frames.empty
          ? st?.text ?? "looking…"
          : null;
    return div()
      .id("ab-screen")
      .relative()
      .flex_1()
      .min_h(0)
      .bg(t.canvas)
      .track_focus(this.h)
      .when(this.control, (el) => el.cursor_pointer())
      .children(feed ? feed.frames.view() : [])
      .when(Boolean(message), (el) =>
        el.child(h_flex().absolute().inset_0().items_center().justify_center().px(20).text_size(12.5).text_color(t.dim).child(message)))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        this.h.focus();
        this.pressed = "left";
        this.mouse(e, "mousePressed", "left");
      })
      .on_mouse_up("left", (e, cx) => {
        this.pressed = null;
        this.mouse(e, "mouseReleased", "left");
        this.poke(cx);
      })
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        this.mouse(e, "mousePressed", "right");
      })
      .on_mouse_up("right", (e, cx) => {
        this.mouse(e, "mouseReleased", "right");
        this.poke(cx);
      })
      // No release arrives once the pointer has left: end the drag where it left.
      .on_hover((inside) => {
        if (inside || !this.pressed || !this.lastPoint || !this.control) return;
        this.feed?.send({ type: "input_mouse", eventType: "mouseReleased", ...this.lastPoint, button: this.pressed, clickCount: 1 });
        this.pressed = null;
      })
      .on_mouse_move((e) => {
        const now = Date.now();
        if (now - this.lastMove < 33) return;
        this.lastMove = now;
        this.mouse(e, "mouseMoved", this.pressed ?? "none");
      })
      .on_scroll_wheel((e, cx) => {
        const page = this.feed?.page;
        if (!this.control || !page) return;
        const at = toPage(e.local_position, e.bounds, page.width, page.height);
        if (!at) return;
        cx.stop_propagation();
        // GPUI's wheel delta is positive scrolling up; the page's is positive scrolling down.
        this.feed.send({ type: "input_mouse", eventType: "mouseWheel", x: at.x, y: at.y, deltaX: -e.delta.x, deltaY: -e.delta.y, modifiers: cdpModifiers(e.modifiers, this.os) });
        this.poke(cx);
      })
      .on_key_down((e, cx) => {
        if (!this.control || !this.feed) return;
        cx.stop_propagation();
        if (e.keystroke === "cmd-v" || e.keystroke === "ctrl-v") {
          for (const m of textMessages(cx.read_from_clipboard())) this.feed.send(m);
        } else {
          for (const m of keyMessages(e, this.os)) this.feed.send(m);
        }
        this.poke(cx);
      });
  }

  render(cx) {
    this.lastRender = Date.now();
    const t = theme();
    const feed = this.feed;
    const current = feed?.url ?? feed?.activeTab?.url ?? this.found?.url ?? "";
    // Follow the page's address unless it is being edited.
    if (current && this.url.value() === this.shownUrl && current !== this.shownUrl) {
      this.url.set_value(current);
      this.shownUrl = current;
    }
    const st = this.found ? statusOf(t, feed, this.found) : { color: t.dim, text: "looking…" };
    const live = feed?.phase === "live";
    const tabs = feed?.tabs ?? [];
    const closing = Date.now() - this.armedClose < 3000;

    const header = h_flex()
      .h(42)
      .flex_none()
      .px(10)
      .gap(6)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(svg(ICON).size(14).text_color(t.accent))
      .child(div().flex_none().font_semibold().text_size(13).child(this.session))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(this.machine ?? "this computer"))
      .child(div().w(4))
      .child(button(t, "ab-back", "‹", (cx) => this.act({ action: "back" }, cx), { tip: "Back" }))
      .child(button(t, "ab-forward", "›", (cx) => this.act({ action: "forward" }, cx), { tip: "Forward" }))
      .child(button(t, "ab-reload", "↻", (cx) => this.act({ action: "reload" }, cx), { tip: "Reload" }))
      .child(
        h_flex()
          .id("ab-url")
          .flex_1()
          .min_w(80)
          .h(26)
          .px(8)
          .items_center()
          .rounded(7)
          .border_1()
          .border_color(t.border)
          .bg(t.background)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.url).flex_1().h_full().text_size(12).text_color(t.foreground)),
      )
      .child(button(t, "ab-control", this.control ? "controlling" : "watching", (cx) => {
        this.control = !this.control;
        if (this.control) this.h.focus();
        cx.notify();
      }, { on: this.control, tip: this.control ? "Clicks and keys go to the page. Click to only watch." : "Take control: clicks and keys go to the page" }))
      .when(feed?.live === false, (el) => el.child(button(t, "ab-still", "◉", (cx) => feed.refresh(cx), { tip: "Show the page as it is now" })))
      .child(button(t, "ab-open", "↗", (cx) => {
        if (/^https?:\/\//.test(current)) cx.open_url(current);
      }, { tip: "Open this address in your browser" }))
      .child(button(t, "ab-end", closing ? "end it?" : "end", (cx) => {
        if (closing) {
          this.armedClose = 0;
          this.act({ action: "close" }, cx);
        } else {
          this.armedClose = Date.now();
          cx.timer.after(3100, (cx) => cx.notify());
        }
        cx.notify();
      }, { danger: closing, tip: "Close this browser session" }))
      .child(closeButton(t) ?? div());

    const tabStrip = tabs.length > 1
      ? h_flex()
        .h(30)
        .flex_none()
        .px(10)
        .gap(4)
        .items_center()
        .bg(t.chrome)
        .border_b(1)
        .border_color(t.border)
        .children(tabs.map((tab) =>
          h_flex()
            .id(`ab-tabs-${tab.tabId}`)
            .h(22)
            .px(8)
            .max_w(220)
            .items_center()
            .rounded(6)
            .text_size(11.5)
            .bg(tab.active ? t.selected : t.chrome)
            .text_color(tab.active ? t.foreground : t.muted)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => this.act({ action: "tab_switch", tabId: tab.tabId }, cx))
            .child(div().truncate().child(tab.title || host(tab.url) || tab.tabId))))
      : null;

    const log = feed?.activity ?? [];
    const footer = v_flex()
      .flex_none()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .when(this.showLog, (el) =>
        el.child(
          v_flex()
            .max_h(180)
            .id("ab-log")
            .overflow_y_scrollbar()
            .px(10)
            .py(6)
            .gap(2)
            .children(log.slice(0, 30).map((a, i) =>
              h_flex()
                .id(`ab-log-${i}`)
                .gap(8)
                .text_size(11.5)
                .child(div().w(40).flex_none().text_color(t.dim).child(ago(Date.now() - a.at)))
                .child(div().flex_1().truncate().text_color(t.foreground).child(a.text))
                .child(div().flex_none().text_color(t.dim).child(a.done ? (a.ms != null ? `${a.ms} ms` : "done") : "…"))))))
      .child(
        h_flex()
          .id("ab-status")
          .h(26)
          .px(10)
          .gap(8)
          .items_center()
          .text_size(11.5)
          .text_color(t.dim)
          .cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            this.showLog = !this.showLog;
            cx.notify();
          })
          .child(dot(st.color))
          .child(div().flex_none().child(live ? (feed.live ? `${feed.rate} fps` : "still") : st.text))
          .child(div().flex_1().truncate().child(this.note ? this.note.text : this.live === false ? STILLS : log[0] ? `→ ${log[0].text} · ${ago(Date.now() - log[0].at)}` : "no agent commands yet"))
          .child(div().flex_none().child(this.showLog ? "▾ activity" : "▸ activity")),
      );

    return v_flex()
      .id("ab-viewer")
      .size_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .child(header)
      .child(tabStrip ?? div())
      .child(this.screen(t))
      .child(footer);
  }
}

export default class AgentBrowser extends View {
  init(_p, cx) {
    const p = props() ?? {};
    this.impl = p.view === "viewer" && p.session ? new Viewer() : new Overview();
    this.impl.init(cx, p);
  }

  render(cx) {
    return this.impl.render(cx);
  }

  async close() {
    this.impl.close();
  }
}
