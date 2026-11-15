// Board: every area at once, a lane per area and a column per state, drawn from taskModel() alone.
// It keeps no grouping, no settings and no actions of its own: a card goes into the task, a member
// chip or the question into the task with that agent open; a right-click opens the list's menu.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { statusMark, rowMark, wordColor, duration } from "./marks.js";
import { machineOf, localId, quietWords, GROUPS, ROW_MARKS } from "./model.js";
import { shared } from "herdr";

// The list's groups in the list's order, Needs you first: pinned is not a state and Earlier folds
// into the area's line.
export const COLUMNS = GROUPS.filter((g) => g.id !== "pinned" && g.id !== "earlier");
// The column you act in gets room for the question; the others keep room for a short title.
export const NEEDS_W = 220;
export const COLUMN_W = 120;

// Per area, the window's own area (first) first, then the model's order: its items by column, how many folded into Earlier, and whether
// it keeps the (empty) place for a Todo column. Items of an area the settings no longer list are dropped.
export function lanes(m, first = null) {
  const areas = [...m.areas.filter((a) => a.id === first), ...m.areas.filter((a) => a.id !== first)];
  return areas.map((area) => {
    const own = m.items.filter((i) => i.area === area.id);
    const columns = Object.fromEntries(COLUMNS.map((c) => [c.id, own.filter((i) => i.state === c.id)]));
    return { area, columns, earlier: own.filter((i) => i.state === "earlier").length, todo: Boolean(area.todo) };
  });
}

// The machines a task runs on other than its area's home: "mac", "mac +1", or null.
export function awayFrom(item, home, here) {
  const others = (item.machines ?? [item.machine]).filter((x) => (x ?? null) !== (home ?? null)).map((x) => x ?? here);
  return others.length > 1 ? `${others[0]} +${others.length - 1}` : others[0] ?? null;
}

const nameOf = (t) => t.name || localId(t.address);

// Who asks, in the card's words: the lead, or the worker by name.
export function askerOf(item) {
  const by = item.need?.by;
  if (!by || by === item.lead?.address) return "Lead";
  const t = item.tree?.find((r) => r.t.address === by)?.t;
  return t ? nameOf(t) : by;
}

function press(el, act) {
  return el.cursor_pointer()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      act(cx);
    });
}

// One "Hide text" and one row-mark variant for every view, as the list keeps them.
const hideText = () => shared("agent-tower.hideText") === true;
const rowMarkVariant = () => (ROW_MARKS.includes(shared("agent-tower.rowMark")) ? shared("agent-tower.rowMark") : ROW_MARKS[0]);

// t: theme, m: taskModel(), ui: the stage's {now, selectedKey, goInto(item, {agent}), onMenu(el, thing), here, ...}.
export function render(t, m, ui) {
  const all = lanes(m, ui.area);
  const todo = all.some((l) => l.todo);
  const count = (id) => all.reduce((n, l) => n + l.columns[id].length, 0);
  const cell = (id) => (el) => (id === "needs" ? el.flex_1().flex_grow(1.5).min_w(NEEDS_W) : el.flex_1().min_w(COLUMN_W));
  return v_flex().id("board").size_full().overflow_y_scrollbar().bg(t.background).text_color(t.foreground).text_size(13)
    .px(14).pb(14).gap(14)
    .child(h_flex().pt(10).gap(10).flex_none()
      .when(todo, (el) => el.child(header(t, "Todo", null, 0).flex_1().min_w(COLUMN_W)))
      .children(COLUMNS.map((c) => cell(c.id)(header(t, c.label, c.status, count(c.id))))))
    .children(all.map((lane) => laneRow(t, lane, todo, cell, ui)));
}

function header(t, word, mark, n) {
  const hot = mark === "blocked" && n > 0;
  return h_flex().h(24).px(4).gap(6).items_center().text_size(12).font_semibold()
    .text_color(hot ? t.blocked : t.muted)
    .child(word)
    .child(div().font_weight(400).text_color(hot ? t.blocked : t.dim).child(n ? String(n) : ""));
}

