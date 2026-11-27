# GPU canvases (WebGPU subset)

A live widget template can draw a `canvas` with a subset of WebGPU, enough to build three.js-class 3D scenes from
scratch (meshes, textures, depth, lighting, render-to-texture), e.g. a first-person shooter. The program uses the
WebGPU API's shapes and names; the client replays what it records on its own GPU. Compute is left out for now. 2D `draw`
canvases are unaffected. Clients only: the server stores and validates nothing for it.

| Client | GPU |
| --- | --- |
| Rune desktop | wgpu, psychoscript-gpu |
| iOS | wgpu in `widget-mobile` (`packages/widgets-rs`), on psychoscript-mobile and psychoscript-gpu (Metal) |
| Android | wgpu in `widget-mobile` (`packages/widgets-rs`), on psychoscript-mobile and psychoscript-gpu (Vulkan 1.1 or newer; Android 15, API 35, or newer: newer releases are never excluded) |
| Web host | the browser's WebGPU; no WebGL fallback. It must produce the same program errors as wgpu for this subset; a difference is a client bug |
| TUI | none for now (placeholder); `@opencode/widget`'s `LiveWidget` checks batches (Host checks) without replaying them |

**Unavailable is not an error.** Where a client has no WebGPU, or creating the device fails, the canvas shows its
`poster` (else its `alt`, else "GPU canvas not supported") and everything else in the widget keeps working: other nodes,
nodes layered over it in a `stack`, handlers, timers. The program runs unchanged: `requestDevice()` still resolves and
its calls are recorded and dropped (`widget.gpu.available` is `false`), so a widget template needs no fallback path.
The unavailable state has an exact reason (e.g. no WebGPU, or the device creation error), logged and shown under the
placeholder in dev mode only (`widgets.md`, Failures).

**What the program knows.** A host tells the prelude about its GPU in the live input: `__input()` returns
`{ data, gpu: { available, format } }`, `available` whether it replays batches and `format` its preferred canvas
format (`"bgra8unorm"` or `"rgba8unorm"`). Without `gpu`, or with `available` not `true`, the program has no GPU: it
records nothing and posts no batches; `getPreferredCanvasFormat()` returns `format` (default `"rgba8unorm"`).

**The host side** (the batch format, canvas size, limits, host checks, errors and device loss) is psychoscript-gpu's,
generic over its programs and hosts: `anomalyco/psychoscript`'s `rust/crates/psychoscript-gpu/README.md` (here
"psychoscript-gpu's README"). This spec keeps the program side and what is the widget's.

## The node

A GPU canvas is `canvas` with `gpu: true` (and a `key`, to reach it): `ui.canvas({ key: "scene", gpu: true, height,
fill, onPointer, alt, poster })`. It is live mode only; a step widget template uses the `wgsl` shorthand (below).
`gpu`, `wgsl` and 2D `draw` exclude each other: a canvas is drawn one way (a view with a canvas that has both `gpu` and
`wgsl` is invalid; a live `draw` post to a GPU canvas throws `Canvas "<key>" is drawn by the GPU; it takes no draw
commands`, as for a `wgsl` canvas). Layout, `fill`, full screen, `onPointer`,
pointer capture and `close` are as for every canvas (`widgets.md`, Canvas; `widgets-fullscreen.md`). Game input is
the existing input model: keys and focus, pointer capture with relative `dx`/`dy` (`widgets-input.md`), `widget.keys`
and `widget.pointer` read each frame (`widgets-live.md`).

## The API

The prelude provides `widget.gpu`, shaped like `navigator.gpu` plus a canvas context:

```js
const device = await widget.gpu.requestDevice()          // one device per widget, until it is lost
const format = widget.gpu.getPreferredCanvasFormat()      // "bgra8unorm" or "rgba8unorm", per client
const context = widget.gpu.getContext("scene")            // the canvas with that key, like canvas.getContext("webgpu")
context.configure({ device, format, alphaMode: "opaque" }) // alphaMode: "opaque" | "premultiplied"
// context.width / context.height: the canvas's size in physical pixels (logical × scale), updated before each frame
```

