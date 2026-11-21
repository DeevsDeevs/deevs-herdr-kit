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

- **Area header**, Herdr's flat header: 31px, 16px left and 10px right padding; the area
  words 6px apart, the icons 2px apart.
  The areas from the settings (default "Work" and "Personal") as plain words, 11.5px
  medium, shown when there are two or more: the shown one in `foreground`, the others in
  `dim` (hover `foreground`). An area you are not looking at shows Herdr's tinted badge
  (14px, 4px corners, `blocked` at 15% under `blocked` 10.5px bold) with the number of its
  items under Needs you, tooltip "2 need you in Work". On the right, while the shown area has no running Eye (and
  its `eye` is not `false`), a 26px eye icon button "Start the Eye" (it starts that area's) (dimmed, "Starting the Eye…", while it starts),
  then, with Views switch "One icon in the list's header" (and not in the window), a 26px
  button with the shown view's icon, "Views", opening a 240px menu: the area's views with
  their keys (the shown one checked), "New: <recipe>" for each of the area's `buttons`, and
  "Take the whole window" / "Show the list beside it" while a view other than List is up;
  a 26px `search` icon button "Search tasks, agents and machines in every area (Ctrl-S /)"
  (below), then a 26px `plus` icon button, "Tell the Eye, start a task or a space" while an
  Eye runs, else "New task or space" (`dim`, hover `hover` + `foreground`, shown pressed while the composer is
  open); in the window also a 26px `x` button, "Close (Esc)". No title: Herdr's brand row
  sits above it.
- **The area's menu** (a right-click on the header, 240px): "New task", the area's views
  with their keys, then "Settings…", which opens Switches. With "Right-click on the area
  row" set to "These settings", the right-click opens Switches directly.
- **Switches**: a 260px popup with eight sections, each choice checked when current and
  remembered in shared state: "Done in another area" (below); "Left of a task" ("Its
  state", "How many agents work"; `shared("agent-tower.rowMark")`, default Its state);
  "Views switch" ("One icon in the list's header", "A bar above the centre", "A row at the
  foot of the list"; `agent-tower.viewSwitch`, default the bar, the header icon in a layout
  without `tower-viewbar`); "A list row while a view is up" ("Goes into the task" / "Peeks,
  the view stays") and "An agent clicked in a view" ("Goes into its task" / "Peeks, the
  view stays"); "A task in another area" ("Brings
  its area's window" / "Shows it here"); "Right-click on the area row" ("The area's menu" /
  "These settings"); "Double-click on a task" ("Same as a click" / "Renames it"), the last
  five each kept in `agent-tower.choice.<name>`. Every flip and view switch is appended to
  `<tower folder>/use.jsonl` as `{at, what, from, to, how}` (`how`: click, key, menu or
  back) so unused variants can go; `use.md` beside it sums up what was switched to, how
  often and about how long each view was on screen, rewritten at most every 10 minutes and
  when the list closes.
- **Search**: the magnifier or `agent-tower.search` (`ctrl-s /` in keys.json) opens a 28px
  field under the header (`accent` border, `search` glyph, an `x` that closes it; Esc closes
  it too). While it holds words, the list is one group headed "N tasks" ("1 task"; "Nothing
  found" when empty) of every item in every area,
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
    per other area with news: "Personal · File the 2025 tax return  3m ●" for one finish,
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
  most, the whole text in the tooltip). A click goes to it; a right-click opens its menu,
  "Open" and "End the Eye…"; "End the Eye…" asks "End the Eye?" with "Keep the Eye" / "End
  the Eye". Its first 20 s
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
    which carries their area. After the Eye and recipe chips (and a short divider when there
    are any), the row ends with Herdr's own "New space" chip (10px `plus`, then the word),
    left out while "in <title>" is on; with other connected machines a chevron beside it
    opens "New space on <machine>". It runs `space.new` (a task from birth, adopt.js) and
    closes the composer.
  - While a task is selected, an "in <title>" chip (off by default, the title cut to fit);
    on, it shows "lead | worker" beside it, and Enter starts that agent inside the task (New
    lead, below) instead of a new task. The row menu's New lead opens the composer with it on,
    "lead" picked and the task's own recipe chosen when it is in the shown area. With
    "worker" picked, the hint line names the worker agent in `dim`.
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
  (a `chevron-right` shows while folded). Spaces and Left over start folded; Earlier starts
  open (one fold per area). Folds and opens are kept in shared state, so an area switch keeps
  them. Earlier: one 24px line per task, newest first, nothing under it. Done shows at most 5 rows, then a 26px "N more" row in `dim` at the
  sub-row inset that shows the rest ("Show fewer" folds them again).
- **An item row**, Herdr's agent row: 8px side and 5px vertical padding, 8px corners,
  hover `hover`, `selected` when it is the selected item (below), no tooltip on the row (it
  covered the next row's wait line); the title has one, the whole title, only when it is too
  long to show whole (not while the row's menu is open). A 20px line with 9px gaps:
  - what stands at the left says something about the task (the space's letter said
    nothing): by the "Left of a task" switch, **its state**, the row's status mark (below)
    in an 18px cell, and then the mark column at the right stays empty; or **how many agents
    work** in it (its live terminals whose status is working), 10.5px bold in `working` on
    an 18px tile with 5px corners, `working` at 15%, with the mark at the right as before; a
    task that needs you, or has none working, shows its state mark there instead;
  - the title: `task.title` for a task; else the agent's own title, cleaned the way Herdr's
    agents list cleans it (no status glyph, not the program's name, not a path, no program
    glyph in front: "π - shad" reads "shad"); else the space name. `muted` when the item is
    idle and not focused, else `foreground`. It shrinks only when the row is full;
  - " · <note>" in `dim`, at most 90px, giving way twenty times faster than the title: the
    space name when the title does not already contain it; when the same title still shows
    twice in the area, the lead's name, else its address without the machine ("t41");
  - the machines, when any is not the area's home machine: the 11px `server` glyph in
    `dim`, every machine in its tooltip (an item row never prints the name); merged,
    left-over and space rows print the name instead (10px `dim`, at most 56px,
    right-aligned) and fall back to the glyph when the title needs the room. The home
    machine is the first machine the area's settings list, else this computer (never a
    majority of its rows). A row on this computer in an area that lives on another machine
    says "this Mac" ("this computer" off macOS);
  - the fold chip column, 18px, present only when some row in the area has a chip (below
    300px only on rows that have one): when the item has workers, `chevron-down` in `dim`;
    folded, `chevron-right` in the most urgent worker's colour, no count;
  - the age, 11px `dim`, at least 28px wide from 300px of list up, right-aligned, Herdr's
    compact form ("<1m", "13m", "18h", "3d"): the newest change among the item's
    terminals. The age ("25m") in `working` when the item is working and nothing in it
    changed for 20 minutes (the still clock says quiet); "lead gone" in `blocked` for a task
    whose lead ended;
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
  shell took its place) reads "lead ended" in `blocked` under its row, unless the task waits
  on you; a lead whose terminal ended reads "lead gone" in the age column instead. Either
  way its item menu offers New lead.
- **The title wins.** When the list is narrower than 300px (the sidebar's width from
  `layout()`; the window counts as 320px) no row prints a machine; it stays in the
  tooltip. At any width the space note gives way before the title (the machine glyph on an
  item row stays), until the title has room for 16 characters or all of itself
  (`model.fitRow`, which estimates 7px a character at 13px and 6px at 10-11px); space,
  left-over and merged rows turn their machine name into the glyph, or drop it when the
  title then fits whole.
- **Rows that read alike** (same title, space and machine, no workers, same group) are
  one row: the title, a `dim` "×6", the newest age, the most urgent member's mark, a
  chevron in the chip column. A click goes into its newest member; the chevron opens one
  26px row per member at the sub-row inset, named by the lead's `name` else its address
  without the machine, with its own age and mark; a click there goes to that agent.
- **Under a task**, Herdr's sub-rows: 26px, 39px left padding, 12.5px, 8px corners; the
  tree lines (9×17px boxes with a 1.5px `input` left and bottom border, 6px corner on a
  branch), the program icon (14px), the name in `muted`, the status mark. The shown or
  focused one sits on `raised`. In order:
  - **the lead**: "Lead", with its machine in 10.5px `dim` (at most 72px) before the mark,
    always shown ("this Mac" here on macOS, "this computer" elsewhere): it says it is the
    lead and where it runs; none when the lead has ended;
  - **the workers that work or wait**, and the rows above them (a sub-lead stays while its
    workers run), each named by `name` (else template, program or address) with its machine
    in 10.5px `dim` before the mark when that is not the area's home;
  - **one line for the rest**: "2 done · 10 idle" with a chevron, 12px `dim`; a click opens
    their rows under it. A worker's Done stays Done (it finished and reported; agreed with
    the panel), but only the lead's Done makes the task Done, and only once nothing in it works.
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
  tiles' do: running, tooltip "Eye", a click goes to it and a right-click opens its menu
  ("Open", "End the Eye…"); not running, `dim`, tooltip "Start the Eye" ("Starting the Eye…"
  while it starts, dimmed), and a click starts it. When the sidebar is narrower than 160px
  (Herdr's rule, read from `layout()`),
  no header, composer or group labels: each item is a 32×26px cell holding its tile or
  program icon (a task that needs you keeps its tile, with a `blocked` badge like the Eye's)
  with its mark as a 6px badge at the bottom
  right and its title as the tooltip, groups separated by a short `border` line, then the
  spaces as tiles and the machines as `server` icons.
- **Empty area**: "No tasks" in 12px `dim`.
- **The item menu** (right-click on an item), Herdr's menu: a `popover` popup 250px wide,
  5px padding, 12.8px; 31px items with a 14px `muted` icon: "Details" (`panel-right`, one
  item only), "Peek" (`monitor`, one item with a lead), "Pin to the top" / "Unpin" (`pin` /
  `pin-off`, one item whose lead has not ended), "Rename" (`square-pen`, not in the rail,
  which has no row to rename in), "New lead" (`plus`, one task, not in the rail), "Make a
  task" (`plus`, for an agent that is not a task or a space of only shells),
  "End task…", "End agent…" for an unlabelled agent, "End all 6…" on a merged row (Herdr's
  word for a terminal and what it started; "Close" is for spaces and panes),
  "End 8 agents left over…" when it has left-over agents
  (`x`), then a divider and "Space menu" (`layers`). ↑/↓ move, Enter runs, Esc closes.
  "End…" turns the popup into the question, on one line, in lead and worker words: "End
  <task title>?" (the title cut to 29 characters and "…") with "Keep running" (`raised`)
  and "End all N+1" ("End it" when it is one terminal; `solid`, `solid_foreground`; every
  button has a 1px border, `accent` on the chosen one); "End <title>'s N workers?" for a
  task whose lead is gone; "End the lead and its N workers?" only for an item without a
  task title; "End this agent?" / "End it" for one terminal; "End these 6 agents?" / "End
  all 6" on a merged row; "End these 3 agents?" with "Keep them" / "End 3 agents" for
  left-overs ("End this agent?" with "Keep it" / "End it" for one). Keep running is
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
  agents; a mod can't add to it.) Else it is working when anything in it works, whatever
  its lead's word (a done lead whose workers still work: Working); else finished when its
  lead is done (it finished and nobody has looked since); else idle (see Done and Earlier
  below). Every view (Board's columns, Radar, Watchlist, Timeline's line and its "now", the
  rail, the panel's header mark) shows that same word. An area's pill counts its
  Needs you only.
- **Done**: a lead with a pane is Done while Herdr says "done" (Herdr clears it when
  someone looks). A lead without a pane (an `hc run` lead, which `agents()` never lists) is
  Done for 12 hours after the lead's own last change, until Herdr's `herdr.seen` label on it
  reaches its turn (someone looked at it in Herdr or another client), or until it is clicked
  here: the click stores its address and the lead's own change time in
  `shared("agent-tower.seen")` (pruned like the change times, below); a stored time at or
  after the lead's finish counts as seen (older versions stored the task's newest time). Only
  a new change of the lead makes it Done again; a worker's change neither brings it back nor restarts its 12
  hours. It then falls to Idle or Earlier. A done lead whose workers still work shows in
  Working; when the last one stops it is Done, unless it was seen meanwhile (in its pane, by
  `herdr.seen`, or by a click on its row in Working, which stores the same time).
- **Earlier**: an item that would be idle, quiet for 24 hours or more.
- **Order**: inside a group, Earlier too, most recently changed first; in Working an item quiet
  for 20 minutes goes first; the same time goes A-Z by title (case and accents ignored, numbers
  by value), so the order never flickers.
- **Age** is the time since the mod saw a terminal's status word or turn change, on this
  computer's clock, first seen at the core's `status_ms` when there is one, else at that
  moment. Each list copy (the docked list, the window) looks every second from a timer,
  drawn or not (Herdr draws no covered, minimized or hidden window but runs its timers), so a
  change gets its time within a second; each draw of a list copy looks first too, so it never
  shows a word a second old. A `done` that comes
  without `working` before it at the same turn (Herdr reports an old agent done again when
  it is opened or peeked at) is no new finish; its time stays. A higher turn is a new finish
  even when its `working` fell between two looks; without a turn the word alone decides. The
  times are kept in `shared("agent-tower.changes")` so the copies agree and they survive a
  restart: before it looks, a copy folds in another copy's writing (`model.mergeChanges`: for
  the same word and turn the earlier time wins, for another state the later sighting, on the
  same time the higher turn, then the word), so every copy ends with the same times; only the
  copy whose entry won writes back, under a new `changesV`. A change another copy saw first
  is still news to the recorder's holder. A terminal no longer in `terminals()` is marked
  gone and forgotten a day later (`model.forgettable` picks which may be marked), but only
  on a machine that answered and showed terminals in that read: a quiet machine, or the
  empty read right after a start, loses nothing; one that comes back with the same word and
  turn drops the mark and keeps its time; anything unseen for 30 days goes anyway. Ages
  redraw once a minute.
- **Area** of an item or a space: `task.area` when set, else the first area whose
  `machines` list holds its machine, else the area marked `default`.
- **Spaces**: the spaces of the shown area with no live agent and no live task
  terminal inside (a terminal without a `herdr.space` label counts for the space of
  whatever started it). A click runs `space.select {id}`; a right-click opens Herdr's own
  space menu, the way the shipped `spaces` mod opens it.
- **Board's Lead chip** (on the selected card) shows the lead's own word (`leadWord`:
  blocked when the ask is the lead's own, a seen Done idle), not the task's, so an idle lead
  whose worker asks or works is no blocked or busy lead.
- **Views**: List, Board, Timeline, Radar and Watchlist. An area offers List, Board,
  Timeline and Radar unless its `views` setting lists others; the first listed is where it
  opens. A view other than List shows either in the centre beside the list or over the
  whole window (the sidebar hidden); `ctrl-s m` flips that. Each area comes back to the
  view, shape and task it was left on.
- **A click on a task row selects the task and opens its lead**, also
  when you come back to it from one of its workers; folding is the chevron's alone. A task
  clicked in Board, Radar or Timeline goes into it: the list's screen comes back (the sidebar
  shown in either shape) with its lead open, and "‹ Board" (the view's icon and name, where
  the views switch sits: the list's first line, the bar, or the foot row) goes back one step,
  shape included. Any other view switch forgets it. Views call `ui.select` for this; `ui.pick`
  selects without leaving the view. A click on a row or a merged row's member also runs
  `layout.show {id: "tower-detail"}` when the layout has that column hidden. A click on its lead or worker row opens that terminal: `pane.focus
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
  its own machine, and the list shows it once it appears (Names names the space and its tab); "Opening it on mac…" meanwhile). A machine that does not answer: no button,
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
  Then it names the task: a start with a title (`tower-new --title`) has its name; any other
  asks the namer (below) and waits up to 8 s for it (it answers in about 3 s; meanwhile the
  composer stays open, dimmed, with your words). Then it makes a 5-character id, opens a new space for
  the lead with `space.new {name, tab, folder, machine, argv, task}` (name the title, else
  "New task" when the namer was late; "<name> 2" and on while a start with that name is
  pending; tab "lead"; machine from the
  recipe; folder the recipe's `folder`, else `<taskRoot>/<slug>-<task id>` made on the lead's
  machine (`model.taskFolder`: the area's `taskRoot`, else the settings', else `~/tasks`; the
  slug from the title, never the words typed: its first four words without small words (a,
  an, the, and, of, for, in, on, with; "to" stays: "Cache to Redis" is `cache-to-redis`),
  three when four pass 32 characters, lowercase, joined by hyphens, punctuation dropped; with
  no title, `<taskRoot>/<task id>`; `sh -c 'mkdir -p … && cd … && pwd'` there, so `~` is that
  machine's home). The folder is made once and never moved or renamed: a later title leaves it. If the folder can't be made the start is refused, "its folder could not be
  made in <dir>"; a task never gets the shown space's folder. argv the lead agent's run through
  `env TOWER_TASK=<id> TOWER_WORKER=<workers' agent command>`, so the message you read holds
  no ids, paths or usage text; task: the first message below). `TOWER_WORKER` is the path of
  a small script, `worker-<agent id>`, that runs exactly the worker agent's argv; it is
  written on the lead's machine (`<tower folder>/bin/` here, `~/.config/agent-tower/bin/`
  elsewhere), and if it can't be written `TOWER_WORKER` is the argv, shell-quoted. The start
  closes the composer, then watches for the space with that name on that machine, finds
  its terminal and labels it in one `hc label` call (`task.id`, `task.role=lead`,
  `task.title=<the title>` with `task.by=eye` (`--title`), `you` (`--title --yours`) or `llm`
  (the namer in time), else `task.title=<your words>`, `task.by=raw`, `task.recipe`, `task.area=<the recipe's
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
    `Start workers with: <the worker argv, shell-quoted>`; for a worker agent that needs its
    folder trusted (agy), `Start workers with: <$TOWER_WORKER's script path, shell-quoted> (on
    another machine: <the worker argv, shell-quoted>)`, since the script (the same one the skill
    uses, which trusts the worker's folder for its session) exists only on the lead's machine; the argv
    alone when the script could not be written and "Task: <your words>". The skill itself is written elsewhere. In the contract,
    `{worker-skill}` (the end of a brief) becomes "; use the <skill> skill if you have it"
    with the configured skill's name, and nothing when no skill is configured.
  - The skill form is used only where the skill is: before a start the mod runs
    `sh -c 'test -f "$HOME/.agents/skills/$1/SKILL.md"' sh <skill>` on the lead's machine
    (`exec` with `on`; the name is an argument, never part of the script; a name that is
    not a plain skill name counts as missing), once per machine, kept for the session (a
    check that could not run is asked again). Missing: the full contract.
  - The full contract (`DEFAULTS.contract`) says what the tower skill's Lead part says, in
    its order, in plain lines: plan and delegate; `task.ask` before waiting on you and
    cleared next turn, asked only when a decision needs you; the task's terminals (`hc ls
    --json --label task.id=<id> | jq -r '.terminals[].address'`, `--all` for ended ones) and
    one terminal's labels (`hc get <address> | jq .labels`); name the task before the first
    worker, again only when its mission changes, with the one line above, and never rename or
    move its folder; start workers with the agent
    command named below, brief on the run line, `--cwd <dir>` (the task's own folder), a
    `<role>` that says what the worker works on (not a step or a counter), a
    remote worker by `<machine>/<id>-<role>`; reuse an idle worker when its context fits, a
    fresh one for a cold look; a sub-lead starts with the same `task.id` and
    `task.role=worker`; what a brief gives and how it ends (report to the parent with the
    result path); after starting workers `hc read` each once (a folder-trust or sign-in
    prompt stalls a new worker without telling you), routine prompts with `hc keys`,
    permissions, sign-ins, deleting or sending to the person; `hc wait --children any
    --timeout 100`, never poll, what to do on a report or a stop, and `hc file read --on
    <machine>` for a remote worker's file; the last message opens with one or two plain
    sentences; a chain link at milestones; done is said, ending the workers left to you.
    The test checks the order against the installed skill.
- **The Eye**, one per area. An area's Eye is the newest live terminal labelled
  `tower.eye=1` and `tower.area=<area id>` (`model.findEye(terms, area)`); an older Eye with
  `tower.eye=1` and no `tower.area` (from before Eyes were per area) stands in for every area
  that has none of its own and doesn't say `eye: false`, until you end it. No terminal with `tower.eye=1` is ever an item.
  An area with `eye: false` has none: no icon, row, chip or rail cell. An Eye is only ever
  started by your click on the eye icon (the header's, the rail's Eye cell or the whole
  window's bar), for the shown area, or by `tower-eye start` (below): a space "Eye · <area label>" on this computer in the
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
  `"$TOWER_NEW" --title "<Name>"`, naming each task in your style (naming a task it starts is
  not renaming; your own name with `--yours`), choosing one of its area's recipes from
  "$TOWER_CONFIG"; asked to rename a task, `hc label <lead> "task.title=<Name>" task.by=you`; a task's terminals and
  labels by the same `hc ls`/`hc get` lines as a lead's; a task whose lead has ended, or that
  you want a fresh lead for, gets `"$TOWER_NEW" --task <id> <recipe id> "<their words>"`,
  never a new task; passes messages to
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
  - **`tower-eye [status | start | end] [--area <id>]`** (beside `tower-new` in the mod
    folder) does without a click what the icon and End do, through the inbox; no word means
    `status`, and the area defaults to the one with `default: true`. `status` prints one line per area (its Eye's
    address and state, "none", "starting", or "no Eye (eye: false)"). `start` answers
    "Started Work's Eye: t5." once the Eye is labelled, says so when one runs, and is refused
    for `eye: false`. An agent started by hand on this computer in a space named exactly
    "Eye · <area label>" is labelled `tower.eye=1 tower.area=<id>` instead of starting a
    second ("t6 in "Eye · Personal" is Personal's Eye now"); it has no `TOWER_AREA`, so
    `tower-new` doesn't check its area. `end` ends that area's own Eye only; the older Eye for
    every area is refused ("end it from its menu"). From an Eye (`TOWER_AREA` set, sent as
    `by`), `start` and `end` act on its own area only; `status` sees all.
- **The inbox**, how the Eye starts tasks exactly as the composer does: `tower-new`
  writes `<tower dir>/inbox/<id>.json` (`{recipe, words, agent?, area?, task?, as?, at}`,
  `area` from `TOWER_AREA` when set, `task` and `as` from `--task <id>` and `--as lead|worker`,
  `title` and `yours` from `--title "<Name>"` and `--yours`; written aside and moved in) and waits up to 25 seconds for `outbox/<id>.json`, printing it as
  one line of JSON. `tower-new [--title "<Name>" [--yours]] [--task <id> [--as lead|worker]]
  <recipe id> "<words>" [agent id]` (`--as` without `--task`, `--yours` without `--title`, an
  empty `--title` or `--title` with `--task` are wrong usage) exits 0 when started, 1 when not, 2
  on wrong usage. A title that is only spaces is refused, "the title is empty". The docked copy (never a window) watches the inbox with `watchFolder`,
  scans it at start and on a 5 s tick, and acts only while it holds the lease file
  `<tower dir>/inbox.lease` (`model.leaseKeeper`; renewed every 10 s, free 20 s after the
  last renewal, a copy without it tries every 10 s, released when the copy closes). Timeline's
  recorder works the same way on `recorder.lease` (renewed every 20 s, free 45 s after), held
  only by a docked list (every layout with a view has one; a view's own copy never takes it;
  a copy that takes it back records nothing until it has read the record again):
  the holder records from its one-second look, drawn or not, on a change, a new look, an
  ended terminal and every 30 s, and a look that comes over 2 minutes after the last (the
  computer slept) marks the time between as not recorded. A gap less than 10 s after the one
  before it on the same machine joins it (`model.joinGaps`, `GAP_JOIN_MS`): a sleeping Mac
  that wakes for a few seconds every quarter hour leaves one gap, not one per wake, and those
  seconds are drawn as not recorded. The recorder joins when it adds or closes a gap, merges
  two writers' files, loads `events.json` and moves gaps into `index.json`; Timeline joins
  when it reads either file, so a file written before this reads joined. The
  tower dir holds `config.json`, `inbox/`, `outbox/`, `inbox.lease`, `recorder.lease`,
  `bin/` (workers' scripts), `eye/<area id>/`, `use.jsonl`, `use.md`, `perf.jsonl`,
  `timeline/` (`events.json`, `screens.json`, `beat.json`, `index.json`, `ended.json`,
  `backfill.json`, `tasks/`: Timeline's history, trimmed under Herdr's 1 MiB file limit),
  and for Watchlist `watchlist.json` and the notes file it names (default
  `investing-notes.md`). The inbox and outbox are created 0700, and narrowed to 0700 when
  wider. Only regular files are acted on (`find -type f`: a link or a folder is never
  read). One read at a time; each request is deleted, then checked: over 64 KB is "too
  big"; an id already handled this session is "already handled";
  `model.checkRequest`: older than two minutes when first seen, by its `at` or the file's
  time, is "too old", more than two minutes ahead is "its time is more than two minutes
  ahead"; an unknown recipe or agent or no words says so in words; a request with an `area`
  naming a recipe of another area is refused ("the recipe X is in Personal; this is Work's
  Eye"). A request without `area` (by hand, or from an older Eye) is not area-checked. Then it goes
  through the composer's own start (`startTask`: refusals, machine check, pending row,
  label, naming). The answer is `{ok: true, task, starting: true}` as soon as the start goes
  ahead (the request is checked and its machine answers), before the namer's wait, the folder
  and the space, or `{ok: false, why}`. From then on the only refusal left is a folder that can't
  be made, said in a toast. Answering at the space instead could pass `tower-new`'s 25 s on a cold
  machine; it would then say "nothing was started" while the task starts, and an Eye trying
  again would start it twice. Answers
  nobody fetched are swept from the outbox after ten minutes.
  A request with `task` goes to New lead (below) instead (`model.checkJoin`): `as` left out is
  lead; refused with "there is no task "x"", "task x is in Personal; this is Work's Eye" or
  ""boss" is not lead or worker"; answered `{ok: true, task, as, starting: true}` once the tab
  is asked for.
  Two more request shapes go the same way (same lease, size, age and id checks), each
  answered with `{ok, why?, text}` that the script prints: `{names: {apply, named, space}}`
  from `tower-names` (Names, below) and `{eye: {do, area, by}}` from `tower-eye` (`by` is
  the sender's `TOWER_AREA`). `tower-adopt [--apply] [--space <id or name> [--title <words>]
  [--lead <address>] [--area <id>]]` sends `{adopt: {apply, space?, area?, title?, lead?},
  at}`: it makes spaces made before Tower into tasks by labels only (one space, one task,
  named after the space, in its machine's area). Without `--apply` it is a dry run printing
  each space's title, area, lead and workers, its machine and how long it has been quiet.
  It waits up to 60 seconds; exit 0 done, 1 not, 2 wrong usage. Like `tower-new`, all of them need
  Agent Tower showing; in a layout without it nobody reads the inbox, and they say so after
  their wait.
- A recipe naming an agent the settings don't have falls back to the role's default, with a
  toast "Recipe <label>: unknown agent"; a recipe with an old `argv` (which wins over its `lead`
  and `roles.lead`) gets "Recipe <label>: argv overrides lead". Each shows once a day, from the
  docked list (`agent-tower.warned`); the reasons are in the README's Settings.
- **Name**: a start without a title asks the namer before anything is made, in the person's
  style (`model.namePrompt`): one to four words, the object first and the kind of work last
  ("Parser fuzz review", "Invoice export fix", "Cache to Redis", "Bird song guide"), a verb
  only when it is the work ("Fix login redirect"), no filler, pronouns, articles or words for
  the process, a misheard word not copied when the right one is plain. No digits except inside
  a product or protocol name (S3, IPv6, H264): amounts, prices, sizes, counts, dates, years,
  times, versions, ids and issue numbers are left out with the words that lead to them, shown
  by four examples ("buy a kettle under 80 €" → "Kettle pick", "fix bug #317 in the signup
  form" → "Signup form fix", "move the wiki from v2 to v3" → "Wiki upgrade", "label the 500
  scans from 2019" → "Scan labelling"), and said again after your words: "The name, without
  numbers:" (by default `claude -p --model haiku --no-session-persistence --tools ""` with
  your words as data, 60 s limit). An answer is one non-empty line. Then, whatever the model
  said (`model.acceptName`): a token that is only a number, an amount, a time or a date
  (digits with currency signs, separators, %, units stuck to them, `#482`, `v22.4`,
  `ABC-1234`) goes, with the words it leaves dangling before it ("under", "for", "about",
  "to", "from", "at", "in", "issue", "PR" and the like) and a unit standing after it ("300
  euros", "16 GB"); a word left dangling at the end goes too ("Tax summary with 1099s" → "Tax
  summary"), and a name that lost its first word starts with a capital. A token that starts
  with a letter (S3, IPv6, H264, Q3), or is no amount (3D, 2FA), stays. Nothing left, or only
  filler words, is no name; otherwise it must be at most 40 characters. In the 8 s
  wait it names the space and the folder; later, it reads the lead's labels again with
  `hc get` right before writing (the list may not show a label written a moment ago) and
  writes `task.title` and `task.by=llm` in one call only if `task.by` is still `raw` (nobody,
  neither you nor its lead, named it meanwhile); the space follows through Names. If it fails, your words stay.
- **The lead names its task** (the skill's Lead part and the contract): once it understands
  it, before its first worker, and again only when its mission changes, with one line that
  writes `task.title=<Name>` and `task.by=lead` on its own terminal only while `task.by` is
  `raw`, `llm`, `eye` or `lead`: `hc get $HC_TERMINAL_ID | jq -e '.labels["task.by"] // "" |
  test("^(raw|llm|eye|lead)$")' >/dev/null && hc label $HC_TERMINAL_ID "task.title=<Name>"
  task.by=lead`. It never renames or moves the task's folder. The space follows through Names.
- **Your titles win** (`model.personTitles`): a title whose `task.by` is `you`, `adopt` or
  `space` is remembered per task in `agent-tower.own-titles`, with its lead's address (Herdr
  keeps it across restarts; a Rename is remembered at once). When a live lead's labels then show another title with
  `task.by` `raw`, `llm`, `eye` or `lead` (an agent wrote over it), the docked copy that holds
  the inbox lease writes the remembered title and its `task.by` back, on its 2 s naming tick,
  at most once a minute per title. A write made while no copy runs is put back when one runs
  again, if the person's title was seen before; one set and overwritten while none ran is not
  known. An agent that writes `task.title` alone, leaving `task.by=you`, can't be told from
  you and is kept. An entry is forgotten once its lead is gone from a machine that answers and
  shows terminals (`model.forgettable`), so a machine not loaded yet after Herdr starts keeps its
  titles; an entry from before the address was kept goes when its task is gone with every machine
  answering.
- **Rename** (item menu) turns the row's title into an input in place, title selected.
  Enter saves (cut to 80 characters), Escape leaves it. On a task it writes `task.title`
  and `task.by=you`; on an unlabelled agent it writes `task.id=<new id>`,
  `task.role=lead`, `task.title`, `task.by=you` in one call, which makes it a task. The
  space follows through Names, unless someone typed its name. The model never touches a
  task whose `task.by` is `you`.
- **Names** (`model.wantedNames`), in Herdr's own screens (its spaces, tabs and Agents list):
  - At birth a task's space has its title (or "New task" when the namer was late) and its tab
    "lead", both recorded as ours in the lead's one label call. While the title is still the
    raw words (`task.by=raw`) nothing is renamed; the space takes the namer's late title when
    it answers, and stays "New task" until a Rename (or its lead names the task) if the namer fails.
  - A space holding one task alone takes the task's title, and follows it (the namer's name,
    a Rename, its lead's own name). A space with several tasks, or none, keeps its name; an Eye's
    space keeps "Eye · <area label>".
  - Tabs, by the first terminal in them (Eye, then lead, worker, shell): "Eye"; "lead"; a
    worker's hc name without its task id (`<id>-<role>` shows `<role>`; the hc name keeps the
    id), else "<program> worker"; "shell", or "shell · <folder>" when the
    space has two shell tabs. Where the space doesn't say the task (several tasks, or a name
    someone typed), the lead's tab says "lead · <title>", since the Agents list shows
    "space · tab".
  - **Ours or a person's:** Herdr only says `named` (true after any rename). Every name the
    mod sets is first labelled, `tower.space-name=<name>` on the space's first terminal (Eye,
    lead, worker, shell) or `tower.tab-name=<name>` on the tab's, then `space.rename` /
    `tab.rename`; if the label call fails, nothing is renamed. A name is changed only when
    `named` is false or it equals such a label in that space or tab. A tab still carrying a
    terminal's hc name (Herdr names a tab opened by Keep after it) counts as Herdr's, but only
    while the mod has never named that tab (no `tower.tab-name` on a terminal in it); an hc name
    typed back after that is the person's. Any other name was typed and is never changed. The start and the Eye's start label their `space.new` name in
    their one label call, so a new space is ours from birth; a lead found while the window
    closes gets the same call.
  - **When:** every 2 s in the docked copy that holds the inbox lease (one per computer). A
    machine whose layout isn't ready waits; each name is tried at most once a minute. This
    covers the start, Open as a tab, adopt, New space, Rename, the namer and a tab opened by
    hand; the namer, Rename and Keep rename nothing themselves.
  - **`tower-names [--apply] [--named] [--space <id or name>]`** (beside `tower-new`): a dry
    run prints each space, then its tabs, old → new, and a typed name as "kept: <name> | with
    --named: <title>", counted on the last line. `--apply` sets them; `--named` also
    replaces typed names. Exit 0 done, 1 not, 2 wrong usage.
