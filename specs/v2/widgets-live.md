# Live widgets

A template can opt into **live mode**: instead of short `init`/`update`/`view`/`draw` steps, the client starts one
long-running PsychoScript program per open widget. It keeps its state in the VM, waits on events, timers and display
frames, and renders whenever it wants. This is what minigames, timers, simulations, step-by-step animations and other
free-running widgets use. Step mode stays the default; everything in `widgets.md` still applies unless said here.

## Opting in

A template declares `mode: "live"` (default `"step"`): a field on the template (saved through `widget_template` with
`mode`, returned in template summaries and programs). A live template defines

```js
async function main(data) {
  // runs until it returns, calls widget.submit/dismiss, or the client stops it
}
```

and may omit `init`, `view`, `update` and `draw`.

## Host functions

Hosts provide these functions under the global `__host` (nothing else beyond the step ABI's `__input`):

| Function | Kind | Meaning |
| --- | --- | --- |
| `__host.post(message)` | sync | send a JSON message to the client |
| `await __host.receive()` | async, idempotent | next JSON message from the client (queued in order) |
| `await __host.sleep(ms)` | async, idempotent | resolve after `ms` milliseconds (clamped to >= 0) |
| `__host.now()` | sync | milliseconds the program has been running, excluding time paused |
| `await __host.fetch(request)` | async | HTTPS request; only with the `https` capability (see Capabilities) |

Everything widget-specific is built on these in the prelude, so hosts stay generic. Mobile hosts get all four from
`psychoscript-mobile`; Rune implements them in `opencode-widget`; the TUI doesn't run live widgets yet (it shows
`alt` / "Open this widget on desktop or mobile").

## Prelude API (`widget`)

The prelude exposes a `widget` object inside `main` (implemented with `__host`):

| Call | Effect |
| --- | --- |
| `widget.render(node)` | replace the widget's view tree (same nodes as step mode, `canvas` and `shader` included) |
| `widget.draw(canvasID, commands)` | replace one canvas's command list (same commands as step mode; a builder: `ui.draw()`) |
| `await widget.event()` | next user event (`press`, `change`, `pointer`; same shapes as step mode) |
| `await widget.frame()` | next display frame `{ t, dt, width, height, scale, pointer, dark }` for the widget (requests exactly one) |
| `await widget.sleep(ms)` | timer |
| `widget.now()` | ms of running time (excludes paused time; use `Date.now()` for wall-clock time) |
| `await widget.fetch(url, { method, headers, body })` | HTTPS request → `{ ok, status, headers, text(), json() }` (needs the `https` capability) |
| `await widget.next({ frame?, timeout? })` | whichever comes first: `{ type: "event", event }`, `{ type: "frame", frame }` or `{ type: "timeout" }` |
| `widget.submit(value)` / `widget.dismiss()` | final answer; the client stops the program |
| `widget.send(value, { wake })` | non-final message to the agent (as in step mode) |

`Math.random()` is allowed in live mode.

## Client ↔ program messages

Program → client (`post`): `{ type: "render", node }`, `{ type: "draw", id, commands }`, `{ type: "frame" }` (one
frame wanted), `{ type: "submit", value }`, `{ type: "dismiss" }`, `{ type: "send", value, wake }`.

Client → program (`receive`): `{ type: "event", event }`, `{ type: "frame", frame }` (only after a frame request, at
the next vsync while the widget is visible), `{ type: "resumed", pausedMs }` (after a pause, see below).

## Capabilities

A live template declares what it needs beyond rendering, as a template field:

```ts
capabilities?: { https?: { hosts: string[] } }   // e.g. { https: { hosts: ["api.github.com", "*.coingecko.com"] } }
```

`hosts` entries are exact host names or `*.` suffix wildcards; `["*"]` means any host. Clients show the granted
capabilities on the widget (e.g. a small "Network: api.github.com" chip). **For now clients grant every declared
capability automatically**; each client keeps the grant decision in one place so a permission dialog can be added
later. An undeclared capability is unavailable: the call rejects with `CapabilityDenied`.

`fetch` rules: `https:` only; host must match the declared list (checked again after redirects, at most 5); methods
GET, POST, PUT, PATCH, DELETE, HEAD; no cookies, no credentials, no client certificates, no access to localhost,
private or link-local addresses; request body ≤ 256 KB, response body ≤ 2 MB (text; binary is base64 in `body64`),
timeout 15 s, at most 4 in flight and 10 per second per widget. Responses cross as JSON
`{ status, headers, body | body64 }`. Errors reject with `{ kind: "CapabilityDenied" | "Network" | "Timeout" |
"TooLarge" | "RateLimited", message }`. Mobile hosts get `fetch` from `psychoscript-mobile`, which enforces these rules
and hands the actual transfer to the app (URLSession / OkHttp), so system TLS and proxies apply.

## Lifecycle and budgets

- The client starts `<program>\nreturn await __widget_live(__input())` (input `{ data }`) when an open live widget
  first becomes visible, on its own thread or task, never the UI thread. Render the last `render` node; before the
  first one, show a loading frame.
- **Pause when not visible.** When a live widget scrolls out of view, its window or app goes to the background, or the
  session is closed, the client pauses the program: no frames, events or timer firings are delivered, `sleep` timers
  freeze with their remaining time, `now()` stops, and in-flight `fetch` results are held until resume. When the widget
  comes back into view the client resumes it and delivers `{ type: "resumed", pausedMs }` first, so a dashboard can
  refresh and a game can show its pause screen. A paused program costs no CPU.
- If a widget stays paused for more than 30 s (or the OS asks the app to free memory), the client may suspend the
  program to a snapshot (PsychoScript `suspend`, `toBytes`), drop the VM, and resume from the snapshot when it's visible
  again; if suspending fails, stop it and restart from `main` then.
- Budgets: a program that runs more than 50 ms without awaiting is stopped with an error; at most 2,000 draw commands
  per `draw`; posts beyond 240 per second are dropped with a warning; heap per program capped by the host (default 32
  MB). One error shows inline with "Restart".
- A submitted/dismissed widget (from any client) stops its program; its last rendered view stays, read-only.
- Answers and sends go to the server exactly as in step mode.

## Server

The server never runs template code: the `widget` tool validates `data`, and `widget_template save` parses and lints the
source (an `async function main`, top-level declarations only; see `widgets.md`, Tools). A client whose live program
fails reports it with the `report` RPC (`phase: "main"`, or `"fetch"` for a fetch error it can't handle).
`widget_template` `save` takes `mode` and `capabilities`; both are part of the template version (see `widgets.md`, Template). Step templates
can't declare capabilities. The skill teaches when to use live mode (games, timers, animations,
simulations) and shows a small game.

## Built-in example

`minigame` (live): "tap the dots". `data: { title, seconds?: number (default 20) }`. A canvas with dots spawning on a
timer and shrinking; tap to score; shows score and time left; at the end shows the result with "Submit score" /
"Play again"; submits `{ score, seconds }`.
