// GPU canvases (widgets-gpu.md): a live program's WebGPU calls, recorded by the prelude into batches of ops and bytes,
// replayed here on the browser's WebGPU, on the page's thread where the canvases are. One device per widget; its
// resources stand in an array by handle. Each batch first passes the host checks (gpu-checks.ts: the ops' shapes,
// handles and limits, with the spec's messages); WebGPU validates what replays (an error scope per batch). An error is
// a program error in phase `gpu` that stops the canvases the batch renders into, else every one, once. A canvas an
// error stopped stays stopped for the run; one a device loss stopped starts again when the program configures it on a
// new device.
//
// A canvas is cleared once per frame, at the frame request, not once per batch (widgets-gpu.md, A canvas's contents in
// a frame). WebGPU's current texture is cleared once per presented display frame, which is the same when a canvas's
// passes in a frame all come in the frame request's batch: those render into it directly. A batch posted mid-frame
// (before a sleep or a fetch, which may outlast a display frame) that renders into a canvas makes the canvas draw into
// a texture kept for the rest of that frame instead: the frame's first pass into it clears it, later ones load it, and
// it is copied to the current texture to present (at most once a display frame, and at the frame request). Only such a
// canvas's context has COPY_DST; the rest are configured as the program's canvas texture is, RENDER_ATTACHMENT alone.

import { type Checked, GPU_HANG, gpuChecks, type GpuError } from "./gpu-checks.js"
import { type Run, Watchdog } from "./watchdog.js"

/** A batch as the worker hands it over: the ops, and the bytes they name by `[byteOffset, byteLength]`. */
export interface Batch {
  ops: unknown[][]
  bytes: Uint8Array<ArrayBuffer>
}

/** What the replay needs of a GPU canvas on the page. */
export interface GpuCanvas {
  readonly canvas: HTMLCanvasElement
  /** Measures it now: whether it has a size to draw at. */
  sized(): boolean
  /** Shows the placeholder: `poster`, else `alt`, else "GPU canvas not supported"; with a program error's message. */
  placeholder(message?: string): void
  /** Back from the placeholder: the canvas draws again. */
  shown(): void
}

/** A canvas's texture kept for a frame (above): `active` this frame, `cleared` by this frame's first pass, `dirty`
 * since its last copy to the current texture. */
type Kept = { context: Context; texture: GPUTexture; active: boolean; cleared: boolean; dirty: boolean }

export interface GpuHost {
  /** The GPU canvas with this key in the last rendered view. */
  canvas(key: string): GpuCanvas | undefined
  /** The keys of the GPU canvases in the last rendered view. */
  keys(): ReadonlySet<string>
  /** A program error (phase `gpu`), reported once by the host; `at`: the line and column of its batch's post. */
  programError(message: string, at?: readonly [number, number]): void
  clientError(message: string, cause?: unknown): void
  /** The device was lost: `{ type: "gpu", lost: reason, message }` to the program. */
  lost(reason: string, message: string): void
  /** No WebGPU, or no device: every GPU canvas shows its placeholder (a client error, logged). */
  unavailable(): void
  /** How long a batch's replay took on this thread, in ms (the GPU's work runs after). */
  metric(ms: number): void
  /** The run (widgets-gpu.md, Strikes): its work finished, or was unfinished at a device loss. The same object each time. */
  readonly run: Run
  /** Runs `f` once in the next display frame, before the canvases present. */
  nextFrame(f: () => void): void
}

