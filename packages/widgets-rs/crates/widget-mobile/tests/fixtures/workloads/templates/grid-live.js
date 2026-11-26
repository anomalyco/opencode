// Bench workload: a live grid of plain text cells (no per-frame layout work), re-rendered every frame with one cell
// changed, so the view tree is large (200 rows × 5 cells ≈ 1,200 nodes) and the change is one prop of one node. The
// built-in `table` template does O(rows²) layout work per view (`line` calls `numeric` for every cell), which caps a
// live 200-row table at over 50 ms of compute a frame before any format cost (see the report).

function view(state, data) {
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.row({ gap: 1 }, data.columns.map((c) => ui.text(c, { style: "caption", tone: "muted" }))),
    data.rows.map((r) => ui.row({ gap: 1, align: "center" }, r.map((cell) => ui.text(cell, { style: "code" })))),
  ])
}

async function main(data) {
  let frame = 0
  while (true) {
    await widget.frame()
    const row = data.rows[frame % data.rows.length]
    row[2] = row[2].endsWith("0") ? row[2].slice(0, -1) + "1" : row[2].slice(0, -1) + "0"
    frame++
    widget.render(view(null, data))
  }
}
