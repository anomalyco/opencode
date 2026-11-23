// A first-person maze: walls as a few hundred instanced boxes, WASD to walk, a click captures the pointer for
// mouse-look; on touch, drag to look and hold still to walk. A HUD in a stack over the canvas. `data.frames`: stop
// after that many frames (fixtures).
const SHADER = `
struct Uniforms { viewProjection: mat4x4f, eye: vec4f }
@group(0) @binding(0) var<uniform> u: Uniforms;

struct Out { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) world: vec3f, @location(2) tint: f32 }

@vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) offset: vec3f, @location(3) size: vec3f) -> Out {
  let world = position * size + offset;
  var out: Out;
  out.position = u.viewProjection * vec4f(world, 1.0);
  out.normal = normal;
  out.world = world;
  out.tint = select(1.0, 0.55, size.y < 0.5);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let light = normalize(vec3f(0.3, 1.0, 0.5));
  let lit = 0.35 + 0.65 * max(dot(in.normal, light), 0.0);
  let fog = clamp(distance(in.world, u.eye.xyz) / 14.0, 0.0, 1.0);
  let color = vec3f(0.85, 0.75, 0.6) * in.tint * lit;
  return vec4f(mix(color, vec3f(0.08, 0.09, 0.12), fog), 1.0);
}
`

const SIZE = 21

// A maze of SIZE x SIZE cells (true: wall), carved by a depth-first walk from a seeded generator.
function maze(seed) {
  let state = seed
  const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  const walls = Array.from({ length: SIZE }, () => Array(SIZE).fill(true))
  const stack = [[1, 1]]
  walls[1][1] = false
  while (stack.length > 0) {
    const [x, z] = stack[stack.length - 1]
    const next = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ]
      .map(([dx, dz]) => [x + dx, z + dz, dx, dz])
      .filter(([nx, nz]) => nx > 0 && nz > 0 && nx < SIZE - 1 && nz < SIZE - 1 && walls[nz][nx])
    if (next.length === 0) {
      stack.pop()
      continue
    }
    const [nx, nz, dx, dz] = next[Math.floor(random() * next.length)]
    walls[z + dz / 2][x + dx / 2] = false
    walls[nz][nx] = false
    stack.push([nx, nz])
  }
  return walls
}

// A unit box: 24 vertices of position and normal, 36 indices.
function box() {
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
    corners.forEach((corner) => vertices.push(...corner.map((c) => c / 2), ...normal))
    indices.push(face * 4, face * 4 + 1, face * 4 + 2, face * 4, face * 4 + 2, face * 4 + 3)
  })
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) }
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0]
}

// The view matrix of an eye at `eye` looking along yaw and pitch.
function view(eye, yaw, pitch) {
  const forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]
  const right = [Math.cos(yaw), 0, Math.sin(yaw)]
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  const dot = (a) => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2]
  // prettier-ignore
  return [right[0], up[0], -forward[0], 0, right[1], up[1], -forward[1], 0, right[2], up[2], -forward[2], 0, -dot(right), -dot(up), dot(forward), 1]
}

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

