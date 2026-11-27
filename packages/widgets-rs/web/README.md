# widget-web

The web host for OpenCode widgets (`specs/v2/widgets.md`, `widgets-live.md`, `widgets-fullscreen.md`): the
Rust PsychoScript (`crates/widget-web`) compiled to WebAssembly, run in Web Workers, rendered with plain DOM (no framework), Canvas2D for
2D `canvas`es, the browser's WebGPU for GPU canvases (`canvas` with `wgsl` or `gpu: true`; no WebGL fallback), and
`stack` layers. The web counterpart of Rune desktop and the mobile apps.

## Consume it

`dist/` is self-contained once built, and not committed (its module is ~10 MB): build it (see Build) with
`bash scripts/build-wasm.sh && bun run build`.

```
dist/index.js                         the page side (ESM, 103 KB min) + index.d.ts and friends
dist/worker.js                        the worker (module worker, 16 KB; includes the wasm-bindgen glue)
dist/widget_web_bg.wasm               the language (Program, LiveRun)
```

Pick one:

- **Vendor** (simplest): copy the built `dist/` into the app (e.g. `src/vendor/widget-web/`) and
  `import { mount } from "./vendor/widget-web/index.js"`. Keep the files side by side.
- **Local dependency**: the package is this directory (`packages/widgets-rs/web`), built, so point at a checkout
  (`"widget-web": "file:../opencode/packages/widgets-rs/web"`) and `import { mount } from "widget-web"`.

Assets: `index.js` finds `worker.js` and the `.wasm` files with `new URL("./…", import.meta.url)`. Vite and other
bundlers that understand `new Worker(new URL(…, import.meta.url))` and `new URL(asset, import.meta.url)` emit them as
assets with no configuration. Otherwise serve the four files from one directory, or tell the host where they are:

```ts
import { configure } from "widget-web"
configure({ workerUrl: "/assets/pw/worker.js", wasmUrl: "/assets/pw/widget_web_bg.wasm" })
```

Serve `.wasm` as `application/wasm` (else it falls back to a slower non-streaming compile) and compressed (brotli or
gzip; see Size). The files never change for a given commit, so they can be cached immutably under a hashed path.

## Mount

```ts
import { mount } from "widget-web"

const widget = mount(element, {
  program,            // Program.program from opencode.widget/program: prelude + "\n" + source (widget protocol 2)
  data,               // the widget tool call's data
  mode: "step",       // or "live" (Program.mode)
  capabilities,       // Program.capabilities (live): { https: { hosts } }, granted as declared, shown as a chip
  allowLocalNetwork,  // dev mode only, default false: see "Local network in dev mode" below
  state: "open",      // the server State.status: "submitted" | "dismissed" render read-only with a status line
  response,           // optional: State.response, summarized after "Submitted"
  onSubmit: (value) => rpc.respond({ sessionID, messageID, callID, response: { value } }),
  onDismiss: () => rpc.respond({ sessionID, messageID, callID, response: { dismiss: true } }),
  onSend: (value, wake) => rpc.send({ sessionID, messageID, callID, value, wake }),
  theme: "dark",      // "dark" | "light" | tokens (below)
  resolveImage: (src) => /^(https?|data):/.test(src) ? src : fileContentUrl(session, src),   // optional
  onWarning: (message) => console.warn("widget", message),                                    // optional
  source,             // Program.source: makes error positions widget-template-relative (else found from the prelude)
  failure,            // State.failure, if any
  onReport: (error) => rpc.report({ sessionID, messageID, callID, error, client: "web" }),     // program errors only
  onAsk: (error) => rpc.report({ sessionID, messageID, callID, error, client: "web", ask: true }),  // omit: no button
  onClientError: (message, cause) => dev && console.error("widget host:", message, cause),     // dev log only
})

widget.setState("submitted", response) // the `changed` event said so (from any client): read-only, live program stops
widget.setFailure(state.failure)       // the `changed` event carried a new failure (or none)
widget.setTheme("light")
widget.restart()                       // fresh init / fresh main
widget.destroy()                       // stops the program, frees the worker side, removes the element
```

`mount` appends one element (`div.psychoscript-widget`, open shadow root) to `element` and uses the page's shared
`WidgetHost`. For several independent hosts: `new WidgetHost(options).mount(...)`; `host.destroy()` stops everything.
`host().preload()` starts fetching and compiling the WebAssembly early (e.g. when a session with widgets opens).

