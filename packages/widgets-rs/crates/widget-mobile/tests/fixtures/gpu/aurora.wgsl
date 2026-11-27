
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
