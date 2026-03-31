import type { Subtask, WorkerState } from "@/parallel/schema"

export type DAGNode = {
  id: string
  title: string
  status: WorkerState["status"]
  layer: number
  row: number
  x: number
  y: number
  w: number
  h: number
}

export type DAGEdge = {
  from: string
  to: string
  points: { x: number; y: number }[]
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function layer(subtasks: Subtask[]) {
  const map = new Map(subtasks.map((item) => [String(item.id), item]))
  const deg = new Map(subtasks.map((item) => [String(item.id), item.dependencies.length]))
  const out = new Map<string, string[]>()
  for (const item of subtasks) {
    for (const dep of item.dependencies) {
      const key = String(dep)
      const list = out.get(key) ?? []
      list.push(String(item.id))
      out.set(key, list)
    }
  }

  const ready = subtasks.filter((item) => (deg.get(String(item.id)) ?? 0) === 0).map((item) => String(item.id))
  const rank = new Map<string, number>()
  while (ready.length > 0) {
    const id = ready.shift()!
    const item = map.get(id)
    if (!item) continue
    const base = item.dependencies.reduce((max, dep) => Math.max(max, (rank.get(String(dep)) ?? -1) + 1), 0)
    rank.set(id, base)
    for (const next of out.get(id) ?? []) {
      const left = (deg.get(next) ?? 0) - 1
      deg.set(next, left)
      if (left === 0) ready.push(next)
    }
  }

  const max = Math.max(-1, ...rank.values())
  for (const item of subtasks) {
    const key = String(item.id)
    if (rank.has(key)) continue
    const base = item.dependencies.reduce((val, dep) => Math.max(val, (rank.get(String(dep)) ?? max) + 1), max + 1)
    rank.set(key, base)
  }

  return rank
}

export function layoutDAG(input: {
  subtasks: Subtask[]
  workers: WorkerState[]
  cols: number
  rows: number
}): { nodes: DAGNode[]; edges: DAGEdge[]; width: number; height: number } {
  const rank = layer(input.subtasks)
  const state = new Map(input.workers.map((item) => [item.subtaskID, item.status]))
  const groups = new Map<number, Subtask[]>()
  for (const item of input.subtasks) {
    const key = rank.get(String(item.id)) ?? 0
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }

  const keys = [...groups.keys()].sort((a, b) => a - b)
  const gapX = 6
  const gapY = 2
  const layers = Math.max(1, keys.length)
  const boxW = clamp(Math.floor((Math.max(input.cols, 40) - gapX * Math.max(0, layers - 1)) / layers), 18, 28)
  const boxH = 5
  const nodes = [] as DAGNode[]

  for (const key of keys) {
    const list = (groups.get(key) ?? []).slice().sort((a, b) => a.title.localeCompare(b.title))
    for (const [row, item] of list.entries()) {
      nodes.push({
        id: item.id,
        title: item.title,
        status: state.get(item.id) ?? "pending",
        layer: key,
        row,
        x: key * (boxW + gapX),
        y: row * (boxH + gapY),
        w: boxW,
        h: boxH,
      })
    }
  }

  const map = new Map(nodes.map((item) => [item.id, item]))
  const edges = input.subtasks.flatMap((item) =>
    item.dependencies.flatMap((dep) => {
      const a = map.get(String(dep))
      const b = map.get(item.id)
      if (!a || !b) return []
      const start = { x: a.x + a.w, y: a.y + Math.floor(a.h / 2) }
      const end = { x: Math.max(b.x - 1, start.x + 1), y: b.y + Math.floor(b.h / 2) }
      const mid = Math.max(start.x + 2, Math.floor((start.x + end.x) / 2))
      return [
        {
          from: a.id,
          to: b.id,
          points: [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end],
        },
      ]
    }),
  )

  const width = Math.max(
    input.cols,
    ...nodes.map((item) => item.x + item.w),
    ...edges.flatMap((item) => item.points.map((point) => point.x + 1)),
  )
  const height = Math.max(
    input.rows,
    ...nodes.map((item) => item.y + item.h),
    ...edges.flatMap((item) => item.points.map((point) => point.y + 1)),
  )

  return { nodes, edges, width, height }
}
