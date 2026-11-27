import { expect, test } from "bun:test"
import { Glob } from "bun"
import path from "node:path"
import { fixtures, run } from "../script/gpu-conformance.js"
import { LiveWidget, type LiveMessage, ManualClock, program, step } from "../src/index.js"
import { LIVE } from "./limits.js"

// The GPU conformance fixtures (`fixtures/gpu/*.json`, widgets-gpu.md): every host posts the same batches for each
// program, and its checks give the same program errors. This holds the TypeScript host to them.
const dir = path.resolve(import.meta.dir, "fixtures/gpu")
const files = [...new Glob("*.json").scanSync(dir)].toSorted()

test("there is a fixture for every case, the example widget templates among them", () => {
  expect(files.map((file) => file.replace(/\.json$/, "")).toSorted()).toEqual(
    fixtures()
      .map((item) => item.name)
      .toSorted(),
  )
  for (const name of ["cube", "textured-quad", "post-process", "maze"]) expect(files).toContain(`${name}.json`)
})

for (const file of files) {
  test(`gpu fixture ${file}`, async () => {
    const fixture = await Bun.file(path.join(dir, file)).json()
    const item = fixtures().find((candidate) => candidate.name === fixture.name)!
    expect(item.source).toBe(fixture.source)
    const recorded = await run(item)
    // "from-source": the batches are the run's own.
    if (Array.isArray(fixture.batches)) expect(recorded.batches).toEqual(fixture.batches)
    expect(recorded.errors).toEqual(fixture.errors)
    expect(recorded.end).toBe(fixture.end)
  }, 60_000)
}

// A live run on a manual clock; `posts` holds its GPU batches, `sent` what it sends.
const start = (source: string, options: { readonly gpu?: false } = {}) => {
  const clock = new ManualClock()
  const posts: LiveMessage[] = []
  const sent: unknown[] = []
  const widget = LiveWidget.start(program(source, "live"), null, {
    clock,
    ...LIVE,
    ...options,
    onMessage: (message) => {
      if (message.type === "gpu" || (message.type === "frame" && message.gpu)) posts.push(message)
      if (message.type === "send") sent.push(message.value)
    },
  })
  return { widget, clock, posts, sent }
}
const size = { t: 0, dt: 1 / 60, width: 100, height: 50, scale: 2, pointer: null, dark: false }

test("without a GPU the program runs unchanged and records nothing", async () => {
  const { widget, posts, sent } = start(
    `async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  const device = await widget.gpu.requestDevice()
  widget.gpu.getContext("c").configure({ device, format: widget.gpu.getPreferredCanvasFormat() })
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX })
  device.queue.writeBuffer(buffer, 0, new Float32Array(4))
  device.queue.submit([device.createCommandEncoder().finish()])
  widget.send([widget.gpu.available, typeof device.lost.then, device.limits.maxTextureDimension2D])
}`,
    { gpu: false },
  )
  expect(await widget.done).toEqual({ type: "return" })
  expect(posts).toEqual([])
  expect(sent).toEqual([[false, "function", 4096]])
  expect(widget.gpuErrors).toEqual([])
})

test("canvas sizes, a lost device, and batches before sleeps and at the end", async () => {
  const sent: unknown[] = []
  const clock = new ManualClock()
  const posts: LiveMessage[] = []
  const widget = LiveWidget.start(
    program(
      `async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  const context = widget.gpu.getContext("c")
  try { context.getCurrentTexture() } catch (error) { widget.send(error.message) }
  const device = await widget.gpu.requestDevice()
  context.configure({ device, format: "rgba8unorm" })
  await widget.frame()
  widget.send([context.width, context.height, context.getCurrentTexture().width])
  device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM })
  await widget.sleep(10)
  const lost = await device.lost
  widget.send(lost)
  device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM })
  const again = await widget.gpu.requestDevice()
  widget.send(again === device)
  context.configure({ device: again, format: "rgba8unorm" })
  again.createBuffer({ size: 8, usage: GPUBufferUsage.UNIFORM })
}`,
      "live",
    ),
    null,
    {
      clock,
      ...LIVE,
      onMessage: (message) => {
        if (message.type === "send") sent.push(message.value)
        if (message.type === "gpu" || (message.type === "frame" && message.gpu)) posts.push(message)
      },
    },
  )
  widget.canvas("c", 200, 100)
  await widget.when((current) => current.frameRequested)
  widget.frame(size)
  await clock.advance(10)
  widget.loseDevice("unknown")
  expect(await widget.done).toEqual({ type: "return" })
  expect(sent).toEqual([
    "configure the context before getCurrentTexture",
    [200, 100, 200],
    { reason: "unknown", message: "" },
    false,
  ])
  const ops = posts.map((post) => (post.type === "frame" ? post.gpu!.ops : post.type === "gpu" ? post.ops : []))
  expect(posts.map((post) => post.type)).toEqual(["frame", "gpu", "gpu"])
  expect(ops).toEqual([
    [["context", 1, "c", "rgba8unorm", "opaque"]],
    [["buffer", 2, 4, 64]],
    // The lost device's buffer records nothing (its handle, 3, is spent); the new device's context is a new handle.
    [
      ["context", 4, "c", "rgba8unorm", "opaque"],
      ["buffer", 5, 8, 64],
    ],
  ])
  expect(widget.gpuErrors).toEqual([])
})

