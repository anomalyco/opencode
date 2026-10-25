import { SessionV1 } from "@bolt-ai/core/v1/session"
import { escapeHtml } from "@/util/html"

export interface Step {
  role: "user" | "assistant" | "tool"
  label: string
  text: string
  detail?: string
}

/** Flattens session messages into the ordered replay steps shown in the HTML timeline. */
export function steps(messages: readonly SessionV1.WithParts[]): Step[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part): Step[] => {
      if (part.type === "text" && part.text.trim() === "") return []
      if (part.type === "text" && message.info.role === "user")
        return [{ role: "user", label: "User", text: part.text }]
      if (part.type === "text") return [{ role: "assistant", label: "Assistant", text: part.text }]
      if (part.type === "tool")
        return [
          {
            role: "tool",
            label: part.tool,
            text: part.state.status === "completed" ? part.state.title : part.state.status,
            detail: detail(part.state),
          },
        ]
      return []
    }),
  )
}

function detail(state: SessionV1.ToolState) {
  const input = `input:\n${JSON.stringify(state.input, null, 2)}`
  if (state.status === "completed") return `${input}\n\noutput:\n${state.output}`
  if (state.status === "error") return `${input}\n\nerror:\n${state.error}`
  return input
}

/** Renders a fully self-contained HTML replay (inline CSS + JS, no external resources). */
export function render(title: string, messages: readonly SessionV1.WithParts[]) {
  const items = steps(messages)
  const sections = items
    .map((step, index) => {
      const extra = step.detail
        ? `<details><summary>details</summary><pre>${escapeHtml(step.detail)}</pre></details>`
        : ""
      return `<section class="step ${step.role}" data-step="${index}"><header>${escapeHtml(step.label)}</header><pre>${escapeHtml(step.text)}</pre>${extra}</section>`
    })
    .join("\n")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #0d1117; color: #e6edf3; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 96px; }
h1 { font-size: 20px; margin: 0 0 12px; }
#progress { height: 4px; background: #21262d; border-radius: 2px; overflow: hidden; }
#bar { height: 100%; width: 0; background: #2f81f7; transition: width 0.2s; }
#count { margin: 8px 0 20px; color: #8b949e; font-size: 13px; }
.step { display: none; border: 1px solid #30363d; border-radius: 8px; margin: 0 0 12px; overflow: hidden; }
.step.visible { display: block; }
.step.active { border-color: #2f81f7; }
.step header { padding: 6px 12px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; background: #161b22; color: #8b949e; }
.step.user header { color: #7ee787; }
.step.assistant header { color: #79c0ff; }
.step.tool header { color: #d2a8ff; }
.step pre { margin: 0; padding: 12px; white-space: pre-wrap; word-break: break-word; font: 13px/1.5 ui-monospace, monospace; }
.step details { border-top: 1px solid #30363d; }
.step summary { cursor: pointer; padding: 6px 12px; font-size: 12px; color: #8b949e; }
nav { position: fixed; bottom: 0; left: 0; right: 0; display: flex; gap: 8px; justify-content: center; padding: 12px; background: #0d1117e6; border-top: 1px solid #30363d; }
nav button { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 6px 16px; font-size: 14px; cursor: pointer; }
nav button:hover { border-color: #2f81f7; }
nav select { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 6px 8px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<div id="progress"><div id="bar"></div></div>
<div id="count"></div>
<div id="steps">
${sections}
</div>
</main>
<nav>
<button id="prev" type="button">&#8592; Prev</button>
<button id="play" type="button">&#9654; Play</button>
<select id="speed" aria-label="playback speed">
<option value="2400">0.5x</option>
<option value="1200" selected>1x</option>
<option value="600">2x</option>
<option value="300">4x</option>
</select>
<button id="next" type="button">Next &#8594;</button>
</nav>
<script>
(() => {
  const steps = Array.from(document.querySelectorAll(".step"))
  let current = 0
  const show = () => {
    steps.forEach((step, index) => {
      step.classList.toggle("visible", index <= current)
      step.classList.toggle("active", index === current)
    })
    document.getElementById("count").textContent = steps.length ? current + 1 + " / " + steps.length : "0 / 0"
    document.getElementById("bar").style.width = steps.length ? (100 * (current + 1)) / steps.length + "%" : "0%"
    const active = steps[current]
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }
  const move = (delta) => {
    current = Math.min(Math.max(current + delta, 0), Math.max(steps.length - 1, 0))
    show()
  }
  let timer = 0
  const play = document.getElementById("play")
  const speed = document.getElementById("speed")
  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = 0
    play.innerHTML = "&#9654; Play"
  }
  const start = () => {
    if (steps.length < 2) return
    if (current >= steps.length - 1) {
      current = 0
      show()
    }
    timer = setInterval(() => {
      if (current >= steps.length - 1) return stop()
      move(1)
    }, Number(speed.value))
    play.innerHTML = "&#10074;&#10074; Pause"
  }
  play.addEventListener("click", () => (timer ? stop() : start()))
  speed.addEventListener("change", () => {
    if (!timer) return
    stop()
    start()
  })
  document.getElementById("prev").addEventListener("click", () => {
    stop()
    move(-1)
  })
  document.getElementById("next").addEventListener("click", () => {
    stop()
    move(1)
  })
  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      stop()
      move(-1)
    }
    if (event.key === "ArrowRight") {
      stop()
      move(1)
    }
    if (event.key === " ") {
      event.preventDefault()
      timer ? stop() : start()
    }
  })
  show()
})()
</script>
</body>
</html>
`
}
