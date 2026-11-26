// Canvases with `wgsl` (widgets.md, GPU canvases): the widget template's WGSL in a fixed full-screen pipeline on the
// browser's WebGPU, the GPU canvases' path (widgets-gpu.md); without WebGPU, the placeholder (no WebGL fallback).

import { type Run, Watchdog } from "./watchdog.js"

/** What clients prepend to a widget template's WGSL. */
export const HEADER =
  "struct Widget { resolution: vec2f, time: f32, scale: f32, pointer: vec4f, values: array<vec4f, 4> }\n@group(0) @binding(0) var<uniform> widget: Widget;\n"
const HEADER_LINES = 2
const ENTRY =
  "\n@fragment fn widget_main(@builtin(position) p: vec4f) -> @location(0) vec4f { return shade(p.xy); }\n" +
  "@vertex fn widget_vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {\n" +
  "  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));\n  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);\n}\n"

/** The uniform block: resolution, time, scale, pointer, values (std140 and WGSL agree: 96 bytes). */
export const UNIFORM_FLOATS = 24

/**
 * `program`: the widget template's WGSL is at fault (it fails validation), a program error; else this host's (a client
 * error). `unavailable`: no WebGPU or no device, where the canvas shows its placeholder.
 */
export interface ShaderError {
  message: string
  line?: number
  column?: number
  program?: boolean
  unavailable?: boolean
}

/** One shader on one canvas. */
export interface Surface {
  readonly backend: "webgpu"
  /** Whether the last frame is still drawing: no frame is submitted until it is done. */
  readonly drawing: boolean
  /**
   * Draws a frame with `uniforms`; resolves with how long the GPU took when the backend can tell, else undefined.
   * On the queue the shaders share (widgets-gpu.md, GPU hang): `hang`, the frame hung; `run`, the shader's run, told
   * when the frame finished or was unfinished at a device loss.
   */
  render(uniforms: Float32Array, hang: () => void, run: Run): Promise<number | undefined> | undefined
  /** Settles when its device is lost: the shader is built again on a new one. */
  readonly lost: Promise<unknown>
  destroy(): void
}

// ---------- WebGPU ----------

interface Gpu {
  /** Held: Chromium drops the instance (and fails every call) once its adapter is collected. */
  adapter: GPUAdapter
  device: GPUDevice
  format: GPUTextureFormat
  pipelines: Map<string, Promise<GPURenderPipeline | ShaderError>>
  /** Error scopes are the device's, not a pipeline's: builds take turns so one's errors can't land in another's scope. */
  turn: Promise<unknown>
  layout: GPUBindGroupLayout
  /** The shaders' queue's: only a hung frame's canvas stops, not the frames queued behind it. */
  watchdog: Watchdog
}

let gpu: Promise<Gpu | undefined> | undefined

export function webgpu(): Promise<Gpu | undefined> {
  gpu ??= (async () => {
    const nav = navigator as Navigator & { gpu?: GPU }
    if (!nav.gpu) return undefined
    try {
      const adapter = await nav.gpu.requestAdapter({ powerPreference: "low-power" })
      if (!adapter) return undefined
      const device = await adapter.requestDevice()
      const watchdog = new Watchdog(device.queue)
      void device.lost.then(() => {
        watchdog.lost()
        gpu = undefined
      })
      const layout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
      })
      return { adapter, device, format: nav.gpu.getPreferredCanvasFormat(), pipelines: new Map(), layout, turn: Promise.resolve(), watchdog }
    } catch {
      return undefined
    }
  })()
  return gpu
}

async function pipeline(g: Gpu, wgsl: string): Promise<GPURenderPipeline | ShaderError> {
  let p = g.pipelines.get(wgsl)
  if (!p) {
    const build = async (): Promise<GPURenderPipeline | ShaderError> => {
      const code = HEADER + wgsl + ENTRY
      g.device.pushErrorScope("validation")
      const module = g.device.createShaderModule({ code })
      const info = await module.getCompilationInfo()
      const error = info.messages.find((m) => m.type === "error")
      if (error) {
        await g.device.popErrorScope()
        const line = error.lineNum > HEADER_LINES ? error.lineNum - HEADER_LINES : undefined
        return { message: error.message, line, column: line ? error.linePos : undefined, program: true }
      }
      try {
        const made = await g.device.createRenderPipelineAsync({
          layout: g.device.createPipelineLayout({ bindGroupLayouts: [g.layout] }),
          vertex: { module, entryPoint: "widget_vertex" },
          fragment: { module, entryPoint: "widget_main", targets: [{ format: g.format }] },
          primitive: { topology: "triangle-list" },
        })
        // A validation error here is the WGSL's (its entry points don't fit the pipeline); anything else is the GPU's.
        const scoped = await g.device.popErrorScope()
        if (scoped) return { message: scoped.message, program: scoped instanceof GPUValidationError }
        return made
      } catch (e) {
        await g.device.popErrorScope()
        return { message: String((e as Error)?.message ?? e), program: (e as { reason?: string })?.reason === "validation" }
      }
    }
    p = g.turn.then(build, build)
    g.turn = p
    g.pipelines.set(wgsl, p)
  }
  return p
}

async function gpuSurface(g: Gpu, canvas: HTMLCanvasElement, wgsl: string): Promise<Surface | ShaderError> {
  const made = await pipeline(g, wgsl)
  if ("message" in made) return made
  const context = canvas.getContext("webgpu")
  if (!context) return { message: "no WebGPU context" }
  context.configure({ device: g.device, format: g.format, alphaMode: "premultiplied" })
  const buffer = g.device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bind = g.device.createBindGroup({ layout: g.layout, entries: [{ binding: 0, resource: { buffer } }] })
  let destroyed = false
  let timing = true
  let drawing = false
  return {
    backend: "webgpu",
    get drawing() {
      return drawing
    },
    lost: g.device.lost,
    render(uniforms, hang, run) {
      if (destroyed || canvas.width === 0 || canvas.height === 0) return undefined
      g.device.queue.writeBuffer(buffer, 0, uniforms.buffer, uniforms.byteOffset, uniforms.byteLength)
      const encoder = g.device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
        ],
      })
      pass.setPipeline(made)
      pass.setBindGroup(0, bind)
      pass.draw(3)
      pass.end()
      const started = performance.now()
      g.device.queue.submit([encoder.finish()])
      // One frame drawing at a time: the time is this frame's rather than a queue of them.
      drawing = true
      return g.watchdog.submitted(hang, run).then(
        () => {
          drawing = false
          return timing ? performance.now() - started : undefined
        },
        () => {
          // Some implementations (SwiftShader in headless Chromium) can't tell: no GPU-time budget there.
          drawing = false
          timing = false
          return undefined
        },
      )
    },
    destroy() {
      destroyed = true
      buffer.destroy()
      context.unconfigure()
    },
  }
}

/** Makes a surface for `wgsl` on `canvas` on WebGPU; without it, unavailable. */
export async function surface(canvas: HTMLCanvasElement, wgsl: string): Promise<Surface | ShaderError> {
  const g = await webgpu()
  if (!g) return { message: "GPU canvas not supported", unavailable: true }
  return gpuSurface(g, canvas, wgsl)
}
