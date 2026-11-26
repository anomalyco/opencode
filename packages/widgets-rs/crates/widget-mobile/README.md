# widget-mobile

OpenCode widgets on iOS and Android: the one native library each app ships (`libwidget_mobile`). It is
psychoscript-mobile's UniFFI API (programs, sessions, `runBytes`, live runs, fetch, budgets, snapshots, GPU canvases:
`anomalyco/psychoscript`'s `rust/crates/psychoscript-mobile/README.md`, at the revision `Cargo.lock` pins) plus the
widget parts: the widget encoder ([below](#the-widget-encoder)) and `ShaderCanvas`, the `wgsl` shorthand
([below](#shadercanvas)). One library, so a frame's delivery and a batch's replay stay in one binary.

| | Swift | Kotlin |
| --- | --- | --- |
| Module / package | `import PsychoScript` (both crates' bindings) | `com.anomalyco.psychoscript` (psychoscript-mobile's), `ai.opencode.widgets` (this crate's) |
| Native library | `PsychoScriptFFI.xcframework` (static) | `libwidget_mobile.so` (JNA) |

## The widget encoder

`widgetEncoder()` (Swift, module `PsychoScript`; Kotlin `ai.opencode.widgets.widgetEncoder()`) is the `ValueEncoder`
for OpenCode widgets' binary format (`specs/v2/widgets-binary.md`, crate `widget-wire`) for a native host of widget
protocol 2 (`widgets.md`, Native hosts): it builds the view tree (ids, keys, handlers) itself while it encodes, from the
view as the program built it. Runs with it pass program functions to the host as markers, with a boundary value depth
of 202 (`widget_wire::MAX_VALUE_DEPTH`). Restore a widget run with the widget encoder.

- **Checked before running.** The widget encoder runs only protocol 2 (`const __widget_protocol = 2` on the program's
  first line): an older program fails with kind `OlderProtocol` and the message `This widget was built with an older
  widget runtime; ask the agent to post it again` (a program error in the phase of the step or run refused: `init`,
  `event`, `draw`, `main`), a newer one with kind `NewerProtocol` and `This widget needs a newer version of this app`
  (a client error: show it, don't report it).
- **Steps:** `program.runBytes(inputJson, widgetEncoder(), options)` (also on `RunSession`) defines `__widget_emit`.
  The encoder reads the step's `phase` from the input. In `init` and `event` steps the view goes through
  `__widget_emit`, and `{ state, submit?, dismiss?, send? }` is the run's result, so it keeps the JSON path's rules
  exactly (`toJSON`, an `Error`'s fields, a typed array failing the step). In `draw` steps the commands go through
  `__widget_emit`, read as JSON reads them (functions left out), and the run has no result. `maxOutputBytes` limits
  the bytes. Failures (`Runtime`, by kind):
  - `InvalidView`, no line: the view breaks Keys and depth (`A node's key must be a string, a number or a boolean`,
    `The view nests more than 100 levels`), whatever the run did after;
  - `InvalidDraw`, no line: a draw step's commands failing the Draw command checks (`widgets.md`, Canvas), with
    exactly that section's message, e.g. `draw command 2: a text weight must be 400, 500, 600 or 700` (after the
    run; the run's own failure first). Clients get the normalised commands (clamped values, defaults for absent
    fields);
  - `ExecutionFailure` `TypeError: Argument <n> to __widget_emit contains a function, which cannot be passed to the
    host. (line, col)`: a function in the view anywhere but a node's `onPress`, `onChange`, `onPointer`;
  - `InvalidDataValue` `The step gave no view`: an init or event step that never called `__widget_emit`;
  - and the run's own failures, as `run` has them.
- **Live runs:** with `startLive(..., encoder: widgetEncoder())` (and `LiveRun.restore(..., encoder:)`), posts reach
  `handler.onPostsBytes(messages)`. `__host.post` returns, for a `render`, whether the view has handlers (the prelude
  keeps the run going on it), else `undefined`. A post the encoder can't write throws at `__host.post`: uncaught, the
  run ends with `Failed(Runtime)` of the encoder's kind, located at the post. A live draw's commands get a draw step's
  checks and message (kind `InvalidDraw`, the message without an `invalid post:` prefix). A view breaking Keys and
  depth doesn't throw: the run ends at once with `Failed(Runtime(kind: "InvalidView"))`, no line. A `draw` post whose
  `key` isn't a string ends the run with `Failed(Runtime(kind: "InvalidDataValue", reason: "A draw post needs a
  string key"))`, no line. What the encoder keeps goes into a snapshot: the last render's canvases by key, the
  program's last GPU handle and the canvases errors stopped.
- **Post rate** (`widgets-live.md`, Post rate): `render` and `draw` posts take a token from a bucket of 8 refilled at
  240 a second; without one they wait, a newer render replacing the waiting render and a newer draw the waiting draw
  of its canvas key, and go out in order as tokens come. Every post is checked when it's posted (errors and `post`'s
  answer don't wait). `submit` and `dismiss` hand over what waits first; `frame`, `send` and `capture` go at once. A
  post carrying a GPU batch takes no token but waits behind waiting posts, in order (the frame request it rides in
  too); a frame request while one is pending (no `frame` delivered since) sends nothing, its batch still applies.
  Nothing is dropped and the rate is never an error.
- **GPU batches** never reach `onPostsBytes`: with feature `gpu` they are replayed on the run's `LiveGpu`
  (psychoscript-mobile, GPU canvases), and the program's input gets `gpu: { available, format }`; without it the run
  has no GPU (no `gpu` in its input) and batches are dropped. A batch's errors don't end the run: they stop canvases
  (`onGpuCanvas`, phase `gpu`).
- **Function markers:** a function in a post's values, draw commands or `fetch`'s request fails the call with the
  runtime's `TypeError` `Argument <n> to <name> contains a function, which cannot be passed to the host.` at the call:
  a real `TypeError` the program can catch, located at the call when uncaught.
- **Keys:** live draws name their canvas by key (`{ type: "draw", key, commands }`); the encoder sends the canvas's id
  from the last render. An unknown key (`No canvas with key "<key>" in the rendered view`), or a canvas drawn by its
  `wgsl` (`Canvas "<key>" is drawn by its wgsl; it takes no draw commands`) or by the GPU (`Canvas "<key>" is drawn
  by the GPU; it takes no draw commands`), throws an `Error` at the post that the program can catch, as the prelude
  does.
- **Kinds** name the spec's phase for the report: `InvalidView` (phase `view`), `InvalidDraw` (`draw`). Anything else
  it can't write (an unknown post type) is `InvalidDataValue`, an invalid post (`invalid post: ...`). widget-wire's
  `InvalidGpu` (`gpu`) is a GPU batch post `encode_post` can't write; this encoder hands batches to the run's GPU
  instead, where their errors stop canvases.

## ShaderCanvas

`ShaderCanvas(wgsl:, surface:, width:, height:)` (Swift, module `PsychoScript`; Kotlin
`ai.opencode.widgets.ShaderCanvas`) draws the `wgsl` shorthand (`widgets.md`, GPU canvases; `widget_wire::shorthand`)
on psychoscript-mobile's device, in steps and live widgets. It returns at once (create it on the UI thread). `render(time:, scale:, pointer:, values:)` on
the display link at the canvas's `fps` only records the frame (a few µs); a thread of the canvas's own waits for the
device, compiles the shader, and draws and presents the newest frame (frames faster than the surface are skipped).
Nothing is drawn or reported before the device is ready. `render` fails, once, with what stopped the canvas for good,
its `reason` the message: `GpuFailure.program` for a WGSL error (its line the template's: report it, phase `gpu`),
`.client` without a GPU (log it); show the placeholder then. A shader over 50 ms a frame three frames in a row stops
on its last frame (`widgets-gpu.md`): `render` fails with `.client` and reason `the shader took over 50 ms a frame,
three frames in a row` once; log it and keep the surface (its last frame), not the placeholder. A frame the GPU hung
on (psychoscript-mobile, Heavy GPU work) fails with `.client` and `the GPU work hung; the canvas is stopped`: log it,
show the placeholder. After a device loss it draws again on the new device. `resize(width:, height:)` takes effect at
the next frame. Drop it before its surface goes: once dropped, it never touches the surface again (a present in
progress finishes first). It is always premultiplied: not opaque.

## OpenCode widgets on this API

A widget template's served `program` is `prelude + "\n" + source`, and the step ABI is one entry call:

```swift
let program = try Program(source: served.program + "\nreturn __widget_step(__input())")
let step = RunOptions(timeoutMs: 250), draw = RunOptions(timeoutMs: 8)
let out = try program.run(inputJson: #"{"phase":"init","data":\#(dataJson)}"#, options: step)   // {state, view, ...}
let frame = try program.run(inputJson: drawInputJson, options: draw)                               // {commands}
```

```kotlin
val program = Program(served.program + "\nreturn __widget_step(__input())")
val out = program.run("""{"phase":"init","data":$dataJson}""", RunOptions(timeoutMs = 250uL))
val frame = program.run(drawInputJson, RunOptions(timeoutMs = 8uL))   // a Timeout here counts as a draw overrun
```

With the binary format (widget protocol 2, a native host): the step program ends in
`return __widget_native_step(__input())` instead of `return __widget_step(__input())`, a live one in
`return await __widget_live(__input(), true)`, and the app decodes the bytes (`widgets-binary.md`) rather than parsing
JSON. Live posts arrive in `onPostsBytes`. Keep a session per widget with its `data` and send only
`{ phase, state, event | frame }` per step; live widgets take `maxHeapBytes` 32 MB (`32 * 1024 * 1024`).

```swift
let wire = widgetEncoder()
let program = try Program(source: served.program + "\nreturn __widget_native_step(__input())")
let liveProgram = try Program(source: served.program + "\nreturn await __widget_live(__input(), true)")
let bytes = try program.runBytes(inputJson: stepInputJson, encoder: wire, options: step)    // 01 'S' ... or 01 'D' ...
let run = try liveProgram.startLive(inputJson: input, handler: handler, options: opts, transport: t, encoder: wire)
```

```kotlin
import ai.opencode.widgets.widgetEncoder

val wire = widgetEncoder()
val program = Program(served.program + "\nreturn __widget_native_step(__input())")
val liveProgram = Program(served.program + "\nreturn await __widget_live(__input(), true)")
val bytes = program.runBytes(stepInputJson, wire, RunOptions(timeoutMs = 250uL))
val run = liveProgram.startLive(input, handler, opts, transport, wire)          // handler.onPostsBytes(List<ByteArray>)
```

A `wgsl` canvas, in a step or a live widget: a [`ShaderCanvas`](#shadercanvas) per canvas, drawn on the display link.
The 16 KB source cap, the draw command cap and output parsing are the app's, per the spec. `examples/widget.rs` runs and
times a step program as an app does; `examples/wire_bench.rs` times both paths on the bench workloads
(`tests/fixtures/workloads`).

## Building

Run from an opencode checkout; each script runs psychoscript-mobile's own on this crate (its checkout at the revision
`Cargo.lock` pins, `CRATE=widget-mobile`), with its needs (psychoscript-mobile's README, Building):

```sh
packages/widgets-rs/crates/widget-mobile/scripts/build-ios.sh <out>    # macOS + Xcode
ANDROID_NDK_HOME=… packages/widgets-rs/crates/widget-mobile/scripts/build-android.sh <out>
```

Without `<out>`, they write to `packages/widgets-rs/target/mobile/ios` and `.../android`.

- iOS: `<out>/PsychoScript/`, a local Swift package (`import PsychoScript`): `Package.swift`,
  `PsychoScriptFFI.xcframework` (static libraries for iOS, the Simulator and macOS, arm64, with both crates' headers)
  and `Sources/PsychoScript/*.swift`, one file per crate's bindings.
- Android: `<out>/jniLibs/{arm64-v8a,x86_64}/libwidget_mobile.so`, and Kotlin
  `<out>/kotlin/com/anomalyco/psychoscript/{psychoscript_mobile.kt,PsychoScriptGpu.kt,LiveFrames.kt}` and
  `<out>/kotlin/ai/opencode/widgets/widget_mobile.kt`, all loading `libwidget_mobile.so`.
- Both: `<out>/REVISION` (`anomalyco/opencode <sha>`) and this README.

An app adds them as psychoscript-mobile's README says (In an app), with R8 also keeping `ai.opencode.widgets.**`.
`FEATURES=--no-default-features` builds them without GPU canvases (a `ShaderCanvas` then fails with `this build has
no GPU canvases`).

## Tests

Run from `packages/widgets-rs`: `cargo test --locked -p widget-mobile`. The GPU tests run on this machine's device
(Metal on macOS, Vulkan elsewhere: lavapipe on a machine without a GPU). They read opencode's sources in place:

- `wire`: the binary path against the JSON path, `runBytes` and live posts, on the bench workloads
  (`tests/fixtures/workloads`) and on the native-host fixtures (`packages/widget/test/fixtures/wire`), with
  `packages/widget/src/prelude.js`, `prelude-live.js` and `test/fixtures/scripted-prelude.js`.
- `widgets`: live widgets as the apps run them, on copies of the prelude and the `minigame` built-in in
  `tests/fixtures`.
- `gpu`: GPU canvases end to end, headless and into real surfaces; `gpu_loss` (a device loss) and `gpu_unavailable`
  (a GPU that turns out to be missing), each in a process of its own; `gpu_fixtures`: the GPU conformance fixtures
  (`packages/widget/test/fixtures/gpu`; `GPU_FIXTURES` names another directory). They run with
  `packages/widget/src/prelude.js` and `prelude-live.js`.
- `gpu_heavy` and `gpu_slow`, on demand only (`--ignored`), hang the GPU for real: the OS recovers the GPU, the whole
  screen's included. Run one, once, with the GPU owner's OK (`gpu_heavy.rs` says how).