Behavior, per the contract:

- Widget protocol 2 (widgets.md, Protocol, Native hosts): the program's first line must be `const __widget_protocol =
  2`. Steps run `__widget_native_step(__input())`, the view handed to `__widget_emit` and its tree built in the
  WebAssembly; live programs run `__widget_live(__input(), true)`, each render's tree built as posted. A program of an
  older protocol isn't run: "This widget was built with an older widget runtime; ask the agent to post it again", a
  program error in phase `init` (`main` live; `olderRuntimeMessage` replaces the text shown); a newer one shows "This
  widget needs a newer version of this app", a client error. Neither offers "Try again".
- Step widgets share one worker; `init` runs when the widget first comes within 200 px of the viewport (a loading
  shimmer before). Each step runs off the page's thread; a failing step keeps the previous view and shows the error
  inline; a failing first step shows an error card with "Try again".
- Live widgets get a worker each (isolation: one can't stall another), start when first visible, pause when out of
  view or the tab is hidden (timers freeze, `now()` stops, events/fetch results held), and receive
  `{ type: "resumed", pausedMs }` when back. A program computing more than 50 ms without awaiting is stopped and
  shows the error with "Restart". Submit/dismiss stops the program; the last view stays read-only.
- Live post rate (widgets-live.md, Post rate): `render` and `draw` posts take tokens from a bucket of 8 refilled at
  240 a second; over it they wait, the latest render and the latest draw per canvas key replacing earlier ones, and go
  out as tokens come, or all at once when the run ends (not when the client stops it). They are checked when posted.
  Frame requests, `submit`, `dismiss`, `capture` and `send` are never counted. Nothing is dropped and the rate is
  never an error. A `draw` post without a string `key` ends the run (`A draw post needs a string key`), and so does
  one over 2,000 commands or with a command that fails the spec's draw command checks (phase `draw`, `draw command
  <i>: …`); the client gets a draw's canvas id and the normalised commands only. Draw steps are checked the same way.
- `onSubmit`/`onDismiss` fire once; the widget turns read-only right away. `onSend` is throttled to 10 a second.
- GPU canvas (`canvas` with `gpu: true` and a `key`, live mode; widgets-gpu.md): the live input tells the program
  `gpu: { available, format }` (WebGPU in this browser, its preferred canvas format). The program's `widget.gpu` calls,
  recorded by the live prelude into batches (ops and one `ArrayBuffer` of bytes, in a frame request or on their own;
  a batch never overtakes a waiting render or draw; ops read as JSON reads them, numbers kept, `NaN` and infinities
  put back by the worker), are checked and then replayed on the page's thread on the
  browser's WebGPU: one device per widget, resources by handle, a context's canvas found by its key among the GPU
  canvases of the last render, sized before it is configured. The checks are the spec's Host checks with their exact
  messages (`src/gpu-checks.ts`, a port of opencode's reference; the per-frame counts start again at every frame
  request, one without a batch too); WebGPU validates what replays (an error scope per batch, in the browser's words).
  An error is a program error in phase `gpu` that stops the canvases the batch renders into (a pass's color attachment
  `view` or `resolveTarget`), else every GPU canvas, each reported once: a stopped canvas shows its placeholder with the
  error for the rest of the run, also rendered anew and after a device loss; its ops in later batches are skipped while
  the batch's other canvases draw. The program and the rest of the widget run on. Before each frame (the first too)
  the program gets `{ type: "canvas", key, width, height }` for each GPU canvas whose size changed: its physical size
  clamped to 4096 with its aspect kept, the canvas's backing size, which its box scales. A lost device sends
  `{ type: "gpu", lost, message }` and its canvases show the placeholder; a new device restarts those, never one an
  error stopped; a batch from before the program learned of the loss is dropped quietly. A canvas is cleared once per
  frame, at the frame request: when its passes all come in the frame request's batch (the common case) they render
  straight into WebGPU's current texture, which is cleared once per presented display frame. A batch posted mid-frame
  (before a sleep or a fetch) that renders into a canvas makes it draw into a texture kept for the rest of that frame
  (the frame's first pass clears it, later batches load it), copied to the current texture to present: at most once a
  display frame, and at the frame request. Only such a canvas's context gets `COPY_DST`; the others are configured
  with `RENDER_ATTACHMENT` alone, the usage the program's canvas texture has. A frame with no pass into a canvas keeps
  its last image. A GPU hang, a batch's work unfinished 250 ms after its submit, stops the canvases it renders into,
  else every GPU canvas, for the rest of the run, as an error would (a new device never restarts them): a client error
  `the GPU work hung; the canvas is stopped`, the placeholder with it. A queue's watchdog
  (`src/watchdog.ts`; `onSubmittedWorkDone` and one timer, never waited on) times only its oldest unfinished submit,
  from its submit or, if later, from when the one before it finished, so work queued behind a hung submit isn't
  blamed. Strikes: at a device loss, a run with GPU work submitted and not yet seen finished (its live device's, or its
  `wgsl` shaders' on the device they share) gets a strike, if its work finished on a device (an `onSubmittedWorkDone`
  resolved there, not by the loss) since its previous strike or its start: losses in a row with none finished between
  are one reset, one strike. The first changes nothing visible, a second 30 s or less
  after it stops every GPU canvas of the run, shaders too, for the rest of the run with that client error (once), and no
  new device restarts them. Without WebGPU the canvas shows `poster`, else `alt`, else "GPU canvas not supported" (a
  client error, not reported). Why the page's thread: the canvases, their sizes, placeholders, full
  screen and pointer are there already; batches cross from the worker as transferred bytes, and WebGPU calls only
  record commands, so the GPU's work stays asynchronous.
- `canvas`: Canvas2D, drawn on `requestAnimationFrame` only while `fps > 0` (or `duration` not reached) and
  visible; draw steps run in the worker, at most one in flight; 8 ms / 2,000 commands budget, three overruns in a row
  stop the animation and keep the last frame. A resize repaints the last commands at once, then draws again.
- GPU canvas (`canvas` with `wgsl`, `values` ≤ 16 floats; `fps` defaults to 60): the WGSL in a fixed full-screen
  pipeline on WebGPU; without WebGPU it shows `poster`, else `alt`, else "GPU canvas not supported" (a client error,
  not reported; no WebGL fallback).
  New `values` (a live program re-rendering every frame) update the uniforms only: same element, same pipeline.
  A frame is submitted only once the last is done (`onSubmittedWorkDone`); a frame unfinished 50 ms after its submit
  three frames in a row stops it, its last frame kept (client error `the shader took over 50 ms a frame, three frames
  in a row`); a frame unfinished 250 ms after its submit, before that, stops it for the rest of the run, its
  placeholder showing the client error `the GPU work hung; the canvas is stopped` (a GPU hang; the shaders
  share one device, and its watchdog stops only the hung frame's canvas; strikes at its loss are each run's, and a
  shader is built again on a new device unless its run is stopped). A failing shader shows
  `poster` or `alt` with the error.
- Canvases are never drawn or rendered while they have a zero width or height; `Frame.width`/`height` are > 0.
- `stack` layers its children in one cell (first at the bottom): a child's area is the stack minus its `inset`;
  `place` aligns its natural size there (`top-left` default … `bottom-right`), `fill` stretches it (a canvas then draws
  at that size); `left`/`right` are physical, they don't flip right-to-left. The stack is as tall as its tallest child
  plus insets. Children let the pointer through to the layer below (text, markdown, images, a canvas without
  `pointer: true`, empty space) except controls, cards and carousels with an `id`, and canvases with `pointer: true`.
  In full screen a stack with a canvas grows like one.
- Canvases (2D or GPU) with `pointer: true` (the prelude sets it for an `onPointer`; a canvas with only a `key` has an
  `id` for `widget.draw` but takes no input) send `pointer`
  events, which the prelude routes to `onPointer`: `down`, `up`, and `move`
  at most once a frame, with `down: true` while a button is held and, on desktop and web, hover moves
  `{ kind: "move", x, y, down: false, width, height }` while the pointer is over the node (touch has no hover).
- Full screen (widgets-fullscreen.md): an expand button in the top-right corner (on hover/focus; always on touch)
  when the root node has `fullscreen: true`, or it isn't `false` and the widget is live or its view has a `canvas` or
  stack with one. It uses the Fullscreen API on the widget's element (Esc exits); the program gets
  `{ id: "", type: "fullscreen", value }` (`onFullscreen` / `widget.on("fullscreen")`) and `Frame.fullscreen` is set.
  The root fills the screen minus a 16 px padding on every side (canvases inside it too) and every `canvas` and
  stack with a canvas shares the remaining height equally (its `height` is the minimum; `fill: false` keeps it at its `height`);
  taller content scrolls. The only chrome is the close button, always visible, floating 32 x 32 CSS px, 8 px from the
  screen's top and right edges, over the padded root's corner (no capability chip, no focus hint). The program is told
  where it is: the `fullscreen` event carries `close` (the button's area in root coordinates, `{ x: W - 24, y: -8,
  width: 32, height: 32 }` for a root `W` wide, `null` when leaving; sent again when the root's size changes), and
  `Frame.close` and absolute canvas or
  GPU canvas `pointer` values carry it in that node's coordinates when it overlaps the node. Esc and the browser's back
  close full screen whatever holds the keyboard or the pointer (entering pushes a history entry; `popstate` closes),
  releasing both; closing it any other way takes that history entry back off.

### Failures (widgets.md, Failures)

The host sorts every error into one of two kinds:

- **Program errors** (the widget template's): a parse error or exception (in `init`, a handler or hook, `draw`, `main`), an
  invalid view or draw output, WGSL that fails validation (WebGPU's compiler) or is over 16 KB, the 250 ms
  step, the 50 ms live slice and the send rate (10/s), a draw post without a string `key`, a view that breaks a rule of views (a
  key not a string, number or boolean; more than 100 levels), a function where none may go (anywhere in a view but a
  node's `onPress`/`onChange`/`onPointer`, in a post or a host call: `TypeError: Argument <n> to <name> contains a
  function, …`), an older widget
  protocol. The widget shows them (error card, or inline under the last good view) and calls `onReport({ phase,
  message, line?, column? })` once per distinct error; `phase` is `init`, `event`, `draw`, `main`, `view` (the rules
  of views) or `shader`, and `line`/`column` are in the widget template's source (the
  prelude's lines subtracted; dropped when they fall in the prelude or past the widget template; a shader's WGSL position goes
  into the message as "WGSL line N"). Post it with `report` (`client: "web"`).
- **Client errors** (this host's): a newer widget protocol, a worker or WebAssembly crash, a missing worker or module, valid WGSL the GPU path
  can't run, a draw or shader too slow on this device (the 8 ms draw / 50 ms shader stops), the host's own 100 ms draw
  cut-off, Fullscreen API refusals, a throwing `onReport` or failing `onAsk`. They go only to `onClientError(message,
  cause)`: log them in dev mode, never report them. A fetch error a live program catches is its own business.

`failure` / `setFailure(f)` is the server's `State.failure`. While the widget is open it shows
"Failed on <client>: <phase>: <message> (line N, col M)" (not repeated when this client is showing the same error),
then "The agent was told about this error." when `sent`, or with `sent: false` an **"Ask agent to fix it"** button that
calls `onAsk(error)` (the embedder calls `report` with `ask: true`; "Asking the agent…" while it runs). Without `onAsk`
(an artifact with no agent session) there is no button.

### Keyboard and pointer capture (widgets-input.md)

- Clicking or tapping inside an open widget, or tabbing to it (the widget's element is focusable), gives it keyboard
  focus: an accent focus ring and a tiny hint, a keyboard icon plus "Esc" (a cursor icon plus "Esc" while the pointer
  is captured; `aria-label` "Esc to release"). Touch devices show no hint until a hardware keyboard types, then the
  icon alone. The program gets `{ id: "", type: "focus", value }`, and
  while focused `{ id: "", type: "key", value: { kind: "down" | "up", key, code, repeat, shift, alt, ctrl, meta } }`
  which the prelude routes to the hooks (`onKey`, `onFocus`, `onCapture`, `onFullscreen` in step mode,
  `widget.on(...)` in live mode). Delivered keys are `preventDefault`ed and stop
  propagating at the widget (no page scrolling, no app shortcuts in the bubble phase).
- Not delivered: Cmd (macOS) / Ctrl (elsewhere) chords, which reach the page; Tab, which moves focus; keys typed into
  text inputs; Enter/Space on buttons and options, and arrows on sliders, options and carousels, which keep working.
  Clicking outside blurs it; held keys get their `up` on blur.
- Pointer capture: root `capture: "pointer"` (step or live) or a live program posting `{ type: "capture", value: true }`
  (what the prelude's `widget.capturePointer()` posts; `releasePointer()` posts `value: false`). Granted on the next
  click inside the widget with the Pointer Lock API (cursor hidden); then `{ id, type: "pointer", value: { kind: "move",
  dx, dy } }` at most once a frame and `{ kind: "down" | "up", button }`, with `id` the first `pointer: true` canvas's `id` in the
  view (else `""`). The program gets `{ id: "", type: "capture", value: true }` when granted.
- Esc is never delivered. One Esc releases both (the browser itself ends Pointer Lock on Esc; that also drops focus),
  as do leaving full screen, the window losing focus, submit/dismiss and `destroy()`. The program gets
  `{ type: "focus", value: false }` and, if it had the pointer, `{ type: "capture", value: false }`. A live program
  must call `capturePointer()` again after a release; a root `capture: "pointer"` is granted again on the next click.
- The host sends only the wire events (`{ id, type, value }`, widgets.md, Events); ids come from the prelude and the
  host never interprets them, so widget templates written with handlers (`onPress`, `onChange`, `onPointer`) and hooks need
  nothing from the host.

### Theme

`theme` is `"dark"`, `"light"` or tokens: `{ text, muted, accent, bg, surface, border, success, warning, error,
accentText?, font?, mono?, radius?, dark? }` (missing ones come from the dark or light preset). They become CSS
variables on the widget element (`--pw-text`, `--pw-accent`, …, `--pw-font`, `--pw-radius`) and the colors draw
commands name. The widget paints no background of its own (except in full screen): it sits on the page's surface.

## Content-Security-Policy

What the page needs (the demo server, `scripts/serve.ts`, sends exactly this and everything works under it):

```
script-src 'self' 'wasm-unsafe-eval'     # WebAssembly.compile in the page and the worker
worker-src 'self'                        # module worker from the same origin (or where worker.js is served)
connect-src 'self' https:                # fetching the .wasm (self), and live widgets' fetch capability
                                         # (+ the local hosts, e.g. http://localhost:4097, with allowLocalNetwork)