- **New lead** (item menu, the composer's "in <title>", or `tower-new --task <id> [--as
  lead|worker]`) starts an agent inside a task (`joinTask`): a new tab in the task's space on
  its lead's machine (named "lead" for a lead), or, if that space has gone, a new space named
  after the task. Its machine is the anchor's: the lead's, or its first live member's once the
  lead has ended. Folder (`model.joinPlace`, home folders left out): the first that exists on
  that machine, looked for in one `exec` (`FIRST_DIR_SCRIPT`), of the lead's launch folder (hc's
  `cwd`: it wins while it exists, so no `cd` of the lead, in or out of the task or through a
  symlink, moves the task), then the folders the lead and the task's live members on that machine
  run in now (hc's `foreground.cwd`: a folder moved by hand, where hc keeps the old path), then
  their launch folders; with none of those, the recipe's `folder` (looked for the same way), else
  `<taskRoot>/<slug>-<task id>` made as for a start. When none of the task's folders exists the
  start is refused, toast "The agent didn't start", "<the first of them> does not exist on <machine>",
  and `tower-new` gets the same reason. One at a time per
  task ("a new agent in this task is still starting"). Found like a start (a live terminal in
  a tab of that space that wasn't there before, given up after a minute) and labelled in one
  call: a lead gets `task.id`, `task.role=lead`, the task's `task.title` and `task.by`,
  `task.recipe`, `task.area`, `task.lead` and `tower.tab-name=lead`; a worker `task.id` and
  `task.role=worker`. Then the lead before it becomes `task.role=worker` while its agent runs,
  `task.role=shell` (no row) once its program has ended; an ended terminal keeps its labels.
  - A new lead's first message, with the skill, two lines:
    `You are the new lead of task <id>, "<title>", taking over from its earlier lead: its terminals and its chain say where it stands.`
    and `Lead task <id> with the tower skill (questions to me go through task.ask): <words>`.
    Without the skill: the recipe's rules, that same "You are the new lead…" line, then the
    full contract and "Task: <words>".
  - A worker added from the list gets four lines:
    `You are a worker on task <id>, "<title>"; use the tower skill if you have it.`;
    `Do exactly the task below. Start no other agents unless it says so; if it does, start them with --label task.id=<id> --label task.role=worker, and they report to you.`;
    `Put long answers in a result file. When done or blocked, report to your parent, the task's lead (<lead address, or: hc ls --json --label task.id=<id> --label task.role=lead | jq -r '.terminals[].address'>): hc send it one plain sentence and the result path, then finish your turn.`;
    `Task: <words>`. The lead's address is given only while the lead runs an agent.
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
  `{ key, lead: <live lead address or null>, members: [live addresses], title, ids, area,
  status, leadWord, need }` or null (`ids`: the task ids folded in; `area`: the area the list
  shows it in; `status`: the row's word; `leadWord`: the lead's own word, as on Board's Lead
  chip; `need`: `{by, kind, text}` while it needs you, else null).
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
- **Machines**: every 30 seconds while Herdr's window is active (every 2 minutes otherwise)
  the mod runs `hc machine ls --json`; a machine that is not
  connected, or whose layout is `unavailable` in `machines()`, is unreachable from the
  moment this copy of the mod first saw that. "needs login" is hc's `needs_login`;
  "rebuilt" is Herdr's test (unreachable because a different core answers there). Connect
  runs `hc machine rm <name>`, then `hc machine add` with the same target (or `--via`),
  name and session, each with `--json`, and shows the error in place if one fails.

