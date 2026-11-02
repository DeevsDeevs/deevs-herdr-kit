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
| [agent-images](agent-images/) | the images in the focused agent's conversation: see them, hover them large, copy one into another agent |

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

MIT, except the Lucide icons in agent-images (ISC, license beside them).
