import type { Task } from "@bearmanser/opencode-superpowers-execution/contract"

export const GRAPH_NODE_WIDTH = 220
export const GRAPH_NODE_HEIGHT = 88
export const GRAPH_VERTICAL_GAP = 72
export const GRAPH_GROUPING_THRESHOLD = 200
export const GRAPH_MIN_ZOOM = 0.25
export const GRAPH_MAX_ZOOM = 2
export const GRAPH_LAYOUT_CACHE_LIMIT = 20

export type GraphNode = { id: string; x: number; y: number; width: number; height: number }
export type GraphEdge = { from: string; to: string; path: string }
export type GraphLayout = { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number }
export type GraphNodeSize = { width: number; height: number }
export type GraphMeasurer = (task: Task) => GraphNodeSize | undefined
export type GraphPhaseGroup = { phase: string; tasks: Task[] }

export type GraphTypography = { fontSize: number; lineHeight: number; fontFamily: string; scale: number }

export function graphDimensionKey(typography: GraphTypography) {
  return `${typography.fontSize}:${typography.lineHeight}:${typography.scale}:${typography.fontFamily}`
}

export function measureGraphTypography(element: HTMLElement): GraphTypography {
  const style = getComputedStyle(element)
  const fontSize = Number.parseFloat(style.fontSize) || 13
  return {
    fontSize,
    lineHeight: Math.max(16, Math.round(fontSize * 1.4)),
    fontFamily: style.fontFamily || "sans-serif",
    scale: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  }
}

export function graphSignature(tasks: Task[]) {
  return JSON.stringify(
    tasks.map((task) => ({
      id: task.id,
      order: task.order,
      dependsOn: [...task.dependsOn].sort(),
      title: task.title,
    })),
  )
}

export function layoutTaskGraph(tasks: Task[], measure: GraphMeasurer = defaultMeasure): GraphLayout {
  const byID = indexTasks(tasks)
  assignLayers(tasks, byID)
  const ordered = [...tasks].sort(compareByOrderID)
  const sizes = ordered.map((task) => nodeSize(task, measure))
  const width = Math.max(0, ...sizes.map((size) => size.width))
  let y = 0
  const nodes = ordered.map((task, index) => {
    const size = sizes[index]!
    const node = { id: task.id, x: (width - size.width) / 2, y, ...size }
    y += size.height + GRAPH_VERTICAL_GAP
    return node
  })
  // Links express declared execution order, not dependency fan-in.
  const edges = nodes.slice(1).map((node, index) => ({
    from: nodes[index]!.id,
    to: node.id,
    path: edgePath(nodes[index]!, node),
  }))

  return {
    nodes,
    edges,
    width: nodes.reduce((widest, node) => Math.max(widest, node.x + node.width), 0),
    height: nodes.reduce((tallest, node) => Math.max(tallest, node.y + node.height), 0),
  }
}

const layoutCache = new Map<string, GraphLayout>()

export function cachedLayout(
  tasks: Task[],
  measure: GraphMeasurer = defaultMeasure,
  dimensionKey = "",
): GraphLayout {
  const signature = `${graphSignature(tasks)}|${dimensionKey}`
  const cached = layoutCache.get(signature)
  if (cached) {
    layoutCache.delete(signature)
    layoutCache.set(signature, cached)
    return cached
  }
  const layout = layoutTaskGraph(tasks, measure)
  const oldest = layoutCache.keys().next()
  if (!oldest.done && layoutCache.size >= GRAPH_LAYOUT_CACHE_LIMIT) layoutCache.delete(oldest.value)
  layoutCache.set(signature, layout)
  return layout
}

export function resetLayoutCache() {
  layoutCache.clear()
}

export function clampZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(GRAPH_MAX_ZOOM, Math.max(GRAPH_MIN_ZOOM, zoom))
}

export function groupTasksByPhase(tasks: Task[]): GraphPhaseGroup[] {
  return [...new Set(tasks.map((task) => task.phase))].sort().map((phase) => ({
    phase,
    tasks: tasks.filter((task) => task.phase === phase).sort(compareByOrderID),
  }))
}

export function edgePath(from: GraphNode, to: GraphNode) {
  const startX = from.x + from.width / 2
  const startY = from.y + from.height
  const endX = to.x + to.width / 2
  const endY = to.y
  const midY = (startY + endY) / 2
  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`
}

function defaultMeasure(): GraphNodeSize {
  return { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT }
}

function nodeSize(task: Task, measure: GraphMeasurer): GraphNodeSize {
  const measured = measure(task) ?? defaultMeasure()
  return {
    width: Math.max(GRAPH_NODE_WIDTH, measured.width),
    height: Math.max(GRAPH_NODE_HEIGHT, Math.round(measured.height)),
  }
}

function indexTasks(tasks: Task[]) {
  const byID = new Map<string, Task>()
  for (const task of tasks) {
    if (byID.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`)
    byID.set(task.id, task)
  }
  return byID
}

function assignLayers(tasks: Task[], byID: Map<string, Task>) {
  const layers = new Map<string, number>()
  const visiting = new Set<string>()
  const resolve = (id: string): number => {
    const task = byID.get(id)
    if (!task) throw new Error(`Unknown task dependency: ${id}`)
    const known = layers.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) throw new Error(`Dependency cycle detected at task ${id}`)
    visiting.add(id)
    let layer = 0
    for (const dependency of task.dependsOn) layer = Math.max(layer, resolve(dependency) + 1)
    visiting.delete(id)
    layers.set(id, layer)
    return layer
  }
  for (const task of tasks) resolve(task.id)
  return layers
}

function compareByOrderID(left: Task, right: Task) {
  if (left.order !== right.order) return left.order - right.order
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}