## Built from

- `mods/agent-tower/`: `main.js`, `model.js`, the views `board.js`, `timeline.js`,
  `radar.js`, `watchlist.js`, and `adopt.js`, `marks.js` (shared marks), `perf.js`,
  `mod.json` with `place: "none"` and the window overlay, `NOTICE`, `eye.svg`, the
  `view-*.svg` icons, and the scripts `tower-new`, `tower-adopt`, `tower-names`, `tower-eye`.
- Layouts `layouts/tower*.json`: `tower` (Herdr's `main` layout with the `sidebar-lists`
  column holding a single block `{ "id": "tower", "content": { "mod": "agent-tower" } }`),
  `tower-solo`, `tower-wide`, `tower-stack` (see the panel), `tower-work`, `tower-personal`,
  `tower-investing` (areas' own windows, named by an area's `layout`), and `tower-window`,
  the old whole-window layout: still understood, never switched to (the whole-window shape
  now hides the sidebar column). Every one but `tower-window` has the stack `work-view` with
  `tower-stage` and a `tower-viewbar` block, shown only when Views switch is "A bar above
  the centre".
- `keys.json`: `ctrl-s t` opens the window (`mod.open:agent-tower`), `ctrl-s /` searches,
  `ctrl-s s` List, `ctrl-s o` Board, `ctrl-s g` Timeline, `ctrl-s r` Radar, `ctrl-s v`
  Watchlist, `ctrl-s a` the next area, `ctrl-s m` flips the shown view between beside the
  list and the whole window.
