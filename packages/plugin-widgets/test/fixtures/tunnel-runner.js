// Tunnel runner: race down a pulsing neon tunnel; tap to jump the barriers. Submits { score, distance }.
const GRAVITY = -30
const JUMP = 11
const SPACING = 18
const BARRIER = 1.1

const WGSL = `
// values[0] = (height, distance, gap to the next barrier, score); values[1].x = 1 while alive
fn tunnel(p: vec3f) -> f32 {
  let wobble = 0.3 * sin(p.z * 0.5 + widget.time * 1.7);
  return 2.4 + wobble - length(p.xy);
}

fn barrier(p: vec3f) -> f32 {
  let gap = widget.values[0].z;
  let z = (p.z - gap) - 18.0 * round((p.z - gap) / 18.0);
  let q = abs(vec3f(p.x, p.y + 1.9, z)) - vec3f(2.6, 0.55, 0.3);
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn shade(frag: vec2f) -> vec4f {
  let res = widget.resolution;
  let uv = (frag - 0.5 * res) / res.y;
  let ro = vec3f(0.0, -1.1 + widget.values[0].x * 0.55, 0.0);
  let rd = normalize(vec3f(uv.x, -uv.y, 1.1));
  var t = 0.0;
  var hit = false;
  for (var i = 0; i < 64; i++) {
    let p = ro + rd * t;
    let d = min(tunnel(p), barrier(p));
    if (d < 0.003) {
      hit = true;
      break;
    }
    t += d * 0.85;
    if (t > 45.0) {
      break;
    }
  }
  let p = ro + rd * t;
  let travelled = p.z + widget.values[0].y;
  let swirl = atan2(p.y, p.x) * 3.0 + travelled * 1.3 - widget.time * 3.0;
  var color = mix(vec3f(0.18, 0.0, 0.3), vec3f(0.95, 0.15, 0.55), 0.5 + 0.5 * sin(swirl));
  if (barrier(p) < 0.02) {
    color = vec3f(0.2, 1.0, 0.7) * (0.7 + 0.3 * sin(widget.time * 12.0));
  }
  color = select(vec3f(0.0), color * exp(-t * 0.07), hit);
  if (widget.values[1].x < 0.5) {
    color = mix(color, vec3f(0.7, 0.0, 0.05), 0.55);
  }
  return vec4f(color, 1.0);
}
`

async function main(data) {
  const run = { y: 0, vy: 0, distance: 0, speed: 9, next: SPACING, score: 0, alive: true }
  const show = () =>
    widget.render(
      ui.column({ gap: 1, fullscreen: true }, [
        ui.row({ gap: 2 }, [ui.text(data.title ?? "Tunnel runner", { style: "title" }), ui.text("Score " + run.score)]),
        ui.canvas({
          wgsl: WGSL,
          height: 280,
          fill: true,
          values: [run.y, run.distance, run.next - run.distance, run.score, run.alive ? 1 : 0],
          alt: "A neon tunnel runner: tap to jump the barriers",
          onPointer: (p) => {
            if (p.kind === "down" && run.y === 0) run.vy = JUMP
          },
        }),
      ]),
    )
  const end = widget.now() + (data.seconds ?? 45) * 1000
  show()
  while (run.alive && widget.now() < end) {
    const frame = await widget.frame()
    const dt = Math.min(frame.dt, 0.05)
    run.vy += GRAVITY * dt
    run.y = Math.max(0, run.y + run.vy * dt)
    if (run.y === 0) run.vy = Math.max(0, run.vy)
    run.distance += run.speed * dt
    run.speed += dt * 0.25
    if (run.distance >= run.next) {
      if (run.y < BARRIER) run.alive = false
      else {
        run.score++
        run.next += SPACING
      }
    }
    show()
  }
  widget.render(
    ui.column({ gap: 1 }, [
      ui.text(run.alive ? "Time's up: " + run.score + " barriers" : "Crashed after " + run.score + " barriers", {
        style: "title",
      }),
      ui.button("Submit score", {
        variant: "primary",
        onPress: () => widget.submit({ score: run.score, distance: Math.round(run.distance) }),
      }),
    ]),
  )
}
