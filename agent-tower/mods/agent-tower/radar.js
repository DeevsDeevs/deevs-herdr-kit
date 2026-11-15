// Radar: the same tasks as a scope. You sit in the middle and distance is urgency: what needs you
// is in the inner ring and creeps in the longer it waits, working tasks fly mid-field, done and
// idle ones sit at the rim and drift out as they go quiet. Each area is a sector. A blip is a
// task (taskModel's item), its mark the list's; a click goes into it, a right-click opens its menu.

import { div, v_flex, h_flex } from "./perf.js";
import { statusMark, wordColor, duration, WORD } from "./marks.js";

// The three rings, inside out, as fractions of the scope's radius. HOLE: the centre's count.
export const HOLE = 0.16;
export const RINGS = [
  { id: "needs", words: ["blocked"], from: HOLE, to: 0.42 },
  { id: "working", words: ["working", "stale"], from: 0.42, to: 0.7 },
  { id: "quiet", words: ["done", "idle", null], from: 0.7, to: 0.97 },
];
// A wait this long reaches the centre; quiet this long reaches the rim.
export const CREEP_MS = 30 * 60 * 1000;
// The question column beside the scope, when the stage is wide enough for both.
export const ASKS_W = 260;
const LABEL_W = 130;
const LABEL_H = 30;
// Narrower than this (beside the list), a label is its title alone: the mark already says the state.
export const COMPACT_W = 760;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export const ringOf = (word) => RINGS.find((r) => r.words.includes(word ?? null)) ?? RINGS[2];

// Where each task sits: angle from its area's sector and its place in it, distance from its ring
// and how long since it changed. Earlier tasks are left off the scope (counted under it).
// Returns [{item, ring, x, y, right}] in scope units (centre 0,0, radius 1; y down).
export function blips(m, now) {
  const areas = m.areas.length ? m.areas : [{ id: null }];
  const sector = (2 * Math.PI) / areas.length;
  const out = [];
  areas.forEach((area, a) => {
    const own = m.items.filter((i) => i.state !== "earlier" && (areas.length === 1 || i.area === area.id))
      .sort((x, y) => RINGS.indexOf(ringOf(x.word)) - RINGS.indexOf(ringOf(y.word)) || (x.key < y.key ? -1 : 1));
    // Tasks of one ring would sit side by side, where the inner ring has the least room: deal them
    // across the sector instead, a stride of about half of it.
    const n = own.length;
    let step = Math.ceil(n / 2);
    while (gcd(step, n) !== 1) step += 1;
    own.forEach((item, i) => {
      const k = (i * step) % n;
      // Area sectors start at the top and go clockwise; tasks spread inside, clear of the sector's
      // edges, where the ring words sit.
      const angle = -Math.PI / 2 + sector * (a + 0.1 + (0.8 * (k + 0.5)) / own.length);
      const ring = ringOf(item.word);
      const age = Math.min(1, Math.max(0, now - (item.changed || now)) / CREEP_MS);
      // Needs you comes in while it waits; the rest drift outward while nothing changes.
      const r = ring.id === "needs" ? ring.to - age * (ring.to - ring.from) : ring.from + age * (ring.to - ring.from);
      out.push({ item, ring: ring.id, x: r * Math.cos(angle), y: r * Math.sin(angle), right: Math.cos(angle) >= 0 });
    });
  });
  return out;
}

// What waits on you, the longest wait first (closest to the centre).
// Label tops (px) by item key: each side stacked top-down so no two labels overlap; a label moves
// down from its blip only as far as the one above it needs. points: [{key, y, right}].
export function stackLabels(points, h = LABEL_H) {
  const tops = new Map();
  for (const right of [true, false]) {
    let floor = -Infinity;
    for (const p of points.filter((q) => q.right === right).sort((a, b) => a.y - b.y)) {
      const top = Math.max(p.y - 9, floor);
      tops.set(p.key, top);
      floor = top + h;
    }
  }
  return tops;
}

