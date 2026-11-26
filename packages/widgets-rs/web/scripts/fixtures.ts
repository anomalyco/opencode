#!/usr/bin/env bun
// Writes demo/fixtures.js from @opencode/widget (packages/widget, or another checkout's): the served program
// (prelude + "\n" + source, a live one with the live prelude between them)
// of every built-in widget template, its mode, and example data, plus a few demo-only widget templates (fetch, a runaway loop, a
// full-screen layout switch). Usage: bun scripts/fixtures.ts [path/to/opencode/packages/widget]

import { readdir } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const widget = path.resolve(process.argv[2] ?? path.join(root, "../../widget"))
const src = path.join(widget, "src")
const prelude = await Bun.file(path.join(src, "prelude.js")).text()
const preludeLive = await Bun.file(path.join(src, "prelude-live.js")).text()
const FIRST = ["suggestions", "form", "confirm", "chart", "backdrop", "minigame"]
const rank = (n: string) => (FIRST.includes(n) ? FIRST.indexOf(n) : FIRST.length)
const names = (await readdir(path.join(src, "widget-templates")))
  .filter((f) => f.endsWith(".js"))
  .map((f) => f.slice(0, -3))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
const diagrams: Record<string, unknown> = await import(path.join(widget, "test/fixtures/diagrams.ts"))
  .then((m) => m.examples as Record<string, unknown>)
  .catch(() => ({}))

const LIVE = new Set(["minigame"])

/** A placeholder photo: an SVG gradient with a caption, as a data URI. */
const photo = (label: string, a: string, b: string) =>
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><circle cx="470" cy="150" r="70" fill="#fff" fill-opacity=".25"/><path d="M0 380 L180 250 L320 360 L450 280 L640 400 L640 480 L0 480Z" fill="#000" fill-opacity=".2"/><text x="40" y="440" font-family="sans-serif" font-size="40" font-weight="600" fill="#fff">${label}</text></svg>`,
  )

const data: Record<string, unknown> = {
  suggestions: {
    title: "Which landing page direction should we build?",
    options: [
      { label: "Bold gradient", note: "Big hero, product shots below", images: [photo("Hero", "#7c3aed", "#db2777"), photo("Features", "#2563eb", "#7c3aed")], recommended: true },
      { label: "Minimal", note: "Text-first, one screenshot", images: [photo("Minimal", "#334155", "#64748b")] },
      { label: "Playful", images: [photo("Playful", "#f59e0b", "#ef4444"), photo("Mascot", "#10b981", "#06b6d4"), photo("Footer", "#0ea5e9", "#6366f1")] },
    ],
  },
  form: {
    title: "Deploy settings",
    description: "Pick how the **staging** deploy should run. You can change these later in `deploy.toml`.",
    submitLabel: "Deploy",
    fields: [
      { key: "name", type: "text", label: "Release name", placeholder: "v1.2.0" },
      { key: "replicas", type: "number", label: "Replicas", min: 1, max: 8, default: 2 },
      { key: "canary", type: "boolean", label: "Canary rollout", default: true },
      {
        key: "region",
        type: "select",
        label: "Region",
        options: [
          { value: "us-east", label: "US East" },
          { value: "eu-west", label: "EU West" },
          { value: "ap-south", label: "Asia Pacific" },
        ],
      },
      { key: "notes", type: "text", label: "Notes", multiline: true },
    ],
  },
  confirm: { title: "Delete the staging database?", message: "This drops **all tables** in `staging`. It can't be undone.", confirmLabel: "Delete", danger: true },
  chart: {
    title: "Build time by week",
    kind: "bar",
    unit: "s",
    choose: true,
    labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"],
    series: [
      { label: "Linux", values: [312, 298, 305, 280, 266, 240, 236, 221] },
      { label: "macOS", values: [402, 395, 380, 371, 350, 344, 330, 318], color: "#f59e0b" },
    ],
  },
  backdrop: { title: "Release 2.0 is out", preset: "aurora", text: "Thanks to everyone who tested the **beta**. Drag the slider to change the speed." },
  minigame: { title: "Tap the dots", seconds: 15 },
  ...diagrams,
}

// Demo widget templates, in the authoring style of widgets.md: handlers on nodes (`onPress`, `onChange`, `onPointer`), hooks
// for events that belong to no node (`onKey`, `onFocus`, `onFullscreen`, `onCapture`; live: `widget.on`), no `update`
// and no `widget.event()`.
const DEMO = {
  "fetch-demo": {
    mode: "live",
    capabilities: { https: { hosts: ["api.github.com"] } },
    data: { title: "GitHub status" },
    source: `async function main(data) {
  let lines = ["press a button"]
  let tone
  const show = () =>
    widget.render(ui.column({ gap: 2, fullscreen: false }, [
      ui.text(data.title, { style: "title" }),
      ...lines.map((l) => ui.text(l, { style: "code", tone })),
      ui.row({ gap: 1 }, [
        ui.button("Fetch again", { variant: "primary", onPress: () => get("https://api.github.com/zen") }),
        ui.button("Try http://localhost", { onPress: () => get("http://localhost/x") }),
        ui.button("Try example.com", { onPress: () => get("https://example.com/") }),
      ]),
    ]))
  const get = async (url) => {
    try {
      const r = await widget.fetch(url)
      lines = ["GET " + url, "status " + r.status, (await r.text()).slice(0, 120)]
      tone = "success"
    } catch (e) {
      lines = ["GET " + url, e.kind + ": " + e.message]
      tone = "error"
    }
    show()
  }
  show()
  await get("https://api.github.com/zen")
}`,
  },
  "local-demo": {
    mode: "live",
    localNetwork: true,
    capabilities: { https: { hosts: ["localhost:4173"] } },
    data: { title: "Local network (dev mode)" },
    source: `async function main(data) {
  const show = (lines, tone) => widget.render(ui.column({ gap: 1, fullscreen: false }, [
    ui.text(data.title, { style: "title" }),
    ...lines.map((l) => ui.text(l, { style: "code", tone })),
  ]))
  const url = "http://localhost:4173/demo/demo.css"
  try {
    const r = await widget.fetch(url)
    show(["GET " + url, "status " + r.status + ", " + (await r.text()).length + " bytes"], "success")
  } catch (e) {
    show(["GET " + url, e.kind + ": " + e.message], "error")
  }
}`,
  },
  "keys-demo": {
    mode: "step",
    data: { title: "Keyboard and mouse" },
    source: `function init() {
  return { capture: false, focus: false, captured: false, last: "-", keys: 0, moved: 0, buttons: 0, hover: 0, pressed: false }
}