img-src 'self' data: https:              # image nodes and draw images (plus your file-content endpoint)
style-src 'self'                         # no inline styles: constructable stylesheets and CSSOM only
```

`connect-src` for widget fetch: live widgets fetch from the worker, so the page's policy applies. `https:` allows
every host a widget template may declare; a narrower list blocks undeclared and declared hosts alike (the widget sees a
`Network` error). The `.wasm` and worker must be same-origin with the page (or the CDN must be in `script-src`,
`worker-src` and `connect-src`; module workers can't be cross-origin, so serve `worker.js` from the page's origin).

## Live `fetch` in a browser

Rules are enforced in Rust (`packages/widgets-rs/crates/widget-web/src/fetch.rs`): `https:` only, host on the declared list
(exact, `*.suffix`, `*`), no URL credentials, no `localhost`/`.local`/single-label names or private, loopback,
link-local literal addresses, GET/POST/PUT/PATCH/DELETE/HEAD, no cookie headers either way, request body ≤ 256 KB,
response ≤ 2 MB, 15 s, at most 4 in flight and 10 a second. The worker carries it with
`fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", mode: "cors" })`.

### Local network in dev mode

`allowLocalNetwork: true` (default false; widgets-live.md, "Local network in dev mode") also lets a widget reach
loopback, private and link-local addresses and local names (`localhost`, `*.localhost`, `*.local`, `*.internal`,
single-label names), over `http:` as well as `https:`, but only hosts the widget template declares by name or address, never
through `*`. Entries may name a port (`localhost:4097`, `127.0.0.1:5173`, `[::1]:8080`) and then match only it; an
entry without a port matches any. Turn it on only behind a dev setting (e.g. a debug toggle or an
`OPENCODE_WIDGETS_DEV_NETWORK`-style flag), never by default in release builds. The capability chip then says
"local network allowed".

