// The live prelude (specs/v2/widgets.md, Prelude and step ABI): what only live programs use, after the prelude in a
// live widget template's program: `widget` with `widget.gpu`, and `__widget_live`. Steps never load it.

// WebGPU's flags, for the subset widgets have (specs/v2/widgets-gpu.md).
const GPUBufferUsage = Object.freeze({ COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 })
const GPUTextureUsage = Object.freeze({ COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 })
const GPUShaderStage = Object.freeze({ VERTEX: 1, FRAGMENT: 2 })
const GPUColorWrite = Object.freeze({ RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 })

// `widget.gpu` (specs/v2/widgets-gpu.md): WebGPU's shapes, recorded as ops and bytes into the batch the host replays.
// `start` takes the live input's `gpu`; `take` gives the pending batch (or null); `accept` takes the host's `canvas`
// and `gpu` messages; `watched` tells whether the program waits on the device's loss, which `watch` is told of.
function __widget_gpu(watch) {
  const LIMITS = Object.freeze({
    maxTextureDimension2D: 4096,
    maxTextureArrayLayers: 256,
    maxBindGroups: 4,
    maxBindingsPerBindGroup: 1000,
    maxDynamicUniformBuffersPerPipelineLayout: 8,
    maxDynamicStorageBuffersPerPipelineLayout: 4,
    maxSampledTexturesPerShaderStage: 16,
    maxSamplersPerShaderStage: 16,
    maxStorageBuffersPerShaderStage: 8,
    maxUniformBuffersPerShaderStage: 12,
    maxUniformBufferBindingSize: 65536,
    maxStorageBufferBindingSize: 67108864,
    minUniformBufferOffsetAlignment: 256,
    minStorageBufferOffsetAlignment: 256,
    maxVertexBuffers: 8,
    maxBufferSize: 67108864,
    maxVertexAttributes: 16,
    maxVertexBufferArrayStride: 2048,
    maxInterStageShaderVariables: 16,
    maxColorAttachments: 8,
    maxColorAttachmentBytesPerSample: 32,
  })
  // `device`: the live device or null, and `lost` its resolver; `ops` and `bytes` (`length` of them used): the pending
  // batch. `sizes`: the GPU canvases' sizes by key, from the host; `contexts` by key.
  const gpu = {
    watched: false,
    available: false,
    format: "rgba8unorm",
    next: 1,
    device: null,
    lost: null,
    ops: [],
    bytes: null,
    length: 0,
  }
  const sizes = {}
  const contexts = {}
  const handle = () => gpu.next++
  // Records an op for `device`; a lost device's calls, and every call without a GPU, record nothing.
  const record = (device, op) => {
    if (gpu.available && device === gpu.device) gpu.ops.push(op)
  }
  const kind = (value, expected, what) => {
    if (!value || value.__kind !== expected) throw new TypeError(what + " must be a GPU " + expected)
    return value.__handle
  }
  const object = (value, what) => {
    if (!value || typeof value !== "object") throw new TypeError(what + " must be an object")
    return value
  }
  // Appends `data`'s bytes (an ArrayBuffer, or a typed array whose offset and size count elements) to the batch and
  // returns `[byteOffset, byteLength]`. They are copied now, as WebGPU's writes copy them.
  const append = (data, offset, size) => {
    const view = ArrayBuffer.isView(data)
    if (!view && !(data instanceof ArrayBuffer)) throw new TypeError("data must be an ArrayBuffer or a typed array")
    const unit = view ? data.BYTES_PER_ELEMENT : 1
    const skip = (offset ?? 0) * unit
    const length = size === undefined ? data.byteLength - skip : size * unit
    const bytes = new Uint8Array(view ? data.buffer : data, (view ? data.byteOffset : 0) + skip, length)
    if (!gpu.bytes || gpu.length + length > gpu.bytes.length) {
      const grown = new Uint8Array(Math.max(1024, (gpu.length + length) * 2))
      if (gpu.bytes) grown.set(new Uint8Array(gpu.bytes.buffer, 0, gpu.length))
      gpu.bytes = grown
    }
    gpu.bytes.set(bytes, gpu.length)
    gpu.length += length
    return [gpu.length - length, length]
  }
  // An origin or extent as WebGPU takes one (an array, or an object), as `[x, y, z]`.
  const triple = (value, fill) =>
    Array.isArray(value)
      ? [value[0] ?? fill[0], value[1] ?? fill[1], value[2] ?? fill[2]]
      : value && typeof value === "object"
        ? [
            value.x ?? value.width ?? fill[0],
            value.y ?? value.height ?? fill[1],
            value.z ?? value.depthOrArrayLayers ?? fill[2],
          ]
        : fill
  const extent = (value) => triple(value, [undefined, 1, 1])
  const origin = (value) => triple(value, [0, 0, 0])
  const component = (value) => ({
    operation: value?.operation ?? "add",
    srcFactor: value?.srcFactor ?? "one",
    dstFactor: value?.dstFactor ?? "zero",
  })

  const texture = (device, h, props) => {
    // Views are immutable, so equal ones are one handle: a frame's view of the canvas too.
    const views = {}
    return {
      __kind: "texture",
      __handle: h,
      __device: device,
      ...props,
      createView: (descriptor) => {
        const d = descriptor ?? {}
        const layers = props.depthOrArrayLayers
        const dimension = d.dimension ?? (layers > 1 ? "2d-array" : "2d")
        const base = d.baseArrayLayer ?? 0
        const mip = d.baseMipLevel ?? 0
        const normal = {
          dimension,
          baseMipLevel: mip,
          mipLevelCount: d.mipLevelCount ?? props.mipLevelCount - mip,
          baseArrayLayer: base,
          arrayLayerCount: d.arrayLayerCount ?? (dimension === "2d" ? 1 : dimension === "cube" ? 6 : layers - base),
        }
        const key = JSON.stringify(normal)
        if (views[key]) return views[key]
        const view = { __kind: "view", __handle: handle(), __device: device }
        record(device, ["view", view.__handle, h, normal])
        views[key] = view
        return view
      },
      destroy: () => record(device, ["destroy", h]),
    }
  }

  const pass = (encoder, descriptor) => {
    const d = object(descriptor, "beginRenderPass's descriptor")
    const depth = d.depthStencilAttachment
    const clear = (value) =>
      Array.isArray(value) ? [...value] : value ? [value.r, value.g, value.b, value.a] : [0, 0, 0, 0]
    encoder.add(
      [
        "pass",
        {
          colorAttachments: (d.colorAttachments ?? []).map((a) =>
            a
              ? {
                  view: kind(a.view, "view", "a color attachment's view"),
                  resolveTarget: a.resolveTarget ? kind(a.resolveTarget, "view", "a resolveTarget") : null,
                  clearValue: clear(a.clearValue),
                  loadOp: a.loadOp,
                  storeOp: a.storeOp,
                }
              : null,
          ),
          depthStencilAttachment: depth
            ? {
                view: kind(depth.view, "view", "the depth attachment's view"),
                depthClearValue: depth.depthClearValue ?? null,
                depthLoadOp: depth.depthLoadOp ?? null,
                depthStoreOp: depth.depthStoreOp ?? null,
                depthReadOnly: depth.depthReadOnly ?? false,
              }
            : null,
        },
      ],
      true,
    )
    const open = { ended: false }
    const add = (op) => (open.ended ? encoder.fail("the render pass has ended") : encoder.add(op, true))
    return {
      setPipeline: (pipeline) => add(["setPipeline", kind(pipeline, "renderPipeline", "setPipeline's pipeline")]),
      setBindGroup: (index, group, offsets) =>
        add([
          "setBindGroup",
          index,
          kind(group, "bindGroup", "setBindGroup's group"),
          offsets ? Array.from(offsets) : [],
        ]),
      setVertexBuffer: (slot, buffer, offset, size) =>
        add(["setVertexBuffer", slot, kind(buffer, "buffer", "setVertexBuffer's buffer"), offset ?? 0, size ?? -1]),
      setIndexBuffer: (buffer, format, offset, size) =>
        add(["setIndexBuffer", kind(buffer, "buffer", "setIndexBuffer's buffer"), format, offset ?? 0, size ?? -1]),
      setViewport: (x, y, width, height, minDepth, maxDepth) =>
        add(["setViewport", x, y, width, height, minDepth, maxDepth]),
      setScissorRect: (x, y, width, height) => add(["setScissorRect", x, y, width, height]),
      draw: (count, instances, first, firstInstance) =>
        add(["draw", count, instances ?? 1, first ?? 0, firstInstance ?? 0]),
      drawIndexed: (count, instances, first, base, firstInstance) =>
        add(["drawIndexed", count, instances ?? 1, first ?? 0, base ?? 0, firstInstance ?? 0]),
      end: () => {
        if (open.ended) return encoder.fail("the render pass has ended")
        open.ended = true
        encoder.add(["end"], true)
        encoder.close()
      },
    }
  }

  // A command encoder keeps its commands until `queue.submit` takes its command buffer. Misuse that WebGPU reports as
  // a validation error goes into the batch as an `error` op, once per encoder, and the encoder records nothing more.
  const encoder = (device) => {
    const state = { ops: gpu.available ? [] : null, pass: false, finished: false, failed: false }
    const self = {
      add: (op, inPass) => {
        if (state.failed) return
        if (state.finished) return self.fail("the command encoder is finished")
        if (state.pass && !inPass) return self.fail("a render pass is open on this command encoder")
        state.ops?.push(op)
      },
      close: () => (state.pass = false),
      fail: (message) => {
        if (state.failed) return
        state.failed = true
        record(device, ["error", message])
      },
    }
    const dead = { add: () => {}, fail: () => {}, close: () => {} }
    return {
      __kind: "encoder",
      beginRenderPass: (descriptor) => {
        if (state.finished) self.fail("the command encoder is finished")
        else if (state.pass) self.fail("a render pass is open on this command encoder")
        if (state.failed) return pass(dead, descriptor)
        state.pass = true
        return pass(self, descriptor)
      },
      copyBufferToBuffer: (source, sourceOffset, destination, destinationOffset, size) =>
        self.add([
          "copyBufferToBuffer",
          kind(source, "buffer", "the source"),
          sourceOffset,
          kind(destination, "buffer", "the destination"),
          destinationOffset,
          size,
        ]),
      copyBufferToTexture: (source, destination, size) =>
        self.add([
          "copyBufferToTexture",
          kind(source?.buffer, "buffer", "the source's buffer"),
          source.offset ?? 0,
          source.bytesPerRow,
          source.rowsPerImage ?? null,
          kind(destination?.texture, "texture", "the destination's texture"),
          destination.mipLevel ?? 0,
          origin(destination.origin),
          extent(size),
        ]),
      copyTextureToTexture: (source, destination, size) =>
        self.add([
          "copyTextureToTexture",
          kind(source?.texture, "texture", "the source's texture"),
          source.mipLevel ?? 0,
          origin(source.origin),
          kind(destination?.texture, "texture", "the destination's texture"),
          destination.mipLevel ?? 0,
          origin(destination.origin),
          extent(size),
        ]),
      finish: () => {
        if (state.pass) self.fail("a render pass is open on this command encoder")
        else if (state.finished) self.fail("the command encoder is finished")
        state.finished = true
        return { __kind: "commandBuffer", ops: state.failed ? null : state.ops, submitted: false }
      },
    }
  }

  const createDevice = () => {
    const lost = new Promise((resolve) => (gpu.lost = resolve))
    const device = {
      __kind: "device",
      limits: LIMITS,
      features: new Set(),
      // Reading it waits for the loss: the host's messages keep coming until then.
      get lost() {
        gpu.watched = true
        watch()
        return lost
      },
      createBuffer: (descriptor) => {
        const d = object(descriptor, "createBuffer's descriptor")
        const h = handle()
        record(device, ["buffer", h, d.size, d.usage])
        return {
          __kind: "buffer",
          __handle: h,
          __device: device,
          size: d.size,
          usage: d.usage,
          destroy: () => record(device, ["destroy", h]),
        }
      },
      createTexture: (descriptor) => {
        const d = object(descriptor, "createTexture's descriptor")
        const [width, height, depthOrArrayLayers] = extent(d.size)
        const props = {
          width,
          height,
          depthOrArrayLayers,
          format: d.format,
          usage: d.usage,
          mipLevelCount: d.mipLevelCount ?? 1,
          sampleCount: d.sampleCount ?? 1,
          dimension: "2d",
        }
        const h = handle()
        if (d.dimension !== undefined && d.dimension !== "2d")
          record(device, ["error", 'a texture\'s dimension must be "2d"'])
        record(device, [
          "texture",
          h,
          width,
          height,
          depthOrArrayLayers,
          d.format,
          d.usage,
          props.mipLevelCount,
          props.sampleCount,
        ])
        return texture(device, h, props)
      },
      createSampler: (descriptor) => {
        const d = descriptor ?? {}
        const h = handle()
        record(device, [
          "sampler",
          h,
          {
            addressModeU: d.addressModeU ?? "clamp-to-edge",
            addressModeV: d.addressModeV ?? "clamp-to-edge",
            addressModeW: d.addressModeW ?? "clamp-to-edge",
            magFilter: d.magFilter ?? "nearest",
            minFilter: d.minFilter ?? "nearest",
            mipmapFilter: d.mipmapFilter ?? "nearest",
            lodMinClamp: d.lodMinClamp ?? 0,
            lodMaxClamp: d.lodMaxClamp ?? 32,
            compare: d.compare ?? null,
            maxAnisotropy: d.maxAnisotropy ?? 1,
          },
        ])
        return { __kind: "sampler", __handle: h, __device: device }
      },
      createShaderModule: (descriptor) => {
        const h = handle()
        record(device, ["shader", h, object(descriptor, "createShaderModule's descriptor").code])
        return { __kind: "shader", __handle: h, __device: device }
      },
      createBindGroupLayout: (descriptor) => {
        const h = handle()
        const entries = (object(descriptor, "createBindGroupLayout's descriptor").entries ?? []).map((e) => ({
          binding: e.binding,
          visibility: e.visibility,
          buffer: e.buffer
            ? {
                type: e.buffer.type ?? "uniform",
                hasDynamicOffset: e.buffer.hasDynamicOffset ?? false,
                minBindingSize: e.buffer.minBindingSize ?? 0,
              }
            : null,
          sampler: e.sampler ? { type: e.sampler.type ?? "filtering" } : null,
          texture: e.texture
            ? {
                sampleType: e.texture.sampleType ?? "float",
                viewDimension: e.texture.viewDimension ?? "2d",
                multisampled: e.texture.multisampled ?? false,
              }
            : null,
        }))
        record(device, ["bindGroupLayout", h, { entries }])
        return { __kind: "bindGroupLayout", __handle: h, __device: device }
      },
      createPipelineLayout: (descriptor) => {
        const h = handle()
        const layouts = (object(descriptor, "createPipelineLayout's descriptor").bindGroupLayouts ?? []).map((l) =>
          kind(l, "bindGroupLayout", "a bind group layout"),
        )
        record(device, ["pipelineLayout", h, layouts])
        return { __kind: "pipelineLayout", __handle: h, __device: device }
      },
      createBindGroup: (descriptor) => {
        const d = object(descriptor, "createBindGroup's descriptor")
        const h = handle()
        // A buffer, a buffer binding, a sampler or a texture view.
        const resource = (r) =>
          r?.__kind === "sampler"
            ? { sampler: r.__handle }
            : r?.__kind === "view"
              ? { view: r.__handle }
              : r?.__kind === "buffer"
                ? { buffer: r.__handle, offset: 0, size: -1 }
                : {
                    buffer: kind(r?.buffer, "buffer", "a bind group entry's resource"),
                    offset: r.offset ?? 0,
                    size: r.size ?? -1,
                  }
        record(device, [
          "bindGroup",
          h,
          {
            layout: kind(d.layout, "bindGroupLayout", "createBindGroup's layout"),
            entries: (d.entries ?? []).map((e) => ({ binding: e.binding, resource: resource(e.resource) })),
          },
        ])
        return { __kind: "bindGroup", __handle: h, __device: device }
      },
      createRenderPipeline: (descriptor) => {
        const d = object(descriptor, "createRenderPipeline's descriptor")
        const h = handle()
        const vertex = object(d.vertex, "the vertex stage")
        const fragment = d.fragment
        const depth = d.depthStencil
        record(device, [
          "renderPipeline",
          h,
          {
            layout: d.layout === "auto" ? "auto" : kind(d.layout, "pipelineLayout", "the layout"),
            vertex: {
              module: kind(vertex.module, "shader", "the vertex module"),
              entryPoint: vertex.entryPoint ?? null,
              buffers: (vertex.buffers ?? []).map((b) =>
                b
                  ? {
                      arrayStride: b.arrayStride,
                      stepMode: b.stepMode ?? "vertex",
                      attributes: (b.attributes ?? []).map((a) => ({
                        format: a.format,
                        offset: a.offset,
                        shaderLocation: a.shaderLocation,
                      })),
                    }
                  : null,
              ),
            },
            fragment: fragment
              ? {
                  module: kind(fragment.module, "shader", "the fragment module"),
                  entryPoint: fragment.entryPoint ?? null,
                  targets: (fragment.targets ?? []).map((t) =>
                    t
                      ? {
                          format: t.format,
                          blend: t.blend ? { color: component(t.blend.color), alpha: component(t.blend.alpha) } : null,
                          writeMask: t.writeMask ?? 15,
                        }
                      : null,
                  ),
                }
              : null,
            primitive: {
              topology: d.primitive?.topology ?? "triangle-list",
              stripIndexFormat: d.primitive?.stripIndexFormat ?? null,
              frontFace: d.primitive?.frontFace ?? "ccw",
              cullMode: d.primitive?.cullMode ?? "none",
            },
            depthStencil: depth
              ? {
                  format: depth.format,
                  depthWriteEnabled: depth.depthWriteEnabled ?? false,
                  depthCompare: depth.depthCompare ?? "always",
                }
              : null,
            multisample: {
              count: d.multisample?.count ?? 1,
              mask: d.multisample?.mask ?? 4294967295,
              alphaToCoverageEnabled: d.multisample?.alphaToCoverageEnabled ?? false,
            },
          },
        ])
        // `layout: "auto"`'s layouts: one handle per index.
        const layouts = {}
        return {
          __kind: "renderPipeline",
          __handle: h,
          __device: device,
          getBindGroupLayout: (index) => {
            if (layouts[index]) return layouts[index]
            const layout = { __kind: "bindGroupLayout", __handle: handle(), __device: device }
            record(device, ["autoLayout", layout.__handle, h, index])
            layouts[index] = layout
            return layout
          },
        }
      },
      createCommandEncoder: () => encoder(device),
      queue: {
        writeBuffer: (buffer, offset, data, dataOffset, size) => {
          const h = kind(buffer, "buffer", "writeBuffer's buffer")
          if (gpu.available && device === gpu.device)
            gpu.ops.push(["writeBuffer", h, offset, ...append(data, dataOffset, size)])
        },
        writeTexture: (destination, data, layout, size) => {
          const h = kind(destination?.texture, "texture", "writeTexture's texture")
          if (!gpu.available || device !== gpu.device) return
          const skip = layout?.offset ?? 0
          const [byteOffset, byteLength] = append(data)
          gpu.ops.push([
            "writeTexture",
            h,
            destination.mipLevel ?? 0,
            origin(destination.origin),
            byteOffset + skip,
            byteLength - skip,
            layout?.bytesPerRow,
            layout?.rowsPerImage ?? null,
            extent(size),
          ])
        },
        submit: (buffers) => {
          for (const buffer of buffers) {
            kind(buffer, "commandBuffer", "submit's command buffer")
            if (buffer.submitted) {
              record(device, ["error", "a command buffer can be submitted once"])
              continue
            }
            buffer.submitted = true
            if (buffer.ops && gpu.available && device === gpu.device) for (const op of buffer.ops) gpu.ops.push(op)
          }
          record(device, ["submit"])
        },
      },
    }
    return device
  }

  const api = {
    get available() {
      return gpu.available
    },
    getPreferredCanvasFormat: () => gpu.format,
    // One device per widget, until it is lost.
    requestDevice: async () => {
      if (!gpu.device) gpu.device = createDevice()
      return gpu.device
    },
    getContext: (key) => {
      const name = String(key)
      if (contexts[name]) return contexts[name]
      const state = { device: null, handle: 0, texture: null }
      const context = {
        get width() {
          return sizes[name]?.width ?? 0
        },
        get height() {
          return sizes[name]?.height ?? 0
        },
        configure: (configuration) => {
          const c = object(configuration, "configure's configuration")
          kind(c.device, "device", "configure's device")
          // A new device's context is a new handle; configuring again keeps it.
          if (c.device !== state.device) state.handle = handle()
          state.device = c.device
          record(c.device, ["context", state.handle, name, c.format, c.alphaMode ?? "opaque"])
          const props = {
            format: c.format,
            usage: 16,
            mipLevelCount: 1,
            sampleCount: 1,
            depthOrArrayLayers: 1,
            dimension: "2d",
          }
          state.texture = texture(c.device, state.handle, props)
          // The canvas's texture is the client's: destroying it does nothing.
          state.texture.destroy = () => {}
          Object.defineProperty(state.texture, "width", { get: () => context.width })
          Object.defineProperty(state.texture, "height", { get: () => context.height })
        },
        getCurrentTexture: () => {
          if (!state.texture) throw new Error("configure the context before getCurrentTexture")
          return state.texture
        },
      }
      contexts[name] = context
      return context
    },
  }

  return {
    api,
    start: (input) => {
      gpu.available = input?.available === true
      if (input?.format === "bgra8unorm" || input?.format === "rgba8unorm") gpu.format = input.format
    },
    take: () => {
      if (gpu.ops.length === 0) return null
      const batch = { ops: gpu.ops, bytes: gpu.bytes ? gpu.bytes.buffer.slice(0, gpu.length) : new ArrayBuffer(0) }
      gpu.ops = []
      gpu.length = 0
      return batch
    },
    watched: () => gpu.watched && gpu.available && gpu.device !== null,
    accept: (message) => {
      if (message.type === "canvas") {
        sizes[String(message.key)] = { width: message.width, height: message.height }
        return
      }
      if (message.type !== "gpu" || message.lost === undefined || !gpu.device) return
      // Every handle is gone: the lost device's calls record nothing, and `requestDevice` makes a new one.
      const resolve = gpu.lost
      gpu.device = null
      gpu.watched = false
      gpu.ops = []
      gpu.length = 0
      resolve({ reason: message.lost, message: typeof message.message === "string" ? message.message : "" })
    },
  }
}

