# Live widgets

A widget template can opt into **live mode**: instead of short `init`/`view`/`draw` steps, the client starts one
long-running PsychoScript program per open widget. It keeps its state in the VM, waits on timers and display frames,
takes input through handlers on its nodes, and renders whenever it wants. This is what games, timers, simulations, step-by-step animations and other
free-running widgets use. Step mode stays the default; everything in `widgets.md` still applies unless said here.

## Opting in

A widget template declares `mode: "live"` (default `"step"`): a field on the widget template (saved through `widget_template` with
`mode`, returned in widget template summaries and programs). A live widget template defines

```js
async function main(data) {
  // runs until it returns, calls widget.submit/dismiss, or the client stops it
}
```

and may omit `init`, `view` and `draw`.

## Host functions

Hosts provide these functions under the global `__host` (nothing else beyond the step ABI's `__input`):

| Function | Kind | Meaning |
| --- | --- | --- |
| `__host.post(message)` | sync | send a JSON message to the client; for a `render`, returns whether its view has handlers (`widgets.md`, Native hosts) |
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
| `widget.render(node)` | replace the widget's view tree (same nodes, ids and handler props as step mode) |
| `widget.draw(key, commands)` | replace the command list of the canvas with that `key` in the last rendered view (a builder: `ui.draw()`); throws for an unknown key |
| `await widget.frame()` | next display frame `{ t, dt, width, height, scale, pointer, dark }` for the widget (requests exactly one; every waiter gets it) |
| `await widget.sleep(ms)` | timer |
| `widget.now()` | ms of running time (excludes paused time; use `Date.now()` for wall-clock time) |
| `await widget.fetch(url, { method, headers, body })` | HTTPS request → `{ ok, status, headers, text(), json() }` (needs the `https` capability) |
| `widget.on(kind, fn)` | `kind`: `key` (`fn(key)`), `focus` (`fn(focused)`), `fullscreen` (`fn(on)`), `capture` (`fn(captured)`), `resumed` (`fn(pausedMs)`), `storage` (`fn({ key, value })`, see Storage); returns an unsubscribe function |
| `widget.keys` | the `code`s of the keys held now (a `Set`; cleared on blur), to read each frame |
| `widget.pointer` | the last pointer value from any node, or `null` |
| `widget.submit(value)` / `widget.dismiss()` | final answer; the client stops the program |
| `widget.send(value, { wake })` | non-final message to the agent (as in step mode) |
| `widget.capturePointer()` / `widget.releasePointer()` | ask for pointer capture (granted on the next click) / give it back; see `widgets-input.md` |
| `widget.storage.get(key)` / `.keys(prefix?)` / `await .set(key, value)` / `await .delete(key)` | the widget template's storage, synced across the user's devices (needs the `storage` capability; see Storage) |

`Math.random()` is allowed in live mode. There is no `widget.event()` or `widget.next()`: input arrives through
handlers, and `widget.frame()`, `widget.sleep()` and `Promise.race` cover waiting.

**Handlers.** The node props are the same as in step mode (`onPress`, `onChange`, `onPointer`; `widgets.md`, Events),
but a live handler gets only the value (`onPress()`, `onChange(value)`, `onPointer(p)`; a table's `onPress(row)` and
`onSort(column)`) and its return value is
ignored: it changes the program's variables or calls `widget.*`. `render` keeps the node, whose handlers the prelude finds by
the ids' paths, and whether the host found any. While
the view has handlers, hooks are registered or a frame is awaited, the prelude keeps a `__host.receive()` in flight and
calls the handler or hook for each message between the program's awaits (handlers run while `main` awaits a frame, a
timer or a fetch). A handler that throws, or an async one that rejects, fails the program like a throw in `main`. When
`main` returns, the widget stays open while its view has handlers or hooks are registered; the run ends when none are
left (`return`) or the program submits or dismisses.

## GPU canvases