function view(state, data) {
  return ui.column({ gap: 1, capture: state.capture ? "pointer" : undefined }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({ key: "pad", height: 110, onPointer: padPointer }),
    ui.text("focus " + state.focus + " · captured " + state.captured, { style: "code" }),
    ui.text("last " + state.last + " · keys " + state.keys + " · moved " + state.moved + " · buttons " + state.buttons, { style: "code" }),
    ui.text("hover " + state.hover, { style: "code" }),
    ui.row({ gap: 1 }, [
      ui.button(state.capture ? "Stop asking for the mouse" : "Ask for the mouse", {
        onPress: (state) => ({ ...state, capture: !state.capture }),
      }),
    ]),
  ])
}

// Captured: relative moves and buttons. Otherwise absolute: a move with no button held is a hover.
function padPointer(state, p) {
  if (p.dx !== undefined)
    return p.kind === "move" ? { ...state, moved: state.moved + Math.abs(p.dx) + Math.abs(p.dy) } : { ...state, buttons: state.buttons + 1 }
  if (p.kind === "down") return { ...state, pressed: true }
  if (p.kind === "up") return { ...state, pressed: false }
  return state.pressed ? state : { ...state, hover: state.hover + 1 }
}

function onKey(state, key) {
  return { ...state, last: key.kind + " " + key.key, keys: state.keys + 1 }
}

function onFocus(state, focused) {
  return { ...state, focus: focused }
}

function onCapture(state, captured) {
  return { ...state, captured }
}