type Context = {
  kind: "context"
  key: string
  format: GPUTextureFormat
  alphaMode: GPUCanvasAlphaMode
  view?: GpuCanvas
  ctx?: GPUCanvasContext
}
type Obj =
  | Context
  | { kind: "buffer"; gpu: GPUBuffer }
  | { kind: "texture"; gpu: GPUTexture }
  | { kind: "view"; gpu?: GPUTextureView; context?: number; descriptor?: GPUTextureViewDescriptor }
  | { kind: "sampler"; gpu: GPUSampler }
  | { kind: "shader"; gpu: GPUShaderModule }
  | { kind: "bindGroupLayout"; gpu: GPUBindGroupLayout }
  | { kind: "pipelineLayout"; gpu: GPUPipelineLayout }
  | { kind: "renderPipeline"; gpu: GPURenderPipeline }
  | { kind: "bindGroup"; gpu: GPUBindGroup }

const num = (v: unknown): number => v as number
const xyz = (v: unknown): GPUOrigin3DDict => {
  const [x, y, z] = v as [number, number, number]
  return { x, y, z }
}
const extent = (v: unknown): GPUExtent3DDict => {
  const [width, height, depthOrArrayLayers] = v as [number, number, number]
  return { width, height, depthOrArrayLayers }
}
/** Thrown for an op on a stopped canvas: the op is ignored (a pass, up to its `end`); the rest of the batch replays. */
const SKIP = Symbol("stopped canvas")

const whole = (v: unknown): number | undefined => (v === -1 || v === null ? undefined : (v as number))

/** A normalised descriptor as WebGPU takes it: members that are `null` (absent, in the transport) left out. */
function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean)
  if (!v || typeof v !== "object") return v
  const out: Record<string, unknown> = {}
  for (const [k, item] of Object.entries(v)) if (item !== null) out[k] = clean(item)
  return out
}

export class GpuReplay {
  private device: GPUDevice | undefined
  private starting = false
  /** Checked batches waiting for the device, in order, and the frame ends between them (`null`). */
  private waiting: Array<{ batch: Batch; checked: Checked; boundary: boolean; at?: readonly [number, number] } | null> = []
  private unavailable = false
  private objects: Array<Obj | undefined> = []
  private closed = false
  private encoder: GPUCommandEncoder | undefined
  private pass: GPURenderPassEncoder | undefined
  private readonly checks: ReturnType<typeof gpuChecks>
  /** The stopped canvases' errors by key, and the error that stopped every one: a canvas rendered anew stays stopped. */
  private readonly stopped = new Map<string, string>()
  private all: string | undefined
  /** The canvases the device's loss stopped, by key, until the program configures them on a new device. */
  private readonly lostKeys = new Set<string>()
  /** The canvases drawn mid-frame, by key, and those whose context has COPY_DST for it (once one is, it stays). */
  private readonly kept = new Map<string, Kept>()
  private readonly copyDst = new Set<string>()
  /** Whether the batch replaying is a frame request's (it ends the frame), and a present is waiting for a frame. */
  private boundary = false
  private presenting = false
  /** Whether the batch replaying submitted work (a GPU hang is timed from it), and the device's queue's watchdog. */
  private submitted = false
  private watchdog: Watchdog | undefined

  constructor(private readonly host: GpuHost) {
    this.checks = gpuChecks(() => host.keys())
  }

  /** Checks `batch` now, in order, and replays what passes after the batches before it. `boundary`: the batch of a
   * frame request (not one repeated while a frame is pending), which `frame()` follows; `at`: its post's line and column. */
  batch(batch: unknown, boundary: boolean, at?: readonly [number, number]) {
    if (this.closed || this.unavailable) return
    const checked = this.checks.batch(batch)
    if (checked.error) this.fail(checked.error, at)
    // Ignored: every canvas it renders into stopped, it is from before a device loss, or it failed before its first op.
    if (checked.skip || (checked.error && checked.at === undefined)) return
    const b = batch as Batch
    if (this.device && this.waiting.length === 0) return this.replay(this.device, b, checked, boundary, at)
    this.waiting.push({ batch: b, checked, boundary, at })
    void this.start()
  }

  /** A program error: reported once; its canvases (or every one) stop and show their placeholder with it. */
  private fail(error: GpuError, at?: readonly [number, number]) {
    this.host.programError(error.message, at)
    this.stop(error)
  }

