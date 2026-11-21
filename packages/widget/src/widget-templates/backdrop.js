// An animated shader banner with a title and text. widget.values[0] is (speed, accent red, green, blue); colors are
// sRGB. Pressing the banner lights it up around the pointer.

const ACCENTS = { plasma: "#8b5cf6", aurora: "#2dd4bf", waves: "#3b82f6" }

const COMMON = `
fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(123.34, 456.21));
  let r = q + dot(q, q + 45.32);
  return fract(r.x * r.y);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash(i);
  let b = hash(i + vec2f(1.0, 0.0));
  let c = hash(i + vec2f(0.0, 1.0));
  let d = hash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(start: vec2f) -> f32 {
  var p = start;
  var amplitude = 0.5;
  var sum = 0.0;
  for (var i = 0; i < 5; i++) {
    sum += amplitude * noise(p);
    p = p * 2.03 + vec2f(1.7, 9.2);
    amplitude *= 0.5;
  }
  return sum;
}

fn touch(frag: vec2f, color: vec3f) -> vec3f {
  if (widget.pointer.z < 0.5) {
    return color;
  }
  let d = distance(frag, widget.pointer.xy) / widget.resolution.y;
  return color + widget.values[0].yzw * 0.35 * exp(-d * d * 30.0);
}

fn vignette(frag: vec2f) -> f32 {
  let uv = frag / widget.resolution;
  let edge = uv * (1.0 - uv);
  return clamp(pow(edge.x * edge.y * 16.0, 0.18), 0.0, 1.0);
}
`

const PRESETS = {
  plasma:
    COMMON +
    `
fn shade(frag: vec2f) -> vec4f {
  let res = widget.resolution;
  let p = (frag - 0.5 * res) / res.y * 3.0;
  let t = widget.time * widget.values[0].x;
  let accent = widget.values[0].yzw;
  var v = sin(p.x * 1.3 + t);
  v += sin((p.y + t) * 0.7);
  v += sin((p.x + p.y + t) * 0.6);
  let c = p + vec2f(sin(t * 0.33), cos(t * 0.5)) * 1.5;
  v += sin(sqrt(dot(c, c) + 1.0) * 1.8 - t);
  let glow = 0.5 + 0.5 * sin(v * 1.4);
  let hue = 0.5 + 0.5 * sin(v * 0.9 + 2.0);
  let deep = accent * 0.18 + vec3f(0.02, 0.02, 0.06);
  let warm = mix(accent, vec3f(1.0, 0.42, 0.72), 0.5);
  let cool = mix(accent, vec3f(0.2, 0.85, 1.0), 0.5);
  var color = mix(deep, mix(cool, warm, hue), glow * glow);
  color = touch(frag, color * (0.6 + 0.4 * vignette(frag)));
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`,
  aurora:
    COMMON +
    `
fn shade(frag: vec2f) -> vec4f {
  let res = widget.resolution;
  let uv = frag / res;
  let aspect = res.x / res.y;
  let t = widget.time * widget.values[0].x;
  let accent = widget.values[0].yzw;
  var color = mix(vec3f(0.03, 0.06, 0.14), vec3f(0.005, 0.01, 0.04), uv.y);
  for (var i = 0; i < 3; i++) {
    let layer = f32(i);
    let x = uv.x * aspect * (1.1 + layer * 0.45) + t * (0.04 + layer * 0.02);
    let center = 0.42 + 0.14 * layer + 0.2 * (fbm(vec2f(x * 0.7, layer * 3.1 + t * 0.08)) - 0.5);
    let d = uv.y - center;
    let falloff = select(exp(-d * d * 14.0), exp(-d * d * 900.0), d > 0.0);
    let rays = fbm(vec2f(x * 9.0, t * 0.25 + layer));
    let glow = falloff * (0.35 + 0.9 * rays * rays);
    let tint = mix(accent, vec3f(0.35, 1.0, 0.55), 0.35 + 0.25 * layer);
    color += tint * glow * (0.75 - layer * 0.18);
  }
  let size = 14.0 * widget.scale;
  let cell = floor(frag / size);
  let spot = (cell + 0.2 + 0.6 * vec2f(hash(cell + 3.1), hash(cell + 8.7))) * size;
  let twinkle = 0.65 + 0.35 * sin(t * 2.0 + hash(cell) * 40.0);
  let star = step(0.82, hash(cell)) * smoothstep(1.3 * widget.scale, 0.0, distance(frag, spot)) * twinkle;
  color += vec3f(star) * smoothstep(0.75, 0.0, uv.y);
  color = touch(frag, color * (0.6 + 0.4 * vignette(frag)));
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`,
  waves:
    COMMON +
    `
fn shade(frag: vec2f) -> vec4f {
  let res = widget.resolution;
  let uv = frag / res;
  let aspect = res.x / res.y;
  let t = widget.time * widget.values[0].x;
  let accent = widget.values[0].yzw;
  let edge = 1.5 / res.y;
  var color = mix(accent * 0.35 + vec3f(0.04, 0.05, 0.1), vec3f(0.02, 0.03, 0.07), uv.y);
  for (var i = 0; i < 5; i++) {
    let layer = f32(i);
    let x = uv.x * aspect;
    let h = 0.3 + layer * 0.13
      + 0.045 * sin(x * (2.2 + layer * 0.6) + t * (0.5 + layer * 0.22) + layer * 1.7)
      + 0.02 * sin(x * (5.3 - layer * 0.4) - t * (0.9 + layer * 0.1) + layer);
    let body = mix(accent, vec3f(0.02, 0.04, 0.12), 0.35 + layer * 0.14) * (0.75 + 0.25 * (uv.y - h) / (1.0 - h));
    color = mix(color, body, smoothstep(h - edge, h + edge, uv.y));
    color += accent * 0.35 * exp(-abs(uv.y - h) * res.y * 0.08) * (1.0 - layer * 0.15);
  }
  color = touch(frag, color * (0.65 + 0.35 * vignette(frag)));
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`,
}

function init(data) {
  return { speed: 1 }
}

function view(state, data) {
  return ui.column({ gap: 2, align: "stretch" }, [
    ui.canvas({
      wgsl: PRESETS[data.preset],
      height: 200,
      values: [state.speed, ...rgb(data.accent ?? ACCENTS[data.preset])],
      fps: state.speed > 0 ? 60 : 0,
      alt: "Animated " + data.preset + " backdrop",
    }),
    ui.text(data.title, { style: "title" }),
    data.text && ui.markdown(data.text),
    ui.slider({
      label: "Speed",
      value: state.speed,
      min: 0,
      max: 2,
      step: 0.1,
      onChange: (state, speed) => ({ speed: Math.round(speed * 10) / 10 }),
    }),
  ])
}

// "#rgb" or "#rrggbb" to three 0..1 floats.
function rgb(hex) {
  const digits = hex.length === 4 ? hex.slice(1).replace(/./g, (digit) => digit + digit) : hex.slice(1, 7)
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16) / 255)
}
