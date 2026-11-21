// A GPU canvas whose speed follows a slider: state drives `values`.
const WGSL = `
fn shade(frag: vec2f) -> vec4f {
  let uv = frag / widget.resolution;
  let t = widget.time * widget.values[0].x;
  let c = 0.5 + 0.5 * cos(t + uv.xyx * 3.0 + vec3f(0.0, 2.0, 4.0));
  return vec4f(c, 1.0);
}`
function init() {
  return { speed: 1 }
}
function view(state) {
  return ui.column({ gap: 1 }, [
    ui.canvas({ wgsl: WGSL, height: 160, values: [state.speed], alt: "Shifting colors" }),
    ui.slider({
      label: "Speed",
      value: state.speed,
      min: 0,
      max: 3,
      step: 0.1,
      onChange: (state, speed) => ({ speed }),
    }),
  ])
}
