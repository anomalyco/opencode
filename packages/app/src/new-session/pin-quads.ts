// Draws a pin board layer as a list of filled parallelograms. With WebGL2 the whole list is at most two
// instanced draws, so a frame costs about the same however many pins there are. A 2D canvas spends a
// GPU draw call on most shapes, which kept weak machines busy. Without hardware WebGL2 it falls back to one 2D
// path fill per run of same-coloured quads, as drawing straight to the canvas would.

export type Rgba = readonly [number, number, number, number]
export type Quads = ReturnType<typeof createQuads>

type Region = { x: number; y: number; w: number; h: number }

const FLOATS = 10

const VERTEX = `#version 300 es
in vec2 corner;
in vec2 origin;
in vec2 u;
in vec2 v;
in vec4 color;
uniform vec2 view;
uniform vec2 size;
uniform float scale;
out vec2 st;
out vec2 span;
out vec4 tint;
void main() {
  vec2 du = u * scale;
  vec2 dv = v * scale;
  float area = max(abs(du.x * dv.y - du.y * dv.x), 1e-4);
  // span is the quad's width across each pair of edges in device pixels; the quad grows a pixel
  // past every edge so partly covered pixels get drawn.
  span = vec2(area / max(length(dv), 1e-4), area / max(length(du), 1e-4));
  st = mix(-1.0 / span, 1.0 + 1.0 / span, corner);
  vec2 p = (origin - view) * scale + du * st.x + dv * st.y;
  gl_Position = vec4(p.x / size.x * 2.0 - 1.0, 1.0 - p.y / size.y * 2.0, 0.0, 1.0);
  tint = color;
}`

