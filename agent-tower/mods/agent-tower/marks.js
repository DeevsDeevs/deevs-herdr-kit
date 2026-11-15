// Marks, words and colours: the one place every view (list, Board, Timeline, the headers) draws
// them from, so a lane, a card and a row never say a task's state differently.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { workingCount, duration, KINDS } from "./model.js";

export { KINDS, duration };

// A row's word (model.rowWord) in Herdr's words, and the theme key of its colour.
export const WORD = { blocked: "Needs you", stale: "Working", working: "Working", done: "Done", idle: "Idle" };
export const BADGE = { blocked: "blocked", working: "working", stale: "working", done: "done", idle: "dim" };
export const wordColor = (t, word) => t[BADGE[word]] ?? t.dim;
// The more urgent of two words.
export const RANK = { blocked: 4, done: 3, working: 2, stale: 2, idle: 1 };

export const chrome = (name) => svg(`mods/workspace-chrome/${name}.svg`);

// Herdr's status mark: working spins, idle is a ring, done a dot, blocked a "!" tile; a working
// task quiet for 20 minutes (stale) shows a still clock; nothing for no word.
export function statusMark(t, word) {
  if (word === "stale") return chrome("clock").size(12).mx(1).flex_none().text_color(t.working);
  if (word === "working") return chrome("spinner").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (word === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (word === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(4).bg(word === "done" ? t.done : t.dim + "00");
}

// The mark in a 14px column, as at the right of a row.
export const markSlot = (t, word) => h_flex().w(14).flex_none().justify_center().child(statusMark(t, word));

// What stands at the left of a task (18px): variant "state", its mark; "agents", how many of its
// agents work right now, on a working-tinted tile, in place of the spinner. A task that needs you,
// or with none working, shows its mark: a number is never red and never counts idle agents.
export function rowMark(t, item, word, variant = "state") {
  const n = variant === "state" ? 0 : workingCount(item);
  if (variant === "state" || word === "blocked" || !n) return h_flex().size(18).flex_none().items_center().justify_center().child(statusMark(t, word));
  return h_flex().size(18).flex_none().rounded(5).bg(t.working + "26").items_center().justify_center()
    .text_size(10.5).font_bold().text_color(t.working).child(String(n));
}

// The agent's icon from the app's program table: a one-colour glyph or a picture.
export function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// A machine, first in every header: the server glyph and its name (word: "mac", "this Mac").
export const machineChip = (t, word) => h_flex().flex_none().h(20).px(6).gap(5).items_center().rounded(5).bg(t.raised)
  .text_size(11.5).font_medium().text_color(t.foreground).child(chrome("server").size(12).text_color(t.muted)).child(word);
