import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { spawn } from "child_process"

// ============================================================================
// CAVA Audio Spectrum Visualizer
// ============================================================================

const SPEC_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
const BAR_COUNT = 16

// CAVA config for raw ASCII output
const CAVA_CONFIG = `
[general]
bars = ${BAR_COUNT}
framerate = 30

[input]
method = pulse
source = auto

[output]
method = raw
data_format = ascii
ascii_max_range = 7
bar_delimiter = 59
`

function SpectrumWidget(props: { api: TuiPluginApi; onLevel?: (level: number) => void }) {
  const theme = () => props.api.theme.current
  const [bars, setBars] = createSignal<number[]>(Array(BAR_COUNT).fill(0))
  const [source, setSource] = createSignal<"cava" | "sim">("sim")
  const [avgLevel, setAvgLevel] = createSignal(0)

  let cavaProc: ReturnType<typeof spawn> | null = null

  // Try to spawn CAVA
  try {
    cavaProc = spawn("cava", ["-p", "/dev/stdin"], {
      stdio: ["pipe", "pipe", "ignore"],
    })

    if (cavaProc.stdin) {
      cavaProc.stdin.write(CAVA_CONFIG)
      cavaProc.stdin.end()
    }

    if (cavaProc.stdout) {
      setSource("cava")
      let buffer = ""
      
      cavaProc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        
        for (const line of lines) {
          if (line.trim()) {
            const vals = line.split(";").map(v => parseInt(v.trim(), 10) || 0)
            if (vals.length > 0) {
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
    }
  } catch {
    setSource("sim")
  }

  // Fallback simulation
  if (source() === "sim") {
    const simTimer = setInterval(() => {
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
    }, 50)
    
    onCleanup(() => clearInterval(simTimer))
  }

  onCleanup(() => {
    if (cavaProc) {
      cavaProc.kill()
    }
  })

  // Render spectrum as 3-row visualization
  const specRows = createMemo(() => {
    const b = bars()
    const rows: string[] = []
    for (let row = 2; row >= 0; row--) {
      const threshold = row * 2.5
      rows.push(b.map(v => v > threshold ? "█" : " ").join(""))
    }
    return rows
  })

  const barChars = createMemo(() => {
    return bars().map(v => SPEC_CHARS[Math.min(7, v)]).join("")
  })

  const levelPct = createMemo(() => Math.round(avgLevel() * 100))

  const statusColor = createMemo(() => {
    const t = theme()
    return source() === "cava" ? t.success : t.textMuted
  })

  return (
    <box>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme().text} bold>♪ Audio</text>
        <text fg={statusColor()}>
          {source() === "cava" ? "● CAVA" : "○ sim"}
        </text>
      </box>
      {specRows().map((row, i) => (
        <text key={i} fg={theme().accent} fontFamily="monospace">{row}</text>
      ))}
      <text fg={theme().accent}>{barChars()}</text>
      <text fg={theme().textMuted}>level: {levelPct()}%</text>
    </box>
  )
}

export { SpectrumWidget }