The prelude defines WebGPU's flag objects for the subset as globals: `GPUBufferUsage` (`COPY_SRC` 4, `COPY_DST` 8,
`INDEX` 16, `VERTEX` 32, `UNIFORM` 64, `STORAGE` 128), `GPUTextureUsage` (`COPY_SRC` 1, `COPY_DST` 2,
`TEXTURE_BINDING` 4, `RENDER_ATTACHMENT` 16), `GPUShaderStage` (`VERTEX` 1, `FRAGMENT` 2) and `GPUColorWrite` (`RED`
1, `GREEN` 2, `BLUE` 4, `ALPHA` 8, `ALL` 15). An argument of the wrong kind where WebGPU takes an object (a buffer where
a pipeline goes, no descriptor) throws a `TypeError` in the program, as WebGPU's JavaScript API does; anything else
(values, enums, limits) is recorded as given and checked by the host.

`device` has these methods and objects, each taking WebGPU's descriptor shape and returning an object that stands for
the resource (a handle):

- `createBuffer({ size, usage })`: `usage` from `GPUBufferUsage` (`VERTEX`, `INDEX`, `UNIFORM`, `STORAGE`, `COPY_DST`,
  `COPY_SRC`), with WebGPU's numeric values. No `mappedAtCreation`, no `mapAsync`: data goes in with `writeBuffer`.
- `createTexture({ size: [w, h, depthOrArrayLayers?], format, usage, mipLevelCount?, sampleCount? })`: 2D textures
  and 2D texture arrays (`depthOrArrayLayers`, default 1). Formats: `rgba8unorm`, `rgba8unorm-srgb`, `bgra8unorm`,
  `r8unorm`, `rgba16float`, `depth24plus`, `depth32float`. `usage` from `GPUTextureUsage` (`COPY_SRC`, `COPY_DST`,
  `TEXTURE_BINDING`, `RENDER_ATTACHMENT`). `sampleCount` 1 or 4. `texture.createView(descriptor?)`: `dimension` `"2d"`,
  `"2d-array"` or `"cube"` (6 layers of a square texture, from `baseArrayLayer`), `baseMipLevel`, `mipLevelCount`,
  `baseArrayLayer`, `arrayLayerCount`.
- `createSampler(descriptor)`, `createShaderModule({ code })` (WGSL).
- `createBindGroupLayout`, `createPipelineLayout`, `createBindGroup` (entries: buffer bindings, samplers, texture
  views), and `pipeline.getBindGroupLayout(index)` for `layout: "auto"`.
- `createRenderPipeline(descriptor)`: vertex (buffers and attributes) and fragment stages, `primitive` (topology,
  `cullMode`, `frontFace`), `depthStencil` (depth format, `depthWriteEnabled`, `depthCompare`), per-target `blend` and
  `writeMask`, `multisample.count`. Synchronous only (no `createRenderPipelineAsync`).
- `queue.writeBuffer(buffer, offset, data, dataOffset?, size?)` and `queue.writeTexture({ texture, mipLevel?, origin? },
  data, { bytesPerRow, rowsPerImage? }, [w, h, layers?])` (`origin` `[x, y, layer]`), with `data` an `ArrayBuffer` or typed array (`Float32Array`,
  `Uint8Array`, `Uint16Array`, `Uint32Array`, `Int32Array`; the interpreter hands their bytes to the host without
  copying).
- `createCommandEncoder()` → `copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size)`,
  `copyBufferToTexture({ buffer, offset?, bytesPerRow, rowsPerImage? }, { texture, mipLevel?, origin? }, [w, h,
  layers?])`, `copyTextureToTexture({ texture, mipLevel?, origin? }, { texture, mipLevel?, origin? }, [w, h, layers?])`,
  and `beginRenderPass({ colorAttachments: [{ view, resolveTarget?, clearValue, loadOp, storeOp
  }], depthStencilAttachment?: { view, depthClearValue, depthLoadOp, depthStoreOp } })` → `setPipeline`,
  `setBindGroup(index, group, dynamicOffsets?)`, `setVertexBuffer(slot, buffer, offset?, size?)`,
  `setIndexBuffer(buffer, "uint16" | "uint32", offset?, size?)`, `setViewport`, `setScissorRect`, `draw`, `drawIndexed`,
  `end()`; `encoder.finish()` → a command buffer for `queue.submit([...])`.
- `buffer.destroy()`, `texture.destroy()`; `device.lost`, a promise (below).

