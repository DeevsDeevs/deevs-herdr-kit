# Agent tower

One list of your work instead of Herdr's Spaces and Agents lists, on this computer or any
hc machine. A work item is a top-level agent and everything it started, or a task: a lead
agent and the workers that carry its id. It shows what needs you, what is done, what is
working and what is idle; anything quiet for a day folds away under Earlier, and spaces
with no agent under Spaces.
You start a task by typing what needs doing; a small model gives it a short name. The
same mod also opens as a window over any other layout.

Nothing is stored outside herdr-core and Herdr's own shared state: a task is its lead
terminal, marked with labels. The layout is `tower` and the mod `agent-tower` (they were
`tasks` and `agent-tasks`; the word "task" stays on screen and in the `task.*` labels). The
selected item is published for a second mod, `agent-tower-panel`, built separately.

## What you see

Two ways to show it, same content:

- **Docked**: the `tower` layout is Herdr's `main` layout with the sidebar's Spaces and
  Agents blocks replaced by one block holding this mod. It never takes the keyboard by
  itself.
- **Window**: `mod.open:agent-tower` (`ctrl-s t`) opens a `window` overlay, 320px wide and
  80% of the window tall, key `agent-tower`, with a close button; it opens with the
  composer open and the keyboard in its input.

One column on `chrome`, 13px text, in the vocabulary of Herdr's shipped `agents` and
`spaces` mods (numbers below are theirs unless said otherwise). Top to bottom:

- **Area header**, Herdr's flat header: 31px, 16px left and 10px right padding, 12px gaps.
  The areas from the settings (default "Work" and "Personal") as plain words, 11.5px
  medium, shown when there are two or more: the shown one in `foreground`, the others in
  `dim` (hover `foreground`). An area you are not looking at shows Herdr's tinted badge
  (14px, 4px corners, `blocked` at 15% under `blocked` 10.5px bold) with the number of its
  items under Needs you, tooltip "2 need you in Work". On the right, while the shown area has no running Eye (and
  its `eye` is not `false`), a 26px eye icon button "Start the Eye" (it starts that area's) (dimmed, "Starting the Eye…", while it starts),
  a 26px `search` icon button "Search (Ctrl-S /)" (below), then a 26px `plus` icon button, "Tell the Eye or start a task" while an Eye runs, else
  "New task" (`dim`, hover `hover` + `foreground`, shown pressed while the composer is
  open); in the window also a 26px `x` button, "Close (Esc)". No title: Herdr's brand row
  sits above it.
- **Switches** (a right-click on the header): a 240px popup with one section per variant you
  can flip, each choice checked when current, remembered in shared state, and every flip
  appended to `<tower folder>/use.jsonl` as `{at, what, from, to}` so unused variants can go:
  "Done in another area" (below) and "Left of a task" ("Its state", "How many agents run";
  `shared("agent-tower.rowMark")`, default Its state).
- **Search**: the magnifier or `agent-tower.search` (`ctrl-s /` in keys.json) opens a 28px
  field under the header (`accent` border, `search` glyph, an `x` that closes it; Esc closes
  it too). While it holds words, the list is one "Found N" group of every item in every area,
  group and fold (Earlier, Done, left-overs too) holding every word, matched in the title,
  space, task ids, machines ("this computer" for here), what it asks, and each live member's
  name, title and last sentence (`model.searchItems`). A result is its row and acts like it;
  one from another area carries that area as its note; a match inside the task opens its
  tree and its idle line. Not searched: screens (`hc read` per item would be slow) and ended
  tasks (hc keeps them a day; the list reads live terminals only).
- **Finished elsewhere** (an experiment, switchable while you look): how the header tells
  that something finished unseen in an area you are not looking at. The Switches popup's "Done
  in another area" section has "Dot by the area name", "Breathing dot by the area name",
  "Line at the bottom" and "Off", the current one checked; the choice is `shared("agent-tower.doneSignal")`, so the docked list and the
  window agree, and the settings key `doneSignal` gives the default (Dot when unset). The
  red count stays exactly as it was.
  - **Dot**: after the other area's word (and after its red pill, if any) Herdr's still 7px
    `done` dot, never a number: one finish and ten look the same. The word's tooltip:
    "2 need you · 3 done in Personal", then the newest three as "title · age", then
    "+N more".
  - **Pulse**: the same dot, breathing (opacity 1 ↔ 0.35, 1.6 s) while the newest finish is
    younger than 5 minutes and the area has no red count; the existing 60 s redraw stops
    it, so it lasts 5 to 6 minutes, and a burst is one long pulse. With a red count beside
    it, it stays still.
  - **Line**: nothing on the header; at the bottom, above the machine lines, one 26px line
    per other area with news: "Personal · Back up the 2025 photos  3m ●" for one finish,
    "Personal · 10 done  <1m ●" for several (the newest one's age), tooltip with the newest
    three and "Open it" / "Go to Personal". A click on one finish
    does what a Done row does (marks it seen, selects it, goes to it) and stays in this
    area; on several it switches to that area with Done unfolded.
  - **Off**: nothing.
  - **News** (`model.areaNews`): an item in another area that is in Done (not needing you:
    the red count's items never count twice; never a left-over) and changed after you last
    left that area. Leaving an area stamps `shared("agent-tower.areaLeft")[area]` with now,
    so switching in clears it; it also clears when its items leave Done by the usual rules.
    Not drawn on the shown area, with a single area, or in the rail.
- **The Eye's row**, only while the shown area's Eye runs, above the area row (switching
  areas swaps it),
  8px left and 14px right like the list, in an item row's grammar: an eye icon (the mod's
  own `eye.svg`, 16px in the tile's 18px place), "Eye", its age and mark. Working: one line,
  its status sentence in the tooltip. Waiting: Herdr's full "Needs you" pill (18px, `blocked`
  at 15%, 10.5px semibold) in place of age and mark, and the waits line as in Needs you
  (kind in `blocked`, its `task.ask` label, else its sentence, in `muted`, two lines at
  most, the whole text in the tooltip). A click goes to it; a right-click asks straight away
  "End the Eye?" with "Keep the Eye" / "End the Eye". Its first 20 s
  without an agent: "Starting the Eye…" in place of age and mark. After that, still no
  agent (its program ended and a shell took its place): "Eye · no agent running" in
  `muted`, tooltip "Its program ended. Open it or end it.", and nothing is ever sent to it.
  Not running: no row. An Eye is never an item, in a group or left over; a waiting Eye adds
  1 to its area's red count.
- **Composer**, only after `plus`, right under it: 16px left and 10px right padding (the
  input starts with "Work" and ends with the plus box), 8px below, a 1px `border` under it.
  - One 30px input at full width (7px corners, `input` border, `background`, 13px): "What
    needs doing?" for a task, "Tell the Eye" for the Eye.
  - A chip row when there is a choice (the shown area's Eye runs, or the area has two or more recipes):
    "Eye" first, then the area's recipes; 20px chips, 6px side padding, 4px corners, 11px,
    the chosen one on `selected`, the row pulled 6px left so the text starts at 16px. The Eye
    chip sends to the shown area's Eye; a recipe chip starts a task. While it runs the composer
    always opens on the Eye; a recipe chip applies until it closes (the recipe last picked
    per area is the one a task uses, and the one shown when no Eye runs). Switching areas
    with the composer open redraws its chips and target for the new area: text never goes
    to another area's Eye. Each area keeps its own words for its Eye: they come back when you
    return to the area, and across a restart of the list (a layout switch) through the draft,
    which carries their area.
  - One send or start at a time: while one is in flight Enter does nothing, the input is at
    60% opacity and the plus does not close the composer; the input clears when it
    succeeds. Text from the input has every run of whitespace with a line break in it
    turned into one space (`model.oneLine`), for the Eye and for task words alike.
  - One 15px hint line at 11px, the same height in every state so the list does not jump:
    - task: "[recipe · ]Led by <agent ▾>[ · on <machine>]", the recipe only
      when there are no chips, the machine only when it is not this computer and the
      recipe's name doesn't already say it. The agent is a button (18px, no fill at rest,
      `muted`, chevron; `hover` fill and `foreground` on hover) opening "Lead agent" just
      under it (at its bounds from the press, so it never covers it): the agents with their
      program icons, the current one checked; a pick is remembered for the recipe in
      `shared("agent-tower.leadPick")`, and the composer takes the keyboard back;
    - no recipe: "No recipe" (the settings file to add one in, in its tooltip;
      whole words), the settings file's full path in the tooltip;
    - Eye: no line, and Enter runs `hc send -- <eye> <text>` (never
      `--force`; `--` so a leading dash is text, checked on hc 0.1.21); a failure keeps the
      text and toasts "Not sent to the Eye. Your text is kept." with hc's words in the body
      (a toast has no tooltip);
    - Eye starting: "Starting the Eye…", and Enter sends nothing;
    - Eye without an agent: "No agent in the Eye · Open it" in `blocked`; a
      click goes to it, Enter sends nothing and keeps the text;
    - Eye waiting: "Open the Eye" in `muted` (`foreground` on hover; the pill and the
      kind already say it in red); a click goes to it, and
      Enter sends nothing and keeps the text. (hc refuses to type into a blocked terminal
      without `--force`, even for the Eye's own question, so every wait is this one.)
  - "No tasks" is hidden while the composer is open.
- **The list**, scrolling, 8px left and 14px right padding (the scrollbar's gutter).
  Groups in Herdr's order, each left out when empty: **Pinned** (`dim`: items whose lead
  carries Herdr's pin, `terminal.pin`, whatever their state or age; the item menu's "Pin to
  the top" / "Unpin" sets it, and every Herdr client shows it), **Needs you** (label in `blocked`),
  **Done** (`done`), **Working** (`working`), **Idle** (`dim`), **Earlier** (`dim`),
  **Spaces** (`dim`), then **Left over** (`dim`). A group label: 24px, 11px medium, the
  count after it in `dim`, 10px above it (none above the first); a click folds the group
  (a `chevron-right` shows while folded). Earlier, Spaces and Left over start folded; folds
  live in memory. Done shows at most 5 rows, then a 26px "N more" row in `dim` at the
  sub-row inset that shows the rest ("Show fewer" folds them again).
- **An item row**, Herdr's agent row: 8px side and 5px vertical padding, 8px corners,
  hover `hover`, `selected` when it is the selected item (below), a tooltip with the title,
  space and machine (left out while that row's menu is open, until the pointer leaves the
  row, so it never covers the menu). A 20px line with 9px gaps:
  - what stands at the left says something about the task (the space's letter said
    nothing): by the "Left of a task" switch, **its state**, the row's status mark (below)
    in an 18px cell, and then the mark column at the right stays empty; or **how many agents
    run** in it (lead and live members running an agent), 10.5px bold on an 18px tile with
    5px corners, tinted by its state (`blocked`, `working`, `done` or `dim` at 15% under the
    same colour), with the mark at the right as before;
  - the title: `task.title` for a task; else the agent's own title, cleaned the way Herdr's
    agents list cleans it (no status glyph, not the program's name, not a path, no program
    glyph in front: "π - shad" reads "shad"); else the space name. `muted` when the item is
    idle and not focused, else `foreground`. It shrinks only when the row is full;
  - " · <note>" in `dim`, at most 90px, giving way twenty times faster than the title: the
    space name when the title does not already contain it; when the same title still shows
    twice in the area, the lead's name, else its address without the machine ("t41");
  - the machines, 10px `dim`, at most 62px, right-aligned against the columns after it,
    only those that are not the area's home machine ("mac", or "mac +1" for more; all of
    them in the tooltip): the home machine is the first machine the area's settings
    list, else this computer (never a majority of its rows). A row on this computer in an
    area that lives on another machine says "this Mac" ("this computer" off macOS);
  - the fold chip column, 18px, present only when some row in the area has a chip (below
    300px only on rows that have one): when the item has workers, `chevron-down`; folded,
    `chevron-right` and the count in the most urgent worker's colour;
  - the age, 11px `dim`, at least 28px wide from 300px of list up, right-aligned, Herdr's
    compact form ("<1m", "13m", "18h", "3d"): the newest change among the item's
    terminals. "quiet 25m" in `working` when the item is working and nothing in it changed
    for 20 minutes; "lead gone" in `blocked` for a task whose lead ended;
  - the status mark in a 14px column: a 12px spinning `spinner` in `working`, a still 12px
    `clock` in `working` for a quiet working item, a `blocked` "!" tile (14px), a 7px `done`
    dot, a 7px `idle` ring (a done lead outside Done shows the ring); nothing for a terminal
    that reports no status.
  In Needs you the row has a second line, 11.5px, 27px in and 22px clear of the mark
  column: what kind of wait, in words ("Asks you", "Needs sign-in", "Needs permission",
  "Stopped with an error", else "Waiting on you"; never "Needs you", which would repeat the
  header) in `blocked`,
  then " · " and the agent's own sentence in `muted`, 15px lines, at most two, full text in
  the tooltip. The first line holds the kind and as many whole words as fit (an estimate,
  `model.splitWait`: no text measuring or styled runs in the mod API); the second starts at
  the kind's left edge and ends in "…" when cut. The Eye's waits line is the same. In Done
  the second line is the lead's own last sentence, one line in `muted`, when it gave one.
  A task's lead that runs no agent 20 seconds after it was made (its program ended and a
  shell took its place) reads "no agent running" in `blocked` on its second line.
- **The title wins.** When the list is narrower than 300px (the sidebar's width from
  `layout()`; the window counts as 320px) no row prints a machine; it stays in the
  tooltip. At any width the extras give way before the title, in this order: the machine,
  the fold chip's count (the chevron stays), the space note, until the title has room for
  16 characters or all of itself (`model.fitRow`, which estimates 7px a character at 13px
  and 6px at 10-11px). Space, left-over and merged rows drop their machine the same way.
- **Rows that read alike** (same title, space and machine, no workers, same group) are
  one row: the title, a `dim` "×6", the newest age, the most urgent member's mark, a
  chevron in the chip column. A click opens it: one 26px row per member at the sub-row
  inset, named by the lead's `name` else its address without the machine, with its own age
  and mark; a click there goes to that agent.
- **Under a task**, Herdr's sub-rows: 26px, 39px left padding, 12.5px, 8px corners; the
  tree lines (9×17px boxes with a 1.5px `input` left and bottom border, 6px corner on a
  branch), the program icon (14px), the name in `muted`, the status mark. The shown or
  focused one sits on `raised`. In order:
  - **the lead**: "Lead · home-server" ("Lead · this computer" here): it says it is the lead
    and where it runs; none when the lead has ended;
  - **the workers that work or wait**, and the rows above them (a sub-lead stays while its
    workers run), each named by `name` (else template, program or address) with its machine
    in 10.5px `dim` before the mark when that is not the area's home;
  - **one line for the rest**: "2 done · 10 idle" with a chevron, 12px `dim`; a click opens
    their rows under it. A worker's Done stays Done (it finished and reported; agreed with
    the panel), but only the lead's Done makes the task Done.
  The tree is open while the task is selected or something in it works or waits, folded
  otherwise; a click on the chip opens or folds it and that choice wins.
- **A starting task**: a 30px row in Working with the working mark, your words in `muted`,
  "Starting…" in `dim`, until its lead is labelled.
- **Left over** (agents whose starter is gone, see below). Under an item: after its
  workers, one 26px line at the worker inset, "3 agents left over" ("1 agent left over") with
  a chevron, 11.5px `dim`, folded by default (`<item key>:left` in the explicit opens),
  tooltip "Their starter has ended", right-click "End 3 agents left over…"; open, their rows
  at the worker inset.
  In the Left over group: rows at the item inset, the program icon in an 18px box so names
  start with the titles. A row: the program icon, the name (`name`, else template, program
  or address) in `muted`, the machine when it is not the area's home; no age (it would only
  say when Tower noticed it) and no mark. A click peeks at the agent.
- **Space rows** (one or two at the bottom without a header; from three, the folded Spaces group): 30px, the `terminal` glyph in `dim` (no letters anywhere), the space name in `muted` (`foreground` and
  `selected` for the space on screen), the machine as on item rows. A space holding an Eye is
  never a space row, even while its Eye runs no agent.
- **Machine lines**, Herdr's: nothing while every machine this area uses is connected.
  Otherwise, pinned under the list with a 1px `border` above, one 26px line per machine
  that is not, 11px `dim`: the `server` icon, the name, a state word ("unreachable since
  11:46", "needs login", "rebuilt") and a 6px `dim` dot. "needs login" adds a Copy button
  that copies `hc machine login <name>` ("Copied" after); "rebuilt" adds Connect, as in
  Herdr's spaces list. A machine is this area's when the area lists it or an item or space
  of the area is on it. Its rows show at 60% opacity with "as of 11:46" in place of the age.
- **Rail**: the shown area's Eye is the first cell (none with `eye: false`), its icon in an 18px box so its badge sits where the
  tiles' do: running, a click goes to it and a right-click asks the End question; not
  running, `dim`, "Eye: not running. Click to start", and a click starts it (dimmed while it
  starts). When the sidebar is narrower than 160px
  (Herdr's rule, read from `layout()`),
  no header, composer or group labels: each item is a 32×26px cell holding its tile or
  program icon (a task that needs you keeps its tile, with a `blocked` badge like the Eye's)
  with its mark as a 6px badge at the bottom
  right and its title as the tooltip, groups separated by a short `border` line, then the
  spaces as tiles and the machines as `server` icons.
- **Empty area**: "No tasks" in 12px `dim`.
- **The item menu** (right-click on an item), Herdr's menu: a `popover` popup 250px wide,
  5px padding, 12.8px; 31px items with a 14px `muted` icon: "Details" (`panel-right`, one
  item only), "Peek" (`monitor`, one item with a lead), "Rename" (`square-pen`, not in the rail, which has no row to rename in),
  "End task…", "End agent…" for an unlabelled agent, "End all 6…" on a merged row (Herdr's
  word for a terminal and what it started; "Close" is for spaces and panes),
  "End 8 agents left over…" when it has left-over agents
  (`x`), then a divider and "Space menu" (`layers`). ↑/↓ move, Enter runs, Esc closes.
  "Close…" turns the popup into the question, on one line, in lead and worker words: "End
  the lead and its N workers?" with "Keep running" (`raised`) and "End all N+1" (`solid`,
  `solid_foreground`; every button has a 1px border, `accent` on the chosen one); "End its N
  workers?" for a task whose lead is gone; "End this agent?" / "End it" for one terminal;
  "End these 6 agents?" / "End all 6" on a merged row; "End these 3 agents? Their starter
  has ended." with "Keep them" / "End 3 agents" for left-overs ("End this agent? Its starter
  has ended." with "Keep it" / "End it" for one; it may wrap). Keep running is
  chosen first, ←/→ move. When a machine of those terminals does not answer, the popup says
  "work-vps does not answer; nothing was ended." with only "Close".

Icons are Herdr's own, drawn from `mods/workspace-chrome/*.svg` at run time; program icons
come from the app's program table.

## How it behaves

- **A row is a task**, on whatever machines it runs. A terminal belongs to the topmost
  `task.id` up its chain of parents (so a lead another task's lead started, with its own
  id, and its workers are part of the starter's task: one row; the contract now starts a
  sub-lead with the same `task.id` and `task.role=worker`); with none, to the topmost agent
  in its chain of live parents; a shell nobody started belongs to nothing. A task is every
  terminal carrying that id or one folded into it (ended ones too, for 24 hours) plus the
  live terminals they started; the one with the top id and `task.role=lead` is its lead.
  Parents across machines work: Herdr writes a parent on this computer as a bare id. An agent is a live terminal that reports a status
  or whose program is an agent.
- **Left over**: a live agent with no `task.id` whose parent is set but gone (on a machine
  whose terminals this computer sees: hc writes a parent bare here, `name/tN` on a known
  machine, and a parent elsewhere is never taken for gone) is never a work item of its own:
  an `hc run` script or agent started it, then ended and was removed, and Herdr's own list
  hides it. If its `where` label names a space (`<space name> / <tab>`) that exists on its
  machine, it joins that space's work item (the one whose lead comes first in Herdr's agent
  order when several share it); otherwise it goes in the Left over group. Left-over agents
  never count toward Needs you, Done, Working, Idle or Earlier, never move their item
  between groups, are not in the rail, and their item is never merged with alike rows.
  "End N left over…" in the item menu, and on a right-click of the Left over header, asks
  "End these N agents?" and ends exactly those, with the same safety as Close (asks again
  if the set changed, nothing ended if a machine does not answer).
- **The tree** under an item: its live terminals by parent, depth first; a task's worker
  started by someone outside the task hangs off the lead.
- **Status**: a lead's word comes from `agents()` when it has a pane (there "done" becomes
  "idle" once someone looks), else the core's word; "error" counts as blocked. A
  worker's "done" stays (only the lead's makes the task Done). An item needs you
  when any of its agents is blocked (the lead first, then the tree), or when its lead or a
  sub-lead (a member that started others in the task) carries a non-empty `task.ask` (the
  skill's way to ask: it labels the question and ends its turn, so it may read as done or
  idle) and is not working (a working one clears it first thing, so its label is stale); a
  plain worker's `task.ask` doesn't count. A question in an agent's text is never a wait. Such an item
  shows "Asks you · <the ask>" and the "!" mark, counts in the area's number, and leaves
  when the label is cleared. (The status bar's "needs you" is Herdr's own count of blocked
  agents; a mod can't add to it.) Else it is finished
  when its lead is done (it finished and nobody has looked since), else working when
  anything in it works, else idle (see Done and Earlier below). An area's pill counts its
  Needs you only.
- **Done**: a lead with a pane is Done while Herdr says "done" (Herdr clears it when
  someone looks). A lead without a pane (an `hc run` lead, which `agents()` never lists) is
  Done for 12 hours after its last change, or until it is clicked here: the click stores
  its address and that change in `shared("agent-tower.seen")` (pruned like the change
  times, below); a later change makes it Done again. It then falls to Idle or Earlier.
- **Earlier**: an item that would be idle, quiet for 24 hours or more.
- **Order**: inside a group, most recently changed first; in Working a quiet item first.
- **Age** is the time since the mod saw a terminal's status word or turn change, on this
  computer's clock, first seen at the core's `status_ms` when there is one, else at that
  moment. The times are kept in `shared("agent-tower.changes")` so the docked list and the
  window agree and they survive a restart. A terminal no longer in `terminals()` is
  forgotten at once (`model.forgettable`), but only on a machine that answered and showed
  terminals in that read: a quiet machine, or the empty read right after a start, loses
  nothing; anything unseen for 30 days goes anyway. Ages redraw once a minute.
- **Area** of an item or a space: `task.area` when set, else the first area whose
  `machines` list holds its machine, else the area marked `default`.
- **Spaces**: the spaces of the shown area with no live agent and no live task
  terminal inside (a terminal without a `herdr.space` label counts for the space of
  whatever started it). A click runs `space.select {id}`; a right-click opens Herdr's own
  space menu, the way the shipped `spaces` mod opens it.
- **A click on a task row selects the task and opens its lead**, also
  when you come back to it from one of its workers; folding is the chevron's alone. A task
  clicked in Board, Radar or Timeline goes into it: the list's screen comes back (the sidebar
  shown in either shape) with its lead open, and "‹ Board" (the view's icon and name, where
  the views switch sits: the list's first line, the bar, or the foot row) goes back one step,
  shape included. Any other view switch forgets it. Views call `ui.select` for this; `ui.pick`
  selects without leaving the view. A click on its lead or worker row opens that terminal: `pane.focus
  {terminal}` when it has a pane. A lead without a pane (started with `hc run`) gets a real
  tab the first time the task is clicked into (a row, a search hit, a rail dot, Details, a
  toast, an arrival from another area's window), where Keep below puts one: here, its task's
  space, or a new space on its machine named after the task. The list goes to that tab, and
  the next click goes to it with `pane.focus`. A click while the tab is still coming (under
  10 s) does nothing. A worker without a pane, any click while the centre is hidden (a view
  or the whole window is up), a list row under "Peeks, the view stays", and "Peek" in the
  item menu (a look at the lead without going in) open the list's own
  peek, Herdr's 80% dialog with this mod as its 36px header (`props.peekBar`): the machine
  (`server` glyph and name on `raised`), the task title, the worker's name, its state in
  Herdr's words, then Keep and ✕. Herdr's own peek names neither machine nor task, and its
  Keep fails for a terminal on another machine than the shown space. In the window the mod
  then closes itself. The rail, which has no lead row, still selects and opens the lead.
- **Keep** (`model.keepPlan`) says what you get, a tab, and where: "Open as a tab here" when the
  shown space is the task's own on that machine (`terminal.keep`); "Open as a tab on work-vps"
  when the task has a space there (`space.select`, then `terminal.keep`; its name in the tooltip)
  or has none (label the worker with a new `herdr.space`/`herdr.tab` id, Herdr makes that space on
  its own machine, and the header, kept open until it appears, names it "<task title> · <worker>"
  and shows it; "Opening it on mac…" meanwhile). A machine that does not answer: no button,
  "mac does not answer; nothing was kept."
- **Pane header** (`props.paneHead`, for the tower layouts' pane frames in place of Herdr's
  `pane` mod): Herdr's header (icon, folder, status, split/zoom/close on hover) with the
  machine and the task title first and the worker's hc name for its name, so a terminal
  says where it runs once it is open.
- **Hide text**: `shared("agent-tower.hideText")`, flipped in the card's footer, hides
  agents' own words in the list too (wait lines show only their kind; Done rows no sentence).
- **Start**: Enter in the composer. When the recipe names a machine, the mod first asks
  `hc machine ls`; if that machine does not answer it toasts "The task didn't start ·
  work-vps does not answer; nothing was started.", starts nothing and keeps your words.
  Then it makes a 5-character id, opens a new space for
  the lead with `space.new {name, folder, machine, argv, task}` (name: your words cut to 40
  characters; folder and machine from the recipe, argv the lead agent's run through
  `env TOWER_TASK=<id> TOWER_WORKER=<workers' agent command>`, so the message you read holds
  no ids, paths or usage text; task: the first message below),
  closes the composer, then watches for the space with that name on that machine, finds
  its terminal and labels it in one `hc label` call (`task.id`, `task.role=lead`,
  `task.title=<your words>`, `task.by=raw`, `task.recipe`, `task.area=<the recipe's
  area>` so it stays in the area it was started from, `task.lead=<agent id>`; the title is
  cut to 80 characters). It is given up on, with a toast, if no terminal is found in 60
  seconds, or at once when its machine stops answering. Escape closes the composer.
- **Agents per role.** Wherever an agent is started there is a choice; the default is
  Claude Code with Fable for leads and the Eye, Claude Code with Opus for workers. Roles: lead,
  worker, namer, and eye.
  - **Lead**: the agent picked in the composer for that recipe, else the recipe's old
    `argv` (it wins when present), else the recipe's `lead`, else `roles.lead`, else the
    first agent. It starts with the agent's `argv`, and the lead's label call also writes
    `task.lead=<agent id>` (`recipe:<id>` for an old argv), so the panel can say what runs.
  - **Workers**: the recipe's `worker`, else `roles.worker`; named in the first message.
  - **Namer**: `roles.namer`, a plain argv; the prompt goes right after `-p` when there is
    one (Claude's `--tools` takes every word after it as a tool name), else at the end.
- **First message to the lead**, two forms, both starting with the recipe's rules, one per
  line:
  - with the skill (`skill`, default "tower"): one plain line, `Lead task {id} with the {skill}
    skill (questions to me go through task.ask): <your words>`; the skill reads the task id and the workers' command from
    `$TOWER_TASK` and `$TOWER_WORKER`;
  - without (`"skill": null`): the contract from the settings with `{id}` filled in, then
    `Start workers with: <worker argv, shell-quoted>` and "Task: <your words>". The skill itself is written elsewhere. In the contract,
    `{worker-skill}` (the end of a brief) becomes "; use the <skill> skill if you have it"
    with the configured skill's name, and nothing when no skill is configured.
  - The skill form is used only where the skill is: before a start the mod runs
    `sh -c 'test -f "$HOME/.agents/skills/$1/SKILL.md"' sh <skill>` on the lead's machine
    (`exec` with `on`; the name is an argument, never part of the script; a name that is
    not a plain skill name counts as missing), once per machine, kept for the session (a
    check that could not run is asked again). Missing: the full contract.
  - The full contract (`DEFAULTS.contract`) says what the tower skill's Lead part says, in
    its order, in plain lines: plan and delegate; start workers with the agent command named
    below, brief on the run line, `--cwd <dir>` (the task's own folder), a remote worker by
    `<machine>/<id>-<role>`; what a brief gives and how it ends (report to the parent with
    the result path); after starting workers `hc read` each once (a folder-trust or sign-in
    prompt stalls a new worker without telling you), routine prompts
    with `hc keys`, permissions, sign-ins, deleting or sending to the person;
    `hc wait --children any --timeout 100`, never poll, and what to do on a report or a
    stop; `task.ask` before waiting on you and cleared next turn; the last message opens
    with one or two plain sentences; a chain link at milestones; done is said, ending the
    workers left to you. The test checks the order against the installed skill.
- **The Eye**, one per area. An area's Eye is the newest live terminal labelled
  `tower.eye=1` and `tower.area=<area id>` (`model.findEye(terms, area)`); an older Eye with
  `tower.eye=1` and no `tower.area` (from before Eyes were per area) stands in for every area
  that has none of its own and doesn't say `eye: false`, until you end it. No terminal with `tower.eye=1` is ever an item.
  An area with `eye: false` has none: no icon, row, chip or rail cell. An Eye is only ever
  started by your click on the eye icon (the header's, the rail's Eye cell or the whole
  window's bar), for the shown area: a space "Eye · <area label>" on this computer in the
  area's `eye.folder`, else `<eye.folder>/<area id>`, else `<tower folder>/eye/<area id>`
  (a `/` in the id becomes `-`; made if missing), with the area's `eye.agent`, else
  `roles.eye` (an unknown agent id falls back to it, with a toast once a day), run through
  `env TOWER_NEW=<mod folder>/tower-new TOWER_CONFIG=<the settings file the mod really read>
  TOWER_AREA=<area id>` (and `AGENT_TOWER_DIR` in a sandbox); then its terminal is labelled
  `tower.eye=1 tower.area=<area id>` in one call, found the way a new lead is. Its first
  message (`model.eyeMessage(config, area)`): the global `eye.rules`, then the area's, then
  with the skill (only when the skill on this computer has an "## Eye" part, by
  `grep -qx '## Eye'`) one plain line, "You are the Eye of the Work area: follow the tower
  skill's Eye part." (the skill has it answer first with where its area stands, in the
  list's words); without it the full text (its area's tasks from `hc ls --json` by
  `task.area`, else the area's machines, else the default area; starts leads with
  "$TOWER_NEW", choosing one of its area's recipes from "$TOWER_CONFIG"; passes messages to
  its area's leads with `hc send`; work for another area goes back to you; answers from
  labels, never memory; never does task work or ends anything unasked; asks when unclear;
  starts its last message with one or two plain sentences). End kills and `hc rm`s that
  Eye's terminal only; there is no Restart (End, then start it again). The mod never sends
  an Eye anything but what you typed.
  - **In the whole window** (the list hidden), the bar shows the shown area's eye icon after
    the area chips: a click opens its Eye, a right-click its menu, a red dot while it waits;
    with none running, a click starts one ("Starting the Eye…" in every copy while it starts,
    through a shared stamp). No icon with `eye: false`.
  - **Its limit is a rule and one check, not a wall.** Checked: `tower-new` sends
    `TOWER_AREA` with the request and a recipe of another area is refused. Rules only:
    `hc ls` shows every terminal on every machine and `hc send` reaches any of them; an
    agent that unsets `TOWER_AREA` or writes the request itself gets past the check.
- **The inbox**, how the Eye starts tasks exactly as the composer does: `tower-new`
  writes `<tower dir>/inbox/<id>.json` (`{recipe, words, agent?, area?, at}`, `area` from
  `TOWER_AREA` when set; written aside and moved in) and waits up to 25 seconds for `outbox/<id>.json`, printing it as
  one line of JSON (exit 0 when it started). The docked copy (never a window) watches the
  inbox with `watchFolder`, scans it at start and on its 30 s tick, and acts only while it
  holds `shared("agent-tower.inboxLease")` (renewed every 30 s, free after 75 s, released
  when the copy closes). The inbox and outbox are created 0700, and narrowed to 0700 when
  wider. Only regular files are acted on (`find -type f`: a link or a folder is never
  read). One read at a time; each request is deleted, then checked: over 64 KB is "too
  big"; an id already handled this session is "already handled";
  `model.checkRequest`: older than two minutes when first seen, by its `at` or the file's
  time, is "too old", more than two minutes ahead is "its time is more than two minutes
  ahead"; an unknown recipe or agent or no words says so in words; a request with an `area`
  naming a recipe of another area is refused ("the recipe X is in Personal; this is Work's
  Eye"). A request without `area` (by hand, or from an older Eye) is not area-checked. Then it goes
  through the composer's own start (`startTask`: refusals, machine check, pending row,
  label, naming). The answer is `{ok: true, task, lead}` once the lead is labelled, or
  `{ok: false, why}`. Answers nobody fetched are swept from the outbox after ten minutes.
- A recipe naming an agent the settings don't have falls back to the role's default, with a
  toast "Recipe <label>: unknown agent"; a recipe with an old `argv` (which wins over its `lead`
  and `roles.lead`) gets "Recipe <label>: argv overrides lead". Each shows once a day, from the
  docked list (`agent-tower.warned`); the reasons are in the README's Settings.
- **Name**: right after labelling, the mod asks the namer to name the outcome "in at most
  four words, under 26 characters", not who does it or how ("Tea, coffee and water notes",
  not "Delegating three text files"; no verbs like delegate, have workers, ask)
  (by default `claude -p --model haiku --no-session-persistence --tools ""` with your words
  as data, 60 s limit). If the answer is one non-empty line of at most 28 characters and the
  lead's `task.by` is still `raw`, it writes `task.title` and `task.by=llm` in one call and
  renames the space to match. If it fails, your words stay.
- **Rename** (item menu) turns the row's title into an input in place, title selected.
  Enter saves (cut to 80 characters), Escape leaves it. On a task it writes `task.title`
  and `task.by=you`; on an unlabelled agent it writes `task.id=<new id>`,
  `task.role=lead`, `task.title`, `task.by=you` in one call, which makes it a task. The
  space takes the name too when no other item lives in it. The model never touches a task
  whose `task.by` is `you`.
- **Close** (item menu): the question counts what would end: for a task, every terminal
  carrying its `task.id`; for an unlabelled agent, it and the live terminals that belong
  to it (not another task's workers); on a merged row, all of that for every member.
  "Keep running" closes the menu. "End all" counts again:
  if the item is gone, it toasts and ends nothing; if the set changed, it asks again with
  the new count; if a machine of those terminals does not answer (a fresh
  `hc machine ls`, and `machines()`), it says so and ends nothing, because a task must never
  be half ended; otherwise the docked list (or window) that opened the menu gets the list
  of addresses, checks the machines once more (a toast and nothing ended if one went
  quiet), and for each one still in the item runs `hc kill`, then `hc rm` once it has ended
  (one retry after 2 seconds). Failure toasts give hc's error message in words, never its
  JSON.
- **Titles outlive leads**: the mod keeps the last title it saw or wrote for each task id
  in `shared("agent-tower.titles")` (ids on no terminal any more are dropped, only when
  every machine answered and the read is not empty), so a task
  whose lead's record is gone still shows its title, not its id.
- **Selection**, for the panel mod: `shared("agent-tower.selected")` is
  `{ key, lead: <live lead address or null>, members: [live addresses], title }` or null.
  Focus moving to a terminal of an item selects that item (null for a terminal that is no
  item's). A click on an item, a member or a worker row selects its item and pins it
  (`shared("agent-tower.pin")`, `{key, space}`): it stays selected through focus changes,
  such as a closed peek handing focus back to the old terminal, until another click, the
  item going, or the shown space changing to one other than the space the click showed
  (the clicked agent's pane's space, else the space on screen). Its members and title follow
  the item while it stays selected. The docked list and the window share it.
- **Details** (item menu) selects and pins that item and, when the layout has a node
  `tower-detail` (the panel mod's own column), runs `layout.show {id: "tower-detail"}`.
  Without that node it only sets the selection (Herdr would otherwise toast the failed
  command).
- **Space menu** (item menu) closes the popup and opens Herdr's space menu for the item's
  space.
- **Machines**: every 30 seconds the mod runs `hc machine ls --json`; a machine that is not
  connected, or whose layout is `unavailable` in `machines()`, is unreachable from the
  moment this copy of the mod first saw that. "needs login" is hc's `needs_login`;
  "rebuilt" is Herdr's test (unreachable because a different core answers there). Connect
  runs `hc machine rm <name>`, then `hc machine add` with the same target (or `--via`),
  name and session, each with `--json`, and shows the error in place if one fails.

## Built from

- One mod, `mods/agent-tower/` (`main.js`, `model.js`, `mod.json` with `place: "none"` and
  the window overlay, `NOTICE`, `eye.svg`, `tower-new`), one layout, `layouts/tower.json`
  (Herdr's `main` layout
  with the `sidebar-lists` column holding a single block
  `{ "id": "tower", "content": { "mod": "agent-tower" } }`), `keys.json`
  (`ctrl-s t` → `mod.open:agent-tower`), and `model.test.mjs`.
- `model.js` holds the pure functions (work items, groups, merging alike rows, repeat notes,
  the home machine, spaces, the close set, ages, machines, start bookkeeping);
  `node agent-tower/model.test.mjs` checks that every agent shows exactly once, every
  agent-less space once under Spaces, Close reaching only its own item, Done ageing and
  seen-on-click, Earlier, the quiet item first, merging alike rows, the repeat notes and
  the home machine, the selection value, titles kept by task id, the 80-character cap, the
  no-agent rule, which machines are silent, hc errors in words, the contract's points, and
  left-over agents (a real case: a gone parent, `where` naming a space, eight of them; one
  without `where`; a parent on a machine not seen here), the pinned selection, the home
  machine from settings only, `fitRow`'s order, the other area's count, and the
  finished-elsewhere news (since the last visit, apart from the red count, cleared by
  switching in, ten finishes as one signal), settings parsing with old files, which agent a
  start uses, both first-message forms and the namer's argument order, finding the Eye,
  its second line, the composer's two modes, both forms of the Eye's first message, the
  inbox lease and the request check with its refusal texts.
- Live data: `terminals()` (labels, status word, report kind and msg, turn, status_ms,
  title, name, template, parent, state, program), `agents()` (status as shown, panes,
  focus), `focused()`, `spaces()`, `machines()`, `theme()`, `layout()` (the sidebar's
  width), `window().platform`, `shared("space.colors")`.
- Commands: `space.new`, `space.rename`, `space.select`, `pane.focus`, `terminal.peek`;
  `closeOverlay(props().overlay)`; `openOverlay` of Herdr's `menu` mod for a space, with
  the props the shipped `spaces` mod passes.
- The item menu is a `popup` overlay of this same mod (`props: { menu, from, keys, space }`,
  as Herdr's agents mod opens its sort menu; `keys` holds every member of a merged row). It
  asks the copy that opened it to rename or close through
  `setShared("agent-tower.request", { from, keys, action, addresses? })`; only
  the copy whose random id is `from` acts on it, and clears it.
- `hc(["label", address, "k=v", …])`, `hc(["kill", address])`, `hc(["rm", address])`,
  `hc(["machine", "ls", "--json"])`, and for Connect `hc(["machine", "rm", …])` and
  `hc(["machine", "add", …])`; `cx.write_to_clipboard` for Copy. Remote terminals are
  addressed `machine/tN`.
- `exec(namer[0], namerArgs(namer, prompt), { timeout: 60000 })` on this computer for the
  name. Arguments are lists, never a
  shell line.
- Text inputs: `InputState` + `Input` from `gpui-base`, one for the composer and one for
  rename, both made in `init`.
- The tower dir is `~/.config/agent-tower` for the Herdr app itself; a Herdr with its own
  app home (a sandbox) uses `<app home>/agent-tower` for its inbox, outbox and settings,
  so two apps on one machine never take each other's requests or settings. The Eye's start
  command then sets `AGENT_TOWER_DIR`, which `tower-new` reads.
- Settings: `<tower dir>/config.json`, else `~/.config/agent-tower/config.json`, else (from
  before the rename) `~/.config/agent-tasks/config.json`, read with `readTextFile` (which
  gives null for a missing file); when neither exists the mod uses its built-in defaults (it
  does not write the file). A file that is not valid JSON gets a toast naming it, and the
  defaults: `{ areas: [{ id, label, machines?: [name], default?: true,
              eye?: { agent?: id, folder?: path, rules?: [text] } | false }],
     agents: [{ id, label, argv: [..] }],
     roles: { eye?: id, lead?: id, worker?: id, namer?: [argv] },
     recipes: [{ id, label, area, machine?: name, folder?: path, rules?: [text],
                 lead?: id, worker?: id, argv?: [..] (old files) }],
     skill: name | null, contract: text with {id},
     doneSignal?: "dot" | "pulse" | "line" | "off" }`.
  Parsed by `model.parseConfig`: a part in the wrong shape falls back to its default and is
  named in a toast; `roles` fill in per role. Old files keep loading: `activities` and a
  recipe `activity` (the new names win when both are there), recipes with `argv` and no
  agents or roles. Defaults: areas Work and Personal (default); agents Claude · Fable,
  Opus and Sonnet (`claude --model <m> --permission-mode auto`), pi, Codex
  (`codex --no-daemon`); lead and eye Claude · Fable, worker Claude · Opus, namer haiku; one recipe per area, "A
  lead here", no machine, no rules; skill "tower".
- `cx.timer.every(60000)` for ages, `cx.timer.every(30000)` for machines,
  `cx.timer.every(1500)` only while a started task is still looking for its terminal.
- The row, group label, tree lines, status marks, fold chip, rail test, repeat notes,
  avatar colours, machine line (Copy, Connect) and menu are adapted from Herdr's `agents`,
  `spaces` and `menu` mods (Apache-2.0, see `NOTICE`).

## Watch out

- `run()` returns nothing, so a new lead is found by its space's name and machine among
  spaces that were not there before the start. Two starts with the same words within a
  minute would confuse it: a second start with a pending name is refused.
- A remote space's id is `machine/<id>`; the `herdr.space` label on its terminals holds the
  id without the machine prefix.
- An empty label value deletes the label; a title is never written empty, and the mod
  writes only `task.*` keys.
- The app's `terminals()` may carry no `status_ms`; ages then start when the mod first sees
  a terminal. Each copy of a mod gets its own `localStorage`, which is why the times live
  in `shared`.
- A machine link can hang while `hc machine ls` still says connected; the mod can only go
  by what hc and `machines()` say.
- hc removes an ended terminal's record after 24 hours, labels included. A lead must stay
  alive until its task is closed; the mod never treats an ended lead as a finished task.
- The docked list publishes the area it shows in `shared("agent-tower.area")` (on load and
  on every switch; the window does not), so the panel can clear a selection from another
  area.
- Shared state lives under `agent-tower.*` (changes, seen, titles, selected, pin, area, request,
  areaLeft, doneSignal, leadPick, inboxLease).
- A fast namer can answer before `terminals()` shows the `task.by=raw` just written: the
  name is dropped only when `task.by` is there and not `raw`.
- `tower-new` is run with `sh`, so it needs no exec bit; it uses only `awk`, `date`, `mv`.
- A copy that reloads hands the inbox over through the lease: released on close, otherwise
  free 75 s after its last renewal.
  Until a new key is written, `changes`, `seen` and `titles` are read from the old
  `agent-tasks.*` keys, so ages and seen marks carry over the rename.
- Labels are not protected: only this mod writes `task.title`, `task.by`,
  `task.recipe` and `task.area`; leads write `task.id` and `task.role` on their workers.
- The mod kills terminals only on "End all"/"End it", only those of the items the menu was
  opened on and only those the question counted.
- The machine is not a column reserved on every row: at 62px of a 268px sidebar that left
  titles one letter wide. It prints only where it says something, against fixed age and
  mark columns, so its right edge lines up. Below 300px even the empty chip column and
  the age's minimum width go: at 221px they cost a title about five characters.
- The red count on an area you are not looking at counts its items with a blocked agent
  only (`model.areaNeeds`): not Done, not working, not left-over agents.
- A done lead without a pane is never cleared by Herdr; without the 12-hour limit and the
  click, cron-like runs would pile up in Done for days.
- The closing menu hands the keyboard back to the pane under it: rename takes it again
  150ms later, and selects the title only then (the input must be drawn).
- Do not keep a `cx`; no `setTimeout`; no redraw timers for motion. Don't name a method
  `close` unless it is the shutdown hook (here it labels what a closing window was still
  starting).
- Not built yet: questions with answer buttons, a to-do list, restarting a lead on
  another machine, typing to an agent from the window, drag to reorder.

## Done when

- `herdr-app check mods/agent-tower` passes, and `node model.test.mjs` prints "model ok".
- In the `tower` layout every agent shows once, under its item, and every space with no
  agent shows under Spaces; loading the layout does not move the keyboard out of the
  terminal.
- `plus` opens the composer; typing and Enter opens a new space running the recipe's agent
  with the rules, contract and task as its first message; it shows as "Starting…", then
  as a task with the model's name, and the space carries the same name. Escape closes the
  composer.
- A blocked agent, anywhere in an item's tree, puts the item under Needs you with its kind
  and sentence, and a click goes to that agent; a lead that finishes unseen moves its item
  to Done, not Needs you, and out of the pill's count. A paneless Done row leaves Done when
  clicked, or after 12 hours; anything quiet for a day is under Earlier.
- Three alike headless runs show as one "×3" row; "End all 3" ends exactly those three.
- Narrowing the sidebar below 160px shows the rail; a machine that needs a login shows its
  line with Copy in the areas that use it.
- `hc label <t> task.id=x1 task.role=worker` on any terminal makes it appear under task
  `x1` within a second, on this computer and on another machine.
- Rename on an unlabelled agent makes it a task; on a task it survives a later model
  answer. "End task…" → "Keep running" changes nothing; "End all" ends exactly the counted
  terminals; a terminal added to the item while the question is open makes it ask again.
- A space row selects its space on click and opens Herdr's space menu on right-click;
  "Space menu" in the item menu does the same for the item's space.
- With a worker on a machine that does not answer, "End task…" says so and ends nothing;
  a task whose lead's record is gone keeps its title and asks "End its N workers?"; a start
  on a silent machine starts nothing.
- Clicking an item sets `agent-tower.selected`; closing a peek leaves it there; "Details"
  sets it and shows `tower-detail`.
- Eight agents whose starter was removed, labelled `where=investing / 1`, show under the
  investing item after "left over" and nowhere else; one without `where` sits in Left over;
  "End 8 left over…" ends exactly the eight.
- At 221px no row prints a machine and titles keep about 16 characters; at 360px only rows
  away from the area's home name their machine; a blocked agent in the other area shows
  its red count.
- With Work shown and ten background runs finishing in Personal, Dot shows one still dot
  after "Personal", Pulse breathes and goes still 5 to 6 minutes after the newest finish,
  Line shows "Personal · 10 finished", and Off shows nothing; switching into Personal and
  back clears each.
- Picking another agent in the composer starts that agent (`hc get` shows its argv), with
  the skill form of the first message naming the workers' agent and `task.lead` set; with
  `"skill": null` the full contract goes instead.
- Nothing starts an Eye but your click on the eye icon, and it is the shown area's. Started,
  it is labelled `tower.eye=1 tower.area=<area>` and has its row in that area only; text from the composer reaches it (`hc read`); a waiting
  Eye refuses it; `tower-new <recipe> "<words>"` starts a labelled, named lead and prints
  `{"ok":true,…}`; from Work's Eye, a Personal recipe is refused; a stale or wrong request
  is answered in words; End leaves every task alone.
- The design pass of round 3: no Eye row while none runs; the Eye above the area row; chips
  "Eye, recipes" in the composer; "Led by <agent ▾>"; a waiting Eye's "Needs
  you" pill and "Open the Eye" hint; "3 agents left over" folded under its item.
- Disconnecting a machine shows its line at the bottom and dims its rows; with every
  machine answering there is no machine line at all.

## The panel

A second mod, `agent-tower-panel`, shows the selected work item in its own column at the
right edge: where the lead stands and what it last said, what needs you, and three rows that
open in place (Workers, Code, Saved progress). This section describes what
is built.

### What you see

The column `tower-detail`, 340px (260–560), hidden until "Details" shows it. One card:
`background`, 10px corners, a 1px `border`, 13px text.

- **Rules and surfaces:** its only two inner rules are the header's bottom border and the
  footer's top border; nothing inside the body draws a line. Space separates groups, and
  only three things are filled: a Needs you block, the Asks you card, and the hover on a
  closed row.
- **One radius:** rows, worker lines, "+N more", the card and the blocks all use 8px.
- **One fade:** 0.7 (200ms), for what a machine that doesn't answer last said and for
  ended workers.
- **Text edge:** text starts 14px in from the card's edge everywhere (header and footer
  `px(14)`, body `px(6)` plus 8px inside each block). The only indent is a worker's report
  under its name. The close X, the chevrons and "Hide text" end on the same right edge
  (the close box has `mr(-6)` so its ink lines up).

Spacing uses 2, 4, 8, 12 and 16. 12 is the optical step: the body's top and bottom, the gap
above the rows, and the space under an opened row.

Type uses three sizes:
- 13: the title (semibold), the state word (medium), the ask question (13/19);
- 12: body and rows (12/18);
- 11: meta, labels, the footer and the space tile's letter.

Weight never marks a kind or a repo name; colour does. Each colour has one meaning:

- `blocked`: Needs you only.
- `ansi1`: a problem nobody has to act on yet, and the one coloured statement on its
  screen. Used for:
  - "N checks failing";
  - a lead or worker quiet with nothing else moving;
  - "<machine> doesn't answer";
  - a stale or failed read in the footer.
- `working` and `done`: only those words.
- `muted`: secondary text, including unpushed commits.
- `dim`: meta.

Every "·" in the body is the same dot with 4px either side.

Top to bottom:

- **Header**, 42px:
  - the space tile (18px); an item with no space gets its program icon (16px) centred in
    an 18px box, so the title starts at the same x either way;
  - the title (the lead's `task.title`, else its hc title, else the sidebar's), cut with
    an ellipsis, full text in the tooltip;
  - the 24px close box "Close the panel".

  No status mark. With nothing selected: "Details" and the close box.
- **Needs you blocks**, one per blocked member, on `blocked` at 8%, 8px apart, 16px above
  what follows.
  - Line 1 (22px):
    - the kind, in regular weight and `blocked`: hc's status kind ("question",
      "sign-in", "permission", "error"), else "needs you";
    - then the agent's name in `muted`, plus its age when it is the lead;
    - "Go to it" on `background`, hover `hover`, 22px, 6px corners.
  - Line 2: the agent's `status.msg`, whole, wrapped by whole words; left out when there
    is none.
- **State line** (20px), always about the lead (a lone agent is its own lead):

  | Lead | State line |
  | --- | --- |
  | done | "Done 2m" (`done`) |
  | idle | "Idle 3h" (`muted`) |
  | working | "Working 12m" (`working`); nothing more while its transcript was written in the last 10 minutes |
  | working, quiet 10 minutes or more | "· quiet 31m", or "· quiet since it started" when quiet as long as the state; `ansi1` when nothing else in the item moved and no tool call is open, else `dim` |
  | working, compacted after its last message | "· compacted 20m ago" |
  | ended (workers still live) | "Ended" |
  | blocked | no state line: the block says it, with the age in line 1 |
  | its machine doesn't answer | "Was working" / "Was done" / "Was idle" / "Was waiting on you" (`muted`), then "· work-vps doesn't answer" (12, `ansi1`); no age, no second line |

  A click goes to the lead. While the Asks you card is drawn there is no state line: the
  card carries the state.
- **Asks you card**, on `raised`, first in the body (12px from the header rule).
  - It shows the lead's `task.ask` label while the lead is done or idle. With no label, and
    only while those leads remain, it shows the closing question of the lead's last message
    under the label "Ended with a question".
  - The label carries the state: "Asks you · idle 2m" (11, regular, `muted`).
  - The question is 13/19, wrapped by whole words.
  - A click goes to the lead. When the message ends with the same sentence, the message
    drops it, and is not drawn when nothing is left.
- **Message**, 12/18, 4px under the state line, 8px under the card:
  - **Done or idle lead:** its last message in `foreground`. Under the Asks you card it is
    context: `muted`, folded to two lines.
  - **Working lead:** its words from this turn in `muted`. With none yet, "Last said 12m
    ago: …" in `dim`. A blocked lead's message uses that form too.
  - **Live `status.msg`:** replaces the transcript text, in `foreground`.
  - **Compacted after its last message:** "Compacted 20m ago. No message since."
  - **Over 4,000 characters:** cut at a word, ending "…cut, go to the agent for the rest".
  - **Folding:** when rows follow and the text is over 135 characters or has more than two
    line breaks, it is folded to three lines ending in "…". A click on the message unfolds
    it in place, and another click folds it. There is no "Show all" line: the "…" is the cue.
  - **Empty states,** in `dim`: "No messages to show for this agent.", "Nothing yet.
    Messages appear here when it finishes a turn.", "The lead has ended.", "Reading
    <machine>…", "Couldn't read <machine>: <last stderr line>", "Can't read messages on
    <machine>: python3 isn't installed."
- **Rows**, 12px below, 28px each, 8px corners, chevron 11px at the right. A closed row's
  hover fills it with `hover`; an open row has no surface, and hovering it only turns its
  chevron `foreground`. The summary never wraps: whole segments drop from the end past 48
  characters, and the first segment always stays.
  - **Workers:** "2 workers · 1 working", "· idle", "· ended", or just "2 workers" when
    their machine doesn't answer. A worker with its own Needs you block is not counted
    again. Opened: one block per worker (needs you, working, idle, then ended), at most 6
    and then "+8 more".
    - Line 1: icon, name, the duration ("2m", 11, `dim`) and the compact status mark, as
      Herdr's sidebar does it. A quiet worker gets "· quiet 14m" in `ansi1`.
    - An ended worker reads "failed" (tooltip "exit code 1") or "ended", with no mark, at
      0.7, and does nothing on click.
    - Line 2: its newest `<hc from>` report in the lead's transcript, as one run: the first
      sentence, paths as file names, cut at a word to about two lines (84 characters), then
      "· 9m ago". A click shows all of it.
  - **Code**, when a member's folder (or a folder one level under the lead's) is a git repo.
    - Summary: "2 checks failing · PR #412 · 19 changed", "3 commits unpushed · …",
      "19 changed · never pushed", "PR #412 · all committed", or "3 repos · 2 checks failing
      · 2 commits unpushed · …". There is no "pushed" segment.
    - Opened, one repo: one line, "rate-limiter · feature/rate-limiter · last commit 5h
      ago". The branch is the part that truncates, full in its tooltip.
    - Two or more (at most 3): each repo's name line, then "7 changed · 1 commit unpushed ·
      last commit 2h ago".
    - A PR line, when there is one, opens it.
  - **Saved progress**, when the lead's folder has a chain link: "Saved progress 1h ago",
    plus "· newer work unsaved" (`dim`) when the lead changed more than 10 minutes after the
    link. Opened: the link's title, then "Next: <first sentence of the next step>" as one
    wrapping run in `muted`, two lines; a click shows all of it.
- **Footer**, 32px, 11px `dim`, pinned, the parts 4px apart with plain "·" between them:
  - **Machine:** "this Mac", "this computer" or the hc name; the task id, recipe and rules
    are in its tooltip.
  - **Check:** "checking…", "checked just now", "checked 6m ago" or "couldn't check". A
    click checks again. It turns `ansi1` past 3 minutes or after a failed check. While the
    lead's machine doesn't answer it stays `dim`: the state line already says so in red.
  - **Folder:** its last path segment only ("rate-limiter"), cut with an ellipsis, the full
    path in its tooltip. It is left out when it equals the title, ignoring case.
  - **"Hide text" / "Show text"** at the right.
- **Nothing selected:** "Select something on the left to see where it stands." No footer,
  no reads.
- **Everything ended:** the title stays, and the body reads "Everything in this item has
  ended."

### How it behaves

- **Live data**: `shared("agent-tower.selected")`, `terminals()`, `agents()`, `spaces()`,
  `machines()`; labels (`task.title`, `task.ask`, `task.id`, `task.area`, `task.recipe`)
  arrive live. Every age is from the sidebar's clock, `shared("agent-tower.changes")`, never
  `status_ms`.
- **Reads**: `read.py` runs once per machine that hosts a member, in parallel, at most one
  in flight per machine. The call is `exec("sh", ["-c", 'python3 -c "$1" "$2"', "tower",
  script, args], {on, timeout: 20000})`. It returns JSON under 64 KB, with times as
  "seconds ago" on that machine's clock; the panel adds the time since the answer arrived.
  It reads:
  - The lead's transcript, last 2 MB, found as agent-images does: the last message, when
    the turn started, the last compaction, how long the file has been quiet, whether a tool
    call is open, and `<hc from>` reports. Claude Code, Codex and pi records are all parsed.
  - How long each worker's own transcript has been quiet.
  - Git status and the last commit for every member's folder.
  - `gh pr view`, reduced to counts and the URL. It runs only on a non-default branch with
    an upstream, at most every 5 minutes per repo, and only where gh exists. It goes
    through the login shell.
  - The newest chain link in the lead's folder.
- **When**:
  - On selecting an item, and when a member's status word or turn changes.
  - Every 60s while a member works, else every 5 minutes. After three failures in a row,
    every 5 minutes; with no python3, every 30 minutes.
  - On a click on the footer's check, which bypasses the gh limit.
  - A 30s timer redraws ages and checks what is due.
  - Nothing runs while the column is hidden. When it shows again, the panel reads if the
    last read is over 60s old.
  - Results are cached per item in memory, so switching back shows the old result at once.
- **Ended workers** come from `hc ls --all --json --label task.id=<id>`, run with the lead's
  machine's read, because `terminals()` drops ended terminals at its next resync.
- **Nothing moves after the first read lands**:
  - A refresh changes only what changed, and a slot keeps its old value until the new one
    arrives.
  - Whether the message is folded is decided once per selection, when the first read lands.
  - A machine that stops answering:
    - fades everything below the state line to 0.7;
    - freezes the ages;
    - hides "Go to it" and the quiet warnings;
    - keeps the rows usable.
  - A read that fails after a good one dims the message and turns the footer's check
    `ansi1`; it adds no text.
- **Masking**, always, before drawing or a tooltip:
  - keys (`sk-`, `ghp_`, `github_pat_`, `xox?-`, `AKIA…`, JWTs, `Bearer …`) and long hex or
    mixed-case base64 runs become "•••";
  - URL queries and fragments are dropped.

  "Hide text" (in `localStorage` as `hideText`) also replaces the message, ask, Needs you
  sentences, reports, saved title and Next, branch names and folder with "Text hidden" /
  "branch hidden", and drops the tooltips except the title's.
- **Clicks**:
  - The title, once: goes to the lead after 250ms (`pane.focus`; a lead without a pane gets a
    tab first, as a click into the task does).
  - The title, twice: rename. As the sidebar does it, this is one `hc label` with
    `task.title` and `task.by=you`, and the space takes the name when it is alone.
  - The close box: `layout.hide {id: "tower-detail"}`.
  - Rows open on their own, stay open across refreshes, and close when another item is
    selected.
  - A worker's line goes to it.
  - A PR line runs `open` (macOS) or `xdg-open`, only for an `https://github.com/` URL.
- **Area**: the sidebar publishes its active area tab as `shared("agent-tower.area")`; an
  item of another area shows the nothing-selected state until something there is picked.

### The four layouts

Three put the panel in the column `tower-detail`, after Herdr's `panel` in the `work-body`
row:

```json
{"id": "tower-detail", "type": "column", "hidden": true, "size": {"px": 340}, "min": 260, "max": 560,
 "children": [{"id": "tower-panel", "type": "block", "content": {"mod": "agent-tower-panel"}}]}
```

Herdr's `panel-body` stack keeps only `files` and `changes`. The sidebar's "Details" runs
`layout.show {id: "tower-detail"}` in each, `tower-stack` included.

| Layout | Difference | Terminal card at a 1280px window |
| --- | --- | --- |
| `tower.json` | the column is independent of Files/Changes | about 640px alone, about 265px (30 columns) with Files |
| `tower-solo.json` | `"props": {"solo": true}` on the block: the column and Herdr's panel take turns | about 640px with Details, about 615px with Files |
| `tower-wide.json` | the column at 420px | about 560px alone, about 185px (20 columns) with Files |
| `tower-stack.json` | no right column: Details sits in the sidebar under the list | the full width, about 990px (642 + the 340px column and its 8px gap); about 615px with Files, as `tower.json` with only Files open |

How solo works:

- Files or Changes opened while Details is open → Details closes.
- Details opened while Files or Changes is open → Herdr's panel closes.

The mod isn't drawn while its column is closed, so a 1s timer, only in this layout, forgets
what it last saw once the column is closed. Herdr's tab bar reads the layout, so its Files
and Changes buttons stay right.

The trade-off: a space whose stored tab-bar choice is Files reopens Files on a switch, which
closes Details. Showing Details then stores "no panel" for that space.

**`tower-stack`** (an experiment) has no right column. In the sidebar column, after
`sidebar-lists`, it adds:

```json
{"id": "tower-detail", "type": "column", "hidden": false, "size": {"px": 380}, "min": 220, "max": 640, "padding": 8,
 "children": [{"id": "tower-panel", "type": "block", "content": {"mod": "agent-tower-panel", "props": {"stack": true}}}]}
```

The list keeps the top part and Details the lower 380px, as a card 252px wide at the
sidebar's default 268px.

How it opens and closes:

- A 1s timer, only with `props.stack`, opens Details while the panel has something to show
  and hides it otherwise (nothing selected, or an item of another area). It decides with the
  same `selected()` the render uses.
- Its × keeps it closed for that item; the next selection opens it again.
- The column starts visible, because a mod whose column has been hidden since the layout
  loaded is never created, so no timer of its own could open it. Once created, the view and
  its timer live on while the column is hidden.
- If Herdr restores the layout with the column hidden, the first "Details" brings it back.

The cost is height: with Details open, the list keeps about 250px at an 820px window.

### Narrower than 340px

The panel measures its own width (`on_size_change`). The character budgets scale with it
(`widthScale`), never above their 340px values, so a panel 340px or wider looks exactly as
described above. The budgets are:

- a row summary, 48;
- a Code detail line, 52;
- a worker's report, 84;
- the message fold, 135 for three lines.

Below 300px the footer leaves out the folder, and the machine name is the part that
truncates, so "Hide text" always fits.

### Built from

- `mods/agent-tower-panel/`:
  - `main.js`: drawing, read scheduling, solo.
  - `panel.js`: pure functions for the item, words, summaries, masking, `clip`, report
    matching, the state line, the message, the ask, read timing and `soloHide`.
  - `read.py`: the per-machine read. Its transcript finder is copied from agent-images'
    `extract.py`.
  - `mod.json`: `place: "none"`.
  - `NOTICE`.
- `panel.test.mjs` beside the item: `node agent-tower/panel.test.mjs` prints "panel ok". It
  also runs `read.py` on a made-up transcript and a real temporary git repo.

### Watch out

- **Whole-word wrap.** GPUI's line wrapper treats every character outside its word set as
  a break point, and "?" is outside it on purpose, so URLs can wrap at "?b=2". A question
  can therefore end with "?" alone on the next line, and no glue character (no-break or
  narrow no-break space) prevents it. So the ask question and the Needs you sentence are
  laid out as flex-wrapped word children (`wordWrap` in `main.js`): a word and its "?" can
  never part. The long message keeps GPUI's own wrapping, which is also cheaper for 4,000
  characters.
- **No inline colour.** gpui-kit has no inline colour change inside wrapping text, so:
  - "Next: …" and a report with its time are each one run in one colour;
  - "Last said …:" is one `dim` string.
- **No pid or argv in `hc ls --json`.** The app's `terminals()` has them, because its
  records come from the full event snapshot.
- **pi in a shared folder.** A pi lead that shares its folder with another pi can't be told
  apart: "No messages to show for this agent."
- **Name length.** hc terminal names are at most 32 characters, so a worker name never
  reaches 40.
- **Chain titles.** chain.mjs titles a link by its body's first `# ` heading, else by its
  file name. A link saved with `--title` whose text starts with `##` keeps that title only in
  its file name, and chain.mjs ignores a frontmatter `title:`. So when chain.mjs's title is
  the file name, `read.py` opens the link (via `chain.mjs root`) and takes, in order:
  1. a frontmatter `title:`;
  2. the file name's words (the `--title` it was saved with, lower case, at most 80
     characters, unless it is "chain-link");
  3. the first heading of any level;
  4. the first line.

### Done when

- `herdr-app check mods/agent-tower-panel` passes and `node panel.test.mjs` prints "panel ok".
- Each situation looks as described in its own screenshot:
  - the lead finished and asks, closed and with rows open;
  - working;
  - a worker blocked on a sign-in, and the lead itself blocked;
  - a machine that stops answering after a read, and one that never answered;
  - a lone agent with no repo and no chain;
  - nothing selected;
  - long text;
  - fourteen workers;
  - text hidden.
- The stress fixture holds at 340px, closed and opened: nothing overflows, nothing wraps
  under an icon, no mark leaves its row, and no "?" stands alone. The fixture has:
  - a 60-character title;
  - a three-line ask;
  - a 32-character worker name;
  - a 45-character branch;
  - three repos;
  - a worker with a long last sentence.
- In `tower-solo`, Files closes Details and Details closes Files, in either order.
- In `tower-stack`, with the stress fixture at the sidebar's default width:
  - Details opens on a selection and hides with nothing selected;
  - nothing clips;
  - the same item at 340px in `tower.json` is unchanged.
