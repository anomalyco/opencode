import { readFileSync } from "node:fs"
import path from "node:path"

// The GPU conformance fixtures' programs (`gpu/*.json`): the example widget templates, run for a few frames, and
// programs that break the subset's structure, handles or limits. `canvases`: sizes the host sends before the first
// frame (physical sizes, which it clamps); `inputs`: what the client sends before frame `frame` (an `event`, a
// `canvas` size, or a device loss, `{ type: "gpu", lost, inFlight?, finished? }`), or right after it with `after`.
export interface GpuCase {
  readonly name: string
  readonly source: string
  readonly data?: unknown
  readonly canvases: ReadonlyArray<{ readonly key: string; readonly width: number; readonly height: number }>
  readonly inputs?: ReadonlyArray<{ readonly frame: number; readonly after?: boolean; readonly input: unknown }>
  /** Its batches are too big to record (generated ops): the fixture says `"batches": "from-source"`. */
  readonly fromSource?: true
}

const template = (name: string) => readFileSync(path.resolve(import.meta.dir, `gpu/templates/${name}.js`), "utf8")

// A live program that renders GPU canvases `keys`, gets a device and configures each, then runs `body` with
// `device`, `contexts` (by key) and `view(key)` (the canvas's current view).
const program = (body: string, keys: ReadonlyArray<string> = ["scene"]) => `async function main() {
  widget.render(ui.column([${keys.map((key) => `ui.canvas({ key: ${JSON.stringify(key)}, gpu: true, height: 100 })`).join(", ")}]))
  const device = await widget.gpu.requestDevice()
  const format = widget.gpu.getPreferredCanvasFormat()
  const contexts = {}
  for (const key of ${JSON.stringify(keys)}) {
    contexts[key] = widget.gpu.getContext(key)
    contexts[key].configure({ device, format })
  }
  const view = (key) => contexts[key].getCurrentTexture().createView()
  const clear = (key) => ({ colorAttachments: [{ view: view(key), loadOp: "clear", storeOp: "store" }] })
${body}
}`

// A live program that makes its device again after a loss and draws a frame at a time.
const relost = `async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 100 }))
  const context = widget.gpu.getContext("scene")
  const format = widget.gpu.getPreferredCanvasFormat()
  let device
  let view
  let lost = false
  const setup = async () => {
    device = await widget.gpu.requestDevice()
    device.lost.then(() => (lost = true))
    context.configure({ device, format })
    view = context.getCurrentTexture().createView()
  }
  await setup()
  for (let frame = 0; frame < 4; frame++) {
    await widget.frame()
    if (lost) {
      lost = false
      await setup()
    }
    const encoder = device.createCommandEncoder()
    encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }] }).end()
    device.queue.submit([encoder.finish()])
  }
  await widget.frame()
}`

const scene = [{ key: "scene", width: 200, height: 200 }]