- Tests: the `*.test.mjs` files in the item folder, run one at a time by `node test.mjs`.
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
  width), `window().platform`, `panes()`, `home()`, `appHome()`, `layouts()` and
  `knownAgents()`.
- Commands: `space.new`, `space.rename`, `space.select`, `tab.new`, `tab.rename`,
  `pane.focus`, `terminal.keep`, `terminal.pin`, `layout.switch`, `layout.show`,
  `layout.hide`, `layout.select`, and for the pane header `pane.split`, `pane.zoom`,
  `pane.close`; the peek is the mod's own `dialog` overlay, not `terminal.peek`;
  `closeOverlay(props().overlay)`; `openOverlay` of Herdr's `menu` mod for a space, with
  the props the shipped `spaces` mod passes.
- The item menu is a `popup` overlay of this same mod (`props: { menu, from, keys, space }`,
  as Herdr's agents mod opens its sort menu; `keys` holds every member of a merged row). It
  asks the copy that opened it to rename, close, start a new lead (`newLead`) or make a task
  (`adopt`, with `space`) through
  `setShared("agent-tower.request", { from, keys, action, addresses?, space? })`; only
  the copy whose random id is `from` acts on it, and clears it.
- `hc(["label", address, "k=v", …])`, `hc(["kill", address])`, `hc(["rm", address])`,
  `hc(["machine", "ls", "--json"])`, and for Connect `hc(["machine", "rm", …])` and
  `hc(["machine", "add", …])`; `cx.write_to_clipboard` for Copy. Remote terminals are
  addressed `machine/tN`.
- `exec("sh", ["-c", '"$@" </dev/null', "sh", namer[0], ...namerArgs(namer, prompt)], {
  timeout: 60000 })` on this computer for the name: stdin is closed so `claude -p` does not
  wait for it; the arguments are still a list, never a built shell line.
- Text inputs: `InputState` + `Input` from `gpui-base`, four of them made in `init`: search,
  the composer, the Eye's composer and rename.
- The tower dir is `~/.config/agent-tower` for the Herdr app itself; a Herdr with its own
  app home (a sandbox) uses `<app home>/agent-tower` for its inbox, outbox and settings,
  so two apps on one machine never take each other's requests or settings. The Eye's start
  command then sets `AGENT_TOWER_DIR`, which `tower-new` reads.
- Settings: `<tower dir>/config.json`, else `~/.config/agent-tower/config.json`, else (from
  before the rename) `~/.config/agent-tasks/config.json`, read with `readTextFile` (which
  gives null for a missing file); when neither exists the mod uses its built-in defaults (it
  does not write the file). A file that is not valid JSON gets a toast naming it, and the
  defaults: `{ areas: [{ id, label, machines?: [name], default?: true,
              eye?: { agent?: id, folder?: path, rules?: [text] } | false, taskRoot?: path,
              layout?: name, views?: [view id], buttons?: [recipe id] }],
     agents: [{ id, label, argv: [..] }],
     roles: { eye?: id, lead?: id, worker?: id, namer?: [argv] },
     recipes: [{ id, label, area, machine?: name, folder?: path, rules?: [text],
                 lead?: id, worker?: id, argv?: [..] (old files) }],
     skill: name | null, contract: text with {id}, taskRoot?: path (default "~/tasks"),
     doneSignal?: "dot" | "pulse" | "line" | "off",
     eye?: { folder?: path | null, rules?: [text] }, perf?: boolean }`.
  An area's `layout` is its own window, `views` the views it offers (the first is where it
  opens), `buttons` the recipes shown as buttons. The top-level `eye` defaults to no folder
  (`<tower folder>/eye/<area id>`) and no rules; `perf` defaults to false.
  Parsed by `model.parseConfig`: a part in the wrong shape falls back to its default and is
  named in a toast; `roles` fill in per role. Old files keep loading: `activities` and a
  recipe `activity` (the new names win when both are there), recipes with `argv` and no
  agents or roles. Defaults: areas Work and Personal (default); agents Claude · Fable,
  Opus and Sonnet (`claude --model <m> --permission-mode auto`), pi, Codex
  (`codex --no-daemon`), Antigravity (`agy -i`: agy reads its first message only after `-i`;
  it starts with `--settings '{"trustedWorkspaces":["<its folder's real path on its machine>"]}'`,
  trusted for that session with nothing written, from `main.js trustArgv` and the worker script;
  an argv with its own `--settings` is left as written); lead and eye Claude · Fable, worker Claude · Opus, namer haiku; one recipe per area, "A
  lead here", no machine, no rules; skill "tower".