`context.getCurrentTexture()` returns the canvas's texture (the same object every frame; it stands for whatever surface
texture the client presents next). Render into `getCurrentTexture().createView()` to draw the canvas; render into your
own textures and bind them for render-to-texture. A canvas's texture can only be rendered into (a pass's color
attachment `view` or `resolveTarget`): its usage is `RENDER_ATTACHMENT` (16), as `usage` reads, and copying it, copying
or writing into it, or binding a view of it is a program error (Host checks). `configure` takes `device`, `format`
and `alphaMode`; other members, `usage` among them, are ignored. A host may give its canvas textures more usages for its
own work; the program can't use them. `getCurrentTexture()` before `configure` throws; destroying the canvas's texture
does nothing. A texture's views with equal descriptors are one view (one handle), so a per-frame
`createView()` costs nothing; so is `pipeline.getBindGroupLayout(index)` per index. `requestDevice()` while a device
lives returns it. Nothing else from WebGPU exists (no compute, no queries, no error
scopes, no 3D textures, no compressed formats, no optional features).

## Frames

Create resources once; then per frame:

```js
while (true) {
  const frame = await widget.frame()
  // update state from frame.dt, widget.keys, widget.pointer; resize depth textures when context.width/height change
  device.queue.writeBuffer(camera, 0, cameraMatrices)            // small per-frame writes
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
    loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }], depthStencilAttachment: { view: depthView,
    depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } })
  // setPipeline, setBindGroup, setVertexBuffer, drawIndexed, ... per mesh
  pass.end()
  device.queue.submit([encoder.finish()])
}
```

Calls don't touch a GPU in the program. The prelude records them into a **batch**, in queue order: resource creation
and `writeBuffer`/`writeTexture` at the point they are called, a command buffer's commands at the `submit` that takes
it. The pending batch goes out before the program next waits on the host: with `widget.frame()` it rides in the
frame request itself, so a game posts once per frame (about 120 posts a second at 120 Hz); before `widget.sleep()`,
`widget.fetch()`, each wait for client messages (handlers, hooks) and when `main` returns it is a post of its own (an
intermediate batch, allowed; batches aren't counted toward the post rate, but never overtake a waiting `render` or
`draw`: `widgets-live.md`, Post rate). A batch with no ops isn't posted. The client replays each batch in order on its
device and presents every canvas whose texture a render pass in the batch wrote to (as a color attachment's `view` or
`resolveTarget`). It may skip presents beyond one per display frame, never other ops.
In dev mode the canvas shows the presents per second (`widgets.md`, Canvas: Dev fps readout).

**A canvas's contents in a frame** (psychoscript-gpu's README, A canvas's contents in a frame): a canvas is cleared
to transparent once per frame, at each `widget.frame()`, not once per batch, so batches posted before `sleep`/`fetch`
within a frame see what earlier passes in that frame drew.

## Transport

The batch format is in psychoscript-gpu's README (Transport): the batch shape `{ ops: Op[], bytes: ArrayBuffer }`, the
`Op` type, the `error` op and its messages, and the descriptor shapes with their defaults, which the prelude fills in.
A batch is sent as the frame request `{ type: "frame", gpu: batch }` or on its own as `{ type: "gpu", ...batch }`.
Handles are integers the prelude assigns per widget, from 1, never reused.