export const gpuCases: ReadonlyArray<GpuCase> = [
  { name: "cube", source: template("cube"), data: { frames: 3 }, canvases: [{ key: "cube", width: 600, height: 480 }] },
  {
    name: "textured-quad",
    source: template("textured-quad"),
    data: { frames: 2 },
    canvases: [{ key: "quad", width: 400, height: 400 }],
  },
  {
    name: "post-process",
    source: template("post-process"),
    data: { frames: 3 },
    // The size changes before the second frame: the offscreen texture follows it.
    canvases: [{ key: "post", width: 320, height: 220 }],
    inputs: [{ frame: 1, input: { type: "canvas", key: "post", width: 640, height: 440 } }],
  },
  {
    name: "maze",
    source: template("maze"),
    data: { frames: 4 },
    canvases: [{ key: "maze", width: 640, height: 360 }],
    inputs: [
      {
        frame: 1,
        input: {
          type: "event",
          event: {
            id: "",
            type: "key",
            value: {
              kind: "down",
              key: "w",
              code: "KeyW",
              repeat: false,
              shift: false,
              alt: false,
              ctrl: false,
              meta: false,
            },
          },
        },
      },
      { frame: 2, input: { type: "event", event: { id: "", type: "capture", value: true } } },
      {
        frame: 2,
        input: {
          type: "event",
          event: { id: "0/:maze", type: "pointer", value: { kind: "move", dx: 40, dy: -10, button: 0 } },
        },
      },
    ],
  },
  {
    // Device loss isn't a fixture input; two devices' worth of handles are: a second requestDevice keeps the first.
    name: "handles-and-defaults",
    source: program(`
  const again = await widget.gpu.requestDevice()
  if (again !== device) throw new Error("one device per widget")
  const texture = device.createTexture({ size: { width: 8, height: 8, depthOrArrayLayers: 6 }, format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, mipLevelCount: 2 })
  const cube = texture.createView({ dimension: "cube" })
  const layers = texture.createView()
  if (texture.createView({ dimension: "cube" }) !== cube) throw new Error("equal views are one handle")
  device.createSampler()
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "cube" } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage", hasDynamicOffset: true } },
  ] })
  const storage = device.createBuffer({ size: 512, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC })
  const copy = device.createBuffer({ size: 512, usage: GPUBufferUsage.COPY_DST })
  device.createBindGroup({ layout, entries: [
    { binding: 0, resource: cube },
    { binding: 1, resource: device.createSampler({ magFilter: "linear", compare: undefined }) },
    { binding: 2, resource: { buffer: storage, offset: 256, size: 64 } },
  ] })
  device.createPipelineLayout({ bindGroupLayouts: [layout] })
  device.queue.writeBuffer(storage, 4, new Uint32Array([1, 2, 3, 4, 5]), 1, 3)
  device.queue.writeBuffer(storage, 0, new Uint8Array([9, 8, 7, 6]).buffer)
  device.queue.writeTexture({ texture, mipLevel: 1, origin: [0, 0, 2] }, new Uint8Array(4 * 4 * 4).fill(200), { bytesPerRow: 16 }, { width: 4, height: 4 })
  const encoder = device.createCommandEncoder()
  encoder.copyBufferToBuffer(storage, 0, copy, 0, 256)
  device.queue.submit([encoder.finish()])
  texture.destroy()
  await widget.frame()`),
    canvases: scene,
  },
  {
    // The encoder errors the prelude finds itself go into the batch as \`error\` ops.
    name: "error-encoder-finished",
    source: program(`
  const encoder = device.createCommandEncoder()
  const buffer = encoder.finish()
  encoder.beginRenderPass(clear("scene")).end()
  device.queue.submit([buffer])
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-open-pass",
    source: program(`
  const encoder = device.createCommandEncoder()
  encoder.beginRenderPass(clear("scene"))
  device.queue.submit([encoder.finish()])
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-submitted-twice",
    source: program(`
  const encoder = device.createCommandEncoder()
  encoder.beginRenderPass(clear("scene")).end()
  const buffer = encoder.finish()
  device.queue.submit([buffer])
  device.queue.submit([buffer])
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-unknown-canvas",
    source: `async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 100 }))
  const device = await widget.gpu.requestDevice()
  widget.gpu.getContext("elsewhere").configure({ device, format: widget.gpu.getPreferredCanvasFormat() })
  await widget.frame()
}`,
    canvases: scene,
  },
  {
    name: "error-buffer-too-big",
    source: program(`
  device.createBuffer({ size: 64 * 1024 * 1024 + 4, usage: GPUBufferUsage.VERTEX })
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-texture-too-wide",
    source: program(`
  device.createTexture({ size: [4097, 4], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING })
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-unknown-format",
    source: program(`
  device.createTexture({ size: [4, 4], format: "rg11b10ufloat", usage: GPUTextureUsage.TEXTURE_BINDING })
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-usage-outside-the-subset",
    source: program(`
  device.createBuffer({ size: 16, usage: 1 })
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-resources-over-256-mb",
    source: program(`
  for (let i = 0; i < 5; i++) device.createBuffer({ size: 64 * 1024 * 1024, usage: GPUBufferUsage.STORAGE })
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-destroyed-buffer",
    source: program(`
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST })
  buffer.destroy()
  device.queue.writeBuffer(buffer, 0, new Float32Array(4))
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-too-many-passes",
    source: program(`
  await widget.frame()
  const encoder = device.createCommandEncoder()
  for (let i = 0; i < 17; i++) encoder.beginRenderPass(clear("scene")).end()
  device.queue.submit([encoder.finish()])
  await widget.frame()`),
    canvases: scene,
  },
  {
    // 10,000 draws a frame are allowed; one more is over, in any of the frame's batches. Over 20,000 ops: not recorded.
    name: "error-too-many-draws",
    fromSource: true,
    source: program(`
  const module = device.createShaderModule({ code: "@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0); } @fragment fn fs() -> @location(0) vec4f { return vec4f(1); }" })
  const pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module }, fragment: { module, targets: [{ format }] } })
  const frame = async (draws) => {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass(clear("scene"))
    pass.setPipeline(pipeline)
    for (let i = 0; i < draws; i++) pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
  await frame(10000)
  await widget.frame()
  await frame(6000)
  await widget.sleep(1)
  await frame(4001)
  await widget.frame()`),
    canvases: scene,
  },
  {
    // An error stops the canvases its batch renders into: "a"'s batch fails on frame 1, "b"'s on frame 2; a batch
    // that renders into neither stops both, but they are stopped already, so it gives no error.
    name: "error-isolated-to-a-canvas",
    source: program(
      `
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX })
  const gone = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX })
  gone.destroy()
  const draw = (key, vertices) => {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass(clear(key))
    pass.setVertexBuffer(0, vertices)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
  for (let frame = 0; frame < 3; frame++) {
    await widget.frame()
    draw("a", frame === 1 ? gone : buffer)
    await widget.sleep(1)
    draw("b", frame === 2 ? gone : buffer)
  }
  await widget.frame()
  device.queue.writeBuffer(gone, 0, new Float32Array(4))`,
      ["a", "b"],
    ),
    canvases: [
      { key: "a", width: 100, height: 100 },
      { key: "b", width: 100, height: 100 },
    ],
  },
  {
    // A batch that fails at an op keeps what the ops before it did: "a"'s batch makes a buffer and fails in its pass
    // (stopping "a", the pass dropped); "b"'s next batch draws with that buffer and passes.
    name: "error-keeps-the-ops-before-it",
    source: program(
      `
  await widget.frame()
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX })
  const gone = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX })
  gone.destroy()
  const draw = (key, vertices) => {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass(clear(key))
    pass.setVertexBuffer(0, vertices)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
  draw("a", gone)
  await widget.sleep(1)
  draw("b", buffer)
  await widget.frame()`,
      ["a", "b"],
    ),
    canvases: [
      { key: "a", width: 100, height: 100 },
      { key: "b", width: 100, height: 100 },
    ],
  },
  {
    // A pass renders into a canvas through its resolve target too: "a"'s multisampled batch fails on frame 1 and stops
    // only "a".
    name: "error-isolated-through-a-resolve-target",
    source: program(
      `
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX })
  const gone = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX })
  gone.destroy()
  const samples = device
    .createTexture({ size: [100, 100], format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT })
    .createView()
  const draw = (key, vertices) => {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass(
      key === "a"
        ? { colorAttachments: [{ view: samples, resolveTarget: view("a"), loadOp: "clear", storeOp: "discard" }] }
        : clear(key),
    )
    pass.setVertexBuffer(0, vertices)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
  for (let frame = 0; frame < 3; frame++) {
    await widget.frame()
    draw("a", frame === 1 ? gone : buffer)
    await widget.sleep(1)
    draw("b", buffer)
  }
  await widget.frame()`,
      ["a", "b"],
    ),
    canvases: [
      { key: "a", width: 100, height: 100 },
      { key: "b", width: 100, height: 100 },
    ],
  },
  {
    // The device is lost right after frame 1, before the program learns of it: the batch it posts with that frame
    // names handles from before the loss and is dropped quietly. Then it makes a new device and goes on.
    name: "lost-device-drops-earlier-batches",
    source: relost,
    canvases: scene,
    inputs: [{ frame: 1, after: true, input: { type: "gpu", lost: "unknown" } }],
  },
  {
    // A device loss while the run has GPU work in flight is a strike; two within 30 s stop every GPU canvas.
    name: "hang-two-strikes",
    source: relost,
    canvases: scene,
    inputs: [
      { frame: 1, input: { type: "gpu", lost: "unknown", inFlight: true } },
      { frame: 3, input: { type: "gpu", lost: "unknown", inFlight: true } },
    ],
  },
  {
    // One reset that loses the device three times (each new device's first work discarded, nothing finished in between)
    // is one strike: no stop.
    name: "hang-one-reset-several-losses",
    source: relost,
    canvases: scene,
    inputs: [
      { frame: 1, input: { type: "gpu", lost: "unknown", inFlight: true } },
      { frame: 2, input: { type: "gpu", lost: "unknown", inFlight: true, finished: false } },
      { frame: 3, input: { type: "gpu", lost: "unknown", inFlight: true, finished: false } },
    ],
  },
  {
    // A loss with no GPU work in flight is no strike: one strike stops nothing.
    name: "hang-no-strike-without-work",
    source: relost,
    canvases: scene,
    inputs: [
      { frame: 1, input: { type: "gpu", lost: "unknown", inFlight: true } },
      { frame: 3, input: { type: "gpu", lost: "unknown" } },
    ],
  },
  {
    // A canvas over the texture limit gets its size clamped, aspect ratio kept: 5120 x 2880 is 4096 x 2304, and
    // 9000 x 1000 is 4096 x 455; a texture of the canvas's size fits.
    name: "canvas-clamped-to-4096",
    source: program(`
  for (let frame = 0; frame < 2; frame++) {
    await widget.frame()
    const { width, height } = contexts.scene
    device.createTexture({ size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT })
  }
  await widget.frame()`),
    canvases: [{ key: "scene", width: 5120, height: 2880 }],
    inputs: [{ frame: 1, input: { type: "canvas", key: "scene", width: 9000, height: 1000 } }],
  },
  // Numbers are read as they are: a non-finite one fails the check that reads it where null would pass.
  {
    name: "error-nan-rows-per-image",
    source: program(`
  await widget.frame()
  const texture = device.createTexture({ size: [4, 4], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST })
  device.queue.writeTexture({ texture }, new Uint8Array(64), { bytesPerRow: 16, rowsPerImage: NaN }, [4, 4])
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-infinite-depth-clear-value",
    source: program(`
  await widget.frame()
  const depth = device
    .createTexture({ size: [200, 200], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT })
    .createView()
  const encoder = device.createCommandEncoder()
  const depthStencilAttachment = { view: depth, depthClearValue: Infinity, depthLoadOp: "clear", depthStoreOp: "store" }
  encoder.beginRenderPass({ ...clear("scene"), depthStencilAttachment }).end()
  device.queue.submit([encoder.finish()])
  await widget.frame()`),
    canvases: scene,
  },
  // A canvas's texture is only rendered into: copied from, copied into, written or bound, it is an error naming the
  // canvas.
  {
    name: "error-canvas-texture-copied-from",
    source: program(`
  await widget.frame()
  const texture = device.createTexture({ size: [200, 200], format, usage: GPUTextureUsage.COPY_DST })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToTexture({ texture: contexts.scene.getCurrentTexture() }, { texture }, [200, 200])
  device.queue.submit([encoder.finish()])
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-canvas-texture-copied-into",
    source: program(`
  await widget.frame()
  const buffer = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_SRC })
  const encoder = device.createCommandEncoder()
  encoder.copyBufferToTexture({ buffer, bytesPerRow: 256 }, { texture: contexts.scene.getCurrentTexture() }, [4, 4])
  device.queue.submit([encoder.finish()])
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-canvas-texture-written",
    source: program(`
  await widget.frame()
  device.queue.writeTexture({ texture: contexts.scene.getCurrentTexture() }, new Uint8Array(64), { bytesPerRow: 16 }, [4, 4])
  await widget.frame()`),
    canvases: scene,
  },
  {
    name: "error-canvas-texture-bound",
    source: program(`
  await widget.frame()
  const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }] })
  device.createBindGroup({ layout, entries: [{ binding: 0, resource: view("scene") }] })
  await widget.frame()`),
    canvases: scene,
  },
  {
    // A frame request without a batch ends the frame too: 10 passes before a sleep, then 10 in the next frame.
    name: "frame-counts-reset-at-a-bare-frame",
    source: program(`
  const passes = (count) => {
    const encoder = device.createCommandEncoder()
    for (let i = 0; i < count; i++) encoder.beginRenderPass(clear("scene")).end()
    device.queue.submit([encoder.finish()])
  }
  await widget.frame()
  passes(10)
  await widget.sleep(1)
  await widget.frame()
  passes(10)
  await widget.frame()`),
    canvases: scene,
  },
]