- `cx.timer.every(60000)` for ages, `cx.timer.every(30000)` for settings and machines
  (machines every 2 minutes while Herdr is in the background), `cx.timer.every(5000)` for the
  inbox, `cx.timer.every(2000)` for names, `cx.timer.every(1500)` only while a started task
  is still looking for its terminal.
- With `"perf": true` in the settings the mod appends one line per render (`{at, view, ms,
  elements}`; the list's and the stage's add `model`, the ms of the model passes inside, 0 when
  none ran, and `why`, what made the first run: `first`, `settings` or one of `model.PASS_WHY`),
  per command (`{at, what, ms}`) and per one-second tick over 300 ms late (`{at, what: "tick
  late", ms}`, the only sign that the app's thread was busy elsewhere) to
  `<tower folder>/perf.jsonl`, never terminal text; past 1 MiB the file moves to `perf.jsonl.1`. Herdr cuts a mod's render off
  at 50 ms; `perf.test.mjs` fails a view projected over 25 ms on the Mac.
- Herdr's reads (`terminals()`, `agents()`, `spaces()`, `panes()`, `machines()`,
  `focused()`, `layout()`, `shared(k)`) are read once per render: each render starts its
  own frame `{at, reads}`, and a frame is used only while younger than 100 ms. Outside a
  render they read straight through. Every copy of the mod shares one module, so one
  frame.