  /**
   * A GPU hang (widgets-gpu.md, the device's watchdog): a batch's submitted work hung stops the canvases it renders
   * into, else every one, as an error would (later batches for them ignored, never restarted by a new device), with a
   * client error.
   */
  private hang(keys: ReadonlyArray<string>) {
    if (this.closed) return
    const error = this.checks.scoped(GPU_HANG, keys)
    if (!error) return
    this.host.clientError(GPU_HANG)
    this.stop(error)
  }

  /** Stops `error`'s canvases (or every one): each shows its placeholder with the message. */
  private stop(error: GpuError) {
    if (error.canvases === "all") this.all ??= error.message
    const keys = error.canvases === "all" ? [...this.host.keys()] : error.canvases
    for (const key of keys) if (!this.stopped.has(key)) this.stopped.set(key, error.message)
    for (const key of keys) {
      this.kept.get(key)?.texture.destroy()
      this.kept.delete(key)
      for (const o of this.objects) {
        if (o?.kind !== "context" || o.key !== key) continue
        o.ctx?.unconfigure()
        o.ctx = undefined
        o.view = undefined
      }
      this.host.canvas(key)?.placeholder(error.message)
    }
  }

  private async start() {
    if (this.starting) return
    this.starting = true
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
    let device: GPUDevice | undefined
    try {
      const adapter = gpu ? await gpu.requestAdapter() : null
      device = adapter ? await adapter.requestDevice() : undefined
      if (!device) throw new Error(gpu ? "no WebGPU adapter" : "no WebGPU in this browser")
    } catch (e) {
      this.host.clientError(`GPU canvas: ${String((e as Error)?.message ?? e)}`, e)
    }
    this.starting = false
    if (this.closed) return device?.destroy()
    if (!device) {
      // Unavailable is not an error: the placeholder shows, the program's batches are dropped.
      this.unavailable = true
      this.waiting = []
      return this.host.unavailable()
    }
    this.adopt(device)
    for (const entry of this.waiting.splice(0)) entry ? this.replay(device, entry.batch, entry.checked, entry.boundary, entry.at) : this.endFrame()
  }

  private adopt(device: GPUDevice) {
    this.device = device
    const watchdog = (this.watchdog = new Watchdog(device.queue))
    device.onuncapturederror = (e) => {
      const error = this.checks.scoped(e.error.message, [])
      if (error) this.fail(error)
    }
    void device.lost.then((info) => {
      if (this.closed || this.device !== device) return
      // The run's work unfinished at the loss is a strike; a second stops every canvas before the loss marks the rest.
      watchdog.lost()
      // Every handle is gone; the program may ask for a device again and make its resources anew (new handles). Until
      // it configures a canvas again, the canvas shows its placeholder; one an error stopped stays stopped.
      for (const o of this.objects) if (o?.kind === "context") o.ctx?.unconfigure()
      for (const key of this.host.keys()) {
        if (this.stoppedBy(key) !== undefined) continue
        this.lostKeys.add(key)
        this.host.canvas(key)?.placeholder()
      }
      this.device = undefined
      this.objects = []
      this.kept.clear()
      this.encoder = undefined
      this.pass = undefined
      this.checks.lost()
      this.host.lost(info.reason ?? "unknown", info.message)
    })
  }