// Batches a program posts itself, which the prelude never makes, one fixture each: a JavaScript expression for the
// batch's ops, posted with `bytes` (8 bytes in an ArrayBuffer by default).
const raw = (ops: string, bytes = "new ArrayBuffer(8)") => `async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 100 }))
  __host.post({ type: "gpu", ops: ${ops}, bytes: ${bytes} })
  await widget.frame()
}`
const view = `{ dimension: "2d", baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 }`
const sampler = `{ addressModeU: "wrap", addressModeV: "repeat", addressModeW: "repeat", magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest", lodMinClamp: 0, lodMaxClamp: 32, compare: null, maxAnisotropy: 1 }`

export const rawCases: ReadonlyArray<GpuCase> = (
  [
    ["unknown-op", `[["sparkle", 1]]`],
    ["not-a-list", `[{ op: "buffer" }]`],
    ["wrong-arity", `[["buffer", 1, 16]]`],
    ["handle-reused", `[["buffer", 1, 16, 32], ["buffer", 1, 16, 32]]`],
    ["handles-out-of-order", `[["buffer", 2, 16, 32], ["buffer", 1, 16, 32]]`],
    ["no-such-handle", `[["destroy", 9]]`],
    ["handle-0", `[["destroy", 0]]`],
    ["wrong-kind", `[["shader", 1, ""], ["destroy", 1]]`],
    ["bytes-out-of-range", `[["buffer", 1, 16, 8], ["writeBuffer", 1, 0, 4, 8]]`],
    ["not-a-whole-number", `[["buffer", 1, 16.5, 8]]`],
    ["bad-enum", `[["sampler", 1, ${sampler}]]`],
    ["draw-outside-a-pass", `[["draw", 3, 1, 0, 0]]`],
    [
      "pass-left-open",
      `[["context", 1, "scene", "rgba8unorm", "opaque"], ["view", 2, 1, ${view}], ["pass", { colorAttachments: [{ view: 2, resolveTarget: null, clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }], depthStencilAttachment: null }]]`,
    ],
    [
      "bind-group-layout-entry",
      `[["bindGroupLayout", 1, { entries: [{ binding: 0, visibility: 2, buffer: null, sampler: null, texture: null }] }]]`,
    ],
    ["shader-over-256-kb", `[["shader", 1, "x".repeat(256 * 1024 + 1)]]`],
    ["ops-over-20000", `Array.from({ length: 20001 }, (_, i) => ["shader", i + 1, ""])`],
    ["handles-over-4096", `Array.from({ length: 4097 }, (_, i) => ["shader", i + 1, ""])`],
    // The batch's shape: valid ops that render into "scene" with bytes that aren't an ArrayBuffer stop "scene"; ops
    // that aren't a list render into nothing and stop every canvas.
    [
      "bytes-not-an-array-buffer",
      `[["context", 1, "scene", "rgba8unorm", "opaque"], ["view", 2, 1, ${view}], ["pass", { colorAttachments: [{ view: 2, resolveTarget: null, clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }], depthStencilAttachment: null }], ["end"]]`,
      "new Uint8Array(8)",
    ],
    ["ops-not-a-list", `"buffer"`],
    // Ops read as JSON reads them: an undefined list item is null (a color attachment left out), an undefined member
    // is absent (the binding is a sampler's). Both are valid.
    [
      "undefined-color-attachment",
      `[["context", 1, "scene", "rgba8unorm", "opaque"], ["view", 2, 1, ${view}], ["pass", { colorAttachments: [undefined, { view: 2, resolveTarget: null, clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }], depthStencilAttachment: null }], ["end"]]`,
    ],
    [
      "undefined-buffer-binding",
      `[["bindGroupLayout", 1, { entries: [{ binding: 0, visibility: 2, buffer: null, sampler: { type: "filtering" }, texture: null }] }], ["sampler", 2, { addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge", magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest", lodMinClamp: 0, lodMaxClamp: 32, compare: null, maxAnisotropy: 1 }], ["bindGroup", 3, { layout: 1, entries: [{ binding: 0, resource: { buffer: undefined, sampler: 2 } }] }]]`,
    ],
  ] as ReadonlyArray<readonly [string, string, string?]>
).map(([name, ops, bytes]) => ({
  name: `raw-${name}`,
  source: raw(ops, bytes),
  canvases: [{ key: "scene", width: 100, height: 100 }],
}))