async function main(data) {
  const walls = maze(7)
  const open = (x, z) => !walls[Math.floor(z)]?.[Math.floor(x)]
  // Start facing down the corridor out of the corner: east if it's open, else south.
  const player = { x: 1.5, z: 1.5, yaw: open(2.5, 1.5) ? Math.PI / 2 : Math.PI, pitch: 0, captured: false }
  // The touch (or uncaptured mouse button) held: where it started and was last; once 8 px from the start, it's a drag.
  let touch = null
  const look = (dx, dy, speed) => {
    player.yaw += dx * speed
    player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - dy * speed))
  }
  const hud = () =>
    widget.render(
      ui.stack([
        ui.canvas({
          key: "maze",
          gpu: true,
          height: 360,
          place: "fill",
          alt: "A first-person maze",
          // Under pointer capture, moves are relative: they turn the camera. Without it (touch never captures), a
          // drag turns it and a touch held still walks.
          onPointer: (p) => {
            if (p.dx !== undefined) return look(p.dx, p.dy, 0.004)
            if (p.kind === "down") {
              touch = { startX: p.x, startY: p.y, x: p.x, y: p.y, dragged: false }
              if (!player.captured) widget.capturePointer()
            } else if (p.kind === "move" && touch) {
              look(p.x - touch.x, p.y - touch.y, 0.008)
              touch.dragged ||= Math.hypot(p.x - touch.startX, p.y - touch.startY) > 8
              Object.assign(touch, { x: p.x, y: p.y })
            } else if (p.kind === "up") touch = null
          },
        }),
        ui.text(player.captured ? "WASD to walk, Esc to let go" : "Click or drag to look, hold to walk", {
          place: "top-left",
          inset: 8,
        }),
      ]),
    )
  widget.on("capture", (captured) => {
    player.captured = captured
    hud()
  })
  hud()

  const device = await widget.gpu.requestDevice()
  const context = widget.gpu.getContext("maze")
  const format = widget.gpu.getPreferredCanvasFormat()
  context.configure({ device, format })

  // One instance per wall cell, and one flat one for the floor: offset and size.
  const instances = []
  walls.forEach((row, z) => row.forEach((wall, x) => wall && instances.push(x + 0.5, 0.5, z + 0.5, 1, 1, 1)))
  instances.push(SIZE / 2, -0.05, SIZE / 2, SIZE, 0.1, SIZE)
  const instanceData = new Float32Array(instances)
  const mesh = box()
  const make = (array, usage) => {
    const buffer = device.createBuffer({ size: array.byteLength, usage: usage | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(buffer, 0, array)
    return buffer
  }
  const vertices = make(mesh.vertices, GPUBufferUsage.VERTEX)
  const indices = make(mesh.indices, GPUBufferUsage.INDEX)
  const instanceBuffer = make(instanceData, GPUBufferUsage.VERTEX)
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

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
        {
          arrayStride: 24,
          stepMode: "instance",
          attributes: [
            { format: "float32x3", offset: 0, shaderLocation: 2 },
            { format: "float32x3", offset: 12, shaderLocation: 3 },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  })

  const depth = { texture: null, width: 0, height: 0 }
  for (let frame = 0; data?.frames === undefined || frame < data.frames; frame++) {
    const { dt, width, height, scale } = await widget.frame()
    // Walk, sliding along walls: each axis moves only into open cells, keeping 0.2 from them.
    const keys = widget.keys
    const held = touch && !touch.dragged ? 1 : 0
    const ahead = Math.min(1, (keys.has("KeyW") ? 1 : 0) + held) - (keys.has("KeyS") ? 1 : 0)
    const side = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0)
    const speed = 2.5 * dt
    const dx = (Math.sin(player.yaw) * ahead + Math.cos(player.yaw) * side) * speed
    const dz = (-Math.cos(player.yaw) * ahead + Math.sin(player.yaw) * side) * speed
    if (open(player.x + dx + Math.sign(dx) * 0.2, player.z)) player.x += dx
    if (open(player.x, player.z + dz + Math.sign(dz) * 0.2)) player.z += dz

    const w = context.width || Math.round(width * scale)
    const h = context.height || Math.round(height * scale)
    if (depth.width !== w || depth.height !== h) {
      depth.texture?.destroy()
      depth.texture = device.createTexture({
        size: [w, h],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
      Object.assign(depth, { width: w, height: h })
    }
    const eye = [player.x, 0.6, player.z]
    const matrices = new Float32Array(20)
    matrices.set(multiply(perspective(1.2, w / h, 0.05, 50), view(eye, player.yaw, player.pitch)), 0)
    matrices.set([...eye, 1], 16)
    device.queue.writeBuffer(uniforms, 0, matrices)

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0.08, 0.09, 0.12, 1],
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
    pass.setVertexBuffer(1, instanceBuffer)
    pass.setIndexBuffer(indices, "uint16")
    pass.drawIndexed(36, instances.length / 6)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
}
