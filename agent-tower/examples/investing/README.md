# The investing area (an example, made up)

An example of an area that is a whole window of its own (milestone 4). Nothing here is installed:
copy what you want into your own tower settings.

- `config.example.json`: three areas, each naming its window (`layout`) and its views. Investing's
  window is `layouts/tower-investing.json`, which keeps the Watchlist pinned above the agent, so
  the area lists only List and Timeline as views. Its buttons are two recipes.
- The three windows differ in what they hold, not only in colour:
  - **Work** (`tower-work`): the list beside the terminal, with its tabs, Files and Changes, and
    Board and Timeline as views.
  - **Personal** (`tower-personal`): opens on Board, with larger type, no terminal tabs, no
    Files/Changes and no Timeline.
  - **Investing**: the Watchlist above the agent.
- `watchlist.example.json`: goes to `<tower folder>/watchlist.json`. The tower folder is
  `~/.config/agent-tower` for the Herdr app itself. The Watchlist view lists each ticker with the
  tasks that name it, by title or by a `task.topic` label. It fetches no prices.
- `investing-notes.example.md`: the notes file the research leads append to. The Watchlist view shows
  its newest lines, read-only.

Every ticker, note and date here is invented for the example.