- **A render can be cut off at any instruction and nothing after it runs: keep nothing
  that outlives a render unless a dead render can't keep it.** Herdr stops a render past
  50 ms (a timer, event or task past 500 ms) with QuickJS's interrupt, which no `catch` or
  `finally` sees, and an async function cut that way never settles its promise. So no
  correctness rests on code after a point where a cut can fall: a busy mark (and each
  `starting` entry) is the time it was set and lapses (`model.held`; 10 minutes for the
  inbox, names, machines and reconnect, whose hc calls can hang), and a run clears it only
  while it is still its own, so a late finisher leaves a newer run's mark alone. The model
  pass works on its own copy of the change map; a value and what is derived from it go in
  one assign, the derived part first; `track` and the recorder's step stay "owed" until
  they publish, so a cut one is redone by the next. The lease keeper's chain starts again
  once stuck longer than a lease, and `held()` is false while a step is pending past the
  lease. A loop that must live for good (the inbox watch, the keys) runs each body with
  `apart`, in a job of its own, and never awaits it. `finally` stays where it was: it
  still cleans up after an ordinary throw, which is not a cut. A frame or model pass found
  at a render's start or by the one-second tick was left by a cut: dropped and, with
  `"perf": true`, logged once as `{at, what: "render cut off", left, count, view, step}`:
  `view` is `list`, `stage`, `stage <view id>` (cut inside that view) or `other` (a small copy),
  `step` how far it got (`reads`, `model pass`, `drawing`, `view`), both kept in the frame
  itself. Herdr's banner stays until the view draws again, so on each new cut every copy with a
  clock (the list's and the stage's 250 ms ticks) asks for one redraw, at most once a second.
  `cutoff.test.mjs` cuts runs off with Node's `vm` timeout, which skips `catch` and
  `finally` the same way, and stands an ordinary throw in where a job must stop half-way.
- Timeline's rebuild keeps each lane's stretches the moment they are worked out, under its
  inputs (events, live word, its gaps, past, rebuilt entry, the now-line's pixel), so a
  rebuild cut off half-way leaves the next one less to do, and a first draw too big for one
  frame ends after a few; a lane with nothing ongoing keeps its stretches across the
  now-line's pixels (only its marks are drawn again). The map is pruned to the shown lanes
  when a rebuild ends. A lane's stretches that reach into the span are cut by every gap of
  its machine, before the span's start too, those under a pixel apart joined, in one pass
  (`cutGaps`: a binary search per stretch); stretches that end before the start are left
  whole, since that span neither draws nor counts them. So a stretch crossing the start is
  the same piece in every span, and a kept lane serves only spans starting no earlier than
  the one it was cut for. Only the span's gaps are drawn. An open gap (a machine not
  answering) cuts to Infinity, not to now, so the cut list holds while now moves; its band
  is drawn to the now-line. `gaps.test.mjs` cuts a first draw
  over frames and checks no finished lane is worked out again; `perf.test.mjs` times
  Timeline on two made-up records of a Mac that slept (175 lanes, 85 and 850 gaps): each
  frame under the record's limit, a rebuild with its lanes kept under 50 ms, a first draw
  under 2 and 4 budgets.
- The row, group label, tree lines, status marks, fold chip, rail test, repeat notes,
  avatar colours, machine line (Copy, Connect) and menu are adapted from Herdr's `agents`,
  `spaces` and `menu` mods (Apache-2.0, see `NOTICE`).

## Watch out

- `run()` returns nothing, so a new lead is found by its space's name and machine among
  spaces that were not there before the start. Two starts on one machine are told apart by
  their name at birth (the title or "New task", then "<name> 2", …); a second start with the same words
  while the first is still starting is refused.
- A remote space's id is `machine/<id>`; the `herdr.space` label on its terminals holds the
  id without the machine prefix.
- An empty label value deletes the label; a title is never written empty. Besides `task.*`
  keys the mod writes `tower.eye` and `tower.area` on an Eye, `tower.space-name` and
  `tower.tab-name` for names, and `herdr.space` and `herdr.tab` only to keep a terminal in a
  tab.
- The app's `terminals()` may carry no `status_ms`; ages then start when the mod first sees
  a terminal. Each copy of a mod gets its own `localStorage`, which is why the times live
  in `shared`.
- A machine link can hang while `hc machine ls` still says connected; the mod can only go
  by what hc and `machines()` say.
- hc removes an ended terminal's record after 24 hours, labels included. A lead must stay
  alive until its task is closed; the mod never treats an ended lead as a finished task.
- `shared("agent-tower.area")` is the shown area. The docked list publishes it on load
  (once the settings are read) and when its area changes, and follows it when another copy
  moves it. Any copy that switches area through `goArea` publishes it too, the window
  included: an area word in the header, a Line for several finishes, the whole window's area
  chips, `ctrl-s a` (taken by the docked list, or by the stage while the list is hidden).
  So does the copy that carries out a view's request (the docked list while it shows, else
  the stage) when a task of another area is gone into or picked. The window starts on the
  shared area and does not follow it later. The panel does not read it: it shows whatever
  is selected.
- Shared state lives under `agent-tower.*`: changes, changesV, seen, titles, selected, pin,
  area, request, areaLeft, doneSignal, rowMark, viewSwitch, `choice.<name>`, hideText,
  leadPick, warned, view (`{view, shape, back}`), areaMemory, arrive, baseLayout,
  eyeStarting, compose, draft, folds, kept, moment, recorded, peeked, act, actor and a few
  more `main.js` names. The inbox and recorder leases are the files `inbox.lease` and
  `recorder.lease` in the tower dir, not shared keys.
