# deevs-herdr-kit

My mods for the [Herdr](https://herdr.dev) desktop app, and later layouts. The repo is laid out like `~/.config/herdr-app`, so a folder copies straight in.

## agent-images

The images in the focused agent's conversation: Claude Code, Codex or pi, on this computer or on a machine Herdr reaches through herdr-core. Pasted images are marked apart from tool output.

- Open it with `mod.open:agent-images` (I bind `ctrl-s i`). It follows the agent you focus.
- Hover an image to see it large. Click it to step through with `←` `→`.
- Copy puts the image on the clipboard as a PNG; paste it into any agent with `⌘V`.

What it runs and reads:

- `hc get` for the focused terminal, then `python3` with [`extract.py`](mods/agent-images/extract.py) on the agent's machine. The script reads the agent's transcript under `~/.claude`, `~/.codex` or `~/.pi`, and uses `ps` and `lsof` (or `/proc`) to find it.
- It writes the images to `mods/agent-images-cache/` in the Herdr home.
- Copying runs `osascript` and `sips`, and Open runs `open`, so those parts are macOS only.

Needs `python3` wherever the agents run.

## Install

Copy `mods/<name>/` into `~/.config/herdr-app/mods/` and bind its key in `keys.json`:

```json
{ "global": { "ctrl-s i": "mod.open:agent-images" } }
```

Or let chezmoi keep it current:

```toml
[".config/herdr-app/mods/agent-images"]
    type = "archive"
    url = "https://github.com/DeevsDeevs/deevs-herdr-kit/archive/refs/heads/main.tar.gz"
    stripComponents = 3
    include = ["*/mods/agent-images/**"]
    refreshPeriod = "24h"
```

Icons are from [Lucide](https://lucide.dev) (ISC, see `LICENSE-Lucide.txt` beside them). Everything else is MIT.