// Live mode (specs/v2/widgets-live.md): `main(data)` runs once, on the host's `__host.post`, `__host.receive`,
// `__host.sleep`, `__host.now` and `__host.fetch`. While the view has handlers, hooks are registered or a frame is
// awaited, a pump receives client messages and calls handlers and hooks between the program's awaits.
const widget = (() => {
  const hooks = { key: [], focus: [], fullscreen: [], capture: [], resumed: [] }
  const live = {
    frame: null,
    requested: false,
    waiting: [],
    // The last rendered view as built, and whether the host found handlers in it.
    root: undefined,
    interactive: false,
    pumping: false,
    done: false,
    idle: null,
    reject: null,
  }
  const api = {}
  // `widget.gpu`, made for a live run only: steps never pay for it.
  const made = { gpu: null }
  const gpu = () => (made.gpu ??= __widget_gpu(() => pump()))
  const post = (message) => (live.done ? undefined : __host.post(message))
  // The pending GPU batch goes out on its own before any wait on the host but a frame request, which carries it.
  const flush = () => {
    const batch = gpu().take()
    if (batch) post({ type: "gpu", ops: batch.ops, bytes: batch.bytes })
  }
  const wanted = () =>
    !live.done &&
    (live.waiting.length > 0 ||
      live.interactive ||
      gpu().watched() ||
      Object.values(hooks).some((list) => list.length > 0))
  const fail = (error) => live.reject?.(error)
  // Runs a handler or hook; an async one that rejects fails the program like a throw.
  const call = (handler, ...args) => {
    const result = handler(...args)
    if (result && typeof result.then === "function") result.then(undefined, fail)
  }
  const emit = (kind, ...values) => hooks[kind].slice().forEach((hook) => call(hook, ...values))
  const dispatch = (event) => {
    if (event.type === "key") {
      const key = __widget_key(event.value)
      if (!key) return
      if (key.kind === "down") api.keys.add(key.code)
      else api.keys.delete(key.code)
      return emit("key", key)
    }
    if (event.type === "focus") {
      if (event.value !== true) api.keys.clear()
      return emit("focus", event.value === true)
    }
    if (event.type === "fullscreen") return emit("fullscreen", event.value === true, __widget_rect(event.close))
    if (event.type === "capture") return emit("capture", event.value === true)
    // A wheel isn't where the pointer is held: `widget.pointer` keeps the last down, move or up.
    if (event.type === "pointer" && event.value?.kind !== "wheel")
      api.pointer = __widget_pointer(event.value) ?? api.pointer
    const entry = __widget_find(live.root, event.id)
    if (!entry || entry.event !== event.type) return
    const value = __widget_value(entry, event.value)
    if (value === undefined) return
    if (event.type === "press") call(entry.handler)
    else call(entry.handler, value)
  }
  const accept = (message) => {
    if (message.type === "event") return dispatch(message.event ?? {})
    if (message.type === "canvas" || message.type === "gpu") return gpu().accept(message)
    if (message.type === "resumed") return emit("resumed", message.pausedMs)
    if (message.type !== "frame") return
    live.requested = false
    live.frame = message.frame
    // Every waiter gets this frame: one left over from a race (`Promise.race([widget.frame(), ...])`) too.
    const waiting = live.waiting.splice(0)
    if (waiting.length > 0) {
      const frame = take()
      waiting.forEach((resolve) => resolve(frame))
    }
  }
  const pump = async () => {
    if (live.pumping) return
    live.pumping = true
    try {
      while (wanted()) {
        flush()
        accept(await __host.receive())
      }
    } catch (error) {
      fail(error)
    } finally {
      live.pumping = false
      if (!wanted()) live.idle?.()
    }
  }
  const request = () => {
    const batch = gpu().take()
    if (live.requested || live.frame) {
      if (batch) post({ type: "gpu", ops: batch.ops, bytes: batch.bytes })
      return
    }
    live.requested = true
    post(batch ? { type: "frame", gpu: batch } : { type: "frame" })
  }
  const take = () => {
    const frame = live.frame
    live.frame = null
    return frame
  }
  const response = (raw) => {
    const text = raw.body ?? atob(raw.body64 ?? "")
    return {
      ok: raw.status >= 200 && raw.status < 300,
      status: raw.status,
      headers: raw.headers ?? {},
      text: async () => text,
      json: async () => JSON.parse(text),
    }
  }
  Object.assign(api, {
    keys: new Set(),
    pointer: null,
    render: (node) => {
      live.root = node
      try {
        live.interactive = post({ type: "render", node }) === true
      } catch (error) {
        // A view too deep to cross: the host fails the run with the reason.
        if (!__widget_deep([node], 1)) throw error
        post({ type: "render", node: null, failure: __WIDGET_DEEP })
      }
      pump()
    },
    // The host knows the canvases by key, and throws for an unknown one or a GPU canvas.
    draw: (key, commands) =>
      void post({
        type: "draw",
        key: String(key),
        commands: commands instanceof __WidgetDraw ? commands.commands : commands,
      }),
    frame: async () => {
      request()
      if (live.frame) return take()
      const next = new Promise((resolve) => live.waiting.push(resolve))
      pump()
      return next
    },
    on: (kind, hook) => {
      if (!hooks[kind]) throw new Error('widget.on: unknown event "' + kind + '"')
      if (typeof hook !== "function") throw new Error("widget.on needs a function")
      hooks[kind].push(hook)
      pump()
      return () => {
        const index = hooks[kind].indexOf(hook)
        if (index !== -1) hooks[kind].splice(index, 1)
      }
    },
    sleep: (ms) => {
      flush()
      return __host.sleep(ms)
    },
    now: () => __host.now(),
    submit: (value) => {
      post({ type: "submit", value: value ?? null })
      live.done = true
    },
    dismiss: () => {
      post({ type: "dismiss" })
      live.done = true
    },
    fetch: async (url, init) => {
      flush()
      const request = { url: String(url), method: init?.method ?? "GET", headers: init?.headers ?? {} }
      if (init?.body !== undefined) request.body = String(init.body)
      try {
        return response(await __host.fetch(request))
      } catch (error) {
        throw error?.kind ? error : { kind: "Network", message: error?.message ?? String(error) }
      }
    },
    send: (value, options) => post({ type: "send", value: value ?? null, wake: options?.wake !== false }),
    capturePointer: () => post({ type: "capture", value: true }),
    releasePointer: () => post({ type: "capture", value: false }),
  })
  Object.defineProperty(api, "gpu", { get: () => gpu().api, enumerable: true })
  // Runs `main`, then keeps the widget interactive while its view has handlers or hooks are registered.
  // `gpu`: the live input's `{ available, format }` (specs/v2/widgets-gpu.md), none without a GPU.
  api.__run = async (data, gpuInput) => {
    gpu().start(gpuInput)
    const failed = new Promise((_, reject) => (live.reject = reject))
    failed.catch(() => {})
    await Promise.race([main(data), failed])
    flush()
    if (!wanted()) return
    await Promise.race([new Promise((resolve) => (live.idle = resolve)), failed])
  }
  return api
})()

// Hosts run `return await __widget_live(__input(), true)` (specs/v2/widgets.md, Native hosts).
async function __widget_live(input) {
  await widget.__run(input.data, input.gpu)
  return null
}
