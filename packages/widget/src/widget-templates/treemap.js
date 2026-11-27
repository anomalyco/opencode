// A squarified treemap of a hierarchy: each item's area is its value (a parent's value defaults to the sum of its
// children). Two levels show at a time. Tap a block with children to drill into it, tap a leaf to select it, and use
// Back to go up. With `choose`, the Choose button submits the selected node.

const HEIGHT = 280
const INTRO = 0.6
const HEADER = 18
// Leaves room for the outlines under the spec's 2,000 commands per frame.
const BUDGET = 1900
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

function init(data) {
  return { path: [], selected: null }
}

function view(state, data) {
  const node = focus(data, state.path)
  const picked = state.selected === null ? null : node.children[state.selected]
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    state.path.length > 0 &&
      ui.row({ gap: 1, align: "center" }, [
        ui.button("Back", {
          variant: "secondary",
          onPress: (state) => ({ path: state.path.slice(0, -1), selected: state.path[state.path.length - 1] }),
        }),
        ui.text(trail(data, state.path).join(" › "), { style: "caption", tone: "muted" }),
      ]),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: HEIGHT,
      fps: 60,
      duration: INTRO,
      alt: summary(data, node),
    }),
    ui.text(
      picked
        ? picked.label +
            ": " +
            amount(total(picked), data.unit) +
            " (" +
            share(total(picked), total(node)) +
            " of " +
            node.label +
            ")"
        : "Tap a block with children to drill in, or a leaf to select it",
      { style: "caption", tone: picked ? "default" : "muted" },
    ),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button(picked ? "Choose " + picked.label : "Choose", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: !picked,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const picked = focus(data, state.path).children[state.selected]
    return submit({
      label: picked.label,
      value: total(picked),
      path: [...trail(data, state.path).slice(1), picked.label],
    })
  }
  return state
}

function tap(state, data, pointer) {
  pointer = below(pointer)
  if (pointer.kind !== "up") return state
  const hit = locate(layout(data, state, pointer.width, pointer.height), pointer.x, pointer.y)
  if (!hit) return { ...state, selected: null }
  const child = focus(data, state.path).children[hit.index]
  if (child.children) return { path: [...state.path, hit.index], selected: hit.inner }
  return { ...state, selected: state.selected === hit.index ? null : hit.index }
}

function draw(state, data, frame) {
  frame = below(frame)
  const g = ui.draw()
  if (frame.top) g.translate(0, frame.top)
  const blocks = layout(data, state, frame.width, frame.height)
  const hover = frame.pointer && !frame.pointer.down ? locate(blocks, frame.pointer.x, frame.pointer.y) : null
  blocks.forEach((block, order) => {
    const grow = ease((frame.t - (0.3 * order) / blocks.length) / (INTRO - 0.3))
    if (grow <= 0) return
    const r = scaled(block.rect, grow)
    if (block.inner.length === 0) {
      g.rect(r.x, r.y, r.w, r.h, { fill: block.color, stroke: "bg", width: 2 })
      caption(g, r, block.node.label, amount(total(block.node), data.unit), "#ffffff")
    } else {
      g.save().alpha(0.22).rect(r.x, r.y, r.w, r.h, block.color).restore()
      g.rect(r.x, r.y, r.w, r.h, { stroke: "bg", width: 2 })
      if (r.w > 30)
        g.text(r.x + 6, r.y + 13, fit(block.node.label + "  " + amount(total(block.node), data.unit), r.w - 10, 11), {
          size: 11,
          weight: 600,
        })
      for (const inner of block.inner) {
        if (g.commands.length > BUDGET) break
        const ir = scaled(inner.rect, grow)
        g.rect(ir.x, ir.y, ir.w, ir.h, { fill: block.color, stroke: "bg", width: 1.5 })
        caption(g, ir, inner.node.label, "", "#ffffff")
      }
    }
  })
  if (frame.t >= INTRO)
    for (const [index, width] of [
      [hover && hover.index, 1],
      [state.selected, 2.5],
    ]) {
      const block = index === null ? null : blocks.find((item) => item.index === index)
      if (block)
        g.rect(block.rect.x + 1, block.rect.y + 1, block.rect.w - 2, block.rect.h - 2, { stroke: "text", width })
    }
  return g.commands
}

