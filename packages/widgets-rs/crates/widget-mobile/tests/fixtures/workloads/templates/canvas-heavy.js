// Bench workload: a heavy 2D canvas at 60 fps, close to the 2,000-command budget: 24 line series of 160 points each
// (paths), 1,800 moving particles (circles), 100 labels, a background, grid lines and a few panels, all moving with t.

const SERIES = 24
const POINTS = 160
const PARTICLES = 1800
const LABELS = 100
const COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4"]

function scene(t, width, height) {
  const g = ui.draw()
  g.rect(0, 0, width, height, "bg")
  for (let i = 0; i <= 10; i++) g.line(0, (height * i) / 10, width, (height * i) / 10, { stroke: "border", width: 1 })
  for (let s = 0; s < SERIES; s++) {
    const segments = []
    for (let p = 0; p < POINTS; p++) {
      const x = (width * p) / (POINTS - 1)
      const y = height * (0.5 + 0.4 * Math.sin(t * (0.5 + s * 0.07) + p * 0.08 + s))
      segments.push([p === 0 ? "M" : "L", x, y])
    }
    g.path(segments, { stroke: COLORS[s % COLORS.length], width: 1.5, cap: "round" })
  }
  for (let i = 0; i < PARTICLES; i++) {
    const a = i * 2.399963 + t * (0.2 + (i % 7) * 0.05)
    const r = 20 + ((i * 37) % 280)
    g.circle(width / 2 + Math.cos(a) * r, height / 2 + Math.sin(a) * r * 0.6, 1.5 + (i % 3), COLORS[i % COLORS.length])
  }
  for (let i = 0; i < LABELS; i++)
    g.text(12 + ((i * 53) % (width - 60)), 20 + ((i * 29) % (height - 30)), String(Math.round(1000 * Math.sin(t + i)) / 10), { size: 10, color: "muted" })
  for (let i = 0; i < 6; i++) g.rrect(10 + i * 100, height - 40, 90, 30, 6, { fill: "surface", stroke: "border", width: 1 })
  return g
}

async function main(data) {
  widget.render(ui.column({ gap: 1, align: "stretch" }, [ui.text(data.title, { style: "title" }), ui.canvas({ key: "plot", height: 600, fps: 60 })]))
  const start = widget.now()
  while (true) {
    const frame = await widget.frame()
    widget.draw("plot", scene((widget.now() - start) / 1000, frame.width, frame.height))
  }
}
