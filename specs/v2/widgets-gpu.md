# GPU canvases (WebGPU subset)

A live widget template can draw a `canvas` with a subset of WebGPU, enough to build three.js-class 3D scenes from
scratch (meshes, textures, depth, lighting, render-to-texture), e.g. a first-person shooter. The program uses the
WebGPU API's shapes and names; the client replays what it records on its own GPU. Compute is left out for now. 2D `draw`
canvases are unaffected. Clients only: the server stores and validates nothing for it.

| Client | GPU |
| --- | --- |
| Rune desktop | wgpu |
| iOS | wgpu in `psychoscript-mobile` (Metal) |
| Android | wgpu in `psychoscript-mobile` (Vulkan 1.1 or newer; Android 15, API 35, or newer: newer releases are never excluded) |
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

**A canvas's contents in a frame.** A canvas is cleared to transparent once per frame, at the frame boundary (each
`widget.frame()`), not once per batch. Batches posted before `sleep`/`fetch` within a frame see what earlier passes in
that frame drew. A frame with no pass into a canvas leaves the last presented image showing. So the frame's first pass
into a canvas sees transparent, `loadOp: "load"` included, as on the web (`getCurrentTexture`); a host that keeps a
canvas's texture between frames clears it before the frame's first pass into it.

## Transport

A batch is `{ ops: Op[], bytes: ArrayBuffer }`, sent as the frame request `{ type: "frame", gpu: batch }` or on its own
as `{ type: "gpu", ...batch }`. `ops` are JSON arrays like draw commands, and every host reads them as JSON reads them:
an `undefined` list item is `null`, and an `undefined` object member is absent (so `[undefined]` as color attachments is
`[null]`, and `{ buffer: undefined, sampler: 2 }` is a sampler). Nothing else changes: numbers are read as they are, so
`NaN` and infinities fail the check that reads them rather than becoming `null`. `bytes` is one `ArrayBuffer` the
prelude assembles from the batch's write data (the raw bytes of the typed arrays passed, in call order), never a JSON
array of numbers; the host reads it through psychoscript's host bytes API as a borrowed slice, without copying. Ops
reference it as `[byteOffset, byteLength]`. Handles are integers the prelude assigns per widget, from 1, never reused; a
descriptor names resources by handle.

```ts
type Op =
  | ["context", handle, key, format, alphaMode]             // getContext + configure; handle is its current texture
  | ["buffer", handle, size, usage]
  | ["texture", handle, width, height, depthOrArrayLayers, format, usage, mipLevelCount, sampleCount]
  | ["view", handle, texture, descriptor]                    // texture.createView (dimension: "2d" | "2d-array" | "cube")
  | ["sampler", handle, descriptor]
  | ["shader", handle, code]
  | ["bindGroupLayout", handle, descriptor]
  | ["pipelineLayout", handle, bindGroupLayouts: handle[]]
  | ["renderPipeline", handle, descriptor]                   // layout: handle | "auto"
  | ["autoLayout", handle, pipeline, index]                  // pipeline.getBindGroupLayout(index)
  | ["bindGroup", handle, descriptor]
  | ["destroy", handle]
  | ["writeBuffer", buffer, offset, byteOffset, byteLength]
  | ["writeTexture", texture, mipLevel, [x, y, layer], byteOffset, byteLength, bytesPerRow, rowsPerImage,
      [width, height, layers]]
  | ["copyBufferToBuffer", source, sourceOffset, destination, destinationOffset, size]
  | ["copyBufferToTexture", buffer, offset, bytesPerRow, rowsPerImage, texture, mipLevel, [x, y, layer],
      [width, height, layers]]
  | ["copyTextureToTexture", source, sourceMip, [x, y, layer], destination, destinationMip, [x, y, layer],
      [width, height, layers]]
  | ["pass", descriptor]                                     // beginRenderPass; the commands up to "end" are its own
  | ["setPipeline", pipeline]
  | ["setBindGroup", index, bindGroup, dynamicOffsets]
  | ["setVertexBuffer", slot, buffer, offset, size]          // size -1: to the end
  | ["setIndexBuffer", buffer, "uint16" | "uint32", offset, size]
  | ["setViewport", x, y, width, height, minDepth, maxDepth]
  | ["setScissorRect", x, y, width, height]
  | ["draw", vertexCount, instanceCount, firstVertex, firstInstance]
  | ["drawIndexed", indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
  | ["end"]
  | ["submit"]                                               // the command buffers' commands just before it, in order
```

