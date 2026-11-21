// A network of nodes and edges. `init` runs a deterministic force layout once (links pull, nodes repel, weak gravity)
// and keeps a few snapshots of it in unit coordinates; the canvas plays them back so the graph settles in over the
// intro, then draws only on taps. Tap a node to select it and highlight its neighbors. With `choose`, the Choose button
// submits the selected node.

const HEIGHT = 320
const INTRO = 1.2
const PAD = 22
const STEPS = [0, 0.04, 0.1, 0.22, 0.45, 1]
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

function init(data) {
  return { selected: null, ...settle(data) }
}

function view(state, data) {
  const picked = state.selected === null ? null : data.nodes[state.selected]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEIGHT,
      fps: 60,
      duration: INTRO,
      alt: summary(state, data),
    }),
    ui.text(picked ? describe(state, data, state.selected) : "Tap a node to see its neighbors", {
      style: "caption",
      tone: picked ? "default" : "muted",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button(picked ? "Choose " + name(picked) : "Choose", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: !picked,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const node = data.nodes[state.selected]
    return submit({
      id: node.id,
      label: name(node),
      neighbors: neighbors(state, state.selected).map((at) => data.nodes[at].id),
    })
  }
  return state
}

function tap(state, data, pointer) {
  if (pointer.kind !== "up") return state
  const hit = locate(state, data, positions(state, 1, pointer.width, pointer.height), pointer.x, pointer.y)
  return { ...state, selected: hit === state.selected ? null : hit }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const at = positions(state, ease(frame.t / INTRO), frame.width, frame.height)
  const hover = frame.pointer && !frame.pointer.down ? locate(state, data, at, frame.pointer.x, frame.pointer.y) : null
  const active = hover ?? state.selected
  const near = active === null ? null : new Set([active, ...neighbors(state, active)])
  const groups = [...new Set(data.nodes.map((node) => node.group ?? ""))]
  const fill = (index) =>
    data.nodes[index].color ??
    (groups.length > 1 ? PALETTE[groups.indexOf(data.nodes[index].group ?? "") % PALETTE.length] : "accent")
  const touches = (edge) => active !== null && (edge[0] === active || edge[1] === active)
  for (const lit of [false, true]) {
    const edges = state.edges.filter((edge) => touches(edge) === lit)
    if (edges.length === 0) continue
    g.save().alpha(lit ? 0.9 : active === null ? 0.5 : 0.15)
    for (const [a, b, weight] of edges) {
      if (a === b) continue
      const stroke = lit ? fill(active) : "muted"
      g.line(at[a][0], at[a][1], at[b][0], at[b][1], { stroke, width: (lit ? 1.5 : 1) * weight })
      if (data.directed) arrow(g, at[a], at[b], radius(state, data, b) + 2, stroke)
    }
    g.restore()
  }
  if (frame.t >= INTRO)
    data.edges.forEach((edge, index) => {
      const [a, b] = state.edges[index]
      if (!edge.label || a === b || !(touches(state.edges[index]) || (active === null && data.edges.length <= 16)))
        return
      g.text((at[a][0] + at[b][0]) / 2, (at[a][1] + at[b][1]) / 2 - 4, edge.label, {
        size: 10,
        align: "center",
        color: "muted",
      })
    })
  const labelled = new Set(
    data.nodes.length <= 30
      ? data.nodes.map((_, index) => index)
      : [
          ...state.degree
            .map((d, i) => [d, i])
            .sort((a, b) => b[0] - a[0])
            .slice(0, 8)
            .map((pair) => pair[1]),
          ...(near ?? []),
        ],
  )
  data.nodes.forEach((node, index) => {
    const r = radius(state, data, index)
    const dim = near && !near.has(index)
    if (dim) g.save().alpha(0.3)
    g.circle(at[index][0], at[index][1], r, { fill: fill(index), stroke: "bg", width: 1.5 })
    if (index === active) g.circle(at[index][0], at[index][1], r + 3, { stroke: "text", width: 2 })
    if (labelled.has(index) && frame.t >= INTRO * 0.5)
      g.text(at[index][0], at[index][1] + r + 12, fit(name(node), 120, 11), {
        size: 11,
        align: "center",
        weight: index === active ? 600 : 400,
        color: dim ? "muted" : "text",
      })
    if (dim) g.restore()
  })
  return g.commands
}

// Velocity-Verlet force simulation in unit space (link length 1), keeping snapshots at the STEPS fractions.
function settle(data) {
  const index = new Map(data.nodes.map((node, at) => [node.id, at]))
  for (const edge of data.edges)
    for (const id of [edge.source, edge.target])
      if (!index.has(id)) throw new Error('Unknown node id "' + id + '" in edges')
  const n = data.nodes.length
  const edges = data.edges.map((edge) => [index.get(edge.source), index.get(edge.target), edge.weight ?? 1])
  const degree = data.nodes.map(() => 0)
  for (const [a, b] of edges) {
    degree[a]++
    degree[b]++
  }
  const xs = []
  const ys = []
  for (let i = 0; i < n; i++) {
    const r = 0.5 * Math.sqrt(0.5 + i)
    xs.push(r * Math.cos(i * 2.39996))
    ys.push(r * Math.sin(i * 2.39996))
  }
  const vx = xs.map(() => 0)
  const vy = xs.map(() => 0)
  // About 20k pair updates in all: enough to settle 40 nodes, cheap enough for a 250 ms step.
  const iterations = Math.max(24, Math.min(160, Math.round(20000 / ((n * n) / 2 + edges.length + 1))))
  const keep = new Set(STEPS.map((step) => Math.round(step * iterations)))
  const snapshots = []
  let alpha = 1
  const decay = 1 - Math.pow(0.001, 1 / iterations)
  for (let step = 0; step <= iterations; step++) {
    if (keep.has(step)) snapshots.push([...xs.map((x, i) => [x, ys[i]])])
    for (const [a, b] of edges) {
      if (a === b) continue
      const dx = xs[b] + vx[b] - xs[a] - vx[a]
      const dy = ys[b] + vy[b] - ys[a] - vy[a]
      const d = Math.hypot(dx, dy) || 1e-6
      const pull = ((d - 1) / d) * alpha * (1 / Math.min(degree[a], degree[b]))
      const bias = degree[a] / (degree[a] + degree[b])
      vx[b] -= dx * pull * bias
      vy[b] -= dy * pull * bias
      vx[a] += dx * pull * (1 - bias)
      vy[a] += dy * pull * (1 - bias)
    }
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = xs[j] - xs[i]
        const dy = ys[j] - ys[i]
        const d2 = Math.max(0.01, dx * dx + dy * dy)
        const push = (0.6 * alpha) / d2
        vx[i] -= dx * push
        vy[i] -= dy * push
        vx[j] += dx * push
        vy[j] += dy * push
      }
    for (let i = 0; i < n; i++) {
      vx[i] = (vx[i] - xs[i] * 0.06 * alpha) * 0.6
      vy[i] = (vy[i] - ys[i] * 0.06 * alpha) * 0.6
      xs[i] += vx[i]
      ys[i] += vy[i]
    }
    alpha -= alpha * decay
  }
  // Fit every snapshot with the final layout's bounds, so early ones start small in the middle and spread out.
  const last = snapshots[snapshots.length - 1]
  const minX = Math.min(...last.map((p) => p[0]))
  const minY = Math.min(...last.map((p) => p[1]))
  const spanX = Math.max(1e-6, Math.max(...last.map((p) => p[0])) - minX)
  const spanY = Math.max(1e-6, Math.max(...last.map((p) => p[1])) - minY)
  const unit = (value, min, span) => Math.round(((value - min) / span) * 1000) / 1000
  return {
    frames: snapshots.map((points) => points.map((p) => [unit(p[0], minX, spanX), unit(p[1], minY, spanY)])),
    edges: edges.map(([a, b, weight]) => [a, b, Math.max(0.5, Math.min(4, weight))]),
    degree,
  }
}

