# deevs-herdr-kit

My mods for the [Herdr](https://herdr.dev) desktop app, and later layouts. Each folder is
one item, laid out like `~/.config/herdr-app`:

```
agent-browser/
├── README.md     what it is, what it reaches for, how to use it
├── RECIPE.md     the brief to build it from scratch
├── preview.png
├── keys.json     the keys it expects
└── mods/agent-browser/
```

| Mod | |
| --- | --- |
| [agent-browser](agent-browser/) | every browser your agents drive, here and on Herdr's machines, live in one window; watch or take over |
| [agent-files](agent-files/) | Herdr's Files panel that also downloads from and uploads to the machine a space runs on: right-click, drop or paste, a line per transfer |
| [agent-images](agent-images/) | the images in the focused agent's conversation: see them, hover them large, copy one into another agent |
| [agent-tower](agent-tower/) | your agents' work as tasks instead of terminals, on every machine: one list, a Details card, Board, Timeline and Radar views, a window per area, and the Eye, one agent above it all |

## Install

Copy an item's `mods/<name>/` into `~/.config/herdr-app/mods/`, merge its `keys.json`
into yours, and run `herdr-app check ~/.config/herdr-app/mods/<name>`. Each item's README
says what it runs and reads before you do.

Or let chezmoi keep them current, one entry per mod:

```toml
{{ range list "agent-browser" "agent-images" -}}
[".config/herdr-app/mods/{{ . }}"]
    type = "archive"
    url = "https://github.com/DeevsDeevs/deevs-herdr-kit/archive/refs/heads/main.tar.gz"
    stripComponents = 4
    include = ["*/{{ . }}/mods/{{ . }}/**"]
    refreshPeriod = "24h"
{{ end -}}
```

MIT, except the Lucide icons in agent-images and agent-files (ISC, license beside them) and the
parts of agent-files taken from Herdr's Files panel (Apache-2.0, license beside them).