function draw(state, data, frame) {
  const g = ui.draw()
  g.rrect(0, 0, frame.width, frame.height, 8, state.captured ? "accent" : "surface")
  const hint = state.captured ? "mouse captured: move it, Esc releases" : state.capture ? "click here to give it the mouse" : state.focus ? "type: keys go to the widget" : "click to focus"
  g.text(frame.width / 2, frame.height / 2 + 5, hint, { align: "center", color: state.captured ? "bg" : "muted" })
  return g
}`,
  },
  "keys-live": {
    mode: "live",
    data: { title: "Keys in a live widget" },
    source: `async function main(data) {
  const s = { focus: false, captured: false, last: "-", keys: 0, moved: 0 }
  const show = () => {
    widget.render(ui.column({ gap: 1, fullscreen: false }, [
      ui.text(data.title, { style: "title" }),
      ui.canvas({
        key: "pad",
        height: 70,
        onPointer: (p) => {
          if (p.dx === undefined || p.kind !== "move") return
          s.moved += Math.abs(p.dx) + Math.abs(p.dy)
          show()
        },
      }),
      ui.text("focus " + s.focus + " · captured " + s.captured + " · last " + s.last + " · keys " + s.keys + " · moved " + s.moved, { style: "code" }),
      ui.button("Capture the mouse", { onPress: () => widget.capturePointer() }),
    ]))
    const g = ui.draw()
    g.rrect(0, 0, 2000, 70, 8, s.captured ? "accent" : "surface")
    widget.draw("pad", g)
  }
  widget.on("focus", (focused) => { s.focus = focused; show() })
  widget.on("capture", (captured) => { s.captured = captured; show() })
  widget.on("key", (key) => { s.last = key.kind + " " + key.key; s.keys++; show() })
  show()
}`,
  },
  "clock-demo": {
    mode: "live",
    data: { title: "Running time" },
    source: `async function main(data) {
  let resumed = 0
  let paused = 0
  widget.on("resumed", (ms) => { resumed++; paused += ms })
  while (true) {
    widget.render(ui.column({ gap: 1 }, [
      ui.text(data.title, { style: "title" }),
      ui.text("running " + (widget.now() / 1000).toFixed(1) + " s", { style: "code" }),
      ui.text("resumed " + resumed + "x, paused " + paused + " ms in all", { style: "caption", tone: "muted" }),
    ]))
    await widget.sleep(100)
  }
}`,
  },
  "shader-demo": {
    mode: "live",
    data: { title: "Shader driven by a live program" },
    source: `const WGSL = \`fn shade(frag: vec2f) -> vec4f {
  let uv = frag / widget.resolution;
  let d = distance(uv, widget.values[0].yz);
  let glow = exp(-d * d * 40.0) * (0.6 + 0.6 * widget.values[0].w);
  let base = vec3f(0.08, 0.1, 0.16) + vec3f(0.2, 0.1, 0.4) * (0.5 + 0.5 * sin(widget.values[0].x * 2.0 + uv.x * 6.0));
  return vec4f(base + vec3f(0.3, 0.6, 1.0) * glow, 1.0);
}\`

async function main(data) {
  const s = { down: 0, move: 0, up: 0, hover: 0, x: 0.5, y: 0.5, pressed: 0, frames: 0 }
  // Drags count as moves; moves with no button held (hover) light the orb dimly.
  const onPointer = (p) => {
    if (p.kind === "down") { s.down++; s.pressed = 1 }
    else if (p.kind === "up") { s.up++; s.pressed = 0 }
    else if (s.pressed) s.move++
    else s.hover++
    s.x = p.x / p.width
    s.y = p.y / p.height
  }
  while (true) {
    widget.render(ui.column({ gap: 1 }, [
      ui.text(data.title, { style: "title" }),
      ui.canvas({ key: "orb", wgsl: WGSL, height: 160, fps: 0, values: [widget.now() / 1000, s.x, s.y, s.pressed], alt: "A glowing orb that follows the pointer", onPointer }),
      ui.text("frames " + s.frames + " · down " + s.down + " · move " + s.move + " · up " + s.up + " · hover " + s.hover, { style: "caption", tone: "muted" }),
    ]))
    await widget.frame()
    s.frames++
  }
}`,
  },
  "broken-demo": {
    mode: "step",
    data: { title: "A widget template with a bug" },
    source: `function view(state, data) {
  return ui.column({ gap: 1 }, [
    ui.text(data.title, { style: "title" }),
    ui.button("Break it", { onPress: (state) => state.missing.field }),
  ])
}`,
  },
  "shader-broken": {
    mode: "step",
    data: { title: "A shader that doesn't validate" },
    source: `const WGSL = "fn shade(frag: vec2f) -> vec4f {\\n  return vec4f(nope, 1.0);\\n}"

function view(state, data) {
  return ui.column({ gap: 1 }, [ui.text(data.title, { style: "title" }), ui.canvas({ wgsl: WGSL, height: 80, alt: "A broken shader" })])
}`,
  },
  "hud-demo": {
    mode: "step",
    data: { title: "Starfield" },
    source: `// A HUD over a GPU canvas: a stack with the canvas filling it, text at the top left and a button at the bottom
// right. The button takes its taps; taps anywhere else (the text included) reach the canvas.
const WGSL = \`fn shade(frag: vec2f) -> vec4f {
  let uv = frag / widget.resolution;
  let t = widget.time * 0.3;
  var c = mix(vec3f(0.03, 0.04, 0.12), vec3f(0.15, 0.05, 0.25), uv.y);
  let cell = floor(frag / 18.0);
  let h = fract(sin(dot(cell, vec2f(12.9898, 78.233))) * 43758.5453);
  let twinkle = 0.5 + 0.5 * sin(t * 6.0 + h * 40.0);
  let star = step(0.93, h) * twinkle * (1.0 - smoothstep(0.0, 2.2, distance(fract(frag / 18.0) * 18.0, vec2f(9.0))));
  c += vec3f(star);
  let hit = widget.values[0].yz * widget.scale;
  c += vec3f(0.3, 0.6, 1.0) * widget.values[0].w * exp(-pow(distance(frag, hit) / (40.0 * widget.scale), 2.0));
  return vec4f(c, 1.0);
}\`

function init() {
  return { taps: 0, presses: 0, at: [0, 0] }
}

function view(state, data) {
  return ui.stack({}, [
    ui.canvas({
      key: "sky",
      wgsl: WGSL,
      place: "fill",
      height: 220,
      values: [state.taps, state.at[0], state.at[1], state.taps > 0 ? 1 : 0],
      alt: "A starfield",
      onPointer: (state, p) => (p.kind === "down" ? { ...state, taps: state.taps + 1, at: [p.x, p.y] } : state),
    }),
    // A keyed 2D canvas without onPointer (a vignette over the sky): it takes no input, taps pass through it.
    ui.canvas({ key: "glass", place: "fill", height: 220 }),
    ui.column({ place: "top-left", inset: 12, gap: 0 }, [
      ui.text(data.title, { style: "title" }),
      ui.text("canvas taps " + state.taps + " · button presses " + state.presses, { style: "code" }),
    ]),
    ui.button("Fire", { place: "bottom-right", inset: 12, variant: "primary", onPress: (state) => ({ ...state, presses: state.presses + 1 }) }),
  ])
}

function draw(state, data, frame) {
  const g = ui.draw()
  g.rect(0, 0, frame.width, frame.height, { fill: { radial: [frame.width / 2, frame.height / 2, frame.width * 0.7], stops: [[0, "#00000000"], [0.7, "#00000000"], [1, "#00000088"]] } })
  return g
}`,
  },
  "runaway-demo": {
    mode: "live",
    data: { title: "A runaway loop" },
    source: `async function main(data) {
  widget.render(ui.column({ gap: 2 }, [
    ui.text(data.title, { style: "title" }),
    ui.text("Press to spin forever: the host stops it after 50 ms.", { tone: "muted" }),
    ui.button("Spin", {
      variant: "danger",
      onPress: () => {
        let n = 0
        while (true) n++
      },
    }),
  ]))
}`,
  },
  "fullscreen-demo": {
    mode: "step",
    data: { title: "Pulse" },
    source: `function init() {
  return { full: false, taps: 0, close: null, pointerClose: null }
}

const rect = (r) => (r ? [r.x, r.y, r.width, r.height].join(",") : "none")

// In full screen "pulse" goes first (under the close button) and shares the free height with "echo"; "strip" keeps
// its 40 px (fill: false). The close button's area comes with the fullscreen hook, each Frame and pointer values.
function view(state, data) {
  const pulse = ui.canvas({
    key: "pulse",
    height: 140,
    fps: 60,
    onPointer: (state, p) => (p.kind === "down" ? { ...state, taps: state.taps + 1, pointerClose: p.close ?? null } : state),
  })
  return ui.column({ gap: 2, fullscreen: true }, [
    state.full && pulse,
    ui.text(data.title + (state.full ? " (full screen)" : ""), { style: "title" }),
    !state.full && ui.text("Expand me: both canvases share the screen, the strip keeps its height.", { tone: "muted" }),
    !state.full && pulse,
    ui.canvas({ key: "echo", height: 80 }),
    ui.canvas({ key: "strip", height: 40, fill: false }),
    ui.text("taps: " + state.taps + " · close " + rect(state.close) + " · pointer close " + rect(state.pointerClose), { style: "caption" }),
  ])
}

function onFullscreen(state, on, close) {
  return { ...state, full: on, close }
}

function draw(state, data, frame) {
  const g = ui.draw()
  g.rect(0, 0, frame.width, frame.height, "surface")
  const label = frame.key + " " + frame.width + " x " + frame.height + (frame.fullscreen ? " full screen" : "")
  if (frame.key === "pulse") {
    const r = Math.min(frame.width, frame.height) * (0.25 + 0.08 * Math.sin(frame.t * 3))
    g.circle(frame.width / 2, frame.height / 2, r, { fill: { radial: [frame.width / 2, frame.height / 2, r], stops: [[0, "accent"], [1, "#00000000"]] } })
    if (frame.pointer) g.circle(frame.pointer.x, frame.pointer.y, frame.pointer.down ? 14 : 8, { stroke: "text", width: 2 })
  } else if (frame.key === "echo") {
    for (let i = 0; i < 6; i++) g.rrect(12 + i * (frame.width - 24) / 6, frame.height * 0.3, (frame.width - 24) / 6 - 8, frame.height * 0.5, 6, i % 2 ? "border" : "accent")
  } else {
    g.rect(0, frame.height / 2 - 2, frame.width * 0.6, 4, "success")
  }
  g.text(12, 20, label, { color: "muted", mono: true, size: 12 })
  // Where the close button floats over this canvas: magenta, so a check can find it.
  if (frame.close) g.rect(frame.close.x, frame.close.y, frame.close.width, frame.close.height, "#ff00ff")
  return g
}`,
  },
}

