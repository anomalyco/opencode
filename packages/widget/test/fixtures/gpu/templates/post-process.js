// Render to a texture, then post-process it onto the canvas: a spinning triangle drawn offscreen, shown through a
// vignette with a chromatic offset. `data.frames`: stop after that many frames (fixtures).
const SCENE = `
@group(0) @binding(0) var<uniform> angle: vec4f;

struct Out { @builtin(position) position: vec4f, @location(0) color: vec3f }

@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  let a = angle.x + f32(index) * 2.0943951;
  var out: Out;
  out.position = vec4f(cos(a) * 0.7, sin(a) * 0.7, 0.0, 1.0);
  var colors = array<vec3f, 3>(vec3f(1, 0.3, 0.2), vec3f(0.2, 1, 0.4), vec3f(0.3, 0.4, 1));
  out.color = colors[index];
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}
`

const POST = `
@group(0) @binding(0) var linear: sampler;
@group(0) @binding(1) var scene: texture_2d<f32>;

struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f }

// One triangle that covers the screen.
@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: Out;
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let offset = (in.uv - 0.5) * 0.01;
  let r = textureSample(scene, linear, in.uv + offset).r;
  let g = textureSample(scene, linear, in.uv).g;
  let b = textureSample(scene, linear, in.uv - offset).b;
  let vignette = 1.0 - dot(in.uv - 0.5, in.uv - 0.5) * 1.5;
  return vec4f(vec3f(r, g, b) * vignette, 1.0);
}
`

async function main(data) {
  widget.render(ui.canvas({ key: "post", gpu: true, height: 220, alt: "A post-processed triangle" }))
  const device = await widget.gpu.requestDevice()
  const context = widget.gpu.getContext("post")
  const format = widget.gpu.getPreferredCanvasFormat()
  context.configure({ device, format })

  const sceneModule = device.createShaderModule({ code: SCENE })
  const scenePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: sceneModule, entryPoint: "vs" },
    fragment: { module: sceneModule, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
  })
  const angle = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const sceneGroup = device.createBindGroup({
    layout: scenePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: angle } }],
  })

  const postModule = device.createShaderModule({ code: POST })
  const postPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: postModule, entryPoint: "vs" },
    fragment: { module: postModule, entryPoint: "fs", targets: [{ format }] },
  })
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" })

  // The offscreen texture and its bind group follow the canvas's size.
  const target = { texture: null, group: null, width: 0, height: 0 }
  for (let frame = 0; data?.frames === undefined || frame < data.frames; frame++) {
    const { t, width, height, scale } = await widget.frame()
    const w = context.width || Math.round(width * scale)
    const h = context.height || Math.round(height * scale)
    if (target.width !== w || target.height !== h) {
      target.texture?.destroy()
      target.texture = device.createTexture({
        size: [w, h],
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
      target.group = device.createBindGroup({
        layout: postPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: target.texture.createView() },
        ],
      })
      Object.assign(target, { width: w, height: h })
    }
    device.queue.writeBuffer(angle, 0, new Float32Array([t, 0, 0, 0]))

    const encoder = device.createCommandEncoder()
    const scene = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.texture.createView(), loadOp: "clear", storeOp: "store", clearValue: [0.1, 0.1, 0.12, 1] },
      ],
    })
    scene.setPipeline(scenePipeline)
    scene.setBindGroup(0, sceneGroup)
    scene.draw(3)
    scene.end()
    const post = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" }],
    })
    post.setPipeline(postPipeline)
    post.setBindGroup(0, target.group)
    post.draw(3)
    post.end()
    device.queue.submit([encoder.finish()])
  }
}
