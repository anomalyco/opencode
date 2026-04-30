import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { spawn } from "child_process"

// ============================================================================
// CAVA Audio Spectrum Visualizer
// ============================================================================

const SPEC_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
const BAR_COUNT = 12

function SpectrumWidget(props: { api: TuiPluginApi; onLevel?: (level: number) => void }) {
  const theme = () => props.api.theme.current
  const [bars, setBars] = createSignal<number[]>(Array(BAR_COUNT).fill(0))
  const [source, setSource] = createSignal<"cava" | "sim">("sim")
  const [avgLevel, setAvgLevel] = createSignal(0)

  let cavaProc: ReturnType<typeof spawn> | null = null

  // Try to spawn CAVA with proper config
  try {
    const cavaConfig = `
[general]
bars = ${BAR_COUNT}
framerate = 20

[input]
method = pulse
source = auto

[output]
method = raw
data_format = ascii
ascii_max_range = 7
bar_delimiter = 59
`
    
    cavaProc = spawn("sh", ["-c", `echo '${cavaConfig}' | cava -p /dev/stdin`], {
      stdio: ["ignore", "pipe", "ignore"],
    })

    if (cavaProc.stdout) {
      setSource("cava")
      let buffer = ""
      
      cavaProc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        
        for (const line of lines) {
          if (line.trim() && line.includes(";")) {
            const vals = line.split(";").map(v => {
              const n = parseInt(v.trim(), 10)
              return isNaN(n) ? 0 : Math.min(7, Math.max(0, n))
            })
            if (vals.length >= BAR_COUNT) {
              setBars(vals.slice(0, BAR_COUNT))
              const avg = vals.reduce((a, b) => a + b, 0) / vals.length / 7
              setAvgLevel(avg)
              props.onLevel?.(avg)
            }
          }
        }
      })

      cavaProc.on("error", () => {
        setSource("sim")
      })

      cavaProc.on("exit", () => {
        setSource("sim")
      })
    }
  } catch {
    setSource("sim")
  }

  // Fallback simulation
  const simTimer = setInterval(() => {
    if (source() === "sim") {
      const time = Date.now() / 200
      const newBars = Array.from({ length: BAR_COUNT }, (_, i) => {
        const wave1 = Math.sin(time + i * 0.5) * 0.5 + 0.5
        const wave2 = Math.sin(time * 1.3 + i * 0.3) * 0.3 + 0.3
        const noise = Math.random() * 0.2
        return Math.min(7, Math.max(0, Math.floor((wave1 + wave2 + noise) * 8)))
      })
      setBars(newBars)
      const avg = newBars.reduce((a, b) => a + b, 0) / newBars.length / 7
      setAvgLevel(avg)
      props.onLevel?.(avg)
    }
  }, 50)

  onCleanup(() => {
    clearInterval(simTimer)
    if (cavaProc) {
      cavaProc.kill()
    }
  })

  // Render spectrum as single bar line
  const barChars = createMemo(() => {
    return bars().map(v => SPEC_CHARS[Math.min(7, v)]).join("")
  })

  const levelPct = createMemo(() => Math.round(avgLevel() * 100))

  const statusColor = createMemo(() => {
    const t = theme()
    return source() === "cava" ? t.success : t.textMuted
  })

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={theme().text}>♪</text>
      <text fg={theme().accent}>{barChars()}</text>
      <text fg={statusColor()}>{levelPct()}%</text>
    </box>
  )
}

export { SpectrumWidget }