  private replay(device: GPUDevice, batch: Batch, checked: Checked, boundary: boolean, at?: readonly [number, number]) {
    const started = performance.now()
    this.boundary = boundary
    this.submitted = false
    // The ops that passed the checks: all of them, or those before the one that failed.
    const count = checked.at ?? batch.ops.length
    device.pushErrorScope("out-of-memory")
    device.pushErrorScope("validation")
    try {
      // Ops on stopped canvases are ignored (a pass into one up to its end); the batch's other canvases draw.
      let skipping = false
      for (let i = 0; i < count; i++) {
        const op = batch.ops[i]!
        if (skipping) {
          skipping = op[0] !== "end"
          continue
        }
        try {
          this.op(device, op, batch.bytes)
        } catch (e) {
          if (e !== SKIP) throw e
          skipping = op[0] === "pass"
        }
      }
    } catch (e) {
      // A WebGPU call that throws (a value it refuses) is the program's too, in WebGPU's words.
      const error = this.checks.scoped(String((e as Error)?.message ?? e), checked.keys)
      if (error) this.fail(error, at)
    }
    // A failed batch ends there: what it began isn't submitted.
    if (count < batch.ops.length || this.pass) {
      this.encoder = undefined
      this.pass = undefined
    }
    if (this.submitted) {
      const keys = checked.keys
      this.watchdog!.submitted(() => this.hang(keys), this.host.run)
    }
    // Drawn mid-frame: shown at the next display frame (the frame request's batch is shown by the frame's end).
    if (!boundary && !this.presenting && [...this.kept.values()].some((k) => k.dirty)) this.schedulePresent()
    this.host.metric(performance.now() - started)
    const keys = checked.keys
    void device.popErrorScope().then((e) => {
      const error = e && !this.closed ? this.checks.scoped(e.message, keys) : undefined
      if (error) this.fail(error, at)
    })
    void device.popErrorScope().then((e) => {
      if (!e || this.closed) return
      // Out of GPU memory under the limits: this host's (a client error); the canvases stop.
      this.host.clientError(`GPU canvas: out of GPU memory: ${e.message}`)
      for (const key of keys.length > 0 ? keys : this.host.keys()) this.host.canvas(key)?.placeholder()
    })
  }

  private get<K extends Obj["kind"]>(h: unknown): Obj & { kind: K } {
    return this.objects[h as number] as Obj & { kind: K }
  }

  /** The context's canvas, configured: it may have been rendered anew since. Throws SKIP for a stopped canvas. */
  private context(o: Context, device: GPUDevice): GPUCanvasContext {
    if (this.stoppedBy(o.key) !== undefined) throw SKIP
    const view = this.host.canvas(o.key)
    if (!view) throw new Error(`no GPU canvas with key "${o.key}" on the page`)
    if (o.view !== view || !o.ctx) {
      // Sized before it is configured: its texture is the canvas's size in physical pixels.
      view.sized()
      const ctx = view.canvas.getContext("webgpu")
      if (!ctx) throw new Error("the canvas has no WebGPU context")
      ctx.configure({
        device,
        format: o.format,
        alphaMode: o.alphaMode,
        // The program's canvas texture's usage; COPY_DST too once the canvas was drawn mid-frame (a kept texture's copy).
        usage: GPUTextureUsage.RENDER_ATTACHMENT | (this.copyDst.has(o.key) ? GPUTextureUsage.COPY_DST : 0),
      })
      view.shown()
      this.lostKeys.delete(o.key)
      o.view = view
      o.ctx = ctx
    }
    return o.ctx
  }

  /** A texture by handle, for a copy or a write: never a canvas's (the host checks refuse it). */
  private texture(h: unknown): GPUTexture {
    return this.get<"texture">(h).gpu
  }

  /** A view by handle: a canvas's stands for its current texture, or its kept one while it has one. */
  private view(h: unknown, device: GPUDevice): GPUTextureView {
    const o = this.get<"view">(h)
    if (o.gpu) return o.gpu
    const c = this.get<"context">(o.context)
    const current = this.context(c, device)
    const k = this.kept.get(c.key)
    return (k?.active ? k.texture : current.getCurrentTexture()).createView(o.descriptor)
  }

  /** The context a view handle is of, if it is a canvas's. */
  private canvasOf(h: unknown): Context | undefined {
    const o = this.get<"view">(h)
    return o?.kind === "view" && o.context !== undefined ? this.get<"context">(o.context) : undefined
  }

