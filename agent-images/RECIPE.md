# Agent images

A window of the images in the focused agent's conversation, newest first: the ones you
pasted and the ones its tools produced (screenshots, files it read), for Claude Code,
Codex or pi, here or on another machine. Hover one to see it large, click it to step
through, copy it to paste into any agent.

## What you see

`mod.open:agent-images` opens a `window` overlay, 60% × 70% of the window.

- **Header**, 48px on `chrome`, 1px `border` under it, 16px left and 10px right padding:
  - a Lucide `image` icon (15px, `muted`) and "Images" (13px semibold);
  - which agent, 12px: "Claude Code", "Codex" or "pi" (`muted`), plus " on seine-river"
    for another machine; then "·" and the terminal's title (`dim`, truncated);
  - on the right a segmented control on `raised` (2px padding, 7px corners): All,
    Pasted, Tool, each 24px tall with its count in `dim`; the chosen one sits on
    `surface` with a small shadow;
  - a 28px `x` icon button when it is an overlay.
- **Grid**, on `surface`, 18px padding, cards 14px apart, at least 200px wide and filling
  the row:
  - the picture, card-wide at 0.625 of its width, contained on `canvas`, 8px corners,
    1px `border` (`accent` on hover);
  - under it, 7px down, 11.5px: "Pasted" (`accent`) or "Tool" (`muted`) on the left,
    the time (`dim`) on the right: "just now", "12m ago", "17:20" today, else
    "Nov 2, 17:20".
  - On hover, a 28px copy button in the picture's top right corner (`popover`, 1px
    `border`, small shadow, Lucide `copy` 14px).
- **Hover pop-up**: the hovered picture large, in the half of the grid away from the
  card (cards in the left half show it on the right). Sized to the picture: at most half
  the grid wide and the body tall, never more than twice its own size; 8px padding on
  `popover`, 1px `border`, 10px corners, a large shadow.
- **Open image**: a 44px toolbar with a 1px `border` under it: "← All", a 1×16px divider,
  `‹` `›` (28px icon buttons), "3 of 23" (`muted`), "Pasted · 12m ago" (`dim`); on the
  right `link` (copy the file path) and `external-link` (open in Preview) icon buttons
  and a solid "Copy" button (`solid`, copy icon and the word). Below, the picture
  contained on `canvas` with 20px padding.
- **Empty states**, centered: a 22px `image` icon (`dim`), a 13px line (`muted`), a 12px
  hint (`dim`): "No agent in focus", "Looking for images…", "No images in this
  conversation yet" / "Nothing pasted here yet" with "Paste one into the agent with ⌘V
  and it shows up here.", or "Couldn't read this agent's images" with the error.

## How it behaves

- It shows the agent that has focus and follows focus to other agents. When focus moves
  to something that isn't an agent (this window, a shell), it keeps the last agent.
- It reads again every 10 seconds; only images it hasn't saved yet are transferred.
- Copy (the hover button, the toolbar button, `⌘C` in an open image) puts the picture on
  the clipboard as a PNG. Its copy icon turns into a `working`-colored check for 1.2 s;
  the button keeps its size and words.
- Click a card to open it. `←` `→` step through the filtered list and wrap. `Esc` goes
  back to the grid, then closes the window.
- Changing the filter closes an open image and the pop-up.

## Built from

- `mod.json`: `{ "place": "none", "overlay": { "kind": "window", "key": "agent-images",
  "width": 0.6, "height": 0.7 } }`.
- `herdr`: `focused()`, `agents()` (to know an agent and name it), `hc(["get", address,
  "--json"])` (pid, foreground argv and cwd), `exec` with `on` for another machine,
  `readTextFile`, `appHome`, `theme`, `props`, `closeOverlay`, `notify` (copy errors
  only). `fs/promises` for the image files.
- `extract.py`, run as `sh -c 'python3 -c "$1" "$2"'` with the script's text and a JSON
  request `{pid, argv, cwd, have}`. It finds the transcript, in order:
  1. Claude Code: `~/.claude/sessions/<pid>.json` for any process in the terminal's
     tree gives `sessionId`, then `~/.claude/projects/*/<sessionId>.jsonl`;
  2. a `.jsonl` under `~/.codex/sessions`, `~/.pi/agent/sessions` or
     `~/.claude/projects` that a process in the tree holds open (`/proc/<pid>/fd`, else
     `lsof`);
  3. `--session <path>` in argv (pi);
  4. pi: the newest file in `~/.pi/agent/sessions/--<cwd with / as ->--/`.

  Then every line containing `"image`: Claude `{type: "image", source: {type: "base64",
  media_type, data}}`, pi `{type: "image", data, mimeType}`, Codex `{type:
  "input_image", image_url: "data:<mime>;base64,…"}`. An image is "you" under a
  `role: "user"` (or a Claude `user`/`attachment` line) and "tool" under a tool result
  (`tool_result`, `function_call_output`, `custom_tool_call_output`, `role:
  "toolResult"`). Claude's `api-request-blob` lines are skipped; images are deduplicated
  by the first 16 hex of the SHA-1 of their base64. Width and height come from the PNG
  header or the JPEG SOF marker. It prints `{transcript, images: [{h, mime, who, at, w,
  ht, data?}]}`, with `data` only for hashes not in `have`.
- The mod writes each new image to `mods/agent-images-cache/<hash>.<ext>` and shows it
  with `image()`. Copy converts non-PNGs with `sips`, then `osascript -e 'set the
  clipboard to (read (POSIX file "…") as «class PNGf»)'`. Open runs `open`.
- Icons: Lucide `image`, `x`, `copy`, `check`, `arrow-left`, `chevron-left`,
  `chevron-right`, `link`, `external-link`, as files in the mod folder.

## Watch out

- On another machine, `exec("python3", …)` can fail to start: the remote core's own PATH
  may lack it. Going through `sh -c` finds it.
- Don't name a method `close`: `View.close(cx)` is Herdr's shutdown hook.
- `image()` caches by path. Content-hash file names never change, so nothing goes stale;
  the cache folder sits under `mods/` without a `main.js`, so Herdr never loads it.
- Claude Code repeats images in `api-request-blob` and `toolUseResult`: deduplicate.
- Opening the overlay does not move `focused().terminal`, so the agent is still known.
- The whole transcript is scanned on every refresh; long ones with many screenshots take
  longer.
- pi without `--session` falls back to the newest session in its folder, which is wrong
  when two pi agents share a folder.
- Copy and Open are macOS only. Codex hasn't been tested on a live session.

## Done when

- `herdr-app check` passes.
- With a Claude Code agent focused, the grid shows its pasted images as "Pasted" and its
  screenshots as "Tool", newest first, with counts in the filter.
- Focusing an agent on another machine shows that agent's images, with "on <machine>" in
  the header.
- Hovering a card shows the pop-up on the far side, sized to the picture.
- Copy, then `⌘V` into another agent, pastes the image.
- In an open image, `←` `→` step and wrap, `⌘C` copies, `Esc` goes back and then closes.
- A new paste in the agent appears within about 10 seconds.