A live program animates a GPU canvas (`wgsl`) by calling `widget.render` with the same view and new `values` (up to 16
floats) once per frame; clients must apply that as a uniform update without recompiling the shader or rebuilding the
view (see `widgets.md`, GPU canvases). With `onPointer` it gets `pointer` events like any canvas, so a tap on a
full-screen GPU canvas can drive a game.

## Client ↔ program messages

Program → client (`post`): `{ type: "render", node }`, `{ type: "draw", id, commands }` (the program posts
`{ type: "draw", key, commands }`, which the host turns into the canvas's id; `widgets.md`, Native hosts; a draw post
whose `key` isn't a string is an invalid post: the run ends with the program error `A draw post needs a string key`),
`{ type: "frame" }` (one frame wanted), `{ type: "submit", value }`, `{ type: "dismiss" }`, `{ type: "send", value, wake }`, `{ type: "capture", value: true |
false }` (`capturePointer` / `releasePointer`; clients without capture ignore it), `{ type: "gpu", ops, bytes }` (a GPU
canvas batch; a frame request may carry one as `{ type: "frame", gpu }`, `widgets-gpu.md`), `{ type: "storage", key,
value? }` (a storage write, Storage).

Client → program (`receive`): `{ type: "event", event }` (`{ id, type, value }` for a prelude-assigned id, or `id: ""`
for keys, focus, full screen and capture; the prelude routes it), `{ type: "frame", frame }` (only after a frame request, at
the next vsync while the widget is visible), `{ type: "resumed", pausedMs }` (after a pause, see below), `{ type: "canvas", key, width, height }` and
`{ type: "gpu", lost }` (GPU canvases, `widgets-gpu.md`), `{ type: "storage", key, value? }` (a storage change from
elsewhere, Storage).

## Post rate

Every host applies the same rule to a live run's posts; it never drops a post and never fails the run for its rate.

- **`render` and `draw` posts are counted**, with a token bucket per run: it holds at most 8 tokens, starts full, and
  refills continuously at 240 tokens a second by the host's monotonic clock (pausing doesn't stop it). A counted post
  that arrives while no counted post waits and the bucket holds at least one token takes a token and goes to the
  client at once. Otherwise it waits: it takes the place of the waiting post of its kind (the waiting `render`, or the
  waiting `draw` for the same canvas key), or joins the end of the queue. The waiting posts go to the client in queue
  order, each as soon as the bucket holds a token, which it takes: with the bucket empty, one every 1/240 s. (Tokens
  are fractional; a host may treat 1 − 10⁻⁹ as 1.)
- **Checks don't wait.** The host walks and checks a post when the program posts it, whether it goes out at once or
  waits: an invalid post, a view that breaks Keys and depth, an unknown or GPU canvas key fail the run or the call at
  once, and `post` returns whether the render's view has handlers at once. Only its delivery to the client waits.
- **The final view is never lost.** When the run ends by `submit`, `dismiss`, `main` returning or a program error,
  the waiting posts go to the client at once, in order, before the end (before the `submit` or `dismiss` itself). A
  run the client stops drops them.
- **`frame` requests** are idempotent: at most one is pending. They are never counted, never wait and are never
  dropped; a frame request while one is pending changes nothing (a GPU batch it carries still applies).
- **Not counted:** `submit`, `dismiss`, `capture` and `storage` go to the client at once (ahead of waiting posts). `send` goes at
  once too; the server limits it (`rate_limited`, `widgets.md`). A post carrying a GPU batch (a `gpu` post, or a
  `frame` request with `gpu`) takes no token but never overtakes a waiting post: while counted posts wait, it joins the
  end of the queue, and goes out, in order, as soon as the posts ahead of it have (a batch may configure a canvas a
  waiting render adds). A frame request without a batch still goes at once.

## Capabilities

A live widget template declares what it needs beyond rendering, as a widget template field:

```ts
capabilities?: {
  https?: { hosts: string[] }   // e.g. { https: { hosts: ["api.github.com", "*.coingecko.com"] } }
  storage?: {}                  // widget.storage (Storage)
}
```

