// GPU batch checks a host makes without a GPU (specs/v2/widgets-gpu.md, Host checks): every op's shape, the handles
// it names, and the limits; the page replays what passes (gpu.ts). Opencode's `packages/widget/src/gpu.ts` at widgets
// 2364311f1, the reference, with three changes for this host: a batch's bytes come as a `Uint8Array` (a view of what
// the worker transferred), an error gives the op it stopped at (`at`, the ops before it replay), and `scoped` applies
// the canvases rule to an error the replay found (a WebGPU validation error).

/** A program error from a batch (phase `gpu`): the canvases it stops, by key, or every canvas of the device. */
export interface GpuError {
  readonly message: string
  readonly canvases: ReadonlyArray<string> | "all"
}

/** A batch's check: its error, if any, with the op it stopped at; and the canvases it renders into, by key. */
export interface Checked {
  readonly error?: GpuError
  /** The ops before this one passed and may replay; none without it. */
  readonly at?: number
  readonly keys: ReadonlyArray<string>
  /** Every canvas stopped already, or the batch's, or it is from before a device loss: don't replay it. */
  readonly skip: boolean
}

/** The client error a GPU hang stops canvases with (widgets-gpu.md, Errors and device loss). */
export const GPU_HANG = "the GPU work hung; the canvas is stopped"
/** Two strikes this close stop a run: device losses while it had GPU work in flight, one per GPU reset. */
export const STRIKE_MS = 30_000

export const GPU_LIMITS = {
  ops: 20_000,
  bytes: 4 * 1024 * 1024,
  passes: 16,
  draws: 10_000,
  handles: 4096,
  resources: 256 * 1024 * 1024,
  shader: 256 * 1024,
  buffer: 64 * 1024 * 1024,
  dimension: 4096,
  layers: 256,
}

const TEXTURE_FORMATS: Record<string, number> = {
  rgba8unorm: 4,
  "rgba8unorm-srgb": 4,
  bgra8unorm: 4,
  r8unorm: 1,
  rgba16float: 8,
  depth24plus: 4,
  depth32float: 4,
}
const COLOR_FORMATS = ["rgba8unorm", "rgba8unorm-srgb", "bgra8unorm", "r8unorm", "rgba16float"]
const DEPTH_FORMATS = ["depth24plus", "depth32float"]
const VERTEX_FORMATS = [
  "uint8x2",
  "uint8x4",
  "sint8x2",
  "sint8x4",
  "unorm8x2",
  "unorm8x4",
  "snorm8x2",
  "snorm8x4",
  "uint16x2",
  "uint16x4",
  "sint16x2",
  "sint16x4",
  "unorm16x2",
  "unorm16x4",
  "snorm16x2",
  "snorm16x4",
  "float16x2",
  "float16x4",
  "float32",
  "float32x2",
  "float32x3",
  "float32x4",
  "uint32",
  "uint32x2",
  "uint32x3",
  "uint32x4",
  "sint32",
  "sint32x2",
  "sint32x3",
  "sint32x4",
]
const COMPARE = ["never", "less", "equal", "less-equal", "greater", "not-equal", "greater-equal", "always"]
const FACTORS = [
  "zero",
  "one",
  "src",
  "one-minus-src",
  "src-alpha",
  "one-minus-src-alpha",
  "dst",
  "one-minus-dst",
  "dst-alpha",
  "one-minus-dst-alpha",
  "src-alpha-saturated",
  "constant",
  "one-minus-constant",
]
const BUFFER_USAGE = { COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 }
const TEXTURE_USAGE = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 }
const STAGES = { VERTEX: 1, FRAGMENT: 2 }

// `missing`: the handle a `no handle` failure names.
class Invalid extends Error {
  constructor(
    message: string,
    readonly missing?: number,
  ) {
    super(message)
  }
}
const fail = (message: string): never => {
  throw new Invalid(message)
}