  /** A canvas drawn mid-frame: its texture is kept for the rest of the frame, the frame's first pass clearing it. */
  private keep(o: Context, device: GPUDevice) {
    let k = this.kept.get(o.key)
    if (k?.active) return
    this.context(o, device)
    if (!this.copyDst.has(o.key)) {
      this.copyDst.add(o.key)
      o.ctx = undefined
      this.context(o, device)
    }
    const { width, height } = o.view!.canvas
    if (!k || k.texture.width !== width || k.texture.height !== height || k.texture.format !== o.format) {
      k?.texture.destroy()
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
      k = { context: o, texture: device.createTexture({ size: [width, height], format: o.format, usage }), active: false, cleared: false, dirty: false }
      this.kept.set(o.key, k)
    }
    k.context = o
    k.active = true
    k.cleared = false
  }

  /** The kept textures drawn since their last copy, copied to their canvases' current textures. */
  private present() {
    const device = this.device
    if (!device) return
    let encoder: GPUCommandEncoder | undefined
    for (const [key, k] of this.kept) {
      if (!k.dirty || this.stoppedBy(key) !== undefined || !k.context.ctx) continue
      k.dirty = false
      const current = k.context.ctx.getCurrentTexture()
      encoder ??= device.createCommandEncoder()
      const size = [Math.min(current.width, k.texture.width), Math.min(current.height, k.texture.height)]
      encoder.copyTextureToTexture({ texture: k.texture }, { texture: current }, size)
    }
    if (!encoder) return
    // The host's own work: an error in it is the client's, never the program's.
    device.pushErrorScope("validation")
    device.queue.submit([encoder.finish()])
    void device.popErrorScope().then((e) => e && !this.closed && this.host.clientError(`GPU canvas: presenting a canvas drawn mid-frame: ${e.message}`))
  }

  private schedulePresent() {
    this.presenting = true
    this.host.nextFrame(() => {
      this.presenting = false
      if (!this.closed) this.present()
    })
  }

  /** The frame's end: the canvases drawn into kept textures are presented, and the next frame starts direct. */
  private endFrame() {
    this.present()
    for (const k of this.kept.values()) k.active = false
  }

  private encode(device: GPUDevice): GPUCommandEncoder {
    return (this.encoder ??= device.createCommandEncoder())
  }

