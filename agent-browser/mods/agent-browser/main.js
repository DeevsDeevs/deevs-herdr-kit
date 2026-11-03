// Agent browser: every agent-browser session on this computer and on Herdr's
// other machines, live. The overview is a grid of cards; a card opens the
// session in its own window (or a tab), where you can watch it or take control.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, theme, settings, props, openOverlay, closeOverlay, updates, readTextFile, appHome } from "herdr";
import { DISCOVER, parseDiscovery, sessionKey, slug, host, brief, ago, normalizeUrl, loopback, toPage, cdpModifiers, keyMessages, textMessages } from "./lib.js";
import { SETTINGS } from "./settings.js";
import { remoteMachines, connector, pageTunnel } from "./connect.js";
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
const NO_PAINT_MS = 6000;
// A machine that hasn't answered by then shows as not answering; its stuck call
// is asked again only once a minute, so stuck calls don't pile up.
const SLOW_MS = 8000;
const RETRY_MS = 60 * 1000;

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

const STILLS = "Stills, not live: Herdr 0.1.11 keeps every picture it shows in memory, and the fix is not released yet. Pictures update after you click or type.";

async function discover(name) {
  const r = await exec("sh", ["-c", DISCOVER], name ? { on: name } : {});
  const found = parseDiscovery(r.stdout);
  if (r.code !== 0 && !found.sessions.length) throw new Error(r.stderr.trim() || `exit ${r.code}`);
  return found;
}

const icon = (name) => svg(`mods/agent-browser/${name}.svg`);

// A press on a control is not a window drag.
function control(el, onClick) {
  return el
    .cursor_pointer()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    });
}

function iconButton(t, id, name, onClick, tip) {
  return control(
    h_flex()
      .id(id)
      .size(28)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .child(icon(name).size(15)),
    onClick,
  );
}

function textButton(t, id, label, onClick, { solid = false, danger = false } = {}) {
  return control(
    h_flex()
      .id(id)
      .h(26)
      .px(12)
      .flex_none()
      .items_center()
      .rounded(6)
      .text_size(12)
      .bg(danger ? t.blocked : solid ? t.solid : t.raised)
      .text_color(danger ? "#ffffff" : solid ? t.solid_foreground : t.foreground)
      .hover((s) => (danger || solid ? s.opacity(0.9) : s.bg(t.hover)))
      .child(label),
    onClick,
  );
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
    // agent-browser only sends a picture when Chrome paints: a hidden headed window or an idle page after a resize never does.
    if (!age && Date.now() - feed.liveAt > NO_PAINT_MS) return { color: t.idle, text: "no picture: the page hasn't painted (hidden window or idle page)" };
    return { color: t.working, text: !age ? `${kind} · waiting for a frame` : age === "now" ? `${kind} · now` : `${kind} · frame ${age} old` };
  }
  if (feed.phase === "error") return { color: t.blocked, text: feed.error ?? "disconnected" };
  return { color: t.idle, text: "connecting…" };
}

function closeButton(t, tip = "Close") {
  const overlay = props()?.overlay;
  return overlay ? iconButton(t, "ab-close", "x", () => closeOverlay(overlay), tip) : null;
}