The client finds a context's canvas by its `key` among the `gpu: true` canvases of the last render posted (walked, as
for `widget.draw`: `widgets.md`, Native hosts). Before each frame the client sends the program `{ type: "canvas", key,
width, height }` for every GPU canvas whose size changed; the prelude updates `context.width`/`height` (and the canvas
texture's `width`/`height`; 0 until the first message).

**Canvas size** (psychoscript-gpu's README, Canvas size): physical pixels, clamped to 4096 a side with the aspect
ratio kept. The `canvas` message gives the clamped size. `canvasSize` in `packages/widget/src/gpu.ts` is the rule in
TypeScript.

## Limits

The limits are in psychoscript-gpu's README (Limits), per widget: a program over a limit has a program error
(`widgets.md`, Failures); the client stops that canvas (below). The prelude reports the device limits in
`device.limits`. Batches, in a frame request or on their own, aren't counted toward the post rate (`widgets-live.md`,
Post rate).

## Errors and device loss

Program and client errors, which canvases stop, stopped staying stopped, GPU hangs, strikes, a batch from before the
loss and a run restored from a snapshot are in psychoscript-gpu's README (Errors and device loss), with the widget as
the run. For widgets:

- **Program errors** are reported with phase `gpu` (`report`); the program and the rest of the widget keep running.
- **Client errors** aren't reported; they are logged and shown with their reason under the placeholder in dev mode
  only (`widgets.md`, Failures).
- **GPU hang** applies to `wgsl` shader frames too: a frame still unfinished 250 ms after its submit stops its canvas,
  whatever the shader's 50 ms rule has counted (`widgets.md`, GPU canvases). On a host whose widgets share one device
  and queue, as Rune and mobile do, only the hung submit's widget stops.
- **Device loss.** When the client loses its device (a reset, the app backgrounded long enough, a live program
  restored from a snapshot), it sends `{ type: "gpu", lost: reason, message? }`; the prelude resolves `device.lost` with
  `{ reason, message }` (`message` `""` when absent) and every handle is gone. While the program has read a live
  device's `lost`, the prelude keeps receiving the client's messages, so awaiting it works (and keeps the run open).
  The program may call `requestDevice()` again and recreate its resources; until it does, the canvases the loss stopped
  show their placeholder. The new device restarts only those, never a canvas an error or a GPU hang stopped; other
  canvases and widgets restart as usual.
- **A run restored from a snapshot** (`widgets-live.md`, Pause when not visible): on restoring, the client sends
  `{ type: "gpu", lost: "unknown" }` before the program runs on. The TypeScript host (`LiveWidget`) doesn't snapshot
  runs.

## The `wgsl` shorthand

`canvas({ wgsl, values })` stays, in step and live mode: it is sugar the client expands into a fixed GPU program on
the same path. It is a full-screen triangle pipeline whose fragment stage is the `wgsl` between the header and entry
point in `widgets.md` (GPU canvases), with one uniform buffer for `widget` (`resolution`, `time`, `scale`, `pointer`,
`values`), redrawn at `fps`. Its limits, errors and placeholder rules are this spec's; there is no WebGL fallback, so
where WebGPU is unavailable (a browser without it) the canvas shows its placeholder.

## Host checks

Every host checks each batch before it replays it (or instead, without a GPU) with exactly the rules and messages of
psychoscript-gpu's README (Host checks; in TypeScript `packages/widget/src/gpu.ts`, whose value lists' order the
messages follow). The first failure is the batch's program error (phase `gpu`). For widgets, a `context` op's key
must be a `gpu: true` canvas of the last render posted (`no GPU canvas with key "<key>"`), and a frame request while
one is pending isn't a frame boundary for the per-frame counts (`widgets-live.md`).

## Conformance

`packages/widget/test/fixtures/gpu/*.json` hold programs, the example widget templates among them
(`test/fixtures/gpu/templates`: a lit rotating cube, a textured quad, render-to-texture with post-processing, a
first-person maze), and what a host must do with them. Each is
`{ name, source, data?, canvases, inputs?, gpu,
batches?, errors, end }`. The driver: start the live program of `source`
(`widgets.md`, Prelude and step ABI) with `{ data, gpu }` and no 50 ms slice; send each of `canvases` as a `canvas`
message (sizes in physical pixels, clamped as Canvas size says); then, while the program asks for a frame (at most 10),
send the `inputs` for frame `i` (client `event`s, `canvas` messages, and device losses
`{ type: "gpu", lost, inFlight?, finished? }`, the host losing the device first, with `inFlight: true` when the run had
GPU work in flight then and `finished: false` when none of its GPU work finished on a device since the previous loss),
frame `i` (`t` = `i` / 60, `dt` 1/60, 300 × 200 at scale 2, `pointer` `null`, `dark` `false`), then frame `i`'s inputs
marked `after: true`, before the program runs on. Timers run on a clock that moves while the program waits. `batches`
are the batches it posts, in order (`frame`: in a frame request; `bytes` base64, or `null` when the program posted
something other than an `ArrayBuffer`; `ops` as posted, a list or not, with each number JSON can't hold written
`{ "$num": "NaN" }`, `{ "$num": "Infinity" }` or `{ "$num": "-Infinity" }`, which a driver that replays `batches` reads
back as that number), with each frame request that carries no batch in its place as
`{ frame: true, ops: [], bytes: "" }`, so every frame's end is there (the per-frame counts start again at each
`frame: true` entry); a repeated frame request while one is pending isn't one (its batch, if any, is recorded with
`frame: false`). `raw-*` programs post their own and omit them, except one whose batch has the wrong shape (`ops` not a
list, `bytes` not an `ArrayBuffer`), which keeps them: a driver that replays `batches` makes the batch checks on them as
a host converting the posted value does. A fixture whose ops are generated and too many to record
(`error-too-many-draws`) has `"batches": "from-source"`: a driver gets its batches by running `source` as above.
`errors` are what stopped canvases, `{ message, canvases }`, with `canvases` the keys stopped or `"all"`: the host
checks' program errors, and a stop by Strikes. `end` is how the run ended (`return`, `stop` when it stays open, or
`error: <message>`).