test("a canvas an error stopped stays stopped: out of the view and back, and on a new device", async () => {
  const { widget } = start(`async function main() {
  const both = () => widget.render(ui.column(["a", "b"].map((key) => ui.canvas({ key, gpu: true, height: 10 }))))
  both()
  let device = await widget.gpu.requestDevice()
  const configure = () => ["a", "b"].forEach((key) => widget.gpu.getContext(key).configure({ device, format: "rgba8unorm" }))
  const bad = (key) => {
    const gone = device.createBuffer({ size: 16, usage: GPUBufferUsage.VERTEX })
    gone.destroy()
    const encoder = device.createCommandEncoder()
    const view = widget.gpu.getContext(key).getCurrentTexture().createView()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }] })
    pass.setVertexBuffer(0, gone)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
  configure()
  await widget.frame()
  bad("a")
  await widget.frame()
  widget.render(ui.canvas({ key: "b", gpu: true, height: 10 }))
  await widget.frame()
  both()
  await device.lost
  device = await widget.gpu.requestDevice()
  configure()
  bad("a")
  await widget.frame()
  bad("b")
  await widget.frame()
}`)
  for (let i = 0; i < 3; i++) {
    await widget.when((current) => current.frameRequested)
    widget.frame(size)
  }
  await widget.when((current) => current.view?.type === "column")
  widget.loseDevice("unknown")
  for (let i = 0; i < 2; i++) {
    await widget.when((current) => current.frameRequested)
    widget.frame(size)
  }
  expect(await widget.done).toEqual({ type: "return" })
  expect(widget.gpuErrors.map((error) => error.canvases)).toEqual([["a"], ["b"]])
})

test("two strikes 30 s apart or less stop the run's GPU canvases; further apart, they don't", async () => {
  const { widget, clock } = start(`async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  while (true) await widget.sleep(60000)
}`)
  await clock.advance(0)
  widget.loseDevice("unknown", { inFlight: true })
  await clock.advance(30_001)
  widget.loseDevice("unknown", { inFlight: true })
  widget.loseDevice("unknown")
  expect(widget.gpuErrors).toEqual([])
  await clock.advance(30_000)
  widget.loseDevice("unknown", { inFlight: true })
  expect(widget.gpuErrors).toEqual([{ message: "the GPU work hung; the canvas is stopped", canvases: "all" }])
  widget.loseDevice("unknown", { inFlight: true })
  expect(widget.gpuErrors).toHaveLength(1)
  await widget.stop()
})

test("losses with no finished GPU work in between are one reset: one strike", async () => {
  const { widget, clock } = start(`async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  while (true) await widget.sleep(60000)
}`)
  await clock.advance(0)
  widget.loseDevice("unknown", { inFlight: true })
  widget.loseDevice("unknown", { inFlight: true, finished: false })
  widget.loseDevice("unknown", { inFlight: true, finished: false })
  expect(widget.gpuErrors).toEqual([])
  // Work finished, then a loss with work in flight: the second strike.
  widget.loseDevice("unknown", { inFlight: true })
  expect(widget.gpuErrors).toEqual([{ message: "the GPU work hung; the canvas is stopped", canvases: "all" }])
  await widget.stop()
})

test("a GPU canvas takes no draw commands, and can't have wgsl too", async () => {
  const { widget } = start(`async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  widget.draw("c", [])
}`)
  expect(await widget.done).toMatchObject({
    type: "error",
    error: { message: expect.stringContaining(`Canvas "c" is drawn by the GPU; it takes no draw commands`) },
  })
  const both = await step(program(`function view() { return ui.canvas({ height: 1, gpu: true, wgsl: "x" }) }`), {
    phase: "init",
    data: null,
  }).catch((error: unknown) => error)
  expect(both).toMatchObject({
    kind: "invalid",
    message: expect.stringContaining("`gpu` and `wgsl` exclude each other"),
  })
})

test("writes copy their data when they are called, and typed arrays count elements", async () => {
  const { widget, posts } = start(`async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  const device = await widget.gpu.requestDevice()
  const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST })
  const data = new Uint16Array([1, 2, 3, 4])
  device.queue.writeBuffer(buffer, 0, data, 1, 2)
  data[1] = 9
  device.queue.writeBuffer(buffer, 4, data.buffer, 2, 2)
}`)
  await widget.done
  const batch = posts[0]!
  expect(batch.type === "gpu" && batch.ops).toEqual([
    ["buffer", 1, 16, 8],
    ["writeBuffer", 1, 0, 0, 4],
    ["writeBuffer", 1, 4, 4, 2],
  ])
  expect(batch.type === "gpu" && [...new Uint8Array(batch.bytes)]).toEqual([2, 0, 3, 0, 9, 0])
})

test("a GPU batch takes no token but never overtakes a waiting render; a bare frame request doesn't wait", async () => {
  const clock = new ManualClock()
  const order: string[] = []
  const widget = LiveWidget.start(
    program(
      `async function main() {
  for (let i = 0; i < 9; i++) widget.render(ui.column([ui.text(String(i)), ui.canvas({ key: "c" + i, gpu: true, height: 10 })]))
  const device = await widget.gpu.requestDevice()
  widget.gpu.getContext("c8").configure({ device, format: "rgba8unorm" })
  await widget.sleep(1)
  await widget.frame()
}`,
      "live",
    ),
    null,
    {
      clock,
      ...LIVE,
      postsPerSecond: 1,
      onMessage: (message) => order.push(message.type === "render" ? "render" : message.type),
    },
  )
  await clock.advance(0)
  // 8 renders at once; the 9th waits for a token, and the batch (whose canvas only it has) waits behind it.
  expect(order).toEqual(Array(8).fill("render"))
  await clock.advance(1000)
  // The bare frame request, posted after the batch, went at once.
  expect(order).toEqual([...Array(8).fill("render"), "frame", "render", "gpu"])
  expect(widget.gpuErrors).toEqual([])
  await widget.stop()
})