class Overview {
  init(cx) {
    this.copy = newId();
    this.machines = [];
    this.hover = null;
    this.results = new Map();
    this.asking = new Map();
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
        this.list = list;
        for (const key of this.results.keys()) if (!list.some((m) => m.name === key)) this.results.delete(key);
        for (const m of list) this.ask(cx, m);
        this.othersError = othersError;
        this.scanned = true;
        this.publish(cx, started);
      } finally {
        this.scanning = false;
        cx.notify();
      }
    });
  }

  // Each machine answers on its own, so one stuck link holds back only its own section.
  ask(cx, m) {
    if (m.state !== "connected") {
      // A call stuck on the old link is dropped: a reconnected machine is asked straight away.
      this.asking.delete(m.name);
      this.results.set(m.name, { ...m, sessions: [], error: String(m.state).replace(/_/g, " ") });
      return;
    }
    const now = Date.now();
    const prev = this.asking.get(m.name);
    if (prev && now - prev.at < RETRY_MS) {
      if (now - prev.since > SLOW_MS) this.results.set(m.name, { ...m, sessions: [], slow: true, error: `not answering for ${ago(now - prev.since)}` });
      return;
    }
    const ask = { since: prev?.since ?? now, at: now };
    this.asking.set(m.name, ask);
    cx.spawn(async (cx) => {
      let r;
      try {
        const d = await discover(m.name);
        r = { ...m, os: d.os, sessions: d.sessions, error: null };
      } catch (e) {
        r = { ...m, sessions: [], error: reason(e) };
      }
      if (this.asking.get(m.name) === ask) this.asking.delete(m.name);
      if (this.list?.some((x) => x.name === m.name)) this.results.set(m.name, r);
      this.publish(cx, Date.now());
    });
  }

  publish(cx, started) {
    this.machines = (this.list ?? []).map((m) => this.results.get(m.name) ?? { ...m, sessions: [], waiting: true, error: null });
    // A card that vanished under the pointer never hears it leave.
    if (this.hover && !this.machines.some((m) => m.sessions.some((s) => slug(sessionKey(m.name, s)) === this.hover))) this.hover = null;
    this.sync(cx, started);
    cx.notify();
  }

  // Cards stream only while they are drawn: every scan and every machine's
  // answer ends in a notify, so a shown overview renders at least once between
  // two scans, and one that hasn't for a few is hidden.
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
    const hovered = this.hover === id;
    const healthy = st.color === t.working;
    const title = feed?.title || host(url) || brief(url) || "—";
    // The host only when the title doesn't already say it.
    const site = host(url)?.split(".").slice(-2)[0]?.toLowerCase();
    const where = site && !title.toLowerCase().includes(site) ? host(url) : null;
    return control(
      v_flex()
        .id(`ab-card-${id}`)
        .w(w)
        .flex_none()
        .gap(8)
        .on_hover((inside, cx) => {
          if (inside) this.hover = id;
          else if (this.hover === id) this.hover = null;
          cx.notify();
        })
        .child(
          div()
            .relative()
            .w_full()
            .h(Math.round(w * 0.5625))
            .rounded(8)
            .overflow_hidden()
            .border_1()
            .border_color(hovered ? t.accent : t.border)
            .bg(t.canvas)
            .children(feed ? feed.frames.view() : [])
            .when(!feed || feed.frames.empty, (el) =>
              el.child(h_flex().absolute().inset_0().items_center().justify_center().px(16).text_size(11.5).text_color(t.dim).child(st.text)))
            .when(hovered, (el) => el.child(
              control(
                h_flex()
                  .id(`ab-tab-${id}`)
                  .absolute()
                  .top(6)
                  .right(6)
                  .size(28)
                  .items_center()
                  .justify_center()
                  .rounded(6)
                  .bg(t.popover)
                  .border_1()
                  .border_color(t.border)
                  .shadow_sm()
                  .text_color(t.foreground)
                  .hover((x) => x.bg(t.hover))
                  .tooltip("Open as a tab")
                  .child(icon("app-window").size(14)),
                () => this.open(m, s, true),
              ))),
        )
        .child(
          v_flex()
            .px(2)
            .gap(2)
            .child(
              h_flex()
                .gap(7)
                .items_center()
                .when(!healthy, (el) => el.child(dot(st.color)))
                .child(div().flex_none().font_semibold().text_size(12.5).text_color(t.foreground).child(s.session))
                .when(Boolean(s.namespace), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(s.namespace)))
                .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(where ? `${title} · ${where}` : title)))
            .child(div().min_h(16).truncate().text_size(11.5).text_color(st.color === t.blocked && feed && !feed.frames.empty ? t.blocked : t.dim).child(
              !healthy && feed && !feed.frames.empty ? st.text : last ? `${last.text} · ${ago(Date.now() - last.at)}` : "")),
        ),
      () => this.open(m, s, false),
    );
  }

  render(cx) {
    this.lastRender = Date.now();
    const t = theme();
    const zoom = settings().zoom || 1;
    const width = (this.width || 900) / zoom;
    const inner = Math.max(MIN_CARD, width - 2 * 18);
    const cols = Math.max(1, Math.floor((inner + GAP) / (MIN_CARD + GAP)));
    const cardW = Math.floor((inner - GAP * (cols - 1)) / cols);
    const total = this.machines.reduce((n, m) => n + m.sessions.length, 0);

    const label = (m) => m.name ?? "this computer";
    // A dot only when a machine needs a look: still answering, slow, or failing.
    const section = (m) =>
      v_flex()
        .gap(10)
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .text_size(12)
            .when(Boolean(m.waiting || m.slow || m.error), (el) => el.child(dot(m.waiting || m.slow ? t.idle : t.blocked)))
            .child(div().font_semibold().text_color(t.foreground).child(label(m)))
            .child(div().text_color(t.dim).child(m.waiting ? "looking…" : m.error ? m.error : `${m.sessions.length}`)),
        )
        .when(m.sessions.length > 0, (el) =>
          el.child(h_flex().flex_wrap().gap(GAP).children(m.sessions.map((s) => this.card(t, m, s, cardW)))));
    const shown = this.machines.filter((m) => m.sessions.length || m.waiting || m.slow || m.error);
    const idle = this.machines.filter((m) => !shown.includes(m));

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
          .h(48)
          .flex_none()
          .pl(16)
          .pr(10)
          .gap(10)
          .items_center()
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .child(svg(ICON).size(15).text_color(t.muted))
          .child(div().flex_none().font_semibold().text_size(13).child("Agent browsers"))
          .child(div().flex_none().text_size(12).text_color(t.muted).child(this.scanned ? `${total} ${total === 1 ? "session" : "sessions"}` : "looking…"))
          .child(div().flex_1())
          .when(Boolean(this.othersError), (el) => el.child(div().min_w(0).text_size(11.5).text_color(t.blocked).truncate().child(this.othersError)))
          .child(closeButton(t, "Close  Esc") ?? div()),
      )
      .when(this.live === false, (el) =>
        el.child(h_flex().flex_none().px(16).py(8).gap(8).items_start().text_size(11.5).text_color(t.muted).bg(t.raised)
          .child(icon("camera").size(13).text_color(t.dim))
          .child(div().flex_1().min_w(0).child(`${STILLS} Each card shows its first frame.`))))
      .child(
        v_flex()
          .id("ab-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(18)
          .gap(22)
          .when(this.scanned && total === 0, (el) =>
            el.child(
              v_flex()
                .gap(8)
                .py(32)
                .items_center()
                .child(svg(ICON).size(22).text_color(t.dim))
                .child(div().text_size(13).text_color(t.muted).child("No agent browsers running"))
                .child(div().text_size(12).text_color(t.dim).child("They show up here as soon as an agent runs agent-browser open <url>.")),
            ))
          .children(shown.map(section))
          .when(this.scanned && total > 0 && idle.length > 0, (el) =>
            el.child(div().text_size(12).text_color(t.dim).child(`Nothing running on ${idle.map(label).join(", ")}`))),
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
    this.feed = null;
    this.found = null;
    this.os = null;
    this.ended = false;
    this.control = false;
    this.note = null;
    this.confirmEnd = false;
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
          // Another daemon under this name is another browser: start by only watching it, unasked.
          this.control = false;
          this.confirmEnd = false;
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

  say(text, cx, error = true) {
    this.note = { text, at: Date.now(), error };
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

  // A remote browser's localhost is that machine's: go there through a tunnel.
  openHere(url, cx) {
    if (!/^https?:\/\//.test(url)) return;
    const local = this.machine ? loopback(url) : null;
    if (!local) return cx.open_url(url);
    this.say(`opening ${local.scheme}://127.0.0.1:${local.port} on ${this.machine} through ssh…`, cx, false);
    cx.spawn(async (cx) => {
      try {
        const m = (await remoteMachines()).find((x) => x.name === this.machine);
        if (!m) throw new Error(`${this.machine} is not one of Herdr's machines`);
        const port = await pageTunnel(cx, m, local.port);
        cx.open_url(`${local.scheme}://127.0.0.1:${port}${local.rest}`);
        this.note = null;
        cx.notify();
      } catch (e) {
        this.say(`open: ${reason(e)}`, cx);
      }
    });
  }

  navigate(text, cx) {
    const url = normalizeUrl(text);
    if (url) this.act({ action: "navigate", url }, cx);
  }

  poke(cx) {
    this.feed?.settle(cx);
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
      .when(this.control, (el) => el.child(div().absolute().inset_0().border_2().border_color(t.accent)))
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
    const st = this.found ? statusOf(t, feed, this.found) : { color: t.dim, text: this.ended ? "ended" : "looking…" };
    const live = feed?.phase === "live";
    const tabs = feed?.tabs ?? [];
    const segment = (id, name, label, on, tip) =>
      control(
        h_flex()
          .id(id)
          .h(24)
          .px(9)
          .gap(6)
          .items_center()
          .rounded(5)
          .text_size(12)
          .when(on, (el) => el.bg(t.surface).shadow_sm())
          .text_color(on ? t.foreground : t.muted)
          .hover((x) => x.text_color(t.foreground))
          .tooltip(tip)
          .child(icon(name).size(13).when(on && name === "mouse-pointer", (el) => el.text_color(t.accent)))
          .child(label),
        (cx) => {
          if (this.control === (name === "mouse-pointer")) return;
          this.control = !this.control;
          if (this.control) this.h.focus();
          cx.notify();
        },
      );

    const header = h_flex()
      .h(48)
      .flex_none()
      .pl(16)
      .pr(10)
      .gap(4)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(svg(ICON).flex_none().size(15).text_color(t.muted))
      .child(h_flex().min_w(0).ml(6).mr(6).gap(6).items_center().text_size(12)
        .child(div().min_w(0).truncate().font_semibold().text_size(13).child(this.session))
        .child(div().flex_none().text_color(t.muted).child(this.machine ?? "this computer")))
      .child(iconButton(t, "ab-back", "chevron-left", (cx) => this.act({ action: "back" }, cx), "Back"))
      .child(iconButton(t, "ab-forward", "chevron-right", (cx) => this.act({ action: "forward" }, cx), "Forward"))
      .child(iconButton(t, "ab-reload", "rotate-cw", (cx) => this.act({ action: "reload" }, cx), "Reload"))
      .child(
        h_flex()
          .id("ab-url")
          .flex_1()
          .min_w(140)
          .h(28)
          .mx(4)
          .px(10)
          .items_center()
          .rounded(6)
          .border_1()
          .border_color(t.border)
          .bg(t.background)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.url).flex_1().h_full().text_size(12).text_color(t.foreground)),
      )
      .child(h_flex().flex_none().mx(4).p(2).gap(2).rounded(7).bg(t.raised)
        .child(segment("ab-watch", "eye", "Watch", !this.control, "Only watch the page"))
        .child(segment("ab-control", "mouse-pointer", "Control", this.control, "Clicks and keys go to the page")))
      .when(feed?.live === false, (el) => el.child(iconButton(t, "ab-still", "camera", (cx) => feed.refresh(cx), "Show the page as it is now")))
      .child(iconButton(t, "ab-open", "external-link", (cx) => this.openHere(current, cx), "Open in your browser"))
      .when(!this.ended, (el) => el.child(iconButton(t, "ab-end", "power", (cx) => {
        this.confirmEnd = !this.confirmEnd;
        cx.notify();
      }, "End this session")))
      .child(closeButton(t) ?? div());

    // Asked in place, not through Herdr's confirm: that runs a global command every open viewer would hear.
    const confirmBar = this.confirmEnd && !this.ended
      ? h_flex()
        .h(44)
        .flex_none()
        .pl(16)
        .pr(10)
        .gap(8)
        .items_center()
        .bg(t.raised)
        .border_b(1)
        .border_color(t.border)
        .text_size(12)
        .child(icon("power").flex_none().size(14).text_color(t.blocked))
        .child(div().flex_1().min_w(0).truncate().child(`End ${this.session}? Its browser closes for the agent too.`))
        .child(textButton(t, "ab-end-cancel", "Cancel", (cx) => {
          this.confirmEnd = false;
          cx.notify();
        }))
        .child(textButton(t, "ab-end-confirm", "End session", (cx) => {
          this.confirmEnd = false;
          this.act({ action: "close" }, cx);
          cx.notify();
        }, { danger: true }))
      : null;

    const tabStrip = tabs.length > 1
      ? h_flex()
        .h(34)
        .flex_none()
        .px(10)
        .gap(4)
        .items_center()
        .bg(t.chrome)
        .border_b(1)
        .border_color(t.border)
        .children(tabs.map((tab) =>
          control(
            h_flex()
              .id(`ab-tabs-${tab.tabId}`)
              .h(24)
              .px(10)
              .max_w(220)
              .items_center()
              .rounded(6)
              .text_size(12)
              .when(tab.active, (el) => el.bg(t.selected))
              .text_color(tab.active ? t.foreground : t.muted)
              .hover((x) => x.bg(tab.active ? t.selected : t.hover).text_color(t.foreground))
              .child(div().truncate().child(tab.title || host(tab.url) || tab.tabId)),
            (cx) => this.act({ action: "tab_switch", tabId: tab.tabId }, cx),
          )))
      : null;

    const log = feed?.activity ?? [];
    const status = live ? (!feed.live ? "still" : feed.rate ? `live · ${feed.rate} fps` : "live") : st.text;
    const problem = this.note ?? (feed?.phase === "error" ? { text: st.text, error: true } : null);
    const footer = v_flex()
      .flex_none()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .when(this.showLog && log.length > 0, (el) =>
        el.child(
          v_flex()
            .max_h(180)
            .id("ab-log")
            .overflow_y_scrollbar()
            .px(16)
            .py(8)
            .gap(3)
            .border_b(1)
            .border_color(t.border)
            .children(log.slice(0, 30).map((a, i) =>
              h_flex()
                .id(`ab-log-${i}`)
                .gap(10)
                .text_size(12)
                .child(div().w(36).flex_none().text_color(t.dim).child(ago(Date.now() - a.at)))
                .child(div().flex_1().truncate().text_color(t.foreground).child(a.text))
                .child(div().flex_none().text_color(t.dim).child(a.done ? (a.ms != null ? `${a.ms} ms` : "done") : "…"))))))
      .child(control(
        h_flex()
          .id("ab-status")
          .h(30)
          .pl(16)
          .pr(10)
          .gap(8)
          .items_center()
          .text_size(12)
          .hover((x) => x.bg(t.hover))
          .child(h_flex().id("ab-state").size(16).flex_none().items_center().justify_center().tooltip(status).child(dot(st.color)))
          .child(div().flex_1().min_w(0).truncate()
            .text_color(problem?.error ? t.blocked : problem ? t.muted : t.dim)
            .child(problem ? problem.text : log[0] ? `${log[0].text} · ${ago(Date.now() - log[0].at)}` : ""))
          .when(log.length > 0, (el) => el.child(h_flex().flex_none().gap(6).items_center().text_color(this.showLog ? t.foreground : t.muted)
            .child("Activity")
            .child(div().text_color(t.dim).child(String(Math.min(log.length, 30))))
            .child(icon(this.showLog ? "chevron-down" : "chevron-up").size(13)))),
        (cx) => {
          this.showLog = !this.showLog;
          cx.notify();
        },
      ));

    return v_flex()
      .id("ab-viewer")
      .size_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .child(header)
      .child(confirmBar ?? div())
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
