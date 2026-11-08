# Shader source authoring

Use this reference when producing the complete `main.ts` replacement passed to `update_shader` as `{ path: "main.ts", content: "..." }`. This MCP workflow cannot replace `features.json` directly, but `update_shader.metadata.isAnimated` and `update_shader.metadata.usesMouse` update its capability fields.

## Contents

- [Plan before writing](#plan-before-writing)
- [Required module contract](#required-module-contract)
- [Runtime lifecycle](#runtime-lifecycle)
- [Animation and mouse input](#animation-and-mouse-input)
- [WebGPU patterns](#webgpu-patterns)
- [Controls and parameters](#controls-and-parameters)
- [Effect and fill contracts](#effect-and-fill-contracts)
- [WGSL rules](#wgsl-rules)
- [Pre-build checklist](#pre-build-checklist)

## Plan before writing

Resolve these pieces together before coding:

1. Kind: `effect` or `fill`.
2. Visible controls: names, types, defaults, ranges, units, and which values stay hardcoded.
3. Capabilities: whether the source reads time or mouse input and which metadata flags that requires.
4. GPU resources: shader modules, buffers, samplers, textures, layouts, and passes.
5. Bindings: every WGSL binding must match the JavaScript bind group.
6. Uniform layout: field order, padding, and total byte size.
7. Alpha contract: premultiplied for effects, straight for fills.

Do not write until the controls, uniforms, WGSL bindings, and JavaScript resources agree.

## Required module contract

Author valid TypeScript. The build runs TypeScript and ESLint in process, so type annotations and normal function-local declarations are supported.

```javascript
import { defineProperties } from "figma:shaders"

export default function Effect() {}

export function setup(device, frame) {
  // Compile shader modules and allocate format-independent GPU resources.
  // Store persistent values on frame.state.
}

export function render(device, frame) {
  // Read frame.params, write uniforms, encode passes, and submit.
}

defineProperties(Effect, {
  // User-editable controls.
})
```

Rules:

- The only allowed import is `defineProperties` from `figma:shaders`.
- Keep `defineProperties` at module scope.
- Do not declare module-scope `var`, `let`, or `const`; the runtime strips top-level declarations and the build rejects them. Put runtime constants inside `setup`/`render` or on `frame.state`.
- Shader entry points are `vs_main` and `fs_main`; compute conventionally uses `main`.
- Every complete WGSL module string begins with `diagnostic(off,derivative_uniformity);` as its first non-empty declaration.
- Uniform buffer sizes are multiples of 16 bytes.
- Buffers written by `queue.writeBuffer` need `GPUBufferUsage.COPY_DST`.
- Textures written by `writeTexture` need `GPUTextureUsage.COPY_DST`.
- Build pipelines lazily in `render()` and cache them by `frame.output.format`. Never hardcode `rgba8unorm`.

## Runtime lifecycle

`device` is a real `GPUDevice`. `frame` provides:

| Field | Meaning |
| --- | --- |
| `frame.input` | Input `GPUTexture` or `null`. Effects may sample it; fills must not. |
| `frame.output` | Target texture. Render into `frame.output.createView()`. |
| `frame.params` | Values declared by `defineProperties`. |
| `frame.state` | Persistent mutable bag for modules, buffers, samplers, layouts, and pipelines. |
| `frame.time` | Absolute animation clock in milliseconds. |
| `frame.deltaTime` | Milliseconds since the previous rendered frame. |
| `frame.frame` | Zero-based rendered-frame counter. |
| `frame.mousePosition` | Layer-local mouse position. |

Use `frame.output.width` and `frame.output.height` for dimensions. Allocate format-independent resources once in `setup`. Write live params into buffers and construct input-dependent bind groups in `render`, because the input texture may be recreated.

Available JavaScript includes WebGPU enums, `Float32Array`, integer typed arrays, `Math`, collections, JSON, and promises. There is no DOM, `window`, `document`, `navigator`, `fetch`, console, timer, animation-frame, microtask, `Float64Array`, or `Float16Array`. Use `Math.sin`, `Math.max`, and similar JavaScript forms—not bare WGSL-style math in JavaScript.

## Animation and mouse input

Animation and mouse-driven shaders require source and manifest metadata to agree:

- If the source reads `frame.time`, `frame.deltaTime`, or `frame.frame`, pass `metadata: { isAnimated: true }` to `update_shader`.
- If the source reads `frame.mousePosition`, pass `metadata: { usesMouse: true }`.
- When removing the last use of one capability, pass its metadata value as `false`. Omitted metadata preserves the existing manifest value.

Prefer the absolute `frame.time` clock over accumulating `frame.deltaTime` in `frame.state`; absolute time remains stable when rendering skips frames.

`frame.mousePosition.x` and `.y` are local layer pixels. Normalize coordinates against the output dimensions when the visual should resize with the layer.

## WebGPU patterns

Prefer a six-vertex fullscreen quad with interleaved clip-space position and UV:

```javascript
frame.state.quad = device.createBuffer({
  size: 6 * 4 * 4,
  usage: GPUBufferUsage.VERTEX,
  mappedAtCreation: true,
})
new Float32Array(frame.state.quad.getMappedRange()).set([
  -1, -1, 0, 1,  1, -1, 1, 1,  -1, 1, 0, 0,
  -1, 1, 0, 0,   1, -1, 1, 1,   1, 1, 1, 0,
])
frame.state.quad.unmap()
```

Its vertex layout is:

```javascript
buffers: [{
  arrayStride: 16,
  attributes: [
    { shaderLocation: 0, format: "float32x2", offset: 0 },
    { shaderLocation: 1, format: "float32x2", offset: 8 },
  ],
}]
```

Create the render pipeline only when the output format changes:

```javascript
if (frame.state.pipelineFormat !== frame.output.format) {
  frame.state.pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: frame.state.shaderModule,
      entryPoint: "vs_main",
      buffers: [{
        arrayStride: 16,
        attributes: [
          { shaderLocation: 0, format: "float32x2", offset: 0 },
          { shaderLocation: 1, format: "float32x2", offset: 8 },
        ],
      }],
    },
    fragment: {
      module: frame.state.shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: frame.output.format }],
    },
    primitive: { topology: "triangle-list" },
  })
  frame.state.pipelineFormat = frame.output.format
}
```

Allocate uniform buffers once and write them every render. Prefer `vec4f` slots so padding is explicit:

```javascript
frame.state.uniforms = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(
  frame.state.uniforms,
  0,
  new Float32Array([frame.params.amount, frame.output.width, frame.output.height, 0]),
)
```

Build bind groups that contain `frame.input` each render. If compute feeds render, encode both passes on one command encoder before submitting.

## Controls and parameters

Expose values users will tune per layer. Keep implementation details hardcoded inside `setup` or `render`; do not invent module-scope constants.

| Type | Use | Important shape |
| --- | --- | --- |
| `boolean` | On/off behavior | `{ type: "boolean", defaultValue: true }` |
| `string` | Genuine free text only | `{ type: "string", defaultValue: "Hello" }` |
| `number` slider | Bounded continuous value | Include `min`, `max`, `step`, `control: "slider"` |
| `number` input | Free numeric value | `control: "input"`, optional `unit` |
| numeric select | Modes/presets | `control: "select"`, numeric option values `0,1,2...` |
| `color` | RGBA control | Channels are normalized `0..1` |
| `gradient` | Two-to-eight color stops | Ordered positions `0..1`; pack a fixed eight-stop uniform plus count |
| `point` | Center/origin | Prefer `mode: "canvas_and_ui"`, `unit: "%"` |
| `point-radius` | Center plus radius | Radius percent is relative to the smaller layer dimension |
| `point-point-line` | Two endpoints | Prefer percent units for resize-relative geometry |
| `point-angle-radius` | Polar control | Angle is degrees |
| `color-point` | Coupled position and color | Prefer over separate controls for one visual feature |

Dropdowns must be numeric selects. Do not use a string with `control: "select"`; it becomes unstable after edits.

Percent positions are layer-relative and should be divided by 100 for UVs. Pixel values are absolute local pixels and do not scale with layer resizing.

## Effect and fill contracts

### Effects

- Guard `frame.input == null` before calling `createView()`.
- Input and output use premultiplied alpha. When changing opacity, scale the full RGBA value, not alpha alone.
- Clamp offset UVs before sampling unless transparent out-of-bounds reads are intentional.

```wgsl
let opacity = 0.5;
color *= opacity;
```

### Fills

- Do not bind or sample `frame.input`.
- Output uses straight alpha. Scale only the alpha channel when changing opacity.

```wgsl
let opacity = 0.5;
color.a *= opacity;
```

## WGSL rules

- `let` is immutable; use `var` for mutated values and accumulators.
- Do not use function-scope `const`.
- Do not assign multi-component swizzles. Replace the entire vector.
- Array literals use `array(v1, v2)`, not `[v1, v2]`.
- Matrices are constructed from columns.
- `select(falseValue, trueValue, condition)` uses the opposite ordering from a C ternary.
- Avoid reserved or ambiguous names such as `texture`, `sampler`, `sample`, `min`, `max`, `meta`, and WGSL keywords.
- Use WGSL builtins such as `@builtin(position)`; never use GLSL `gl_*` names.
- Use `textureSample` for filtered normalized UV sampling and `textureLoad` for integer texels.
- `textureSample`, derivatives, and gathers must execute in uniform control flow. For a sample needed inside a per-fragment branch, sample first and use `select`, or use `textureSampleLevel(..., 0.0)`/`textureLoad` deliberately.
- Fixed-bound loops are preferable. Avoid per-pixel loop bounds or breaks around implicit-derivative sampling.

## Pre-build checklist

Before calling `update_shader` with `files: [{ path: "main.ts", content: source }]`, check:

1. Kind matches the existing resource.
2. Source is the complete module, not a diff.
3. `metadata.isAnimated` matches any use of `frame.time`, `frame.deltaTime`, or `frame.frame`.
4. `metadata.usesMouse` matches any use of `frame.mousePosition`.
5. Time values are treated as milliseconds and preferably derive from the absolute clock.
6. No top-level runtime declarations.
7. Bindings and bind-group entries match exactly.
8. Uniform sizes and writes match and are 16-byte aligned.
9. Pipelines track `frame.output.format`.
10. Effects guard and sample input; fills never bind input.
11. Alpha handling matches the kind.
12. WGSL starts with the diagnostic directive and uses valid entrypoint names.
13. No mutated `let`, swizzle assignment, bracket array literal, GLSL builtin, or non-uniform implicit-derivative sample.

On a build error, fix the specific compiler failure with the smallest change and retry once.