A `context` op comes from `configure`: configuring again posts it again with the same handle (a reconfiguration), and
configuring with a new device gives a new handle. A context's handle stands for that canvas's current texture at
replay time, so views of it are created once. An `error` op is a WebGPU validation error the prelude found itself,
which the ops can't show: `the command encoder is finished` (a command after `finish()`), `a render pass is open on this
command encoder` (a command, a pass or `finish()` while a pass is open), `the render pass has ended` (a pass command
after `end()`), `a command buffer can be submitted once`, `a texture's dimension must be "2d"`. An encoder records
nothing after its first error. Handles count from 1 and only grow; a call on a lost device spends a handle and records
nothing.

Descriptors are WebGPU's, with handles in place of objects and every default filled in by the prelude, so each op has
exactly these shapes (`h` a handle; absent optional members are `null`):

- `view`: `{ dimension, baseMipLevel, mipLevelCount, baseArrayLayer, arrayLayerCount }` (dimension `"2d-array"` for a
  texture of more than one layer, else `"2d"`; counts to the texture's end, 1 layer for `"2d"`, 6 for `"cube"`).
- `sampler`: `{ addressModeU, addressModeV, addressModeW, magFilter, minFilter, mipmapFilter, lodMinClamp, lodMaxClamp,
  compare, maxAnisotropy }` (`"clamp-to-edge"`, `"nearest"`, 0, 32, `null`, 1).
- `bindGroupLayout`: `{ entries: [{ binding, visibility, buffer, sampler, texture }] }`, one of the last three set:
  `buffer: { type ("uniform"), hasDynamicOffset (false), minBindingSize (0) }`, `sampler: { type ("filtering") }`,
  `texture: { sampleType ("float"), viewDimension ("2d"), multisampled (false) }`.
- `pipelineLayout`: a list of bind group layout handles.
- `bindGroup`: `{ layout: h, entries: [{ binding, resource }] }`, `resource` one of `{ buffer: h, offset (0), size
  (-1: to the end) }` (a buffer alone is the whole buffer), `{ sampler: h }`, `{ view: h }`.
- `renderPipeline`: `{ layout: h | "auto", vertex: { module: h, entryPoint, buffers: [null | { arrayStride, stepMode
  ("vertex"), attributes: [{ format, offset, shaderLocation }] }] }, fragment: null | { module: h, entryPoint, targets:
  [null | { format, blend: null | { color, alpha }, writeMask (15) }] }, primitive: { topology ("triangle-list"),
  stripIndexFormat, frontFace ("ccw"), cullMode ("none") }, depthStencil: null | { format, depthWriteEnabled (false),
  depthCompare ("always") }, multisample: { count (1), mask (4294967295), alphaToCoverageEnabled (false) } }`, a blend
  component `{ operation ("add"), srcFactor ("one"), dstFactor ("zero") }`, `entryPoint` `null` for the module's only
  one.
- `pass`: `{ colorAttachments: [null | { view: h, resolveTarget, clearValue: [r, g, b, a] ([0, 0, 0, 0]; `{ r, g, b, a
  }` becomes a list), loadOp, storeOp }], depthStencilAttachment: null | { view: h, depthClearValue, depthLoadOp,
  depthStoreOp, depthReadOnly (false) } }`.
- `writeBuffer`'s data offset and size count elements of a typed array, bytes of an `ArrayBuffer`; `writeTexture`
  takes its data from the layout's `offset` to the end. Both copy the bytes when called. Origins default to
  `[0, 0, 0]`, extents' height and layers to 1, `rowsPerImage` to `null`, `mipLevel` to 0; `setVertexBuffer` and
  `setIndexBuffer` offset 0 and size -1; `draw` and `drawIndexed` instance count 1, the rest 0; `setBindGroup`'s
  dynamic offsets `[]`.

The client finds a context's canvas by its `key` among the `gpu: true` canvases of the last render posted (walked, as
for `widget.draw`: `widgets.md`, Native hosts). Before each frame the client sends the program `{ type: "canvas", key,
width, height }` for every GPU canvas whose size changed; the prelude updates `context.width`/`height` (and the canvas
texture's `width`/`height`; 0 until the first message).

**Canvas size.** A GPU canvas's backing size, its texture's, is its size in physical pixels clamped to the texture
limit (4096, Limits) with its aspect ratio kept: when the larger side is over 4096, it becomes 4096 and the other
⌊side × 4096 / larger side⌋ (integer division), at least 1. The `canvas` message gives the clamped size, so a texture
of the canvas's size always fits: a 5K full-screen canvas, 5120 × 2880, is 4096 × 2304 and never errors. The client
scales the texture to the canvas's box. `canvasSize` in `packages/widget/src/gpu.ts` is the rule in TypeScript.

## Limits

The numbers below are verified on wgpu on mobile during implementation. A program over a limit has a program error (`widgets.md`, Failures); the client stops that canvas (below).

- Device limits: WebGPU's default limits, except `maxTextureDimension2D` 4096 (what Vulkan guarantees on Android;
  canvases are clamped to it, Canvas size) and `maxBufferSize` 64 MB; the prelude reports them in `device.limits`.
