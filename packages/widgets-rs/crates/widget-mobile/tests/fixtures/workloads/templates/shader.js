// Bench workload: a live shader game. Every frame it renders the same view with new GPU canvas `values` (16 floats);
// the WGSL (the built-in backdrop's plasma preset) and everything else stay the same. `view` also runs as a step
// (data.t) so the step harness can take the same render apart.

function view(state, data) {
  const t = data.t ?? 0
  const values = []
  for (let i = 0; i < 16; i++) values.push(Math.sin(t * (1 + i * 0.37) + i) * 0.5 + 0.5)
  values[0] = 1
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({ key: "game", height: 320, fps: 60, wgsl: data.wgsl, values, alt: "A shader game: tap to steer" }),
    ui.row({ gap: 1, align: "center" }, [
      ui.text("Score " + data.score, { style: "caption", tone: "muted" }),
      ui.button("Restart", { variant: "secondary" }),
    ]),
  ])
}

async function main(data) {
  const start = widget.now()
  while (true) {
    await widget.frame()
    widget.render(view(null, { ...data, t: (widget.now() - start) / 1000 + 1 }))
  }
}
