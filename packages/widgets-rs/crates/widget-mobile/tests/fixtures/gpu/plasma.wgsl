
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