- Resources: at most 256 MB of buffers and textures per widget (sizes as allocated: width × height × bytes per texel ×
  samples, mip levels included), and 4,096 live handles.
- Per batch: at most 4 MB of `bytes` and 20,000 ops; per frame (between two `widget.frame()`), at most 16 render passes
  and 10,000 draws. The counts start again at each frame request, with a batch or without one.
- Shaders: 256 KB of WGSL per module. Batches, in a frame request or on their own, aren't counted toward the post
  rate (`widgets-live.md`, Post rate).

## Errors and device loss

- **Program errors** (phase `gpu` in `report`): a WGSL module that fails validation, any WebGPU validation error in a
  replayed op (wgpu's and the browser's validation implement WebGPU's rules), an `error` op, and what the host checks
  (Host checks). The first uncaptured GPU error is enough (no error scopes in v1). The program and the rest of the
  widget keep running. A validation error's message is the GPU implementation's own wording (wgpu's or the browser's),
  so only the host checks' messages are the same on every host.
- **Which canvases stop.** The device is the widget's, shared by its GPU canvases. An error in a batch stops the
  canvases that batch renders into (a pass of the batch has a view of a canvas's texture as a color attachment's
  `view` or `resolveTarget`, the view made in that batch or before); if the batch renders into none (a bad pipeline,
  a write), every GPU canvas of the widget stops. A stopped canvas shows its placeholder with the error, its error is
  reported once, and the host ignores later batches for it (after an error that stopped every canvas, all later
  batches). An error that stops only canvases already stopped isn't reported again.
- **Stopped stays stopped.** A canvas an error stopped stays stopped, its placeholder showing its error, for the rest
  of the run: also when it leaves the view and comes back under the same key, and after a device loss. A program error
  is a bug in the program, and a new device doesn't fix it.
- **Client errors** (not reported; logged and shown with their reason under the placeholder in dev mode only,
  `widgets.md`, Failures): no WebGPU, device creation failure, a driver crash or reset, running out of GPU memory under
  the limits. The canvas shows its placeholder.
- **GPU hang.** A batch, or a `wgsl` shader frame, whose GPU work is still unfinished 250 ms after its submit stops
  every canvas it draws into (a pass's color attachment `view` or `resolveTarget`; drawing into none, every GPU canvas
  of the widget, as Which canvases stop says) for the rest of the run, as an error would: a client error with exactly
  this message, `the GPU work hung; the canvas is stopped`, and the placeholder shows. It applies first, whatever the
  shader's 50 ms rule has counted (`widgets.md`, GPU canvases), and catches GPUs without a watchdog. (On a host whose
  widgets share one device and queue, as Rune and mobile do, only the hung submit's widget stops; work queued behind it
  isn't blamed.)
- **Strikes.** At a device loss, a widget run that had GPU work submitted and not yet seen finished gets a strike, if
  its GPU work has finished on a device at least once since its previous strike (or since the run started): losses in a
  row with no finished work in between belong to the same reset and count once (a reset in progress may discard a new
  device's first work and lose it again). A run with two strikes 30 s apart or less is stopped: every GPU canvas of the
  run stops for the rest of the run with the same message, and no new device restarts them. A run's first strike changes
  nothing visible: the loss restarts it as usual. (A GPU reset can't be attributed reliably on every platform, so a run
  present at two resets is treated as their cause, as browsers do.)
- **Device loss.** When the client loses its device (a reset, the app backgrounded long enough, a live program
  restored from a snapshot), it sends `{ type: "gpu", lost: reason, message? }`; the prelude resolves `device.lost` with
  `{ reason, message }` (`message` `""` when absent) and every handle is gone. While the program has read a live
  device's `lost`, the prelude keeps receiving the client's messages, so awaiting it works (and keeps the run open).
  The program may call `requestDevice()` again and recreate its resources; until it does, the canvases the loss stopped
  show their placeholder. The new device restarts only those, never a canvas an error or a GPU hang stopped; other
  canvases and widgets restart as usual.
- **A batch from before the program learned of the loss** names handles from before it: the host drops it quietly
  (not replayed, not reported, no canvas stops). Exactly: a batch whose first failure (Host checks) is `no handle <h>`
  with `h` from 1 to the greatest handle the host had made when it last lost the device. Before any loss no handle
  is, and handle 0 never is: those stay program errors.
- **A run restored from a snapshot** (`widgets-live.md`, Pause when not visible) is a device loss. A host that
  snapshots live runs keeps with the snapshot the greatest handle the program had made, and the canvases errors
  stopped, with their errors. On restoring, it sends `{ type: "gpu", lost: "unknown" }` before the program runs on.
  Handles up to the kept one count as from before the loss (a batch naming one is dropped quietly, above), and the
  stopped canvases stay stopped (Stopped stays stopped), their errors not reported again. The TypeScript host
  (`LiveWidget`) doesn't snapshot runs.

## The `wgsl` shorthand

`canvas({ wgsl, values })` stays, in step and live mode: it is sugar the client expands into a fixed GPU program on
the same path. It is a full-screen triangle pipeline whose fragment stage is the `wgsl` between the header and entry
point in `widgets.md` (GPU canvases), with one uniform buffer for `widget` (`resolution`, `time`, `scale`, `pointer`,
`values`), redrawn at `fps`. Its limits, errors and placeholder rules are this spec's; there is no WebGL fallback, so
where WebGPU is unavailable (a browser without it) the canvas shows its placeholder.

## Host checks

Before it replays a batch (or instead, without a GPU), every host checks it without a GPU, with exactly these rules and
messages, so all hosts fail the same programs the same way. They read `ops` as Transport says (`undefined` as JSON reads
it). The first failure is the batch's program error (phase `gpu`), and the rest of the batch isn't replayed. When it
fails at op `i`, ops 0 to `i` − 1 take effect, as separate WebGPU calls would (the resources they create, their writes,
the submits they make), and an encoder or pass still open at op `i` is dropped without being submitted; the host checks'
handle state does the same, so a later batch may use a handle those ops made. Errors from replaying (WebGPU validation)
follow, in the GPU implementation's wording (Errors and device loss).

- **The batch:** an object (`a batch must be an object`) with `ops` a list (`a batch's ops must be a list`) of at most
  20,000 (`the number of ops in a batch is over the limit of 20000`) and `bytes` an `ArrayBuffer` (`a batch's bytes
  must be an ArrayBuffer`) of at most 4 MB (`the size of a batch's bytes is over the limit of 4194304`). A native host
  may make the first three as it converts the posted value to its own types, before the op checks and any replay;
  that is allowed, with these messages.
- **Each op** fails as `gpu op <i>: <reason>` (`<i>` from 0), checked in order: a list that starts with a string (`an op
  is a list that starts with its name`), a name in the `Op` type or `error` (`unknown op "<name>"`), exactly its
  arguments (`"<name>" takes <k> arguments`); an `error` op fails with its message; `pass` not inside a pass (`"pass"
  inside a render pass`), `setPipeline` … `drawIndexed` and `end` only inside one (`"<name>" outside a render pass`),
  every other op only outside (`"<name>" inside a render pass`). At the batch's end no pass is open (`a render pass is
  still open at the end of the batch`, no op index).
- **Arguments,** first to last, then descriptor members in the order of the shapes above, each named by its path
  (`"<name>" argument <i>`, then `.member` and `[index]`, as in `"renderPipeline" argument 2.vertex.buffers[0].arrayStride`):
  `<path> must be a whole number` (an integer ≥ 0: sizes, offsets, counts, indices, handles), `<path> must be a whole
  number or -1` (sizes that may be -1), `<path> must be an integer` (`drawIndexed`'s base vertex), `<path> must be a
  finite number` (clear values, viewports, lod clamps, depth clear values), `<path> must be true or false`, `<path>
  must be a string`, `<path> must be a list` or `must be a list of <n>` (origins and extents 3, clear values 4), `<path>
  must be an object`, `<path> must be one of <a>, <b>, …` (the subset's values, in the order
  `packages/widget/src/gpu.ts` lists them), `<path> must combine <A>, <B>, …` (flags outside the subset's: buffer usage
  `COPY_SRC, COPY_DST, INDEX, VERTEX, UNIFORM, STORAGE`, texture usage `COPY_SRC, COPY_DST, TEXTURE_BINDING,
  RENDER_ATTACHMENT`, visibility `VERTEX, FRAGMENT`), `<path> needs exactly one of buffer, sampler and texture`,
  `<path> must be a buffer binding, a sampler or a view`.
- **Handles:** a new one is greater than every handle before (`handle <h> was already used`; a `context` op may repeat
  its own handle with the same key); one an op names exists (`no handle <h>`), is of the kind the op takes (`handle <h>
  is a <kind>, not a <kind>`, or `… not a buffer or texture` for `destroy`; kinds `context`, `buffer`, `texture`, `view`,
  `sampler`, `shader`, `bindGroupLayout`, `pipelineLayout`, `renderPipeline`, `bindGroup`; a view's texture may be a
  context) and isn't destroyed (`handle <h> was destroyed`; destroying a texture destroys its views). A `context` op's
  key is a `gpu: true` canvas of the last render posted (`no GPU canvas with key "<key>"`).
- **Canvas textures** are only rendered into. A texture argument of `writeTexture`, `copyBufferToTexture` or
  `copyTextureToTexture` that is a context's handle fails `<path> uses canvas "<key>"'s texture, which can only be
  rendered into` (checked in place of its kind, so this and not `handle <h> is a context, not a texture`); so does a
  bind group entry's `resource.view` whose texture is a context's, once the view itself passed. `<key>` is the
  context's canvas key, as in `"copyTextureToTexture" argument 1 uses canvas "scene"'s texture, which can only be
  rendered into`.
- **Bytes:** `writeBuffer` and `writeTexture` read inside the batch's bytes (`bytes [<start>, <end>) are outside the
  batch's <n> bytes`).
- **Limits** (`<what> is over the limit of <n>`): a buffer's size (`"buffer" argument 2`, 67108864), a texture's width
  and height (`"texture" argument 2` and `3`, 4096) and layers (`"texture" argument 4`, 256), a shader's UTF-8 bytes
  (`"shader" argument 2`, 262144), a color target's `writeMask` (its path, 15), `the number of live handles` (4096:
  handles made, less destroyed buffers and textures and their views; a lost device's handles are gone), `the size of
  buffers and textures` (268435456: buffers' sizes, and textures' bytes per texel × width × height × layers × samples
  summed over mip levels, a texel 4 bytes but 1 for `r8unorm` and 8 for `rgba16float`; canvas textures don't count),
  `the number of render passes in a frame` (16) and `the number of draws in a frame` (10000), counted over a frame's
  batches up to and including the one in its frame request; the counts start again after every frame request, one
  without a batch included (a frame request while one is pending changes nothing, `widgets-live.md`).

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
