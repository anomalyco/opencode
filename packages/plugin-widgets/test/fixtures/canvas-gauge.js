// A canvas gauge that animates in: draw(state, data, frame) with a short intro.
function view(state, data) {
  return ui.column({ gap: 1 }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({ id: "gauge", height: 120, fps: 60, duration: 0.8, alt: data.title + ": " + data.value + "%" }),
  ])
}
function draw(state, data, frame) {
  const g = ui.draw()
  const p = (Math.min(1, frame.t / 0.8) * data.value) / 100
  g.rrect(0, 40, frame.width, 16, 8, "surface")
  g.rrect(0, 40, frame.width * p, 16, 8, "accent")
  g.text(frame.width / 2, 90, Math.round(p * 100) + "%", { size: 20, weight: 600, align: "center" })
  return g.commands
}