- A fast namer can answer before `terminals()` shows the `task.by=raw` just written: the
  name is dropped only when `task.by` is there and not `raw`.
- `tower-new` is run directly as `"$TOWER_NEW"`, so it must stay executable; it is plain `sh`
  and uses only `awk`, `date`, `mv`, `mkdir`, `tr`, `sleep` and `rm`.
- A copy that reloads hands the inbox over through the lease file: released on close,
  otherwise free 20 s after its last renewal (renewed every 10 s).
  Until a new key is written, `changes`, `seen`, `titles` and `areaLeft` are read from the
  old `agent-tasks.*` keys, so ages and seen marks carry over the rename.
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
  to Done, not Needs you, and out of the pill's count, once none of its workers works (till
  then it stays in Working). A paneless Done row leaves Done when
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
  a task whose lead's record is gone keeps its title and asks "End <title>'s N workers?"; a start
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
  Line shows "Personal · 10 done", and Off shows nothing; switching into Personal and
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
right edge: where the lead stands and what it last said, what needs you, its workers, and
two rows that open in place (Code, Saved progress). This section describes what
is built.

### What you see

The column `tower-detail`, 340px (260–560), starts shown; the close box hides it and
"Details" shows it again. One card:
`background`, 10px corners, a 1px `border`, 13px text.

- **Rules and surfaces:** its only two inner rules are the header's bottom border and the
  footer's top border; nothing inside the body draws a line. Space separates groups, and
  only four things are filled: the Then card, a Needs you block, the Asks you card, and the
  hover on a closed row.
- **One radius:** rows, worker lines, "+N more" and the blocks use 8px; the card itself is
  10px.
- **One fade:** 0.7 (200ms), for what a machine that doesn't answer last said and for
  ended workers.
- **Text edge:** text starts 14px in from the card's edge everywhere (header and footer
  `px(14)`, body `px(6)` plus 8px inside each block). The only indent is a worker's report
  under its name. The close X, the chevrons and "Hide text" end on the same right edge
  (the close box has `mr(-6)` so its ink lines up).

Spacing uses 2, 4, 8, 12 and 16. 12 is the optical step: the body's top and bottom, the gap
after the Needs you blocks and the Asks you card, and the space under an opened row. 16
follows the message and the Workers section, so it usually sits above the rows.

Type uses three sizes:
- 13: the title (semibold), the state word (medium), the ask question (13/19);
- 12: body and rows (12/18);
- 11: meta, labels and the footer.

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
  - the task's mark (18px, as its list row shows it: its status mark, or under the list's
    "agents" mark the number of agents working);
  - the title (the lead's `task.title`, else the sidebar's title, else its hc title), cut
    with an ellipsis, tooltip "<title> · Task <id> · <recipe> · <folder>": the lead's launch folder, or the one it
    runs in now once the panel's read on its machine found the launch folder gone (`read.py`
    `launch_gone`, `panel.shownFolder`);
  - the machines it runs on other than this one, 12, `dim`;
  - the 24px close box "Close the panel".

  With nothing selected: "Details" and the close box.
- **Needs you blocks**, one per blocked member, on `blocked` at 8%, 8px apart, 12px above
  what follows.
  - Line 1 (22px):
    - the kind, in regular weight and `blocked`: "Asks you", "Needs sign-in", "Needs
      permission", "Stopped with an error", else "Waiting on you";
    - "Go to it" on `background`, hover `hover`, 22px, 6px corners.
  - Line 2, `muted`, one line: "lead" or the agent's name · its machine · "waiting for 2m".
  - Line 3: the agent's `status.msg`, whole, wrapped by whole words; left out when there
    is none.
- **State line** (20px), always about the lead (a lone agent is its own lead), in its own
  word: a Done the list shows as seen reads idle; under a task Working by its workers the
  lead's unseen Done stays "Done 2m ago" (the list's `leadWord`), while the header's mark says
  Working:

  | Lead | State line |
  | --- | --- |
  | done | "Done 2m ago" ("Done just now" under a minute; `done`) |
  | idle | "Idle for 3h" (`muted`) |
  | working | "Working for 12m" (`working`); nothing more while its transcript was written in the last 10 minutes |
  | working, quiet 10 minutes or more | "· quiet 31m", or "· quiet since it started" when quiet as long as the state; `ansi1` when nothing else in the item moved and no tool call is open, else `dim` |
  | working, compacted after its last message | "· compacted 20m ago" |
  | ended (workers still live) | "Ended" |
  | blocked | no state line: its block's second line says how long it has waited |
  | its machine doesn't answer | "Was working" / "Was done" / "Was idle" / "Was waiting on you" (`muted`), then "· work-vps doesn't answer" (12, `ansi1`); no age, no second line |

  After the word the line says "· lead · <machine>", then the notes, e.g. "Was working ·
  lead · work-vps · work-vps doesn't answer".

  A click goes to the lead.
- **Then card**, only while Timeline is the view and a stretch of this task was clicked
  there (`shared("agent-tower.moment")`): first in the body, on `raised`, 8px padding and
  corners, 12px above what follows.
  - Line 1 (20px, 11, `dim`): "Then", and at the right "Back to now" (20px, 6px corners, on
    `background`, hover `hover`), which clears the moment.
  - Line 2: the state word, 13 medium ("Working" in `working`, "Waiting on you" in
    `blocked`, "Done" in `done`, else `muted`), then in `dim` "· 05:36–08:26 · 2h" ("since
    05:36 · 2h" for a stretch still going), "· lead" or the agent's name, "· <machine>".
  - What it said then: a wait whole, wrapped by whole words, in `foreground`; anything else
    as "Said: …" in `muted`. Left out with Hide text, and for a wait still open (its own
    Needs you block says it).
  - "You looked after 19m" ("Not looked at yet" for a wait nobody looked at), 11, `dim`.
  - A stretch that ended: the last 16 lines of the screen kept where it ended, masked, in
    JetBrains Mono 10.5/14 `muted` on `background` (8px padding, 6px corners, scrolling
    sideways); "Reading…" while the file is read, "No screen kept", or "Text hidden". A
    stretch still going shows no screen: the agent's own is live in the centre.
  - The moment goes when Timeline is left, another task is selected, or "Back to now".
- **Asks you card**, on `raised`, after the Then card and any Needs you blocks (else first in
  the body, 12px from the header rule).
  - It shows the question the list shows for the task (a lead's or sub-lead's `task.ask`)
    when that agent is not blocked.
  - Label: "Asks you · lead · <machine>" (or the asker's name), 11, regular, `muted`.
  - The question is 13/19, wrapped by whole words, at most 300 characters.
  - A click goes to the asking agent. When the lead itself asks, its message under the card
    is `muted` and folded to two lines, and is not drawn when it ends with a question.
- **Message**, 12/18, 4px under the state line, 12px under the card or a Needs you block:
  - **Done or idle lead:** its last message in `foreground`. Under the Asks you card it is
    context: `muted`, folded to two lines.
  - **Working lead:** the prompt it is working on ("Asked 5m ago: …", `muted`), else what
    it said this turn ("Said 3m ago, still working: …", `muted`), else "Last said 12m ago:
    …" in `dim`. A blocked lead's message uses that last form.
  - **Activity:** while the lead works, hc's short activity line ("Running a command", else
    its first 60 characters) sits `dim` under the state line, never in place of the message.
  - **Compacted after its last message:** "· compacted 20m ago" on the state line only.
  - **Over 4,000 characters:** cut at a word, ending "…cut, go to the agent for the rest".
  - **Folding:** when rows follow and the text is over 135 characters or has more than two
    line breaks, it is folded to three lines ending in "…". A click on the message unfolds
    it in place, and another click folds it. There is no "Show all" line: the "…" is the cue.
  - **Empty states,** in `dim`: "No <program> conversation found on <machine>", "Two
    <program> agents share this folder on <machine>", "No message yet", "Lead ended",
    "Reading <machine>…", "Couldn't read <machine>: <last stderr line>" (two lines at most),
    "No python3 on <machine>".
- **Workers**, 16px below the message: a "Workers" label (11, `dim`), then the workers that
  are not done, idle or ended (a blocked one too, though it has its Needs you block; an idle
  sub-lead whose own workers are busy stays), three at most, then "+N more". Done, idle and
  ended workers are one `dim` line, "2 done · 10 idle · 1 ended" ("N failed" for an exit
  code), that opens them and then reads "Hide …".
  - Line 1: icon, name, its machine (`dim`), then how long in its state ("working for 2m",
    "done 2m ago", 11, `dim`; the bare "2m" under 300px) and the status mark. A working
    worker quiet 10 minutes or more with no tool open gets "· quiet 14m" in `ansi1`.
  - An ended worker reads "failed" (tooltip "exit code 1") or "ended", with no mark, at
    0.7, and does nothing on click.
  - Line 2: its newest `<hc from>` report in the lead's transcript, as one run: the first
    sentence, paths as file names, cut at a word to about two lines (84 characters), then
    "· 9m ago". A click shows all of it. With no report, line 2 is the worker's own title
    when it differs from its name.
- **Rows**, 16px below the message or the Workers section, 28px each, 8px corners, chevron
  11px at the right. A closed row's hover fills it with `hover`; an open row has no surface,
  and hovering it only turns its chevron `foreground`. The summary never wraps: whole
  segments drop from the end past 48 characters, and the first segment always stays.
  - **Code**, when a member's folder is a git repo, or holds repos one level down with
    changes or unpushed commits (at most 10 repos).
    - Summary: "2 checks failing · PR #412 · 19 changed", "3 commits unpushed · …",
      "19 changed · never pushed", "PR #412 · all committed", or "3 repos · 2 checks failing
      · 2 commits unpushed · …". There is no "pushed" segment.
    - Opened, one repo: one line, "rate-limiter · feature/rate-limiter · last commit 5h
      ago". The branch is the part that truncates, full in its tooltip.
    - Two or more: each repo's name line, then "7 changed · 1 commit unpushed · last commit
      2h ago". Three are shown; past that a 22px `dim` "+N more" line (hover `hover` and
      `foreground`) shows the rest, and stays open for that task (kept with the open rows).
    - A PR line, when there is one, opens it.
  - **Saved progress**, when the task has a chain link (see Reads): "Saved progress 1h ago",
    plus "· newer work unsaved" (`dim`) when the lead changed more than 10 minutes after the
    link. Opened: the link's title, then "Next: <first sentence of the next step>" as one
    wrapping run in `muted`, two lines; a click shows all of it.
