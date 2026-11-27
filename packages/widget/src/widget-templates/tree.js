// A hierarchy as a tidy tree: "right" grows left to right (deep trees, file trees), "down" grows top down (org charts).
// Leaves get one slot each and parents center over their children. Tap a node's +/− knob to collapse or expand it,
// tap a node to select it (tap it again to toggle it). With `choose`, the Choose button submits the selected node.

const ROW = 36
const LEVEL = 70
// A fully expanded large tree stops drawing nodes here, under the spec's 2,000 commands per frame.
const BUDGET = 1900
const PALETTE = ["accent", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

// Large trees start collapsed below `expand` levels (default: all open up to 40 nodes, else 2 levels).
function init(data) {
  const collapsed = []
  const count = (node) => 1 + (node.children ?? []).reduce((sum, child) => sum + count(child), 0)
  const expand = data.expand ?? (count(data.root) > 40 ? 2 : Infinity)
  const close = (node, key, depth) => {
    if (!node.children) return
    if (depth >= expand) collapsed.push(key)
    else node.children.forEach((child, index) => close(child, join(key, index), depth + 1))
  }
  close(data.root, "", 0)
  return { collapsed, selected: null }
}

function view(state, data) {
  const tree = layout(data, state)
  const picked = state.selected === null ? null : tree.items.find((item) => item.key === state.selected)
  return ui.column({ gap: 1, align: "stretch" }, [
    ui.text(data.title, { style: "title" }),
    ui.canvas({
      onPointer: (state, p) => tap(state, data, p),
      height: data.orientation === "down" ? tree.depth * LEVEL + 8 : Math.max(60, tree.leaves * ROW + 8),
      fps: 60,
      duration: intro(tree),
      alt: summary(data),
    }),
    ui.text(picked ? describe(data, picked) : "Tap a node to select it; tap its +/− to collapse or expand it", {
      style: "caption",
      tone: picked ? "default" : "muted",
    }),
    data.choose &&
      ui.row({ gap: 1 }, [
        ui.button(picked ? "Choose " + picked.node.label : "Choose", {
          onPress: (state) => choose(state, data),
          variant: "primary",
          disabled: !picked,
        }),
      ]),
  ])
}

function choose(state, data) {
  if (state.selected !== null) {
    const picked = layout(data, state).items.find((item) => item.key === state.selected)
    return submit({ label: picked.node.label, path: trail(data, picked.key), note: picked.node.note })
  }
  return state
}

function tap(state, data, pointer) {
  if (pointer.kind !== "up") return state
  const tree = layout(data, state)
  const hit = locate(data, tree, place(data, tree, pointer.width), pointer.x, pointer.y)
  if (!hit) return { ...state, selected: null }
  const toggle = hit.knob || (hit.item.key === state.selected && hit.item.node.children)
  const collapsed = !toggle
    ? state.collapsed
    : state.collapsed.includes(hit.item.key)
      ? state.collapsed.filter((key) => key !== hit.item.key)
      : [...state.collapsed, hit.item.key]
  return { collapsed, selected: hit.knob ? state.selected : hit.item.key }
}

function draw(state, data, frame) {
  const g = ui.draw()
  const tree = layout(data, state)
  const at = place(data, tree, frame.width)
  const hover = frame.pointer && !frame.pointer.down ? locate(data, tree, at, frame.pointer.x, frame.pointer.y) : null
  const down = data.orientation === "down"
  // One alpha group per depth, so levels fade in one after another.
  for (let depth = 0; depth < tree.depth; depth++) {
    const fade = ease((frame.t - depth * 0.12) / 0.35)
    if (fade <= 0) break
    g.save().alpha(fade)
    tree.items.forEach((item, index) => {
      if (item.depth !== depth || g.commands.length > BUDGET) return
      const box = at[index]
      if (item.parent >= 0) {
        const from = at[item.parent]
        if (down) {
          const mid = (from.y + from.h + box.y) / 2
          g.path(
            [
              ["M", from.x + from.w / 2, from.y + from.h],
              ["C", from.x + from.w / 2, mid, box.x + box.w / 2, mid, box.x + box.w / 2, box.y],
            ],
            { stroke: "border", width: 1.5 },
          )
        } else {
          const mid = (from.x + from.w + box.x) / 2
          g.path(
            [
              ["M", from.x + from.w, from.y + from.h / 2],
              ["C", mid, from.y + from.h / 2, mid, box.y + box.h / 2, box.x, box.y + box.h / 2],
            ],
            { stroke: "border", width: 1.5 },
          )
        }
      }
      const selected = item.key === state.selected
      const hovered = hover && hover.item.key === item.key
      const accent = item.node.color ?? PALETTE[(item.branch < 0 ? 0 : item.branch) % PALETTE.length]
      g.rrect(box.x, box.y, box.w, box.h, 6, {
        fill: "surface",
        stroke: selected ? accent : hovered ? "muted" : "border",
        width: selected ? 2 : 1,
      })
      g.rrect(box.x, box.y, 4, box.h, 2, accent)
      const lines = item.node.note && box.h > 30
      g.text(box.x + 11, box.y + (lines ? 15 : box.h / 2 + 4), fit(item.node.label, box.w - 16, 12), {
        size: 12,
        weight: depth === 0 || selected ? 600 : 400,
      })
      if (lines) g.text(box.x + 11, box.y + 30, fit(item.node.note, box.w - 16, 11), { size: 11, color: "muted" })
      if (item.node.children) {
        const knob = knobAt(data, box)
        const closed = state.collapsed.includes(item.key)
        g.circle(knob.x, knob.y, 7, { fill: closed ? accent : "bg", stroke: closed ? accent : "border", width: 1 })
        g.text(knob.x, knob.y + 4, closed ? "+" : "−", {
          size: 11,
          weight: 600,
          align: "center",
          color: closed ? "#ffffff" : "muted",
        })
      }
    })
    g.restore()
  }
  return g.commands
}

// The visible tree in slots: each item has a depth, a breadth slot, its parent's index and its top-level branch.
function layout(data, state) {
  const items = []
  let leaves = 0
  let depth = 0
  const walk = (node, key, level, parent, branch) => {
    const index = items.length
    items.push({ key, node, depth: level, parent, branch, slot: 0 })
    depth = Math.max(depth, level + 1)
    if (node.children && !state.collapsed.includes(key)) {
      const slots = node.children.map((child, at) =>
        walk(child, join(key, at), level + 1, index, level === 0 ? at : branch),
      )
      items[index].slot = (slots[0] + slots[slots.length - 1]) / 2
    } else items[index].slot = leaves++
    return items[index].slot
  }
  walk(data.root, "", 0, -1, -1)
  return { items, leaves, depth }
}

// Pixel boxes for the layout at a canvas width; notes show only in the taller "down" boxes.
function place(data, tree, width) {
  if (data.orientation === "down") {
    const slot = (width - 16) / tree.leaves
    const w = Math.max(40, Math.min(150, slot - 10))
    const h = tree.items.some((item) => item.node.note) ? 40 : 28
    return tree.items.map((item) => ({ x: 8 + (item.slot + 0.5) * slot - w / 2, y: 6 + item.depth * LEVEL, w, h }))
  }
  const column = (width - 16) / tree.depth
  const w = Math.max(50, Math.min(170, column - 28))
  const h = 26
  return tree.items.map((item) => ({ x: 8 + item.depth * column, y: 4 + item.slot * ROW + (ROW - h) / 2, w, h }))
}

function knobAt(data, box) {
  return data.orientation === "down"
    ? { x: box.x + box.w / 2, y: box.y + box.h }
    : { x: box.x + box.w, y: box.y + box.h / 2 }
}

function locate(data, tree, at, px, py) {
  for (let index = tree.items.length - 1; index >= 0; index--) {
    const box = at[index]
    const item = tree.items[index]
    if (item.node.children) {
      const knob = knobAt(data, box)
      if (Math.hypot(px - knob.x, py - knob.y) <= 11) return { item, knob: true }
    }
    if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) return { item, knob: false }
  }
  return null
}