export const asks = (m) => m.items.filter((i) => i.need && i.state !== "earlier").sort((a, b) => (a.changed || 0) - (b.changed || 0));

function press(el, act) {
  return el.cursor_pointer()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      act(cx);
    });
}

// t: theme, m: taskModel(), ui: the stage's {now, width, height, selectedKey, select(item), hideText, ...}.
export function render(t, m, ui) {
  const W = ui.width || 900;
  const H = ui.height || 640;
  const waiting = asks(m);
  const side = waiting.length > 0 && W - ASKS_W >= 480;
  const size = Math.max(240, Math.min(H - 48, (side ? W - ASKS_W : W) - 2 * LABEL_W));
  const R = size / 2;
  const cx0 = (side ? W - ASKS_W : W) / 2;
  const cy0 = H / 2;
  const at = (fx, fy) => [cx0 + fx * R, cy0 + fy * R];
  const kids = [];

  // Rings, outer first so the inner ones paint over; the needs ring is tinted while anything waits.
  for (const ring of [...RINGS].reverse()) {
    const r = ring.to * R;
    kids.push(div().absolute().left(cx0 - r).top(cy0 - r).size(2 * r).rounded_full().border_1().border_color(t.border)
      .bg(ring.id === "needs" && waiting.length ? t.blocked + "10" : ring.id === "working" ? t.surface : t.background));
  }
  // The outer rings' words at their top, just right of the sector edge that runs up the vertical
  // (the centre already says Needs you).
  for (const [ring, word] of [[RINGS[1], WORD.working], [RINGS[2], `${WORD.done} · ${WORD.idle}`]]) {
    kids.push(h_flex().absolute().left(cx0 + 6).top(cy0 - ring.to * R + 4)
      .child(div().px(5).rounded(4).bg(t.background).text_size(10.5).text_color(t.dim).child(word)));
  }
  // Sector edges and area names, when there is more than one area. A name sits just past the edge
  // its sector starts at, outside the rim, where no blip is.
  if (m.areas.length > 1) {
    m.areas.forEach((area, a) => {
      const start = -Math.PI / 2 + ((2 * Math.PI) / m.areas.length) * (a + 0.06);
      const [x, y] = at(1.05 * Math.cos(start), 1.05 * Math.sin(start));
      kids.push(ui.onMenu(div().id(`area-${area.id}`).absolute().top(y - 9).w(120).left(Math.cos(start) >= 0 ? x : x - 120)
        .child(h_flex().w_full().when(Math.cos(start) < 0, (el) => el.justify_end())
          .child(div().text_size(12.5).font_semibold().text_color(t.muted).child(area.label))), { area: area.id }));
      for (let s = 0; s < 18; s++) {
        const edge = -Math.PI / 2 + ((2 * Math.PI) / m.areas.length) * a;
        const f = HOLE + ((1 - HOLE) * (s + 0.5)) / 18;
        const [ex, ey] = at(f * Math.cos(edge), f * Math.sin(edge));
        kids.push(div().absolute().left(ex - 1).top(ey - 1).size(2).rounded_full().bg(t.border));
      }
    });
  }
  // The centre: how many wait on you, the same number as the list's red counts.
  kids.push(v_flex().id("radar-centre").absolute().left(cx0 - HOLE * R).top(cy0 - HOLE * R).size(2 * HOLE * R).rounded_full().items_center().justify_center()
    .bg(t.background).border_1().border_color(waiting.length ? t.blocked : t.border)
    .child(div().text_size(Math.max(16, HOLE * R * 0.5)).text_color(waiting.length ? t.blocked : t.dim).child(String(waiting.length)))
    .child(div().text_size(11).text_color(waiting.length ? t.blocked : t.dim).child(WORD.blocked)));

  const all = blips(m, ui.now);
  const compact = W < COMPACT_W;
  const tops = stackLabels(all.map((b) => ({ key: b.item.key, y: at(b.x, b.y)[1], right: b.right })), compact ? 18 : LABEL_H);
  // Every mark first, then every label over them on a backing, so a label stays readable where a
  // neighbour's blip runs under it.
  const drawn = all.map((b) => blip(t, b, at, ui, tops.get(b.item.key), compact));
  for (const d of drawn) kids.push(...d.marks);
  for (const d of drawn) kids.push(d.label);

  const earlier = m.items.filter((i) => i.state === "earlier").length;
  if (earlier) kids.push(div().absolute().left(14).bottom(10).text_size(11).text_color(t.dim).child(`${earlier} earlier`));

  const scope = kids.reduce((el, k) => el.child(k), div().id("radar-scope").relative().flex_1().h_full().min_w(0).overflow_hidden());
  return h_flex().id("radar").size_full().items_start().bg(t.background).text_color(t.foreground).text_size(13)
    .child(scope)
    .when(side, (el) => el.child(column(t, waiting, ui)));
}