// Pixel positions at intro progress p (0..1), interpolated between snapshots.
function positions(state, p, width, height) {
  const at = p * (state.frames.length - 1)
  const from = Math.min(state.frames.length - 1, Math.floor(at))
  const to = Math.min(state.frames.length - 1, from + 1)
  const mix = at - from
  return state.frames[from].map((point, index) => {
    const end = state.frames[to][index]
    return [
      PAD + (point[0] + (end[0] - point[0]) * mix) * (width - 2 * PAD),
      PAD - 4 + (point[1] + (end[1] - point[1]) * mix) * (height - 2 * PAD - 8),
    ]
  })
}

function radius(state, data, index) {
  const size = data.nodes[index].size
  if (size !== undefined) return 4 + 10 * Math.sqrt(size / Math.max(...data.nodes.map((node) => node.size ?? 0), 1e-6))
  return 5 + 1.6 * Math.sqrt(state.degree[index])
}

function neighbors(state, index) {
  return [...new Set(state.edges.flatMap(([a, b]) => (a === b ? [] : a === index ? [b] : b === index ? [a] : [])))]
}

function locate(state, data, at, px, py) {
  let best = null
  let distance = Infinity
  at.forEach((point, index) => {
    const d = Math.hypot(point[0] - px, point[1] - py) - radius(state, data, index)
    if (d < Math.min(distance, 10)) {
      distance = d
      best = index
    }
  })
  return best
}

function arrow(g, from, to, inset, color) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const tip = [to[0] - Math.cos(angle) * inset, to[1] - Math.sin(angle) * inset]
  const side = (turn) => ["L", tip[0] - Math.cos(angle + turn) * 8, tip[1] - Math.sin(angle + turn) * 8]
  g.path([["M", tip[0], tip[1]], side(0.4), side(-0.4), ["Z"]], color)
}

function describe(state, data, index) {
  const node = data.nodes[index]
  const near = neighbors(state, index).map((at) => name(data.nodes[at]))
  return (
    name(node) +
    (node.group ? " (" + node.group + ")" : "") +
    " · " +
    near.length +
    (near.length === 1 ? " neighbor" : " neighbors") +
    (near.length ? ": " + near.slice(0, 8).join(", ") + (near.length > 8 ? ", …" : "") : "")
  )
}

function summary(state, data) {
  const hubs = state.degree
    .map((degree, index) => [degree, index])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map((pair) => name(data.nodes[pair[1]]) + " (" + pair[0] + ")")
  return (
    "Network of " + data.nodes.length + " nodes and " + data.edges.length + " edges. Most connected: " + hubs.join(", ")
  )
}

function name(node) {
  return node.label ?? node.id
}

function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