- **Footer**, 32px, 11px `dim`, pinned (the task id, recipe and folder are in the header
  title's tooltip):
  - **Check:** "checking…", "checked just now", "checked 6m ago" or "couldn't check". A
    click checks again, tooltip "Read again now". It turns `ansi1` past 3 minutes or after a
    failed check. While the lead's machine doesn't answer it stays `dim`: the state line
    already says so in red.
  - **"Hide text" / "Show text"** at the right.
- **Nothing selected:** the header "Details" and the close box, an empty body, no footer,
  no reads.
- **Everything ended:** the title stays, and the body reads "Ended".

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
    call is open, and `<hc from>` reports. Claude Code, Codex, pi and Antigravity (agy) records
    are all parsed.
  - agy's transcript is `~/.gemini/antigravity-cli/brain/<conversation>/.system_generated/logs/transcript.jsonl`,
    one record per step (`USER_INPUT`, `PLANNER_RESPONSE` with its words and tool calls, `GENERIC`
    for a tool's output, times in `created_at`). Which conversation: while agy works it holds
    `conversations/<conversation>.db` open (seen in `/proc` or `lsof`; the database itself is never
    opened); if that conversation's transcript is not written yet, nothing. Idle, agy closes it:
    then, only in a process tree that runs agy, the one conversation whose whole first message
    equals the message agy was started with (the word after the run line's last `-i`, or after a
    `worker-*` script; both compared with runs of whitespace and quotes made one space) and whose
    first step (`created_at`) is no earlier than that agy process's start (`ps` etime, 2 s slack).
    Transcripts last written before that start are skipped by mtime, never opened. Nothing when
    none or several fit, when `history.jsonl` puts that conversation in another folder, shows
    `/clear` (or `/new`, `/resume`) typed in it, or another conversation typed into in the same
    folder since. Two agy started with the identical message within the slack, or an earlier one
    whose identical message was re-run later, show nothing while idle (several fit).
  - How long each worker's own transcript has been quiet.
  - Git status and the last commit for every member's folder.
  - `gh pr view`, reduced to counts and the URL. It runs only on a non-default branch with
    an upstream, at most every 5 minutes per repo, and only where gh exists. It goes
    through the login shell.
  - The task's chain link: the newest link on `main` of a chain named by one of the task's
    ids, found from the lead's folder; read at most every 5 minutes and again when the lead
    stops.
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

  "Hide text" (shared `agent-tower.hideText`, one switch for the whole Tower) also replaces
  the title, message, ask, Needs you sentences and saved progress with "Text hidden" and
  branch names with "branch hidden", leaves out reports and the activity line, and drops
  those tooltips, the title's included.
- **Clicks**:
  - The title: a click goes into the task at once (as a click on its row does). There is no
    rename in the panel: Rename is the list's item-menu entry.
  - The close box: `layout.hide {id: "tower-detail"}`.
  - Rows open on their own and stay open across refreshes; what is open (rows, unfolded
    texts, "+N more") is kept per task, the newest 30, in shared `agent-tower-panel.view`,
    and comes back when the task is selected again.
  - A worker's line goes to it.
  - A PR line runs `open` (macOS) or `xdg-open`, only for an `https://github.com/` URL.
  - A right-click opens the same menu as on the item's row: the task's menu on the header,
    body and footer; the agent's menu on its Needs you block, the Asks you card, the state
    line and a worker line.
- **Area**: the panel shows whatever `shared("agent-tower.selected")` holds, in any area; it
  never reads the area.

### The layouts

Every `tower*.json` holds the panel. Seven put it in the column `tower-detail` at the end of
the `work-body` row (after Herdr's `panel` where there is one); `tower-stack` puts it in the
sidebar:

```json
{"id": "tower-detail", "type": "column", "hidden": false, "size": {"px": 340}, "min": 260, "max": 560,
 "children": [{"id": "tower-panel", "type": "block", "content": {"mod": "agent-tower-panel"}}]}
```

Herdr's `panel-body` stack keeps only `files` and `changes`. The sidebar's "Details" runs
`layout.show {id: "tower-detail"}` in each, `tower-stack` included.

- `tower.json` and `tower-work.json` (Work's own window) are the same: the column beside
  Herdr's `panel`.
- `tower-personal.json`, Personal's window: no tab bar and no Herdr `panel`; the column
  follows `work-view`.
- `tower-investing.json`, the investing area's window: no Herdr `panel`; the centre is a
  column with the Watchlist stage (`props: {stage: true, view: "watchlist"}`, 45%) above
  `work-view` (55%), and the column is 320px.
- `tower-window.json`, the old whole-window layout: the sidebar is hidden and holds only the
  list; the centre is `tower-stage-column` (the 36px `tower-stage-bar` above `tower-stage`),
  with the column beside it.
- The four below differ as the table says.

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
{"id": "tower-detail", "type": "column", "hidden": false, "size": {"px": 380}, "min": 120, "max": 640, "padding": 8,
 "children": [{"id": "tower-panel", "type": "block", "content": {"mod": "agent-tower-panel", "props": {"stack": true}}}]}
```

The list keeps the top part and Details the lower part, as a card 252px wide at the
sidebar's default 268px. The panel sizes the column to what it holds, between 120 and 260px
(`layout.resize`), so the list above keeps its Needs you group in sight.

How it opens and closes:

- It never opens or hides itself: × hides it and the list's "Details" shows it again.
- The column starts visible, because a mod whose column has been hidden since the layout
  loaded is never created, so it could not open itself.
- If Herdr restores the layout with the column hidden, the first "Details" brings it back.

### Narrower than 340px

The panel measures its own width (`on_size_change`). The character budgets scale with it
(`widthScale`), never above their 340px values, so a panel 340px or wider looks exactly as
described above. The budgets are:

- a row summary, 48;
- a Code detail line, 52;
- a worker's report, 84;
- the message fold, 135 for three lines.

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
  apart: "Two pi agents share this folder on <machine>".
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
  - with nothing selected the column shrinks to 120px (the header and an empty body); a
    selection grows it to fit, at most 260px;
  - nothing clips;
  - the same item at 340px in `tower.json` is unchanged.