function laneRow(t, lane, todo, cell, ui) {
  const { area, columns } = lane;
  const waiting = columns.needs.length;
  const column = (id, cards) => v_flex().id(`col-${area.id}-${id}`).min_h(56).gap(8).p(6).rounded(10)
    .bg(id === "needs" && cards.length ? t.blocked + "14" : t.surface + "80")
    .children(cards);
  // The area's line above its columns: name, the list's red count (the same number), what is folded.
  return v_flex().flex_none().gap(6)
    .child(h_flex().h(22).gap(7).items_center().text_size(11.5).text_color(t.dim)
      .child(ui.onMenu(div().id(`lane-${area.id}`).flex_none().text_size(14).font_semibold().text_color(t.foreground).child(area.label), { area: area.id }))
      .when(waiting > 0, (el) => el.child(div().flex_none().h(16).px(5).rounded(5).bg(t.blocked + "26").text_size(10.5)
        .font_bold().text_color(t.blocked).flex().items_center().child(String(waiting))))
      .child(div().min_w(0).truncate().child(lane.earlier ? `${lane.earlier} earlier` : "")))
    .child(h_flex().items_stretch().gap(10)
      // shortcut: the Todo column is an empty place until a dispatcher pulls cards into it.
      .when(todo, (el) => el.child(column("todo", []).flex_1().min_w(COLUMN_W)))
      .children(COLUMNS.map((c) => cell(c.id)(column(c.id, columns[c.id].map((i) => card(t, i, area, ui)))))));
}

function card(t, item, area, ui) {
  const selected = ui.selectedKey === item.key;
  const word = item.word;
  const away = awayFrom(item, area.home, ui.here);
  const workers = item.tree?.length ?? 0;
  const meta = [away, workers ? `${workers} worker${workers > 1 ? "s" : ""}` : null, item.changed ? duration(ui.now - item.changed) : null]
    .filter(Boolean).join(" · ");
  const need = item.need;
  return ui.onMenu(press(v_flex().id(`card-${item.key}`).flex_none().gap(5).p(9).rounded(8).border_1()
    .bg(selected ? t.selected : t.background)
    .border_color(need ? t.blocked + "99" : selected ? t.input : t.border)
    .hover((s) => s.border_color(t.input))
    .child(h_flex().gap(7).items_start()
      .child(rowMark(t, item, word, rowMarkVariant()))
      .child(div().flex_1().min_w(0).whitespace_normal().font_semibold().text_color(word === "idle" && !selected ? t.muted : t.foreground)
        .child(item.title)))
    .when(Boolean(meta), (el) => el.child(div().pl(25).text_size(11).text_color(t.dim).whitespace_normal().child(meta)))
    .when(Boolean(need), (el) => el.child(press(v_flex().id(`ask-${item.key}`).ml(25).gap(2).pl(8).border_l(2).border_color(t.blocked)
      .child(div().text_size(11).text_color(t.blocked).child(`${askerOf(item)} · ${need.kind}`))
      .when(Boolean(need.text) && !hideText(), (q) => q.child(div().text_size(12.5).whitespace_normal().child(need.text))),
    () => ui.goInto(item, need.by ? { agent: need.by } : undefined))))
    // Its terminals, on the selected card only: the board stays quiet, and a click on one opens it.
    .when(selected, (el) => el.child(chips(t, item, area, ui))), () => ui.goInto(item)), { task: item });
}

function chips(t, item, area, ui) {
  // Quiet members fold into one count, as in the list.
  const rows = [...(item.leadGone || !item.lead ? [] : [{ t: item.lead, status: item.word, lead: true }]), ...(item.activeTree ?? item.tree ?? [])];
  const folded = item.activeTree ? quietWords(item.quiet ?? []) : "";
  return h_flex().w_full().min_w(0).pt(2).gap(5).flex_wrap()
    .children(rows.map((r) => {
      const machine = awayFrom({ machine: machineOf(r.t.address) }, area.home, ui.here);
      const name = r.lead ? "Lead" : nameOf(r.t);
      return ui.onMenu(press(h_flex().id(`chip-${r.t.address}`).max_w_full().min_w(0).h(22).px(7).gap(5).items_center().rounded(6).border_1().border_color(t.border)
        .text_size(11.5).text_color(wordColor(t, r.status)).hover((s) => s.bg(t.hover))
        .tooltip([nameOf(r.t), machine].filter(Boolean).join(" · "))
        .child(statusMark(t, r.status))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(name)), () => ui.goInto(item, { agent: r.t.address })), { agent: r.t.address });
    }))
    .when(Boolean(folded), (el) => el.child(div().h(22).flex().items_center().text_size(11.5).text_color(t.dim).child(folded)));
}