  private op(device: GPUDevice, op: unknown[], bytes: Uint8Array<ArrayBuffer>) {
    const [name, a, b, c, d, e, f, g, h] = op
    switch (name) {
      case "context": {
        // A context op may repeat its handle to configure the canvas again.
        const o: Context = { kind: "context", key: b as string, format: c as GPUTextureFormat, alphaMode: d as GPUCanvasAlphaMode }
        const old = this.objects[a as number]
        if (old?.kind === "context") old.ctx?.unconfigure()
        this.objects[a as number] = o
        this.context(o, device)
        return
      }
      case "buffer":
        this.objects[a as number] = { kind: "buffer", gpu: device.createBuffer({ size: num(b), usage: num(c) }) }
        return
      case "texture":
        this.objects[a as number] = {
          kind: "texture",
          gpu: device.createTexture({
            size: [num(b), num(c), num(d)],
            format: e as GPUTextureFormat,
            usage: num(f),
            mipLevelCount: num(g),
            sampleCount: num(h),
          }),
        }
        return
      case "view": {
        const o = this.get<"texture" | "context">(b)
        const descriptor = clean(c) as GPUTextureViewDescriptor
        // A context's views stand for its current texture: made anew from the descriptor each time.
        this.objects[a as number] =
          o.kind === "texture" ? { kind: "view", gpu: o.gpu.createView(descriptor) } : { kind: "view", context: b as number, descriptor }
        return
      }
      case "sampler":
        this.objects[a as number] = { kind: "sampler", gpu: device.createSampler(clean(b) as GPUSamplerDescriptor) }
        return
      case "shader":
        this.objects[a as number] = { kind: "shader", gpu: device.createShaderModule({ code: b as string }) }
        return
      case "bindGroupLayout":
        this.objects[a as number] = { kind: "bindGroupLayout", gpu: device.createBindGroupLayout(clean(b) as GPUBindGroupLayoutDescriptor) }
        return
      case "pipelineLayout":
        this.objects[a as number] = {
          kind: "pipelineLayout",
          gpu: device.createPipelineLayout({ bindGroupLayouts: (b as number[]).map((l) => this.get<"bindGroupLayout">(l).gpu) }),
        }
        return
      case "renderPipeline": {
        const d = clean(b) as Record<string, unknown>
        const stage = (s: unknown) => (s ? { ...(s as object), module: this.get<"shader">((s as { module: number }).module).gpu } : undefined)
        const descriptor = {
          ...d,
          layout: d.layout === "auto" ? "auto" : this.get<"pipelineLayout">(d.layout).gpu,
          vertex: stage(d.vertex),
          ...(d.fragment ? { fragment: stage(d.fragment) } : {}),
        } as GPURenderPipelineDescriptor
        this.objects[a as number] = { kind: "renderPipeline", gpu: device.createRenderPipeline(descriptor) }
        return
      }
      case "autoLayout":
        this.objects[a as number] = { kind: "bindGroupLayout", gpu: this.get<"renderPipeline">(b).gpu.getBindGroupLayout(num(c)) }
        return
      case "bindGroup": {
        const d = b as { layout: number; entries: Array<{ binding: number; resource: Record<string, unknown> }> }
        const entries = d.entries.map(({ binding, resource: r }) => ({
          binding,
          resource:
            "buffer" in r
              ? { buffer: this.get<"buffer">(r.buffer).gpu, offset: num(r.offset), size: whole(r.size) }
              : "sampler" in r
                ? this.get<"sampler">(r.sampler).gpu
                : this.view(r.view, device),
        })) as GPUBindGroupEntry[]
        this.objects[a as number] = { kind: "bindGroup", gpu: device.createBindGroup({ layout: this.get<"bindGroupLayout">(d.layout).gpu, entries }) }
        return
      }
      case "destroy":
        // Destroying a texture destroys its views (their uses fail as WebGPU's would).
        this.get<"buffer" | "texture">(a).gpu.destroy()
        return
      case "writeBuffer":
        device.queue.writeBuffer(this.get<"buffer">(a).gpu, num(b), bytes, num(c), num(d))
        return
      case "writeTexture":
        device.queue.writeTexture(
          { texture: this.texture(a), mipLevel: num(b), origin: xyz(c) },
          bytes.subarray(num(d), num(d) + num(e)),
          { offset: 0, bytesPerRow: num(f), rowsPerImage: whole(g) },
          extent(h),
        )
        return
      case "copyBufferToBuffer":
        this.encode(device).copyBufferToBuffer(this.get<"buffer">(a).gpu, num(b), this.get<"buffer">(c).gpu, num(d), num(e))
        return
      case "copyBufferToTexture":
        this.encode(device).copyBufferToTexture(
          { buffer: this.get<"buffer">(a).gpu, offset: num(b), bytesPerRow: num(c), rowsPerImage: whole(d) },
          { texture: this.texture(e), mipLevel: num(f), origin: xyz(g) },
          extent(h),
        )
        return
      case "copyTextureToTexture":
        this.encode(device).copyTextureToTexture(
          { texture: this.texture(a), mipLevel: num(b), origin: xyz(c) },
          { texture: this.texture(d), mipLevel: num(e), origin: xyz(f) },
          extent(g),
        )
        return
      case "pass": {
        const d = clean(a) as { colorAttachments: Array<Record<string, unknown> | null>; depthStencilAttachment?: Record<string, unknown> }
        // The canvases it renders into: kept, when drawn mid-frame; a kept one's first pass this frame clears it.
        const kept = (h: unknown, resolve: boolean, at: Record<string, unknown>) => {
          const c = h === undefined ? undefined : this.canvasOf(h)
          if (!c) return at
          if (!this.boundary) this.keep(c, device)
          const k = this.kept.get(c.key)
          if (!k?.active) return at
          k.dirty = true
          if (k.cleared) return at
          k.cleared = true
          return !resolve && at.loadOp === "load" ? { ...at, loadOp: "clear", clearValue: [0, 0, 0, 0] } : at
        }
        const colorAttachments = d.colorAttachments.map((given) => {
          if (!given) return null
          const at = kept(given.resolveTarget, true, kept(given.view, false, given))
          return { ...at, view: this.view(at.view, device), ...(at.resolveTarget !== undefined ? { resolveTarget: this.view(at.resolveTarget, device) } : {}) }
        }) as GPURenderPassColorAttachment[]
        const depth = d.depthStencilAttachment
        this.pass = this.encode(device).beginRenderPass({
          colorAttachments,
          ...(depth ? { depthStencilAttachment: { ...depth, view: this.view(depth.view, device) } as GPURenderPassDepthStencilAttachment } : {}),
        })
        return
      }
      case "setPipeline":
        this.pass!.setPipeline(this.get<"renderPipeline">(a).gpu)
        return
      case "setBindGroup":
        this.pass!.setBindGroup(num(a), this.get<"bindGroup">(b).gpu, c as number[])
        return
      case "setVertexBuffer":
        this.pass!.setVertexBuffer(num(a), this.get<"buffer">(b).gpu, num(c), whole(d))
        return
      case "setIndexBuffer":
        this.pass!.setIndexBuffer(this.get<"buffer">(a).gpu, b as GPUIndexFormat, num(c), whole(d))
        return
      case "setViewport":
        this.pass!.setViewport(num(a), num(b), num(c), num(d), num(e), num(f))
        return
      case "setScissorRect":
        this.pass!.setScissorRect(num(a), num(b), num(c), num(d))
        return
      case "draw":
        this.pass!.draw(num(a), num(b), num(c), num(d))
        return
      case "drawIndexed":
        this.pass!.drawIndexed(num(a), num(b), num(c), num(d), num(e))
        return
      case "end":
        this.pass!.end()
        this.pass = undefined
        return
      case "submit": {
        const encoder = this.encoder
        this.encoder = undefined
        device.queue.submit(encoder ? [encoder.finish()] : [])
        this.submitted = true
        return
      }
    }
  }

  /** A frame request, with a batch (checked first) or without: the per-frame counts start again. */
  frame() {
    this.checks.frame()
    if (this.waiting.length > 0) this.waiting.push(null)
    else this.endFrame()
  }

  /** The run's second strike (widgets-gpu.md, Strikes): every GPU canvas stops for the rest of the run. */
  stopAll() {
    const error = this.checks.hung()
    if (error) this.stop(error)
  }

  /** The error a stopped canvas shows, or undefined while it draws. */
  private stoppedBy(key: string): string | undefined {
    return this.stopped.get(key) ?? this.all
  }

  /** What a GPU canvas shows instead of drawing: an error's message, `null` (lost, the placeholder alone), or undefined. */
  placeholderFor(key: string): string | null | undefined {
    return this.stoppedBy(key) ?? (this.lostKeys.has(key) ? null : undefined)
  }

  /** The widget stopped: its device and everything on it go. */
  destroy() {
    this.closed = true
    this.waiting = []
    for (const k of this.kept.values()) k.texture.destroy()
    this.kept.clear()
    for (const o of this.objects) if (o?.kind === "context") o.ctx?.unconfigure()
    this.objects = []
    this.watchdog?.stop()
    this.device?.destroy()
    this.device = undefined
  }
}