function blip(t, b, at, ui, top, compact) {
  const { item } = b;
  const [x, y] = at(b.x, b.y);
  const selected = ui.selectedKey === item.key;
  const color = wordColor(t, item.word);
  const marks = [];
  if (selected) marks.push(div().absolute().left(x - 13).top(y - 13).size(26).rounded_full().border(2).border_color(t.foreground));
  marks.push(h_flex().absolute().left(x - 9).top(y - 9).size(18).items_center().justify_center().rounded_full()
    .bg(b.ring === "needs" ? t.background : t.background + "00").child(statusMark(t, item.word)));
  const age = item.changed ? duration(ui.now - item.changed) : null;
  const meta = [WORD[item.word] ?? null, age].filter(Boolean).join(" · ");
  const label = v_flex().id(`blip-${item.key}`).tooltip(item.title).absolute().top(top ?? y - 9).w(LABEL_W).left(b.right ? x + 9 : x - 9 - LABEL_W)
    .when(b.right, (el) => el.items_start()).when(!b.right, (el) => el.items_end())
    .child(div().max_w_full().truncate().px(3).rounded(3).bg(t.background + "e6").text_size(12).text_color(item.word === "idle" && !selected ? t.muted : t.foreground)
      .when(selected, (el) => el.font_semibold()).child(item.title))
    .when(!compact, (el) => el.child(div().max_w_full().truncate().px(3).rounded(3).bg(t.background + "e6").text_size(10.5).text_color(item.need ? t.blocked : color === t.dim ? t.dim : t.muted)
      .child(item.need ? item.need.kind : meta)));
  // The blip itself is a target too.
  marks.push(ui.onMenu(press(div().id(`dot-${item.key}`).absolute().left(x - 11).top(y - 11).size(22).rounded_full(), () => ui.goInto(item)), { task: item }));
  return { marks, label: ui.onMenu(press(label, () => ui.goInto(item)), { task: item }) };
}

// The questions beside the scope, longest wait first, so they read without opening anything; a
// click opens the agent who asks.
function column(t, waiting, ui) {
  return v_flex().id("radar-asks").w(ASKS_W).flex_none().h_full().overflow_y_scrollbar().gap(8).p(12).pl(0)
    .child(div().text_size(12).font_semibold().text_color(t.blocked).child(`${WORD.blocked} ${waiting.length}`))
    .children(waiting.map((item) => ui.onMenu(press(v_flex().id(`ask-${item.key}`).gap(3).p(9).rounded(8).border_1()
      .border_color(t.blocked + (ui.selectedKey === item.key ? "ff" : "88")).bg(ui.selectedKey === item.key ? t.selected : t.background)
      .child(div().font_semibold().whitespace_normal().child(item.title))
      .child(div().text_size(11).text_color(t.blocked).child([item.need.kind, item.changed ? duration(ui.now - item.changed) : null].filter(Boolean).join(" · ")))
      .when(Boolean(item.need.text) && !ui.hideText, (el) => el.child(div().text_size(12.5).whitespace_normal().child(item.need.text))),
    () => ui.goInto(item, item.need.by ? { agent: item.need.by } : undefined)), { task: item })));
}