const fixtures: Record<string, { mode: string; source: string; data: unknown; capabilities?: unknown; localNetwork?: boolean }> = {}
for (const name of names) {
  if (data[name] === undefined) {
    console.warn(`no example data for ${name}: skipped`)
    continue
  }
  const source = await Bun.file(path.join(src, "widget-templates", `${name}.js`)).text()
  fixtures[name] = { mode: LIVE.has(name) ? "live" : "step", source, data: data[name] }
}
// "Tap the dots" left the built-ins and lives on as a live runtime test fixture: the demo keeps it as "minigame".
const tapDots = Bun.file(path.join(widget, "test/fixtures/tap-dots.js"))
if (!fixtures.minigame && (await tapDots.exists()))
  fixtures.minigame = { mode: "live", source: await tapDots.text(), data: data.minigame }
for (const [name, t] of Object.entries(DEMO))
  fixtures[name] = {
    mode: t.mode,
    source: t.source,
    data: t.data,
    ...("capabilities" in t ? { capabilities: t.capabilities } : {}),
    ...("localNetwork" in t ? { localNetwork: t.localNetwork } : {}),
  }

const out = path.join(root, "demo/fixtures.js")
await Bun.write(
  out,
  `// Generated by scripts/fixtures.ts from ${path.relative(root, widget)}. Do not edit.\n// The served program of each is prelude + "\\n" + source, a live one's prelude + "\\n" + preludeLive + "\\n" + source.\nexport const prelude = ${JSON.stringify(prelude)}\nexport const preludeLive = ${JSON.stringify(preludeLive)}\nexport const fixtures = ${JSON.stringify(fixtures, null, 1)}\n`,
)
console.log(`${Object.keys(fixtures).length} fixtures -> ${path.relative(process.cwd(), out)}`)
