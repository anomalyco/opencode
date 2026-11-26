// The demo: every fixture mounted with the shared host, a theme toggle, and a log of what widgets send back.
// Query: ?only=<name> (one widget template), ?theme=light, ?noask=1 (no
// "Ask agent to fix it", as in an artifact with no agent session), ?nosource=1 (positions found without `source`).
// The demo plays the server for failures: a report becomes the widget's failure (unsent, as for a built-in), and an
// ask marks it sent.
import { WidgetHost, configure } from "../dist/index.js"
import { fixtures, prelude, preludeLive } from "./fixtures.js"

const params = new URLSearchParams(location.search)
const host = configure({})
const only = params.get("only")
let theme = params.get("theme") === "light" ? "light" : "dark"
document.documentElement.classList.toggle("light", theme === "light")

const demo = { log: [], metrics: {}, perWidget: {}, widgets: {}, host }
window.__demo = demo
demo.WidgetHost = WidgetHost
demo.fixtures = fixtures
demo.prelude = prelude
/** The program served for `source` (widgets.md, Prelude and step ABI): a live one has the live prelude too. */
demo.program = (source, mode) => (mode === "live" ? prelude + "\n" + preludeLive + "\n" + source : prelude + "\n" + source)

const log = (text) => {
  const li = document.createElement("li")
  li.textContent = `${new Date().toLocaleTimeString()} ${text}`
  document.getElementById("log").prepend(li)
  demo.log.push(text)
}
let pending = 0
const record = (name, m) => {
  ;((demo.perWidget[name] ??= {})[m.kind] ??= []).push(m.ms)
  ;(demo.metrics[m.kind] ??= []).push(m.ms)
  if (pending) return
  pending = requestAnimationFrame(() => {
    pending = 0
    const lines = []
    for (const [n, kinds] of Object.entries(demo.perWidget)) {
      const parts = Object.entries(kinds).map(([k, v]) => {
        const avg = v.reduce((a, b) => a + b, 0) / v.length
        return `${k} ${avg.toFixed(1)}${v.length > 1 ? `×${v.length}` : ""}`
      })
      lines.push(`${n.padEnd(15)} ${parts.join("  ")}`)
    }
    document.getElementById("metrics").textContent = lines.join("\n")
  })
}

/** Mounts `name` once more (off screen is fine: it's visible at the top) and resolves with its time to first view. */
demo.mount = (name) =>
  new Promise((resolve) => {
    const f = fixtures[name]
    const slot = document.createElement("div")
    slot.className = "slot"
    section.prepend(slot)
    const w = host.mount(slot, {
      program: demo.program(f.source, f.mode),
      data: f.data,
      mode: f.mode,
      theme,
      onMetrics: (m) => m.kind === "init" && resolve(m.ms),
    })
    demo.extra = [...(demo.extra ?? []), w]
  })

const select = document.getElementById("only")
const section = document.getElementById("widgets")
for (const [name, f] of Object.entries(fixtures)) {
  const o = document.createElement("option")
  o.value = o.textContent = name
  select.append(o)
  if (only && only !== name) continue
  const slot = document.createElement("div")
  slot.className = "slot"
  slot.dataset.name = name
  const label = document.createElement("div")
  label.className = "name"
  const a = document.createElement("span")
  a.textContent = name
  const b = document.createElement("span")
  b.textContent = f.mode
  label.append(a, b)
  slot.append(label)
  section.append(slot)
  const widget = (demo.widgets[name] = host.mount(slot, {
    program: demo.program(f.source, f.mode),
    source: params.has("nosource") ? undefined : f.source,
    data: f.data,
    mode: f.mode,
    capabilities: f.capabilities,
    // Dev mode for the local-demo fixture; ?local=0 turns it off.
    allowLocalNetwork: f.localNetwork === true && params.get("local") !== "0",
    theme,
    onSubmit: (value) => log(`${name} submit ${JSON.stringify(value)}`),
    onDismiss: () => log(`${name} dismiss`),
    onSend: (value, wake) => log(`${name} send ${JSON.stringify(value)}${wake ? "" : " (no wake)"}`),
    onWarning: (message) => log(`${name} warning: ${message}`),
    onReport: (error) => {
      log(`${name} report ${JSON.stringify(error)}`)
      widget.setFailure({ ...error, client: "web", sent: false })
    },
    onClientError: (message) => log(`${name} client-error ${message}`),
    onAsk: params.has("noask")
      ? undefined
      : async (error) => {
          log(`${name} ask ${JSON.stringify(error)}`)
          widget.setFailure({ ...error, client: "web", sent: true })
        },
    onMetrics: (m) => record(name, m),
  }))
}
select.value = only ?? ""
select.onchange = () => {
  if (select.value) params.set("only", select.value)
  else params.delete("only")
  location.search = params.toString()
}
const toggle = document.getElementById("theme")
toggle.textContent = theme === "dark" ? "Light theme" : "Dark theme"
toggle.onclick = () => {
  theme = theme === "dark" ? "light" : "dark"
  document.documentElement.classList.toggle("light", theme === "light")
  toggle.textContent = theme === "dark" ? "Light theme" : "Dark theme"
  for (const w of Object.values(demo.widgets)) w.setTheme(theme)
}
document.getElementById("backend").textContent =
  "gpu" in navigator ? "GPU canvases: WebGPU" : "GPU canvases: no WebGPU (placeholders)"