function intro(tree) {
  return Math.round((0.35 + 0.12 * (tree.depth - 1)) * 100) / 100
}

function join(key, index) {
  return key === "" ? String(index) : key + "." + index
}

function trail(data, key) {
  const labels = [data.root.label]
  if (key === "") return labels
  key.split(".").reduce((node, index) => {
    labels.push(node.children[Number(index)].label)
    return node.children[Number(index)]
  }, data.root)
  return labels
}

function describe(data, item) {
  const count = (node) => (node.children ?? []).reduce((sum, child) => sum + 1 + count(child), 0)
  const below = count(item.node)
  return (
    trail(data, item.key).join(" › ") +
    (item.node.note ? " · " + item.node.note : "") +
    (below ? " · " + below + (below === 1 ? " node below" : " nodes below") : "")
  )
}

function summary(data) {
  const lines = []
  const walk = (node, depth) => {
    if (lines.length < 60) lines.push("  ".repeat(depth) + node.label + (node.note ? " (" + node.note + ")" : ""))
    node.children?.forEach((child) => walk(child, depth + 1))
  }
  walk(data.root, 0)
  return "Tree:\n" + lines.join("\n")
}

function fit(text, width, size) {
  const max = Math.max(1, Math.floor(width / (size * 0.58)))
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…"
}

function ease(p) {
  const clamped = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - clamped, 3)
}