/**
 * A GPU canvas's backing size for its physical size (widgets-gpu.md, Canvas size): within the texture dimension limit,
 * its aspect ratio kept; over it, the larger side is the limit and the other ⌊side × limit / larger⌋, at least 1.
 */
export const canvasSize = (width: number, height: number): readonly [number, number] => {
  const larger = Math.max(width, height)
  if (larger <= GPU_LIMITS.dimension) return [width, height]
  const fit = (side: number) => Math.max(1, Math.floor((side * GPU_LIMITS.dimension) / larger))
  return [fit(width), fit(height)]
}

type Kind =
  | "context"
  | "buffer"
  | "texture"
  | "view"
  | "sampler"
  | "shader"
  | "bindGroupLayout"
  | "pipelineLayout"
  | "renderPipeline"
  | "bindGroup"
interface Handle {
  readonly kind: Kind
  /** A buffer's or texture's bytes as allocated; a view's texture; a context's key. */
  readonly bytes?: number
  readonly texture?: number
  readonly key?: string
  destroyed?: boolean
}

// Checks one value at `path` ("<op>" argument <i>, then .field and [index]).
const whole = (value: unknown, path: string) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fail(`${path} must be a whole number`)
const wholeOrAll = (value: unknown, path: string) =>
  value === -1
    ? -1
    : typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : fail(`${path} must be a whole number or -1`)
const integer = (value: unknown, path: string) =>
  typeof value === "number" && Number.isInteger(value) ? value : fail(`${path} must be an integer`)
const finite = (value: unknown, path: string) =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(`${path} must be a finite number`)
const bool = (value: unknown, path: string) =>
  typeof value === "boolean" ? value : fail(`${path} must be true or false`)
const text = (value: unknown, path: string) => (typeof value === "string" ? value : fail(`${path} must be a string`))
const oneOf = <A>(value: unknown, options: ReadonlyArray<A>, path: string) =>
  options.includes(value as A) ? (value as A) : fail(`${path} must be one of ${options.join(", ")}`)
const list = (value: unknown, path: string, length?: number) =>
  Array.isArray(value) && (length === undefined || value.length === length)
    ? value
    : fail(length === undefined ? `${path} must be a list` : `${path} must be a list of ${length}`)