`hosts` entries are exact host names or `*.` suffix wildcards; `["*"]` means any host. Clients show the granted
capabilities on the widget (e.g. a small "Network: api.github.com" chip). **For now clients grant every declared
capability automatically**; each client keeps the grant decision in one place so a permission dialog can be added
later. An undeclared capability is unavailable: the call rejects with `CapabilityDenied`.

`fetch` rules: `https:` only; host must match the declared list (checked again after redirects, at most 5); methods
GET, POST, PUT, PATCH, DELETE, HEAD; no cookies, no credentials, no client certificates, no access to localhost,
private or link-local addresses; request body ≤ 256 KB, response body ≤ 2 MB (text; binary is base64 in `body64`),
timeout 15 s, at most 4 in flight and 10 per second per widget. Responses cross as JSON
`{ status, headers, body | body64 }`. **Local network in dev mode.** By default `fetch` refuses `http:` and any destination that resolves to a loopback,
private or link-local address. Each host's fetch boundary takes one flag, `allowLocalNetwork` (default `false`), passed
through its API (e.g. `psychoscript-mobile`'s `LiveOptions`, the web host's `mount` options, Rune's runner options).
The app sets it from its own dev mode (debug builds or the app's developer setting), never from environment variables.
When set, `fetch` also allows those destinations and plain `http:` to them, still only for hosts the widget template declares
(a declared `localhost`, `127.0.0.1` or `*.local` entry; ports are allowed then, e.g. `localhost:4097`). Every host checks
the destination against the address it actually connects to (resolve once, check, connect to that address), so DNS
rebinding can't reach the local network when the flag is off.

Errors reject with `{ kind: "CapabilityDenied" | "Network" | "Timeout" |
"TooLarge" | "RateLimited", message }`. Mobile hosts get `fetch` from `psychoscript-mobile`, which enforces these rules
and hands the actual transfer to the app (URLSession / OkHttp), so system TLS and proxies apply.

## Storage

A live widget template that declares `storage: {}` gets data that stays on its server and syncs to the user's other
clients: a weight log, a tracker's entries, a game's high scores. It is one **space** of the server's spaces
(`/api/experimental/space/*`), named `widget.<widget template name>`, so it is shared by every widget of that name on
that server: every version, every Session, every client. Keys are the program's keys as they are; values are JSON text.

The program reads a local copy and writes through the client:

| Call | Effect |
| --- | --- |
| `widget.storage.get(key)` | the value (parsed JSON; text that isn't JSON as a string), or `undefined`; synchronous |
| `widget.storage.keys(prefix?)` | the keys starting with `prefix` (default `""`), sorted; synchronous |
| `await widget.storage.set(key, value)` | stores `JSON.stringify(value)` (`undefined` as `null`); resolves once the local copy has it and the client holds the write |
| `await widget.storage.delete(key)` | removes the key; deleting a missing key does nothing |
| `widget.on("storage", ({ key, value }) => …)` | a change from elsewhere (another client, or another widget of the template on this one), with `value` parsed, `null` when deleted |

A change that leaves the copy as it is (the program's own write coming back) fires no hook. Several writes to one key
end with the last the server took (one key per record avoids that, e.g. `entry:<time>:<random>`).

**Limits**, checked by the prelude against its copy (so the error is at the template's call) and again by the host for
a program that posts around the prelude: a key is 1 to 256 characters; a value at most 64 KiB of UTF-8 JSON; at most
1,000 keys and 1 MiB (keys and values in UTF-8) per widget template. Errors are `Error`s with a `kind`, and their
message starts with it: `TooLarge: widget.storage: a key is longer than 256 characters`, `TooLarge: widget.storage: a
value is over 64 KiB of JSON`, `TooLarge: widget.storage: storage holds 1000 keys already`, `TooLarge: widget.storage:
storage would hold over 1 MiB`; a key that isn't a non-empty string is a `TypeError`.

**Clients.** The live input gains `storage` (`{ data, gpu?, storage? }`):

- `{ entries: [{ key, value }] }`: the client follows the space and grants the capability; `entries` is its copy now
  (the last complete sync, kept on the device, with its pending writes applied).
- `null`: the client has storage, but the widget template doesn't declare it. Any `widget.storage` call throws
  `CapabilityDenied: widget.storage: storage is not declared: save the widget template with capabilities: { storage:
  {} }`.
- left out: the client has no spaces sync (iOS for now, the web host, the TUI). Any `widget.storage` call throws
  `Unsupported: widget.storage: storage needs a client with spaces sync (OpenCode desktop or Android); this client has
  none`.

A client with storage follows `widget.<name>` with its generic spaces client while a storage widget of that template
runs on that server, and:

- starts the run with its copy in `storage.entries`;
- hands each storage post (`{ type: "storage", key, value }` sets, without `value` deletes) to the spaces client's
  pending writes, which carry it to the server, also after a time offline; a post that breaks a limit fails the run
  as an invalid post;
- delivers every change of the space, in order, to every running widget of that template on that server as `{ type:
  "storage", key, value }` (`value` left out for a delete), its writer's own included, and every key that changed when
  the space syncs again (after a `resync` or a reset epoch).

Clients grant `storage` automatically for now and show it on the widget (a "Storage" chip, beside "Network"); the
permission dialog of Capabilities applies to it later. The server adds nothing for storage: it is a space like any
other, events go through the existing event feed, and the spaces' own limits (1 MiB a value) stand.

## Lifecycle and budgets

- The client starts `<program>\nreturn await __widget_live(__input(), true)` (input `{ data, gpu? }`, `gpu` per
  `widgets-gpu.md`) when an open live widget first becomes visible, on its own thread or task, never the UI thread.
  Render the last `render` node; before the first one, show a loading frame.
- **Pause when not visible.** When a live widget scrolls out of view, its window or app goes to the background, or the
  session is closed, the client pauses the program: no frames, events or timer firings are delivered, `sleep` timers
  freeze with their remaining time, `now()` stops, and in-flight `fetch` results are held until resume. When the widget
  comes back into view the client resumes it and delivers `{ type: "resumed", pausedMs }` first (the prelude calls the `widget.on("resumed")` hooks), so a dashboard can
  refresh and a game can show its pause screen. A paused program costs no CPU.
- If a widget stays paused for more than 30 s (or the OS asks the app to free memory), the client may suspend the
  program to a snapshot (PsychoScript `suspend`, `toBytes`), drop the VM, and resume from the snapshot when it's visible
  again; if suspending fails, stop it and restart from `main` then.
- A render whose view breaks Keys and depth (`widgets.md`: a key of another type, more than 100 levels) ends the run
  with that program error in phase `view`, like an invalid post. A program built for another protocol isn't started
  (`widgets.md`, Protocol).
- Budgets: a program that runs more than 50 ms of CPU time without awaiting is stopped with an error (`widgets.md`,
  Budgets count CPU time: a thread that wasn't scheduled isn't over budget); at most 2,000 draw commands per `draw`;
  `render` and `draw` posts beyond the post rate wait and coalesce (Post rate); the heap cap applies as to steps
  (`widgets.md`, Heap cap: default 32 MB, phase `main`). One error shows inline with "Restart".
- A submitted/dismissed widget (from any client) stops its program; its last rendered view stays, read-only.
- Answers and sends go to the server exactly as in step mode.

## Server

The server never runs widget template code: the `widget` tool validates `data`, and `widget_template save` parses and lints the
source (an `async function main`, top-level declarations only; see `widgets.md`, Tools). A client whose live program
hits a program error (an escaped exception, an invalid post, the 50 ms slice or the heap cap) reports it with
the `report` RPC (`phase: "main"`); see `widgets.md`, Failures.
`widget_template` `save` takes `mode` and `capabilities`; both are part of the widget template version (see `widgets.md`, Widget template). Step widget templates
can't declare capabilities. The skill teaches when to use live mode (games, timers, animations,
simulations) and shows a small live example.