The browser has its own say:

- The page's CSP must allow the destination too, e.g. `connect-src 'self' https: http://localhost:4097
  http://127.0.0.1:4097`; otherwise the request fails with `Network`.
- An `https:` page can't fetch plain `http:` except to `localhost`/`127.0.0.1`/`[::1]` (mixed content); other private
  hosts need `https:` there.
- Chromium asks the user before a public page reaches the local network (Private/Local Network Access), and the
  local server must answer CORS (and Private Network Access preflights) for the page's origin.
- A browser can't pin the address it connects to, so with dev mode off a public name that resolves to a private
  address is only stopped by those browser checks, not here.

Browser limits: the target must allow CORS (else `Network`); the browser follows redirects itself (the final URL is
checked against the same rules before the program sees anything, intermediate hops are not visible); names aren't
resolved here, so a public name that points at a private address is only stopped by the browser's Private Network
Access checks.

## Size and speed

| File | Raw | gzip | brotli |
| --- | --- | --- | --- |
| `widget_web_bg.wasm` | 9.95 MB | 3.36 MB | 2.33 MB |
| `index.js` + `worker.js` | 122 KB | 40 KB | |

5.7 MB of the language module is data, mostly ICU4X locale data for `toLocale*String`/`Intl.DateTimeFormat`/
`localeCompare`; trimming it is possible without code changes but changes behavior (see
`packages/widgets-rs/crates/widget-web/README.md`).

