
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
