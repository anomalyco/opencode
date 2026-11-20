// A flowchart: nodes (process, decision, terminal, io) and directed edges, laid out top down in layers. `init` does
// the layout once (Sugiyama style: reverse cycle edges, longest-path layers, dummy points on long edges, barycenter
// ordering, then x positions pulled toward neighbors) in slot units, so draws only scale it. Layers fade in; tap a node
// to highlight its edges. With `choose`, the Choose button submits the selected node.

const LAYER = 84

function init(data) {
  return { selected: null, ...arrange(data) }
}

function view(state, data) {
  const picked = state.selected === null ? null : data.nodes[state.selected]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: state.layers * LAYER - 20,
      fps: 60,
      duration: intro(state),
      alt: summary(data),
    }),
    ui.text(picked ? describe(data, state.selected) : "Tap a step to follow its edges", {
      style: "caption",
      tone: picked ? "default" : "muted",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose step", { onPress: (state) => choose(state, data), variant: "primary", disabled: !picked }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const node = data.nodes[state.selected]
    return submit({ id: node.id, label: node.label ?? node.id })
  }
  return state
}

function tap(state, data, pointer) {
  if (pointer.kind !== "up") return state
  const boxes = place(state, data, pointer.width)
  const hit = boxes.findIndex(
    (box) => Math.abs(pointer.x - box.x) <= box.w / 2 + 4 && Math.abs(pointer.y - box.y) <= box.h / 2 + 4,
  )
  return { ...state, selected: hit < 0 || hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const boxes = place(state, data, frame.width)
  const columns = grid(state, frame.width)
  const hover =
    frame.pointer && !frame.pointer.down
      ? boxes.findIndex(
          (box) => Math.abs(frame.pointer.x - box.x) <= box.w / 2 && Math.abs(frame.pointer.y - box.y) <= box.h / 2,
        )
      : -1
  const active = hover >= 0 ? hover : state.selected
  const step = intro(state) / Math.max(1, state.layers)
  for (let layer = 0; layer < state.layers; layer++) {
    const fade = ease((frame.t - layer * step * 0.8) / (step * 1.6))
    if (fade <= 0) break
    g.save().alpha(fade)
    state.edges.forEach((edge, index) => {
      const from = data.edges[index]
      const ends = [state.ids[from.from], state.ids[from.to]]
      if (Math.max(boxes[ends[0]].layer, boxes[ends[1]].layer) !== layer) return
      const lit = active !== null && ends.includes(active)
      connect(g, edge, ends, boxes, columns, from.label, lit, frame.t >= intro(state))
    })
    data.nodes.forEach((node, index) => {
      if (boxes[index].layer === layer) shape(g, node, boxes[index], index === active, index === state.selected)
    })
    g.restore()
  }
  return g.commands
}

// Layered layout in slot units: every node and dummy point gets a layer and an x; edges keep their point chains.
function arrange(data) {
  const ids = Object.fromEntries(data.nodes.map((node, at) => [node.id, at]))
  for (const edge of data.edges)
    for (const id of [edge.from, edge.to])
      if (ids[id] === undefined) throw new Error('Unknown node id "' + id + '" in edges')
  const n = data.nodes.length
  const pairs = data.edges.map((edge) => [ids[edge.from], ids[edge.to]])
  // Depth-first from the sources; an edge back onto the stack closes a cycle and is reversed for layering.
  const seen = new Array(n).fill(0)
  const back = new Set()
  const visit = (node) => {
    seen[node] = 1
    pairs.forEach(([a, b], edge) => {
      if (a !== node || a === b) return
      if (seen[b] === 1) back.add(edge)
      else if (seen[b] === 0) visit(b)
    })
    seen[node] = 2
  }
  const sources = data.nodes.map((_, at) => at).filter((at) => !pairs.some(([a, b]) => b === at && a !== b))
  for (const start of [...sources, ...data.nodes.map((_, at) => at)]) if (seen[start] === 0) visit(start)
  const dag = pairs.map(([a, b], edge) => (back.has(edge) ? [b, a] : [a, b]))
  const layer = new Array(n).fill(0)
  for (let pass = 0; pass < n; pass++)
    for (const [a, b] of dag) if (a !== b && layer[b] < layer[a] + 1) layer[b] = layer[a] + 1
  // Items are nodes, then one dummy per layer an edge skips; each edge becomes a chain of items.
  const items = data.nodes.map((_, at) => ({ layer: layer[at], x: 0 }))
  const chains = dag.map(([a, b]) => {
    const chain = [a]
    for (let at = layer[a] + 1; at < layer[b]; at++) {
      items.push({ layer: at, x: 0 })
      chain.push(items.length - 1)
    }
    chain.push(b)
    return chain
  })
  const up = items.map(() => [])
  const down = items.map(() => [])
  for (const chain of chains)
    for (let at = 1; at < chain.length; at++) {
      if (chain[at - 1] === chain[at]) continue
      down[chain[at - 1]].push(chain[at])
      up[chain[at]].push(chain[at - 1])
    }
  const layers = Math.max(...layer) + 1
  const rows = []
  for (let at = 0; at < layers; at++)
    rows.push(items.map((_, index) => index).filter((index) => items[index].layer === at))
  // Barycenter ordering, alternating downward and upward sweeps.
  const position = items.map(() => 0)
  const number = () => rows.forEach((row) => row.forEach((item, at) => (position[item] = at)))
  number()
  for (let sweep = 0; sweep < 8; sweep++) {
    const downward = sweep % 2 === 0
    for (const row of downward ? rows : [...rows].reverse()) {
      const score = (item) => {
        const near = downward ? up[item] : down[item]
        return near.length ? near.reduce((sum, other) => sum + position[other], 0) / near.length : position[item]
      }
      const scores = new Map(row.map((item) => [item, score(item)]))
      row.sort((a, b) => scores.get(a) - scores.get(b))
      row.forEach((item, at) => (position[item] = at))
    }
  }
  // x: start packed and centered, then pull toward neighbors while keeping the order and a minimum gap.
  rows.forEach((row) => row.forEach((item, at) => (items[item].x = at - (row.length - 1) / 2)))
  const gap = (a, b) => (a < n && b < n ? 1 : a < n || b < n ? 0.6 : 0.3)
  for (let pass = 0; pass < 8; pass++) {
    const downward = pass % 2 === 0
    for (const row of downward ? rows : [...rows].reverse()) {
      const desired = row.map((item) => {
        const near = [...(downward ? up[item] : down[item])]
        return near.length ? near.reduce((sum, other) => sum + items[other].x, 0) / near.length : items[item].x
      })
      const xs = [...desired]
      for (let at = 1; at < row.length; at++) xs[at] = Math.max(xs[at], xs[at - 1] + gap(row[at - 1], row[at]))
      const shift = desired.reduce((sum, value, at) => sum + value - xs[at], 0) / row.length
      row.forEach((item, at) => (items[item].x = xs[at] + shift))
    }
  }
  const min = Math.min(...items.map((item) => item.x))
  const round = (value) => Math.round((value - min) * 1000) / 1000
  return {
    ids,
    layers,
    span: Math.max(...items.map((item) => item.x)) - min,
    nodes: items.slice(0, n).map((item) => ({ x: round(item.x), layer: item.layer })),
    edges: chains.map((chain, edge) => {
      const points = chain.map((item) => [round(items[item].x), items[item].layer])
      return { points: back.has(edge) ? points.reverse() : points, self: pairs[edge][0] === pairs[edge][1] }
    }),
  }
}

// Slot units to pixels: at most 190 px per slot, the whole span centered in the width.
function grid(state, width) {
  const unit = Math.min(190, (width - 16) / (state.span + 1))
  const left = (width - unit * (state.span + 1)) / 2
  return { unit, x: (slot) => left + (slot + 0.5) * unit, y: (layer) => 10 + layer * LAYER + 22 }
}

function place(state, data, width) {
  const columns = grid(state, width)
  const unit = columns.unit
  return data.nodes.map((node, index) => {
    const lines = wrap(node.label ?? node.id, Math.floor((Math.min(170, unit - 14) - 16) / 6.8))
    const decision = node.shape === "decision"
    const text = Math.max(...lines.map((line) => line.length)) * 6.8 + 24
    const w = Math.min(unit - 8, decision ? text * 1.4 + 10 : text)
    const h = decision ? 54 : lines.length > 1 ? 44 : 34
    const at = state.nodes[index]
    return { x: columns.x(at.x), y: columns.y(at.layer), w, h, lines, layer: at.layer }
  })
}

function shape(g, node, box, active, selected) {
  const paint = {
    fill: "surface",
    stroke: selected ? "accent" : active ? "muted" : (node.color ?? "border"),
    width: selected ? 2 : 1.25,
  }
  const left = box.x - box.w / 2
  const top = box.y - box.h / 2
  if (node.shape === "decision")
    g.path(
      [["M", box.x, top], ["L", box.x + box.w / 2, box.y], ["L", box.x, top + box.h], ["L", left, box.y], ["Z"]],
      paint,
    )
  else if (node.shape === "io")
    g.path(
      [
        ["M", left + 8, top],
        ["L", left + box.w, top],
        ["L", left + box.w - 8, top + box.h],
        ["L", left, top + box.h],
        ["Z"],
      ],
      paint,
    )
  else g.rrect(left, top, box.w, box.h, node.shape === "terminal" ? box.h / 2 : 6, paint)
  box.lines.forEach((line, at) =>
    g.text(box.x, box.y + 4 + (at - (box.lines.length - 1) / 2) * 15, line, {
      size: 12,
      align: "center",
      weight: node.shape === "terminal" ? 600 : 400,
    }),
  )
}

// An edge through its points: leave a node from its bottom (or top, going up), curve through dummies, arrive with an arrow.
function connect(g, edge, ends, boxes, columns, label, lit, labels) {
  const stroke = lit ? "accent" : "muted"
  const width = lit ? 2 : 1.25
  const from = boxes[ends[0]]
  if (edge.self) {
    const x = from.x + from.w / 2
    g.path(
      [
        ["M", x, from.y - 6],
        ["C", x + 30, from.y - 22, x + 30, from.y + 22, x + 2, from.y + 6],
      ],
      { stroke, width },
    )
    return
  }
  const points = edge.points.map(([x, layer], at) => {
    const real = at === 0 ? boxes[ends[0]] : at === edge.points.length - 1 ? boxes[ends[1]] : null
    return real ? { x: real.x, y: real.y, h: real.h } : { x: columns.x(x), y: columns.y(layer), h: 0 }
  })
  const start = points[1].y > points[0].y ? 1 : -1
  let x0 = points[0].x
  let y0 = points[0].y + (start * points[0].h) / 2
  const segments = [["M", x0, y0]]
  for (let at = 1; at < points.length; at++) {
    const p = points[at]
    const dir = p.y > points[at - 1].y ? 1 : -1
    const y1 = p.y - (dir * p.h) / 2 - (at === points.length - 1 ? dir * 2 : 0)
    const bend = (y1 - y0) / 2
    segments.push(["C", x0, y0 + bend, p.x, y1 - bend, p.x, y1])
    x0 = p.x
    y0 = y1
  }
  g.path(segments, { stroke, width })
  const tip = segments[segments.length - 1]
  const dir = points[points.length - 1].y > points[points.length - 2].y ? 1 : -1
  const tx = tip[5]
  const ty = tip[6] + dir * 2
  g.path([["M", tx, ty], ["L", tx - 4.5, ty - dir * 8], ["L", tx + 4.5, ty - dir * 8], ["Z"]], stroke)
  if (label && labels) {
    const first = segments[1]
    const mx = (segments[0][1] + first[5]) / 2
    const my = (segments[0][2] + first[6]) / 2
    const w = 6.4 * label.length + 10
    g.rrect(mx - w / 2, my - 9, w, 16, 4, "bg")
    g.text(mx, my + 3, label, { size: 11, align: "center", color: lit ? "text" : "muted" })
  }
}

function intro(state) {
  return Math.round(Math.min(1.6, 0.3 + 0.15 * state.layers) * 100) / 100
}

// Splits a label into at most two lines of about `max` characters.
function wrap(label, max) {
  if (label.length <= max) return [label]
  const words = label.split(" ")
  let first = ""
  while (words.length && (first + " " + words[0]).trim().length <= max) first = (first + " " + words.shift()).trim()
  if (!first) first = words.shift()
  const rest = words.join(" ")
  return [fit(first, max), rest ? fit(rest, max) : null].filter(Boolean)
}

function describe(data, index) {
  const node = data.nodes[index]
  const name = (id) => data.nodes.find((item) => item.id === id)?.label ?? id
  const next = data.edges
    .filter((edge) => edge.from === node.id)
    .map((edge) => name(edge.to) + (edge.label ? " (" + edge.label + ")" : ""))
  const previous = data.edges.filter((edge) => edge.to === node.id).map((edge) => name(edge.from))
  return [
    node.label ?? node.id,
    next.length ? "next: " + next.join(", ") : "",
    previous.length ? "from: " + previous.join(", ") : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

function summary(data) {
  const name = (id) => data.nodes.find((item) => item.id === id)?.label ?? id
  return (
    "Flowchart. " +
    data.edges
      .map((edge) => name(edge.from) + " → " + (edge.label ? "[" + edge.label + "] " : "") + name(edge.to))
      .join("; ")
  )
}

function fit(text, max) {
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
