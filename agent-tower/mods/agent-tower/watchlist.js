// Watchlist: the investing area's view. The tickers kept in <tower folder>/watchlist.json, each with
// the tasks that name it, drawn from taskModel() with the list's marks; beside them the notes file
// the research leads write to, read-only. It keeps no grouping of its own and fetches nothing: no
// prices, only what is on disk. A task click selects it (Details follows).

import { div, v_flex, h_flex } from "./perf.js";
import { rowMark, WORD, wordColor, duration } from "./marks.js";
import { readTextFile, exec, window, home } from "herdr";
import { held } from "./model.js";

export const FILE = "watchlist.json";
export const NOTES = "investing-notes.md";
// Files are read again at most this often while the view is drawn.
const READ_MS = 15000;
// Two columns (tickers, notes) from this width, so the notes stay in sight beside the list too;
// narrower, they go under the tickers.
export const TWO_COLUMNS_W = 560;
// The notes shown: their newest lines (memos are appended at the end).
const NOTE_LINES = 60;

// watchlist.json: { "tickers": [{ "symbol": "VWCE", "name": "…", "note": "…" }], "notes": "<path>" }.
// Returns { tickers, notes, error }: a broken file says why instead of drawing nothing.
export function parse(text) {
  if (text == null) return { tickers: [], notes: null, error: null, missing: true };
  let own;
  try {
    own = JSON.parse(text);
  } catch (e) {
    return { tickers: [], notes: null, error: `watchlist.json isn't valid JSON: ${e.message}` };
  }
  const list = Array.isArray(own?.tickers) ? own.tickers : null;
  if (!list) return { tickers: [], notes: null, error: 'watchlist.json needs a "tickers" list' };
  const tickers = list.filter((x) => typeof x?.symbol === "string" && x.symbol.trim())
    .map((x) => ({ symbol: x.symbol.trim(), name: typeof x.name === "string" ? x.name : null, note: typeof x.note === "string" ? x.note : null }));
  return { tickers, notes: typeof own.notes === "string" ? own.notes : null, error: null };
}

// The tasks that name a ticker: its symbol as a whole word in the title, or in the lead's task.topic
// label (comma or space separated). Needs you first, then the most recently changed.
export function tasksFor(symbol, items) {
  const word = new RegExp(`(^|[^A-Za-z0-9])${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`, "i");
  const topics = (i) => (i.lead?.labels?.["task.topic"] ?? "").split(/[,\s]+/).map((s) => s.toUpperCase());
  return items.filter((i) => word.test(i.title ?? "") || topics(i).includes(symbol.toUpperCase()))
    .sort((a, b) => (b.word === "blocked") - (a.word === "blocked") || (b.changed ?? 0) - (a.changed ?? 0));
}

// The newest lines of the notes, without trailing blank ones.
export const lastLines = (text, n = NOTE_LINES) => text.replace(/\s+$/, "").split("\n").slice(-n).join("\n");

// Reads both files into ui.state when due. Parsed and cut once per read, not per render; the stage
// is told to draw again only when a file changed.
export function load(ui) {
  const s = ui.state;
  if (held(s.reading) || (s.at && ui.now - s.at < READ_MS)) return null;
  const mine = (s.reading = Date.now());
  // A read that fails (or a throw anywhere here) must not stop the next one.
  return (async () => {
    try {
      const raw = await readTextFile(`${ui.towerDir}/${FILE}`).catch(() => null);
      const own = raw === s.raw && s.own ? s.own : parse(raw);
      const notesPath = own.notes ? own.notes.replace(/^~(?=\/)/, home()) : `${ui.towerDir}/${NOTES}`;
      const text = await readTextFile(notesPath).catch(() => null);
      const changed = !s.at || raw !== s.raw || notesPath !== s.notesPath || text !== s.text;
      // The notes before the text they come from, in one assign: stopped between, the next read redoes both.
      const notes = changed ? (text == null ? null : lastLines(text)) : s.notes;
      Object.assign(s, { notes, at: Date.now(), raw, own, notesPath, text });
      if (changed) ui.notify();
    } finally {
      if (s.reading === mine) s.reading = null;
    }
  })().catch(() => null);
}

const press = (el, act) => el.cursor_pointer().on_click((_e, cx) => {
  cx.stop_propagation();
  act();
});