Chromium 158 on this VM (no GPU, SwiftShader), from `scripts/check.ts`:

| | ms |
| --- | --- |
| First view on a fresh page (fetch + compile the module, start and warm the worker, compile, `init`, paint) | ~180–250 |
| First view of another widget once the worker runs | median 17, p95 ~80 |
| Compiling a widget template program | median 2–3, p95 6 |
| A step (`init`/`update`) | median 0.8–1, p95 5–11 |
| A draw step | median 0.5–0.6, p95 2–3 |

The first program a fresh WebAssembly instance runs costs 30–100 ms more (the engine compiles the interpreter's
functions lazily); the worker runs a small warm-up program at start for that, and workers share the compiled code.
`host().preload()` starts it all early.

Memory: each worker holds its own linear memory: ~7 MB for a live widget's worker (5.7 MB of it the module's data),
~10.5 MB for the shared step worker with 28 step widgets and 23 programs; the page side's JS heap ~18–20 MB for the
whole demo (27 widgets). A live widget's worker is terminated when it stops.

## Build

```sh
cd packages/widgets-rs/web
bun install
bash scripts/build-wasm.sh   # cargo (wasm32-unknown-unknown, workspace ..) + wasm-bindgen 0.2.130 + wasm-opt -> wasm/
                             # (source paths remapped: no build machine's directories in the module)
bun scripts/build.ts         # -> dist/ (index.js, worker.js, .wasm, .d.ts)
bun scripts/fixtures.ts      # demo/fixtures.js from packages/widget (or another checkout's: pass its path)
bun scripts/gpu-fixtures.ts  # packages/widget's GPU fixtures on wasm/: batches byte for byte, host-check errors, ends
bun scripts/watchdog-check.ts  # the GPU hang watchdog on a queue the check finishes: no GPU
bun scripts/report-check.ts  # with the demo server: live failures' reports (fetch kinds, template lines), headless
bun scripts/serve.ts         # http://localhost:4173/demo/ (with the CSP above)
```

Checks in a real browser, with the demo server running: `SHOTS=<dir> xvfb-run -a bun scripts/check.ts` (Chromium from
Playwright's cache, WebGPU through SwiftShader's Vulkan; headless screenshots leave WebGPU canvases blank, so it runs
headful under Xvfb). It renders every fixture in both themes and checks canvases drew, presses controls and checks the
submits (confirm, suggestions with carousel, form), chart pointer and tap, backdrop on WebGPU, shader
pointer events and values-only updates, the minigame, pause/`resumed` out of view, full screen with `fill`, the slice
budget and Restart, and the fetch rules; then prints timings and memory.

The demo (`demo/`) mounts every built-in (`suggestions`, `form`, `confirm`, `chart`, `backdrop`, `minigame` and the
17 diagram widget templates, data from `packages/widget/test/fixtures/diagrams.ts`) plus demo widget templates for fetch,
a running clock (pause), a runaway loop, a live shader and full screen. `?only=<name>`, `?theme=light`.