const record = (value: unknown, path: string) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${path} must be an object`)
const nullable = <A>(value: unknown, check: (value: unknown) => A) => (value === null ? null : check(value))

// A posted value as JSON reads it (widgets-gpu.md, Transport): an `undefined` list item is null and an `undefined`
// member is absent; nothing else changes. Copies only what changes.
const json = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) {
    let out: unknown[] | undefined
    for (let i = 0; i < value.length; i++) {
      const item: unknown = value[i]
      const read = item === undefined ? null : json(item)
      if (read !== item) (out ??= value.slice())[i] = read
    }
    return out ?? value
  }
  let out: Record<string, unknown> | undefined
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) delete (out ??= { ...value })[key]
    else {
      const read = json(item)
      if (read !== item) (out ??= { ...value })[key] = read
    }
  }
  return out ?? value
}
const flags = (value: unknown, names: Record<string, number>, path: string) => {
  const all = Object.values(names).reduce((sum, bit) => sum | bit, 0)
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && (value & ~all) === 0
    ? value
    : fail(`${path} must combine ${Object.keys(names).join(", ")}`)
}
const limit = (value: number, max: number, what: string) =>
  value > max ? fail(`${what} is over the limit of ${max}`) : value

// The ops: their number of arguments after the name.
const ARITY: Record<string, number> = {
  context: 4,
  buffer: 3,
  texture: 8,
  view: 3,
  sampler: 2,
  shader: 2,
  bindGroupLayout: 2,
  pipelineLayout: 2,
  renderPipeline: 2,
  autoLayout: 3,
  bindGroup: 2,
  destroy: 1,
  writeBuffer: 4,
  writeTexture: 8,
  copyBufferToBuffer: 5,
  copyBufferToTexture: 8,
  copyTextureToTexture: 7,
  pass: 1,
  setPipeline: 1,
  setBindGroup: 3,
  setVertexBuffer: 4,
  setIndexBuffer: 4,
  setViewport: 6,
  setScissorRect: 4,
  draw: 4,
  drawIndexed: 5,
  end: 0,
  submit: 0,
  error: 1,
}
const IN_PASS = new Set([
  "setPipeline",
  "setBindGroup",
  "setVertexBuffer",
  "setIndexBuffer",
  "setViewport",
  "setScissorRect",
  "draw",
  "drawIndexed",
  "end",
])

/**
 * The checks of a widget's batches, in order. `canvases` gives the keys of the GPU canvases in the last rendered view.
 * A batch gives its first error, or none, and the rest of it goes unchecked. The error stops the canvases the batch
 * renders into (a pass's color attachment or its resolve target is a view of their texture), or every GPU canvas of the
 * widget when it renders into none; then later batches go unchecked. An error stopping only canvases already stopped
 * isn't given again. A batch whose first error names a handle from before a device loss is dropped without one.
 */
export function gpuChecks(canvases: () => ReadonlySet<string>) {
  const handles = new Map<number, Handle>()
  // `stale`: handles up to this one are from before the last device loss.
  const state = { last: 0, stale: 0, live: 0, resources: 0, passes: 0, draws: 0, all: false }
  const stopped = new Set<string>()

  const find = (value: unknown, path: string, ...kinds: ReadonlyArray<Kind>) => {
    const h = whole(value, path)
    const found = handles.get(h)
    if (!found) throw new Invalid(`no handle ${h}`, h)
    if (!kinds.includes(found.kind)) fail(`handle ${h} is a ${found.kind}, not a ${kinds.join(" or ")}`)
    if (found.destroyed) fail(`handle ${h} was destroyed`)
    return found
  }
  // A canvas's texture has usage RENDER_ATTACHMENT alone: no copy, write or binding may use it.
  const notCanvas = (found: Handle | undefined, path: string) => {
    if (found?.kind === "context") fail(`${path} uses canvas "${found.key}"'s texture, which can only be rendered into`)
  }
  // A texture a copy or a write takes.
  const copied = (value: unknown, path: string) => {
    notCanvas(handles.get(whole(value, path)), path)
    return find(value, path, "texture")
  }
  const create = (value: unknown, path: string, made: Handle) => {
    const h = whole(value, path)
    if (h <= state.last) fail(`handle ${h} was already used`)
    state.last = h
    handles.set(h, made)
    limit(++state.live, GPU_LIMITS.handles, "the number of live handles")
    if (made.bytes) limit((state.resources += made.bytes), GPU_LIMITS.resources, "the size of buffers and textures")
  }
  const free = (h: number, found: Handle) => {
    found.destroyed = true
    state.live--
    state.resources -= found.bytes ?? 0
    for (const [, other] of handles)
      if (other.kind === "view" && other.texture === h && !other.destroyed) {
        other.destroyed = true
        state.live--
      }
  }
  const range = (offset: number, length: number, bytes: Uint8Array) =>
    offset + length > bytes.byteLength
      ? fail(`bytes [${offset}, ${offset + length}) are outside the batch's ${bytes.byteLength} bytes`)
      : undefined
  const triple = (value: unknown, path: string) =>
    list(value, path, 3).forEach((item, i) => whole(item, `${path}[${i}]`))

  const op = (o: ReadonlyArray<unknown>, name: string, bytes: Uint8Array) => {
    const a = (i: number) => `"${name}" argument ${i}`
    switch (name) {
      case "context": {
        const key = text(o[2], a(2))
        oneOf(o[3], ["bgra8unorm", "rgba8unorm"], a(3))
        oneOf(o[4], ["opaque", "premultiplied"], a(4))
        if (!canvases().has(key)) fail(`no GPU canvas with key "${key}"`)
        const existing = handles.get(whole(o[1], a(1)))
        if (existing?.kind === "context" && existing.key === key) return
        return create(o[1], a(1), { kind: "context", key })
      }
      case "buffer": {
        const size = limit(whole(o[2], a(2)), GPU_LIMITS.buffer, a(2))
        flags(o[3], BUFFER_USAGE, a(3))
        return create(o[1], a(1), { kind: "buffer", bytes: size })
      }
      case "texture": {
        const width = limit(whole(o[2], a(2)), GPU_LIMITS.dimension, a(2))
        const height = limit(whole(o[3], a(3)), GPU_LIMITS.dimension, a(3))
        const layers = limit(whole(o[4], a(4)), GPU_LIMITS.layers, a(4))
        const format = oneOf(o[5], Object.keys(TEXTURE_FORMATS), a(5))
        flags(o[6], TEXTURE_USAGE, a(6))
        const mips = whole(o[7], a(7))
        const samples = oneOf(o[8], [1, 4], a(8))
        let bytes = 0
        for (let mip = 0; mip < mips; mip++)
          bytes += Math.max(1, width >> mip) * Math.max(1, height >> mip) * layers * TEXTURE_FORMATS[format]! * samples
        return create(o[1], a(1), { kind: "texture", bytes })
      }
      case "view": {
        const texture = whole(o[2], a(2))
        find(texture, a(2), "texture", "context")
        const d = record(o[3], a(3))
        oneOf(d.dimension, ["2d", "2d-array", "cube"], `${a(3)}.dimension`)
        for (const field of ["baseMipLevel", "mipLevelCount", "baseArrayLayer", "arrayLayerCount"])
          whole(d[field], `${a(3)}.${field}`)
        return create(o[1], a(1), { kind: "view", texture })
      }
      case "sampler": {
        const d = record(o[2], a(2))
        for (const field of ["addressModeU", "addressModeV", "addressModeW"])
          oneOf(d[field], ["clamp-to-edge", "repeat", "mirror-repeat"], `${a(2)}.${field}`)
        for (const field of ["magFilter", "minFilter", "mipmapFilter"])
          oneOf(d[field], ["nearest", "linear"], `${a(2)}.${field}`)
        finite(d.lodMinClamp, `${a(2)}.lodMinClamp`)
        finite(d.lodMaxClamp, `${a(2)}.lodMaxClamp`)
        nullable(d.compare, (value) => oneOf(value, COMPARE, `${a(2)}.compare`))
        whole(d.maxAnisotropy, `${a(2)}.maxAnisotropy`)
        return create(o[1], a(1), { kind: "sampler" })
      }
      case "shader": {
        limit(new TextEncoder().encode(text(o[2], a(2))).length, GPU_LIMITS.shader, a(2))
        return create(o[1], a(1), { kind: "shader" })
      }
      case "bindGroupLayout": {
        const d = record(o[2], a(2))
        list(d.entries, `${a(2)}.entries`).forEach((item, i) => {
          const at = `${a(2)}.entries[${i}]`
          const e = record(item, at)
          whole(e.binding, `${at}.binding`)
          flags(e.visibility, STAGES, `${at}.visibility`)
          if ([e.buffer, e.sampler, e.texture].filter((value) => value !== null).length !== 1)
            fail(`${at} needs exactly one of buffer, sampler and texture`)
          nullable(e.buffer, (value) => {
            const b = record(value, `${at}.buffer`)
            oneOf(b.type, ["uniform", "storage", "read-only-storage"], `${at}.buffer.type`)
            bool(b.hasDynamicOffset, `${at}.buffer.hasDynamicOffset`)
            whole(b.minBindingSize, `${at}.buffer.minBindingSize`)
          })
          nullable(e.sampler, (value) =>
            oneOf(
              record(value, `${at}.sampler`).type,
              ["filtering", "non-filtering", "comparison"],
              `${at}.sampler.type`,
            ),
          )
          nullable(e.texture, (value) => {
            const t = record(value, `${at}.texture`)
            oneOf(t.sampleType, ["float", "unfilterable-float", "depth", "sint", "uint"], `${at}.texture.sampleType`)
            oneOf(t.viewDimension, ["2d", "2d-array", "cube"], `${at}.texture.viewDimension`)
            bool(t.multisampled, `${at}.texture.multisampled`)
          })
        })
        return create(o[1], a(1), { kind: "bindGroupLayout" })
      }
      case "pipelineLayout": {
        list(o[2], a(2)).forEach((item, i) => find(item, `${a(2)}[${i}]`, "bindGroupLayout"))
        return create(o[1], a(1), { kind: "pipelineLayout" })
      }
      case "renderPipeline": {
        pipeline(record(o[2], a(2)), a(2))
        return create(o[1], a(1), { kind: "renderPipeline" })
      }
      case "autoLayout": {
        find(o[2], a(2), "renderPipeline")
        whole(o[3], a(3))
        return create(o[1], a(1), { kind: "bindGroupLayout" })
      }
      case "bindGroup": {
        const d = record(o[2], a(2))
        find(d.layout, `${a(2)}.layout`, "bindGroupLayout")
        list(d.entries, `${a(2)}.entries`).forEach((item, i) => {
          const at = `${a(2)}.entries[${i}]`
          const e = record(item, at)
          whole(e.binding, `${at}.binding`)
          const r = record(e.resource, `${at}.resource`)
          if ("buffer" in r) {
            find(r.buffer, `${at}.resource.buffer`, "buffer")
            whole(r.offset, `${at}.resource.offset`)
            wholeOrAll(r.size, `${at}.resource.size`)
          } else if ("sampler" in r) find(r.sampler, `${at}.resource.sampler`, "sampler")
          else if ("view" in r)
            notCanvas(handles.get(find(r.view, `${at}.resource.view`, "view").texture!), `${at}.resource.view`)
          else fail(`${at}.resource must be a buffer binding, a sampler or a view`)
        })
        return create(o[1], a(1), { kind: "bindGroup" })
      }
      case "destroy": {
        const h = whole(o[1], a(1))
        return free(h, find(h, a(1), "buffer", "texture"))
      }
      case "writeBuffer":
        find(o[1], a(1), "buffer")
        whole(o[2], a(2))
        return range(whole(o[3], a(3)), whole(o[4], a(4)), bytes)
      case "writeTexture":
        copied(o[1], a(1))
        whole(o[2], a(2))
        triple(o[3], a(3))
        range(whole(o[4], a(4)), whole(o[5], a(5)), bytes)
        whole(o[6], a(6))
        nullable(o[7], (value) => whole(value, a(7)))
        return triple(o[8], a(8))
      case "copyBufferToBuffer":
        find(o[1], a(1), "buffer")
        whole(o[2], a(2))
        find(o[3], a(3), "buffer")
        whole(o[4], a(4))
        return void whole(o[5], a(5))
      case "copyBufferToTexture":
        find(o[1], a(1), "buffer")
        whole(o[2], a(2))
        whole(o[3], a(3))
        nullable(o[4], (value) => whole(value, a(4)))
        copied(o[5], a(5))
        whole(o[6], a(6))
        triple(o[7], a(7))
        return triple(o[8], a(8))
      case "copyTextureToTexture":
        copied(o[1], a(1))
        whole(o[2], a(2))
        triple(o[3], a(3))
        copied(o[4], a(4))
        whole(o[5], a(5))
        triple(o[6], a(6))
        return triple(o[7], a(7))
      case "setPipeline":
        return void find(o[1], a(1), "renderPipeline")
      case "setBindGroup":
        whole(o[1], a(1))
        find(o[2], a(2), "bindGroup")
        return list(o[3], a(3)).forEach((item, i) => whole(item, `${a(3)}[${i}]`))
      case "setVertexBuffer":
        whole(o[1], a(1))
        find(o[2], a(2), "buffer")
        whole(o[3], a(3))
        return void wholeOrAll(o[4], a(4))
      case "setIndexBuffer":
        find(o[1], a(1), "buffer")
        oneOf(o[2], ["uint16", "uint32"], a(2))
        whole(o[3], a(3))
        return void wholeOrAll(o[4], a(4))
      case "setViewport":
        return [1, 2, 3, 4, 5, 6].forEach((i) => finite(o[i], a(i)))
      case "setScissorRect":
        return [1, 2, 3, 4].forEach((i) => whole(o[i], a(i)))
      case "draw":
      case "drawIndexed":
        o.slice(1).forEach((value, i) => (name === "drawIndexed" && i === 3 ? integer : whole)(value, a(i + 1)))
        return void limit(++state.draws, GPU_LIMITS.draws, "the number of draws in a frame")
    }
  }

  const pipeline = (d: Record<string, unknown>, at: string) => {
    if (d.layout !== "auto") find(d.layout, `${at}.layout`, "pipelineLayout")
    const vertex = record(d.vertex, `${at}.vertex`)
    find(vertex.module, `${at}.vertex.module`, "shader")
    nullable(vertex.entryPoint, (value) => text(value, `${at}.vertex.entryPoint`))
    list(vertex.buffers, `${at}.vertex.buffers`).forEach((item, i) =>
      nullable(item, (value) => {
        const path = `${at}.vertex.buffers[${i}]`
        const b = record(value, path)
        whole(b.arrayStride, `${path}.arrayStride`)
        oneOf(b.stepMode, ["vertex", "instance"], `${path}.stepMode`)
        list(b.attributes, `${path}.attributes`).forEach((attribute, j) => {
          const where = `${path}.attributes[${j}]`
          const t = record(attribute, where)
          oneOf(t.format, VERTEX_FORMATS, `${where}.format`)
          whole(t.offset, `${where}.offset`)
          whole(t.shaderLocation, `${where}.shaderLocation`)
        })
      }),
    )
    nullable(d.fragment, (value) => {
      const fragment = record(value, `${at}.fragment`)
      find(fragment.module, `${at}.fragment.module`, "shader")
      nullable(fragment.entryPoint, (entry) => text(entry, `${at}.fragment.entryPoint`))
      list(fragment.targets, `${at}.fragment.targets`).forEach((item, i) =>
        nullable(item, (target) => {
          const path = `${at}.fragment.targets[${i}]`
          const t = record(target, path)
          oneOf(t.format, COLOR_FORMATS, `${path}.format`)
          nullable(t.blend, (blend) => {
            const b = record(blend, `${path}.blend`)
            for (const part of ["color", "alpha"]) {
              const c = record(b[part], `${path}.blend.${part}`)
              oneOf(
                c.operation,
                ["add", "subtract", "reverse-subtract", "min", "max"],
                `${path}.blend.${part}.operation`,
              )
              oneOf(c.srcFactor, FACTORS, `${path}.blend.${part}.srcFactor`)
              oneOf(c.dstFactor, FACTORS, `${path}.blend.${part}.dstFactor`)
            }
          })
          limit(whole(t.writeMask, `${path}.writeMask`), 15, `${path}.writeMask`)
        }),
      )
    })
    const primitive = record(d.primitive, `${at}.primitive`)
    oneOf(
      primitive.topology,
      ["point-list", "line-list", "line-strip", "triangle-list", "triangle-strip"],
      `${at}.primitive.topology`,
    )
    nullable(primitive.stripIndexFormat, (value) =>
      oneOf(value, ["uint16", "uint32"], `${at}.primitive.stripIndexFormat`),
    )
    oneOf(primitive.frontFace, ["ccw", "cw"], `${at}.primitive.frontFace`)
    oneOf(primitive.cullMode, ["none", "front", "back"], `${at}.primitive.cullMode`)
    nullable(d.depthStencil, (value) => {
      const depth = record(value, `${at}.depthStencil`)
      oneOf(depth.format, DEPTH_FORMATS, `${at}.depthStencil.format`)
      bool(depth.depthWriteEnabled, `${at}.depthStencil.depthWriteEnabled`)
      oneOf(depth.depthCompare, COMPARE, `${at}.depthStencil.depthCompare`)
    })
    const multisample = record(d.multisample, `${at}.multisample`)
    oneOf(multisample.count, [1, 4], `${at}.multisample.count`)
    whole(multisample.mask, `${at}.multisample.mask`)
    bool(multisample.alphaToCoverageEnabled, `${at}.multisample.alphaToCoverageEnabled`)
  }

  // The keys of the canvases a batch renders into, in order, from what it and earlier batches made.
  const rendered = (ops: ReadonlyArray<unknown>) => {
    const textures = new Map<number, number>()
    const contexts = new Map<number, string>()
    const keys = new Set<string>()
    const context = (h: number | undefined) => {
      const found = h === undefined ? undefined : handles.get(h)
      return h === undefined ? undefined : (contexts.get(h) ?? (found?.kind === "context" ? found.key : undefined))
    }
    for (const o of ops) {
      if (!Array.isArray(o) || typeof o[1] !== "number") continue
      if (o[0] === "context" && typeof o[2] === "string") contexts.set(o[1], o[2])
      if (o[0] === "view" && typeof o[2] === "number") textures.set(o[1], o[2])
    }
    for (const o of ops) {
      if (!Array.isArray(o) || o[0] !== "pass" || !o[1] || !Array.isArray(o[1].colorAttachments)) continue
      // A color attachment's view or its resolve target.
      for (const attachment of o[1].colorAttachments)
        for (const view of [attachment?.view, attachment?.resolveTarget]) {
          if (typeof view !== "number") continue
          const key = context(textures.get(view) ?? handles.get(view)?.texture)
          if (key !== undefined) keys.add(key)
        }
    }
    return [...keys]
  }

  // A pass's descriptor, checked.
  const pass = (value: unknown) => {
    const at = `"pass" argument 1`
    const d = record(value, at)
    list(d.colorAttachments, `${at}.colorAttachments`).forEach((item, i) =>
      nullable(item, (attachment) => {
        const path = `${at}.colorAttachments[${i}]`
        const c = record(attachment, path)
        find(c.view, `${path}.view`, "view")
        nullable(c.resolveTarget, (resolve) => find(resolve, `${path}.resolveTarget`, "view"))
        list(c.clearValue, `${path}.clearValue`, 4).forEach((part, j) => finite(part, `${path}.clearValue[${j}]`))
        oneOf(c.loadOp, ["load", "clear"], `${path}.loadOp`)
        oneOf(c.storeOp, ["store", "discard"], `${path}.storeOp`)
      }),
    )
    nullable(d.depthStencilAttachment, (attachment) => {
      const path = `${at}.depthStencilAttachment`
      const depth = record(attachment, path)
      find(depth.view, `${path}.view`, "view")
      nullable(depth.depthClearValue, (clear) => finite(clear, `${path}.depthClearValue`))
      nullable(depth.depthLoadOp, (load) => oneOf(load, ["load", "clear"], `${path}.depthLoadOp`))
      nullable(depth.depthStoreOp, (store) => oneOf(store, ["store", "discard"], `${path}.depthStoreOp`))
      bool(depth.depthReadOnly, `${path}.depthReadOnly`)
    })
    limit(++state.passes, GPU_LIMITS.passes, "the number of render passes in a frame")
  }

  // An error stops the canvases `keys` (those the batch renders into), or every one; none already stopped is
  // reported again.
  const scopedError = (message: string, keys: ReadonlyArray<string>): GpuError | undefined => {
    if (keys.length > 0) {
      const fresh = keys.filter((key) => !stopped.has(key))
      keys.forEach((key) => stopped.add(key))
      return fresh.length > 0 ? { message, canvases: fresh } : undefined
    }
    state.all = true
    const fresh = [...canvases()].filter((key) => !stopped.has(key))
    return fresh.length > 0 || stopped.size === 0 ? { message, canvases: "all" } : undefined
  }

  return {
    /** Checks a batch. */
    batch: (value: unknown): Checked => {
      if (state.all) return { keys: [], skip: true }
      const scoped = { keys: [] as string[], pass: false, skip: false }
      const result = (error: GpuError | undefined, at?: number): Checked => ({
        error,
        at,
        keys: scoped.keys,
        skip: scoped.skip,
      })
      try {
        const batch = record(value, "a batch")
        const ops = list(json(batch.ops), "a batch's ops")
        scoped.keys = rendered(ops)
        if (!(batch.bytes instanceof Uint8Array)) fail("a batch's bytes must be an ArrayBuffer")
        const bytes = batch.bytes as Uint8Array
        limit(ops.length, GPU_LIMITS.ops, "the number of ops in a batch")
        limit(bytes.byteLength, GPU_LIMITS.bytes, "the size of a batch's bytes")
        // Every canvas it renders into stopped already: it is ignored (after an error, later batches for them are).
        scoped.skip = scoped.keys.length > 0 && scoped.keys.every((key) => stopped.has(key))
        for (let index = 0; index < ops.length; index++) {
          try {
            const o = ops[index]
            if (!Array.isArray(o) || typeof o[0] !== "string") fail("an op is a list that starts with its name")
            const list = o as ReadonlyArray<unknown>
            const name = list[0] as string
            const arity = Object.hasOwn(ARITY, name) ? ARITY[name]! : fail(`unknown op "${name}"`)
            if (list.length !== arity + 1) fail(`"${name}" takes ${arity} arguments`)
            if (name === "error") fail(text(list[1], `"error" argument 1`))
            if (name === "pass") {
              if (scoped.pass) fail(`"pass" inside a render pass`)
              pass(list[1])
              scoped.pass = true
              continue
            }
            if (IN_PASS.has(name) && !scoped.pass) fail(`"${name}" outside a render pass`)
            if (!IN_PASS.has(name) && scoped.pass) fail(`"${name}" inside a render pass`)
            if (name === "end") scoped.pass = false
            else op(list, name, bytes)
          } catch (caught) {
            if (!(caught instanceof Invalid)) throw caught
            // Posted before the program learned of the loss: dropped, not replayed, not reported.
            if (caught.missing !== undefined && caught.missing >= 1 && caught.missing <= state.stale)
              return { keys: scoped.keys, skip: true }
            return result(scopedError(`gpu op ${index}: ${caught.message}`, scoped.keys), index)
          }
        }
        if (scoped.pass) return result(scopedError("a render pass is still open at the end of the batch", scoped.keys), ops.length)
        return result(undefined)
      } catch (caught) {
        if (!(caught instanceof Invalid)) throw caught
        return result(scopedError(caught.message, scoped.keys))
      }
    },
    /** A frame request, with or without a batch: it ends the frame the per-frame limits count. */
    frame: () => {
      state.passes = 0
      state.draws = 0
    },
    /** An error the replay found in a batch that renders into `keys`. */
    scoped: scopedError,
    /** A GPU hang stops every GPU canvas; later batches go unchecked. Given unless every canvas was stopped already. */
    hung: (): GpuError | undefined => {
      if (state.all) return undefined
      state.all = true
      const fresh = [...canvases()].filter((key) => !stopped.has(key))
      return fresh.length > 0 || stopped.size === 0 ? { message: GPU_HANG, canvases: "all" } : undefined
    },
    /** The device is lost: every handle is gone; new ones keep counting up. */
    lost: () => {
      state.stale = state.last
      handles.clear()
      state.live = 0
      state.resources = 0
    },
  }
}