// The children of the focused node, squarified, each with its own children squarified inside below a header.
function layout(data, state, width, height) {
  const node = focus(data, state.path)
  const items = node.children
    .map((child, index) => ({ node: child, index, value: total(child) }))
    .filter((item) => item.value > 0)
  return squarify(items, { x: 0, y: 0, w: width, h: height }).map((placed, order) => {
    const child = placed.item.node
    const room = {
      x: placed.rect.x + 3,
      y: placed.rect.y + HEADER,
      w: placed.rect.w - 6,
      h: placed.rect.h - HEADER - 3,
    }
    const inner =
      child.children && room.w > 40 && room.h > 24
        ? squarify(
            child.children
              .map((grand, index) => ({ node: grand, index, value: total(grand) }))
              .filter((item) => item.value > 0),
            room,
          ).map((cell) => ({ node: cell.item.node, index: cell.item.index, rect: cell.rect }))
        : []
    return {
      node: child,
      index: placed.item.index,
      rect: placed.rect,
      inner,
      color: child.color ?? PALETTE[placed.item.index % PALETTE.length],
    }
  })
}

// Squarified treemap (Bruls et al.): fill rows along the short side while they make the cells squarer.
function squarify(items, rect) {
  const sorted = [...items].sort((a, b) => b.value - a.value)
  const sum = sorted.reduce((total, item) => total + item.value, 0)
  const out = []
  if (sum <= 0) return out
  const scale = (rect.w * rect.h) / sum
  let { x, y, w, h } = rect
  let start = 0
  while (start < sorted.length) {
    const short = Math.min(w, h)
    let end = start + 1
    let area = sorted[start].value * scale
    let worst = ratio(sorted[start].value * scale, sorted[start].value * scale, area, short)
    while (end < sorted.length) {
      const next = area + sorted[end].value * scale
      const score = ratio(sorted[start].value * scale, sorted[end].value * scale, next, short)
      if (score > worst) break
      area = next
      worst = score
      end++
    }
    const thick = area / short
    let offset = 0
    for (let index = start; index < end; index++) {
      const length = (sorted[index].value * scale) / thick
      out.push({
        item: sorted[index],
        rect: w >= h ? { x, y: y + offset, w: thick, h: length } : { x: x + offset, y, w: length, h: thick },
      })
      offset += length
    }
    if (w >= h) {
      x += thick
      w -= thick
    } else {
      y += thick
      h -= thick
    }
    start = end
  }
  return out
}

// The worst aspect ratio of a row with the given largest and smallest cell areas and total area.
function ratio(largest, smallest, area, short) {
  return Math.max((short * short * largest) / (area * area), (area * area) / (short * short * smallest))
}

function locate(blocks, px, py) {
  const inside = (r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
  const block = blocks.find((item) => inside(item.rect))
  if (!block) return null
  const inner = block.inner.find((item) => inside(item.rect))
  return { index: block.index, inner: inner ? inner.index : null }
}

function caption(g, r, label, value, color) {
  if (r.w < 36 || r.h < 18) return
  g.text(r.x + 6, r.y + 15, fit(label, r.w - 10, 12), { size: 12, weight: 600, color })
  if (value && r.h > 36) g.text(r.x + 6, r.y + 31, fit(value, r.w - 10, 11), { size: 11, color })
}

function scaled(r, grow) {
  return { x: r.x + (r.w * (1 - grow)) / 2, y: r.y + (r.h * (1 - grow)) / 2, w: r.w * grow, h: r.h * grow }
}

function focus(data, path) {
  return path.reduce((node, index) => node.children[index], { label: data.rootLabel ?? "All", children: data.items })
}

function trail(data, path) {
  const labels = [data.rootLabel ?? "All"]
  path.reduce(
    (node, index) => {
      labels.push(node.children[index].label)
      return node.children[index]
    },
    { children: data.items },
  )
  return labels
}

function total(node) {
  return node.value ?? (node.children ? node.children.reduce((sum, child) => sum + total(child), 0) : 0)
}

function summary(data, node) {
  const sum = total(node)
  return (
    "Treemap of " +
    node.label +
    " (" +
    amount(sum, data.unit) +
    "): " +
    node.children
      .map((child) => ({ label: child.label, value: total(child) }))
      .sort((a, b) => b.value - a.value)
      .map((child) => child.label + " " + amount(child.value, data.unit) + " (" + share(child.value, sum) + ")")
      .join(", ")
  )
}

function share(part, whole) {
  return (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0) + "%"
}

function amount(value, unit) {
  const size = Math.abs(value)
  const text =
    size >= 1e6
      ? Math.round(value / 1e5) / 10 + "M"
      : size >= 1e4
        ? Math.round(value / 100) / 10 + "k"
        : String(Math.round(value * 100) / 100)
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
