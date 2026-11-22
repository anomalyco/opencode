# GPU canvases (WebGPU subset)

A live widget template can draw a `canvas` with a subset of WebGPU, enough to build three.js-class 3D scenes from
scratch (meshes, textures, depth, lighting, render-to-texture), e.g. a first-person shooter. The program uses the
WebGPU API's shapes and names; the client replays what it records on its own GPU. Compute is left out for now. 2D `draw`
canvases are unaffected. Clients only: the server stores and validates nothing for it.

| Client | GPU |
| --- | --- |
| Rune desktop | wgpu |
| iOS | wgpu in `psychoscript-mobile` (Metal) |
| Android | wgpu in `psychoscript-mobile` (Vulkan 1.1 or newer; Android 15 and 16, API 35 and 36, only) |
| Web host | the browser's WebGPU; no WebGL fallback. It must produce the same program errors as wgpu for this subset; a difference is a client bug |
| TUI | none for now (placeholder) |

**Unavailable is not an error.** Where a client has no WebGPU, or creating the device fails, the canvas shows its
`poster` (else its `alt`, else "GPU canvas not supported") and everything else in the widget keeps working: other nodes,
nodes layered over it in a `stack`, handlers, timers. The program runs unchanged: `requestDevice()` still resolves and
its calls are recorded and dropped (`widget.gpu.available` is `false`), so a widget template needs no fallback path.

## The node

A GPU canvas is `canvas` with `gpu: true` (and a `key`, to reach it): `ui.canvas({ key: "scene", gpu: true, height,
fill, onPointer, alt, poster })`. It is live mode only; a step widget template uses the `wgsl` shorthand (below).
`gpu`, `wgsl` and 2D `draw` exclude each other: a canvas is drawn one way. Layout, `fill`, full screen, `onPointer`,
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
own textures and bind them for render-to-texture. Nothing else from WebGPU exists (no compute, no queries, no error
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
it. The pending batch goes out at the program's next `await` of a `widget` call: with `widget.frame()` it rides in the
frame request itself, so a game posts once per frame (about 120 posts a second at 120 Hz); before `widget.sleep()` or
`widget.fetch()` it is a post of its own (an intermediate batch, allowed, counted toward the post rate). The client
replays each batch in order on its device and presents every canvas whose texture a render pass in the batch wrote to.
It may skip presents beyond one per display frame, never other ops.

## Transport

A batch is `{ ops: Op[], bytes: ArrayBuffer }`, sent as the frame request `{ type: "frame", gpu: batch }` or on its own
as `{ type: "gpu", ...batch }`. `ops` are JSON arrays like draw commands. `bytes` is one `ArrayBuffer` the prelude
assembles from the batch's write data (the raw bytes of the typed arrays passed, in call order), never a JSON array of
numbers; the host reads it through psychoscript's host bytes API as a borrowed slice, without copying. Ops reference it
as `[byteOffset, byteLength]`. Handles are integers the prelude assigns per widget, from 1, never reused; a descriptor
names resources by handle.

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

Descriptors are WebGPU's, with handles in place of objects and defaults filled in by the prelude. A context's handle
stands for that canvas's current texture at replay time, so views of it are created once. The client finds the canvas
by its `key` in the last rendered view, as for `widget.draw` (`widgets.md`, Native hosts). Before each frame the client
sends the program `{ type: "canvas", key, width, height }` (physical pixels) for every GPU canvas whose size changed;
the prelude updates `context.width`/`height`.

## Limits

The numbers below are verified on wgpu on mobile during implementation. A program over a limit has a program error (`widgets.md`, Failures); the client stops that canvas (below).

- Device limits: WebGPU's default limits, except `maxTextureDimension2D` 4096 and `maxBufferSize` 64 MB; the prelude
  reports them in `device.limits`.
- Resources: at most 256 MB of buffers and textures per widget (sizes as allocated: width × height × bytes per texel ×
  samples, mip levels included), and 4,096 live handles.
- Per batch: at most 4 MB of `bytes` and 20,000 ops; per frame (between two `widget.frame()`), at most 16 render passes
  and 10,000 draws.
- Shaders: 256 KB of WGSL per module. A batch in a frame request adds no post; intermediate batches count toward the
  240 posts a second.

## Errors and device loss

- **Program errors** (phase `gpu` in `report`): a WGSL module that fails validation, any WebGPU validation error in a
  replayed op (wgpu's and the browser's validation implement WebGPU's rules), an op the subset doesn't have, a handle
  that doesn't exist, and exceeding a limit. The client stops that canvas: it shows its placeholder with the error,
  ignores later batches for it, and reports the error once. The first uncaptured GPU error is enough (no error scopes
  in v1). The program and the rest of the widget keep running.
- **Client errors** (not reported, logged in dev mode): no WebGPU, device creation failure, a driver crash or reset,
  running out of GPU memory under the limits. The canvas shows its placeholder.
- **Device loss.** When the client loses its device (a reset, the app backgrounded long enough, a live program
  restored from a snapshot), it sends `{ type: "gpu", lost: reason }`; the prelude resolves `device.lost` with
  `{ reason, message }` and every handle is gone. The program may call `requestDevice()` again and recreate its
  resources; until it does, the canvas shows its placeholder.

## The `wgsl` shorthand

`canvas({ wgsl, values })` stays, in step and live mode: it is sugar the client expands into a fixed GPU program on
the same path. It is a full-screen triangle pipeline whose fragment stage is the `wgsl` between the header and entry
point in `widgets.md` (GPU canvases), with one uniform buffer for `widget` (`resolution`, `time`, `scale`, `pointer`,
`values`), redrawn at `fps`. Its limits, errors and placeholder rules are this spec's.
