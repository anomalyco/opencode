// A rotating, lit, depth-tested cube (widgets-gpu.md). `data.frames`: stop after that many frames (fixtures).
const SHADER = `
struct Uniforms { mvp: mat4x4f, model: mat4x4f }
@group(0) @binding(0) var<uniform> u: Uniforms;

struct Out { @builtin(position) position: vec4f, @location(0) normal: vec3f }

@vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> Out {
  var out: Out;
  out.position = u.mvp * vec4f(position, 1.0);
  out.normal = (u.model * vec4f(normal, 0.0)).xyz;
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let light = normalize(vec3f(0.4, 0.8, 0.6));
  let lit = 0.2 + 0.8 * max(dot(normalize(in.normal), light), 0.0);
  return vec4f(vec3f(0.3, 0.6, 1.0) * lit, 1.0);
}
`

// Column-major 4x4 matrices, as WGSL reads them.
function multiply(a, b) {
  const out = new Float32Array(16)
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k]
      out[column * 4 + row] = sum
    }
  return out
}

// A perspective projection to WebGPU's depth range, 0 to 1.
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2)
  // prettier-ignore
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0])
}

function rotation(x, y) {
  const [cx, sx, cy, sy] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y)]
  return new Float32Array([cy, sx * sy, -cx * sy, 0, 0, cx, sx, 0, sy, -sx * cy, cx * cy, 0, 0, 0, 0, 1])
}

const translation = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])

// Each face: its normal and its 4 corners; 24 vertices of position and normal, 36 indices.
function cube() {
  // prettier-ignore
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ]
  const vertices = []
  const indices = []
  faces.forEach(([normal, corners], face) => {
    corners.forEach((corner) => vertices.push(...corner, ...normal))
    const at = face * 4
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3)
  })
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) }
}

async function main(data) {
  widget.render(ui.canvas({ key: "cube", gpu: true, height: 240, alt: "A rotating cube" }))
  const device = await widget.gpu.requestDevice()
  const context = widget.gpu.getContext("cube")
  const format = widget.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: "opaque" })

  const mesh = cube()
  const vertices = device.createBuffer({
    size: mesh.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(vertices, 0, mesh.vertices)
  const indices = device.createBuffer({
    size: mesh.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(indices, 0, mesh.indices)
  const uniforms = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

  const module = device.createShaderModule({ code: SHADER })
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: 24,
          attributes: [
            { format: "float32x3", offset: 0, shaderLocation: 0 },
            { format: "float32x3", offset: 12, shaderLocation: 1 },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  })

  const depth = { texture: null, width: 0, height: 0 }
  for (let frame = 0; data?.frames === undefined || frame < data.frames; frame++) {
    const { t, width, height, scale } = await widget.frame()
    const w = context.width || Math.round(width * scale)
    const h = context.height || Math.round(height * scale)
    // The depth texture follows the canvas's size.
    if (depth.width !== w || depth.height !== h) {
      depth.texture?.destroy()
      depth.texture = device.createTexture({
        size: [w, h],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
      Object.assign(depth, { width: w, height: h })
    }
    const model = rotation(t * 0.7, t)
    const mvp = multiply(perspective(Math.PI / 4, w / h, 0.1, 100), multiply(translation(0, 0, -6), model))
    const matrices = new Float32Array(32)
    matrices.set(mvp, 0)
    matrices.set(model, 16)
    device.queue.writeBuffer(uniforms, 0, matrices)

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0.05, 0.05, 0.08, 1],
        },
      ],
      depthStencilAttachment: {
        view: depth.texture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.setVertexBuffer(0, vertices)
    pass.setIndexBuffer(indices, "uint16")
    pass.drawIndexed(36)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
}