export function render(t, m, ui) {
  load(ui);
  const s = ui.state;
  const own = s.own;
  const wide = (ui.width ?? 0) >= TWO_COLUMNS_W;
  const tickers = v_flex().id("watchlist-tickers").min_w(0).gap(14)
    .when(wide, (el) => el.flex_1().flex_grow(1.4)).when(!wide, (el) => el.flex_none())
    .child(heading(t, "Watchlist", own?.tickers?.length ? String(own.tickers.length) : null))
    .children(!own ? [quiet(t, "Reading…")]
      : own.error ? [quiet(t, own.error, t.blocked)]
        : !own.tickers.length ? [quiet(t, "No watchlist").id("watchlist-empty").tooltip(`${ui.towerDir}/${FILE}: {"tickers":[{"symbol":"VWCE","note":"…"}]}`)]
          : own.tickers.map((x) => ticker(t, x, tasksFor(x.symbol, m.items), ui)));
  const notes = v_flex().id("watchlist-notes").min_w(0).gap(8)
    .when(wide, (el) => el.flex_1()).when(!wide, (el) => el.flex_none())
    .child(h_flex().items_center().gap(8)
      .child(heading(t, "Notes", null))
      .child(div().flex_1())
      .when(Boolean(s.notesPath), (el) => el.child(press(div().id("watchlist-open-notes").text_size(11.5).text_color(t.dim)
        .hover((st) => st.text_color(t.foreground)).tooltip(s.notesPath ?? "").child("Open in editor"),
      () => exec(window()?.platform === "macos" ? "open" : "xdg-open", [s.notesPath]).catch(() => null)))))
    .child(s.notes == null ? quiet(t, s.at ? "No notes" : "Reading…").id("watchlist-no-notes").when(Boolean(s.notesPath), (el) => el.tooltip(s.notesPath ?? ""))
      : ui.hideText ? quiet(t, "Text hidden")
        : div().p(10).rounded(8).bg(t.surface ?? t.raised).whitespace_normal().text_size(12).line_height("18px").text_color(t.muted)
          .child(s.notes));
  return v_flex().id("watchlist").size_full().min_h(0).overflow_y_scrollbar().bg(t.background).text_color(t.foreground).text_size(13)
    .px(16).pt(12).pb(16)
    .child(wide ? h_flex().items_start().gap(24).child(tickers).child(notes) : v_flex().gap(24).child(tickers).child(notes));
}

function heading(t, word, count) {
  return h_flex().h(22).gap(6).items_center().text_size(12).font_semibold().text_color(t.muted)
    .child(word).when(Boolean(count), (el) => el.child(div().font_weight(400).text_color(t.dim).child(count)));
}

const quiet = (t, text, color) => div().whitespace_normal().text_size(12).text_color(color ?? t.dim).child(text);

// One ticker: symbol, name, its note; under it the tasks that name it, or a quiet line.
function ticker(t, x, tasks, ui) {
  return v_flex().id(`ticker-${x.symbol}`).flex_none().gap(4)
    .child(h_flex().gap(8).items_center()
      .child(div().flex_none().text_size(14).font_semibold().child(x.symbol))
      .when(Boolean(x.name), (el) => el.child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(x.name))))
    .when(Boolean(x.note) && !ui.hideText, (el) => el.child(div().whitespace_normal().text_size(12).text_color(t.muted).child(x.note)))
    .children(tasks.length ? tasks.map((i) => taskRow(t, i, ui)) : [div().text_size(11.5).text_color(t.dim).child("No tasks")]);
}

// A task as the list draws it: its mark, title, word and age; the question when it waits.
function taskRow(t, item, ui) {
  const selected = ui.selectedKey === item.key;
  const age = item.changed ? duration(ui.now - item.changed) : "";
  return press(v_flex().id(`watch-${item.key}`).flex_none().px(6).py(4).gap(2).rounded(7)
    .bg(selected ? t.selected : t.background).hover((st) => st.bg(selected ? t.selected : t.hover))
    .child(h_flex().gap(7).items_center()
      .child(rowMark(t, item, item.word, ui.rowMark))
      .child(div().flex_1().min_w(0).truncate().text_color(item.word === "idle" && !selected ? t.muted : t.foreground).child(ui.hideText ? "Text hidden" : item.title))
      .child(div().flex_none().text_size(11).text_color(wordColor(t, item.word)).child(WORD[item.word] ?? ""))
      .child(div().flex_none().w(28).text_right().text_size(11).text_color(t.dim).child(age)))
    .when(Boolean(item.need?.text) && !ui.hideText, (el) => el.child(div().pl(25).whitespace_normal().text_size(12).text_color(t.blocked).child(item.need.text))),
  () => ui.select(item));
}
