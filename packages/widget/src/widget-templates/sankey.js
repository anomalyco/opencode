// A Sankey diagram: flows between stages. `init` lays it out once in unit coordinates (stage columns, node heights by
// value, a few relaxation passes to straighten the flows), so draws only scale it. Hovering or tapping a node
// highlights every flow through it; tapping a flow highlights it. With `choose`, the Choose button submits the selection.

const HEIGHT = 300
const INTRO = 0.8
const NODE = 10
const GAP = 0.05
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

function init(data) {
  return { selected: null, ...arrange(data) }
}

function view(state, data) {
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEIGHT,
      fps: 60,
      duration: INTRO,
      alt: summary(state, data),
    }),
    ui.text(state.selected ? describe(state, data, state.selected) : "Tap a stage or a flow to trace it", {
      style: "caption",
      tone: state.selected ? "default" : "muted",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button("Choose", { onPress: (state) => choose(state, data), variant: "primary", disabled: !state.selected }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected) {
    if (state.selected.kind === "link") {
      const link = data.links[state.selected.index]
      return submit({ kind: "link", source: link.source, target: link.target, value: link.value })
    }
    const node = data.nodes[state.selected.index]
    return submit({
      kind: "node",
      id: node.id,
      label: node.label ?? node.id,
      value: state.nodes[state.selected.index].value,
    })
  }
  return state
}

function tap(state, data, pointer) {
  pointer = below(pointer)
  if (pointer.kind !== "up") return state
  const hit = locate(state, frameOf(state, pointer.width, pointer.height), pointer.x, pointer.y)
  const same = hit && state.selected && hit.kind === state.selected.kind && hit.index === state.selected.index
  return { ...state, selected: same ? null : hit }
}

function draw(state, data, frame) {
  frame = below(frame)
  const g = ui.draw()
  if (frame.top) g.translate(0, frame.top)
  const box = frameOf(state, frame.width, frame.height)
  const hover = frame.pointer && !frame.pointer.down ? locate(state, box, frame.pointer.x, frame.pointer.y) : null
  const active = hover ?? state.selected
  const lit = active ? trace(state, active) : null
  const grow = ease(frame.t / INTRO)
  // Dim flows in one alpha group, highlighted flows in another, then the nodes on top.
  for (const highlighted of [false, true]) {
    const links = state.links.filter((_, index) => (lit ? lit.links.has(index) : false) === highlighted)
    if (links.length === 0) continue
    g.save().alpha((highlighted ? 0.75 : lit ? 0.12 : 0.45) * grow)
    for (const link of links) g.path(band(box, state, link), color(data, link.source))
    g.restore()
  }
  state.nodes.forEach((node, index) => {
    const r = rect(box, node)
    const h = r.h * grow
    const dim = lit && !lit.nodes.has(index)
    if (dim) g.save().alpha(0.35)
    g.rect(r.x, r.y + (r.h - h) / 2, NODE, Math.max(1, h), color(data, index))
    if (dim) g.restore()
    const last = node.column === state.columns - 1
    const text = fit(data.nodes[index].label ?? data.nodes[index].id, box.w / Math.max(2, state.columns) - 16, 12)
    g.text(last ? r.x - 6 : r.x + NODE + 6, r.y + r.h / 2 + 4, text, {
      size: 12,
      align: last ? "right" : "left",
      weight: lit && lit.nodes.has(index) ? 600 : 400,
      color: dim ? "muted" : "text",
    })
  })
  return g.commands
}

// Unit layout: column = longest path from a source (sinks pushed to the last column), y extents in 0..1.
function arrange(data) {
  const index = new Map(data.nodes.map((node, at) => [node.id, at]))
  for (const link of data.links)
    for (const id of [link.source, link.target])
      if (!index.has(id)) throw new Error('Unknown node id "' + id + '" in links')
  const links = data.links.map((link) => ({
    source: index.get(link.source),
    target: index.get(link.target),
    value: link.value,
  }))
  const nodes = data.nodes.map(() => ({ column: 0, value: 0, in: 0, out: 0 }))
  for (const link of links) {
    nodes[link.source].out += link.value
    nodes[link.target].in += link.value
  }
  for (let pass = 0; pass < nodes.length; pass++)
    for (const link of links)
      if (nodes[link.target].column < nodes[link.source].column + 1 && link.source !== link.target)
        nodes[link.target].column = Math.min(nodes.length - 1, nodes[link.source].column + 1)
  const columns = Math.max(...nodes.map((node) => node.column)) + 1
  nodes.forEach((node) => {
    node.value = Math.max(node.in, node.out)
    if (node.out === 0 && node.in > 0) node.column = columns - 1
  })
  const stacks = []
  for (let column = 0; column < columns; column++)
    stacks.push(nodes.map((_, at) => at).filter((at) => nodes[at].column === column))
  const ky = Math.min(
    ...stacks
      .filter((stack) => stack.length)
      .map((stack) => (1 - GAP * (stack.length - 1)) / stack.reduce((sum, at) => sum + nodes[at].value, 0)),
  )
  stacks.forEach((stack) => {
    let y = 0
    for (const at of stack) {
      nodes[at].y0 = y
      nodes[at].y1 = y + nodes[at].value * ky
      y = nodes[at].y1 + GAP
    }
  })
  // Move each node toward the value-weighted center of its neighbors, then resolve overlaps; alternate directions.
  const center = (at) => (nodes[at].y0 + nodes[at].y1) / 2
  for (let pass = 0; pass < 6; pass++) {
    const forward = pass % 2 === 0
    for (const stack of forward ? stacks : [...stacks].reverse()) {
      for (const at of stack) {
        const near = links.filter((link) => (forward ? link.target === at : link.source === at))
        const weight = near.reduce((sum, link) => sum + link.value, 0)
        if (weight === 0) continue
        const target =
          near.reduce((sum, link) => sum + center(forward ? link.source : link.target) * link.value, 0) / weight
        const shift = (target - center(at)) * 0.6
        nodes[at].y0 += shift
        nodes[at].y1 += shift
      }
      stack.sort((a, b) => nodes[a].y0 - nodes[b].y0)
      let y = 0
      for (const at of stack) {
        const push = Math.max(0, y - nodes[at].y0)
        nodes[at].y0 += push
        nodes[at].y1 += push
        y = nodes[at].y1 + GAP
      }
      let bottom = 1
      for (const at of [...stack].reverse()) {
        const pull = Math.max(0, nodes[at].y1 - bottom)
        nodes[at].y0 -= pull
        nodes[at].y1 -= pull
        bottom = nodes[at].y0 - GAP
      }
    }
  }
  // Stack each node's flows in the order of the nodes at their other end.
  const placed = links.map((link) => ({ ...link, width: link.value * ky, sy: 0, ty: 0 }))
  nodes.forEach((node, at) => {
    let out = node.y0
    placed
      .filter((link) => link.source === at)
      .sort((a, b) => nodes[a.target].y0 - nodes[b.target].y0)
      .forEach((link) => {
        link.sy = out
        out += link.width
      })
    let into = node.y0
    placed
      .filter((link) => link.target === at)
      .sort((a, b) => nodes[a.source].y0 - nodes[b.source].y0)
      .forEach((link) => {
        link.ty = into
        into += link.width
      })
  })
  const round = (value) => Math.round(value * 10000) / 10000
  return {
    columns,
    nodes: nodes.map((node) => ({ column: node.column, value: node.value, y0: round(node.y0), y1: round(node.y1) })),
    links: placed.map((link) => ({
      source: link.source,
      target: link.target,
      width: round(link.width),
      sy: round(link.sy),
      ty: round(link.ty),
    })),
  }
}

function frameOf(state, width, height) {
  return { x: 8, y: 8, w: Math.max(1, width - 16 - NODE), h: Math.max(1, height - 16), columns: state.columns }
}

function rect(box, node) {
  const x = box.x + (box.columns === 1 ? 0 : (box.w * node.column) / (box.columns - 1))
  return { x, y: box.y + node.y0 * box.h, h: Math.max(1, (node.y1 - node.y0) * box.h) }
}

// A flow as a filled band between two cubic curves.
function band(box, state, link) {
  const from = rect(box, state.nodes[link.source])
  const to = rect(box, state.nodes[link.target])
  const sx = from.x + NODE
  const tx = to.x
  const mid = (sx + tx) / 2
  const sy = box.y + link.sy * box.h
  const ty = box.y + link.ty * box.h
  const w = Math.max(1, link.width * box.h)
  return [
    ["M", sx, sy],
    ["C", mid, sy, mid, ty, tx, ty],
    ["L", tx, ty + w],
    ["C", mid, ty + w, mid, sy + w, sx, sy + w],
    ["Z"],
  ]
}

// Everything upstream and downstream of a node, or one flow and its two nodes.
function trace(state, active) {
  if (active.kind === "link") {
    const link = state.links[active.index]
    return { links: new Set([active.index]), nodes: new Set([link.source, link.target]) }
  }
  const links = new Set()
  const nodes = new Set([active.index])
  for (const forward of [true, false]) {
    const queue = [active.index]
    while (queue.length) {
      const at = queue.shift()
      state.links.forEach((link, index) => {
        if ((forward ? link.source : link.target) !== at || links.has(index)) return
        links.add(index)
        const next = forward ? link.target : link.source
        nodes.add(next)
        queue.push(next)
      })
    }
  }
  return { links, nodes }
}

function locate(state, box, px, py) {
  const node = state.nodes.findIndex((node) => {
    const r = rect(box, node)
    return px >= r.x - 6 && px <= r.x + NODE + 6 && py >= r.y - 2 && py <= r.y + r.h + 2
  })
  if (node >= 0) return { kind: "node", index: node }
  // On a flow: solve the curve's x(t) for t by bisection, then compare y with the band's top edge there.
  const link = state.links.findIndex((link) => {
    const sx = rect(box, state.nodes[link.source]).x + NODE
    const tx = rect(box, state.nodes[link.target]).x
    if (px < sx || px > tx) return false
    let low = 0
    let high = 1
    for (let step = 0; step < 12; step++) {
      const t = (low + high) / 2
      if (sx + (tx - sx) * (1.5 * t * (1 - t) + t * t * t) < px) low = t
      else high = t
    }
    const t = (low + high) / 2
    const top = box.y + (link.sy + (link.ty - link.sy) * (3 * t * t - 2 * t * t * t)) * box.h
    return py >= top - 2 && py <= top + Math.max(4, link.width * box.h) + 2
  })
  return link >= 0 ? { kind: "link", index: link } : null
}

function describe(state, data, active) {
  const name = (at) => data.nodes[at].label ?? data.nodes[at].id
  if (active.kind === "link") {
    const link = state.links[active.index]
    const value = data.links[active.index].value
    return (
      name(link.source) +
      " → " +
      name(link.target) +
      ": " +
      amount(value, data.unit) +
      " (" +
      share(value, state.nodes[link.source].value) +
      " of " +
      name(link.source) +
      ")"
    )
  }
  const node = state.nodes[active.index]
  const sources = state.links.filter((link) => link.target === active.index).length
  const targets = state.links.filter((link) => link.source === active.index).length
  return name(active.index) + ": " + amount(node.value, data.unit) + " · " + sources + " in, " + targets + " out"
}

function summary(state, data) {
  const name = (id) => data.nodes.find((node) => node.id === id)?.label ?? id
  return (
    "Sankey diagram with " +
    state.columns +
    " stages. Flows: " +
    [...data.links]
      .sort((a, b) => b.value - a.value)
      .map((link) => name(link.source) + " → " + name(link.target) + " " + amount(link.value, data.unit))
      .join(", ")
  )
}

function color(data, index) {
  return data.nodes[index].color ?? PALETTE[index % PALETTE.length]
}

function share(part, whole) {
  return (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0) + "%"
}

function amount(value, unit) {
  const text = String(Math.round(value * 100) / 100)
  if (!unit) return text
  return unit.length > 1 && /^[a-z]/i.test(unit) ? text + " " + unit : text + unit
}

function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}

// In full screen, the layout starts below the close button when it overlaps this canvas (widgets-fullscreen.md):
// `close` comes with the frame and the pointer, so drawing and hit testing agree.
function below(area) {
  const top = area.close ? Math.max(0, area.close.y + area.close.height) : 0
  if (top === 0) return area
  return {
    ...area,
    top,
    height: area.height - top,
    ...(typeof area.y === "number" ? { y: area.y - top } : {}),
    ...(area.pointer ? { pointer: { ...area.pointer, y: area.pointer.y - top } } : {}),
  }
}
