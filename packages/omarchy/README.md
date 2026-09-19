# OpenCode sessions

A bar icon and panel for OpenCode sessions on the shared V2 background
server. Selecting a session asks the server to activate a live TUI or
Desktop client. If none can take it, the panel opens
`opencode --session <id>` in a terminal.

## Panel

- **Hero** — OpenCode, plus running / needs-attention / idle.
- **Latest / Projects / Usage** — recency list, project grouping, or usage.
  `h`/`l` or the chips switch the view.
- **Usage** — Go subscription quota when a Go API key is present, plus today's
  cost and tokens by model from session stats.
- **Row** — title, project (in Latest), model, age, and last outcome. Running
  rows are marked LIVE.

The icon hides while the background service is unreachable, the same way
`omarchy.agents` stays off the bar until it has something to say.

## Interactions

- Bar icon: left = panel, right = new session, middle = refresh.
- Panel: `h`/`l` switch tabs, `j`/`k` move, Enter attach, `n` new session,
  `r` refresh, Tab neighboring panel, Esc close.
- IPC: `omarchy-shell simon.opencode <open|close|toggle|refresh>`.

Attach first calls `POST /api/session/:id/activate`. A live TUI or Desktop
that has registered presence takes the session. Otherwise attach falls back
to `omarchy launch or focus tui` with a per-session app id.

## Data

`fetch.ts` reads the local service registration and calls:

- `GET /api/session?parentID=null` — recent top-level sessions
- `GET /api/session/active` — sessions this process is currently draining
- `POST /api/session/:id/activate` — focus a live client, or report none
- `GET /api/experimental/session/stats` — today's cost and tokens

It never starts the background server and never scrapes the OpenCode
database. Refresh interval and list length are widget settings.

Copy into the local Omarchy plugin dir with `packages/omarchy/install`.

```
omarchy bar set simon.opencode refreshIntervalSec 3 --json
```
