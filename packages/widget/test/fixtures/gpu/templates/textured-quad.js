// A quad with a texture built in script: a checkerboard with a gradient, sampled with linear filtering and repeat.
// `data.frames`: stop after that many frames (fixtures).
const SHADER = `
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f }

@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1));
  let corner = corners[index];
  var out: Out;
  out.position = vec4f(corner * 0.8, 0.0, 1.0);
  out.uv = (corner * vec2f(0.5, -0.5) + 0.5) * 2.0;
  return out;
}

@group(0) @binding(0) var linear: sampler;
@group(0) @binding(1) var image: texture_2d<f32>;

@fragment fn fs(in: Out) -> @location(0) vec4f {
  return textureSample(image, linear, in.uv);
}
`

// 64 x 64 RGBA pixels: 8-pixel squares, tinted by position.
function checkerboard(size) {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const on = ((x >> 3) + (y >> 3)) % 2 === 0
      const at = (y * size + x) * 4
      pixels[at] = on ? 255 : Math.round((x / size) * 255)
      pixels[at + 1] = on ? 255 : 64
      pixels[at + 2] = on ? 255 : Math.round((y / size) * 255)
      pixels[at + 3] = 255
    }
  return pixels
}

async function main(data) {
  widget.render(ui.canvas({ key: "quad", gpu: true, height: 200, alt: "A textured quad" }))
  const device = await widget.gpu.requestDevice()
  const context = widget.gpu.getContext("quad")
  const format = widget.gpu.getPreferredCanvasFormat()
  context.configure({ device, format })

  const size = 64
  const texture = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture({ texture }, checkerboard(size), { bytesPerRow: size * 4 }, [size, size])
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
  })

  const module = device.createShaderModule({ code: SHADER })
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
  })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: texture.createView() },
    ],
  })

  for (let frame = 0; data?.frames === undefined || frame < data.frames; frame++) {
    await widget.frame()
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.draw(6)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
}