// Coverage is the overlap of the pixel with the quad along each axis, which is exact for axis-aligned rects.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 st;
in vec2 span;
in vec4 tint;
out vec4 outColor;
void main() {
  vec2 d = st * span;
  vec2 c = clamp(min(d + 0.5, span) - max(d - 0.5, 0.0), 0.0, 1.0);
  outColor = tint * (c.x * c.y);
}`

export function createQuads(canvas: HTMLCanvasElement, restored: () => void) {
  // Each quad's colour is also kept as given, for the 2D fallback.
  const data = { list: new Float32Array(FLOATS * 1024), tints: [] as Rgba[], count: 0, shadows: 0 }
  // The context is created on first draw, so a layer that never shows pins never holds one.
  const surface: {
    current?: { gl: WebGL2RenderingContext; gpu: ReturnType<typeof setup> } | { ctx: CanvasRenderingContext2D }
  } = {}
  const styles = new WeakMap<Rgba, string>()

  const push = (x: number, y: number, ux: number, uy: number, vx: number, vy: number, c: Rgba) => {
    if ((data.count + 1) * FLOATS > data.list.length) {
      const grown = new Float32Array(data.list.length * 2)
      grown.set(data.list)
      data.list = grown
    }
    const list = data.list
    data.tints[data.count] = c
    const i = data.count++ * FLOATS
    const a = c[3]
    list[i] = x
    list[i + 1] = y
    list[i + 2] = ux
    list[i + 3] = uy
    list[i + 4] = vx
    list[i + 5] = vy
    list[i + 6] = (c[0] / 255) * a
    list[i + 7] = (c[1] / 255) * a
    list[i + 8] = (c[2] / 255) * a
    list[i + 9] = a
  }

  return {
    begin() {
      data.count = 0
      data.shadows = 0
    },
    /** Shadows, all in one colour, go first and merge where they overlap instead of darkening. */
    shadow(x: number, y: number, w: number, h: number, c: Rgba) {
      push(x, y, w, 0, 0, h, c)
      data.shadows = data.count
    },
    rect(x: number, y: number, w: number, h: number, c: Rgba) {
      push(x, y, w, 0, 0, h, c)
    },
    /** The parallelogram with a corner at (x, y) and edges u and v. */
    quad(x: number, y: number, ux: number, uy: number, vx: number, vy: number, c: Rgba) {
      push(x, y, ux, uy, vx, vy, c)
    },
    draw(region: Region, scale: number) {
      surface.current ??= open()
      if ("gl" in surface.current) return drawGL(surface.current.gl, surface.current.gpu, region, scale)
      drawCanvas(surface.current.ctx, region, scale)
    },
    dispose() {
      const current = surface.current
      if (!current || !("gl" in current)) return
      // Losing the context in the frame the canvas leaves the page lets the compositor redraw the last
      // frame from a released buffer, which some GPUs show as a one-frame white flash. Drop it once the
      // canvas is gone instead.
      setTimeout(() => current.gl.getExtension("WEBGL_lose_context")?.loseContext(), 250)
    },
  }

  function open() {
    // Software WebGL is refused: the browser would read every frame back to composite it, which costs more than 2D.
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      failIfMajorPerformanceCaveat: true,
    })
    if (gl) return { gl, gpu: setup(gl) }
    return { ctx: canvas.getContext("2d")! }
  }

  function drawGL(gl: WebGL2RenderingContext, gpu: ReturnType<typeof setup>, region: Region, scale: number) {
    if (gl.isContextLost()) return
    if (!gpu.ready) gpu.init()
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!data.count) return
    gl.useProgram(gpu.program)
    gl.bindVertexArray(gpu.vao)
    gl.uniform2f(gpu.view, region.x, region.y)
    gl.uniform2f(gpu.size, canvas.width, canvas.height)
    gl.uniform1f(gpu.scale, scale)
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.instances)
    // The GPU buffer is reused across frames and only reallocated when the quad list outgrows it.
    if (gpu.capacity < data.list.length) {
      gpu.capacity = data.list.length
      gl.bufferData(gl.ARRAY_BUFFER, gpu.capacity * 4, gl.DYNAMIC_DRAW)
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.list, 0, data.count * FLOATS)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (data.shadows) {
      gl.blendEquation(gl.MAX)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.shadows)
    }
    gl.blendEquation(gl.FUNC_ADD)
    if (data.count > data.shadows) {
      gpu.offset(data.shadows)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.count - data.shadows)
      gpu.offset(0)
    }
  }

  // Each run of quads in one colour is one path fill. The board emits quads grouped by colour, so this makes
  // about as many fills as drawing straight to the canvas would. A shared path also merges overlapping shadows.
  function drawCanvas(ctx: CanvasRenderingContext2D, region: Region, scale: number) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale)
    const list = data.list
    for (let n = 0; n < data.count; ) {
      const c = data.tints[n]
      ctx.fillStyle = styles.get(c) ?? styles.set(c, `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`).get(c)!
      ctx.beginPath()
      for (; n < data.count && data.tints[n] === c; n++) {
        const i = n * FLOATS
        const x = list[i]
        const y = list[i + 1]
        if (list[i + 3] === 0 && list[i + 4] === 0) {
          ctx.rect(x, y, list[i + 2], list[i + 5])
          continue
        }
        ctx.moveTo(x, y)
        ctx.lineTo(x + list[i + 2], y + list[i + 3])
        ctx.lineTo(x + list[i + 2] + list[i + 4], y + list[i + 3] + list[i + 5])
        ctx.lineTo(x + list[i + 4], y + list[i + 5])
        ctx.closePath()
      }
      ctx.fill()
    }
  }
  // GPU objects are rebuilt after the context is lost and restored.
  function setup(gl: WebGL2RenderingContext) {
    const gpu = {
      ready: false,
      capacity: 0,
      program: null as WebGLProgram | null,
      vao: null as WebGLVertexArrayObject | null,
      instances: null as WebGLBuffer | null,
      view: null as WebGLUniformLocation | null,
      size: null as WebGLUniformLocation | null,
      scale: null as WebGLUniformLocation | null,
      attributes: [] as { at: number; size: number; offset: number }[],
      init() {
        const program = gl.createProgram()!
        for (const [type, source] of [
          [gl.VERTEX_SHADER, VERTEX],
          [gl.FRAGMENT_SHADER, FRAGMENT],
        ] as const) {
          const shader = gl.createShader(type)!
          gl.shaderSource(shader, source)
          gl.compileShader(shader)
          gl.attachShader(program, shader)
        }
        gl.linkProgram(program)
        gpu.program = program
        gpu.view = gl.getUniformLocation(program, "view")
        gpu.size = gl.getUniformLocation(program, "size")
        gpu.scale = gl.getUniformLocation(program, "scale")
        gpu.vao = gl.createVertexArray()
        gl.bindVertexArray(gpu.vao)
        const corners = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, corners)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
        const corner = gl.getAttribLocation(program, "corner")
        gl.enableVertexAttribArray(corner)
        gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
        gpu.instances = gl.createBuffer()
        gpu.capacity = 0
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.instances)
        gpu.attributes = [
          { at: gl.getAttribLocation(program, "origin"), size: 2, offset: 0 },
          { at: gl.getAttribLocation(program, "u"), size: 2, offset: 2 },
          { at: gl.getAttribLocation(program, "v"), size: 2, offset: 4 },
          { at: gl.getAttribLocation(program, "color"), size: 4, offset: 6 },
        ]
        for (const a of gpu.attributes) {
          gl.enableVertexAttribArray(a.at)
          gl.vertexAttribDivisor(a.at, 1)
        }
        gpu.offset(0)
        gpu.ready = true
      },
      // Points the per-quad attributes at the given first quad, so one buffer serves both draws.
      offset(first: number) {
        for (const a of gpu.attributes)
          gl.vertexAttribPointer(a.at, a.size, gl.FLOAT, false, FLOATS * 4, (first * FLOATS + a.offset) * 4)
      },
    }
    canvas.addEventListener("webglcontextlost", (event) => event.preventDefault())
    canvas.addEventListener("webglcontextrestored", () => {
      gpu.ready = false
      restored()
    })
    return gpu
  }
}
