import { Schema } from "effect"

const number = Schema.Finite
const Trace = Schema.Struct({
  traceEvents: Schema.Array(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      ph: Schema.optionalKey(Schema.String),
      pid: Schema.optionalKey(number),
      tid: Schema.optionalKey(number),
      ts: Schema.optionalKey(number),
      dur: Schema.optionalKey(number),
    }),
  ),
})
const Cpu = Schema.Struct({
  startTime: number,
  endTime: number,
  nodes: Schema.Array(
    Schema.Struct({
      id: number,
      callFrame: Schema.Struct({ functionName: Schema.String, url: Schema.String, lineNumber: number }),
    }),
  ),
  samples: Schema.optionalKey(Schema.Array(number)),
  timeDeltas: Schema.optionalKey(Schema.Array(number)),
})
const Heap = Schema.Struct({
  snapshot: Schema.Struct({
    meta: Schema.Struct({
      node_fields: Schema.Array(Schema.String),
      node_types: Schema.Array(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
      edge_fields: Schema.Array(Schema.String),
      edge_types: Schema.Array(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    }),
  }),
  nodes: Schema.Array(number),
  edges: Schema.Array(number),
  strings: Schema.Array(Schema.String),
})

export function analyzeTrace(value: unknown, limit = 100) {
  const trace = Schema.decodeUnknownSync(Trace)(value)
  const events = new Map<string, { name: string; count: number; totalMs: number; maxMs: number }>()
  const longTasks: number[] = []
  trace.traceEvents.forEach((event) => {
    if (event.ph !== "X" || !event.name || event.dur === undefined) return
    const duration = event.dur / 1000
    const item = events.get(event.name) ?? { name: event.name.slice(0, 2_048), count: 0, totalMs: 0, maxMs: 0 }
    item.count++
    item.totalMs += duration
    item.maxMs = Math.max(item.maxMs, duration)
    events.set(event.name, item)
    if ((event.name === "RunTask" || event.name === "ThreadControllerImpl::RunTask") && duration > 50)
      longTasks.push(duration)
  })
  return {
    metrics: [
      { name: "recordedEvents", value: trace.traceEvents.length, unit: "count" },
      { name: "longTasks", value: longTasks.length, unit: "count" },
      { name: "longTaskBlocking", value: longTasks.reduce((sum, duration) => sum + duration - 50, 0), unit: "ms" },
    ],
    events: Array.from(events.values())
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, limit),
    insights: [
      "Event durations can overlap and must not be summed into total page time.",
      longTasks.length
        ? `${longTasks.length} recorded tasks exceeded 50 ms; inspect their stacks in the exported trace.`
        : "No tasks over 50 ms were observed in the retained trace. This is not proof that the page has no long tasks.",
      "This renderer-process trace does not calculate LCP, INP, CLS, or Lighthouse performance scores.",
    ],
  }
}

export function analyzeCpu(value: unknown, limit = 100) {
  const profile = Schema.decodeUnknownSync(Cpu)(value)
  const times = new Map<number, number>()
  profile.samples?.forEach((id, index) =>
    times.set(id, (times.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1000),
  )
  return {
    durationMs: Math.max(0, (profile.endTime - profile.startTime) / 1000),
    functions: profile.nodes
      .map((node) => ({
        name: node.callFrame.functionName.slice(0, 2_048),
        url: node.callFrame.url.slice(0, 100_000),
        line: Math.max(0, node.callFrame.lineNumber + 1),
        selfMs: times.get(node.id) ?? 0,
      }))
      .filter((node) => node.selfMs > 0)
      .sort((a, b) => b.selfMs - a.selfMs)
      .slice(0, limit),
  }
}

export function parseHeap(value: unknown) {
  const heap = Schema.decodeUnknownSync(Heap)(value)
  const fields = heap.snapshot.meta.node_fields
  const edgeFields = heap.snapshot.meta.edge_fields
  const width = fields.length
  const edgeWidth = edgeFields.length
  const indexes = {
    type: fields.indexOf("type"),
    name: fields.indexOf("name"),
    id: fields.indexOf("id"),
    size: fields.indexOf("self_size"),
    count: fields.indexOf("edge_count"),
    edgeType: edgeFields.indexOf("type"),
    edgeName: edgeFields.indexOf("name_or_index"),
    to: edgeFields.indexOf("to_node"),
  }
  if (
    !width ||
    !edgeWidth ||
    Object.values(indexes).some((index) => index < 0) ||
    heap.nodes.length % width ||
    heap.edges.length % edgeWidth
  )
    throw new Error("Unsupported heap snapshot layout.")
  const types = heap.snapshot.meta.node_types[indexes.type]
  const edgeTypes = heap.snapshot.meta.edge_types[indexes.edgeType]
  if (!Array.isArray(types) || !Array.isArray(edgeTypes)) throw new Error("Unsupported heap snapshot types.")
  const node = (offset: number) => ({
    id: heap.nodes[offset + indexes.id],
    name: (heap.strings[heap.nodes[offset + indexes.name]] ?? "").slice(0, 100_000),
    type: types[heap.nodes[offset + indexes.type]] ?? "unknown",
    selfBytes: heap.nodes[offset + indexes.size],
    edgeCount: heap.nodes[offset + indexes.count],
  })
  const classes = new Map<string, { name: string; count: number; bytes: number }>()
  let selfBytes = 0
  for (let offset = 0; offset < heap.nodes.length; offset += width) {
    const item = node(offset)
    const name = item.name.slice(0, 2_048)
    const entry = classes.get(name) ?? { name, count: 0, bytes: 0 }
    entry.count++
    entry.bytes += item.selfBytes
    selfBytes += item.selfBytes
    classes.set(name, entry)
  }
  return {
    summary(limit = 100) {
      return {
        nodes: heap.nodes.length / width,
        edges: heap.edges.length / edgeWidth,
        selfBytes,
        classes: Array.from(classes.values())
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, limit),
      }
    },
    classes,
    query(name = "", limit = 100) {
      const found: ReturnType<typeof node>[] = []
      for (let offset = 0; offset < heap.nodes.length; offset += width) {
        const item = node(offset)
        if (item.name.toLowerCase().includes(name.toLowerCase())) found.push(item)
      }
      return { nodes: found.sort((a, b) => b.selfBytes - a.selfBytes).slice(0, limit), truncated: found.length > limit }
    },
    object(id: number, limit = 100) {
      const target = heap.nodes.findIndex((value, index) => index % width === indexes.id && value === id) - indexes.id
      if (target < 0) throw new Error("Object ID was not found in this heap snapshot.")
      const references: { name: string; node: ReturnType<typeof node> }[] = []
      const retainers: { name: string; node: ReturnType<typeof node> }[] = []
      let edgeOffset = 0
      let truncated = false
      for (let offset = 0; offset < heap.nodes.length; offset += width) {
        const count = heap.nodes[offset + indexes.count]
        for (let index = 0; index < count; index++, edgeOffset += edgeWidth) {
          const to = heap.edges[edgeOffset + indexes.to]
          if (offset !== target && to !== target) continue
          const type = edgeTypes[heap.edges[edgeOffset + indexes.edgeType]]
          const raw = heap.edges[edgeOffset + indexes.edgeName]
          const name = (type === "element" || type === "hidden" ? String(raw) : (heap.strings[raw] ?? "")).slice(
            0,
            100_000,
          )
          if (offset === target) {
            if (references.length < limit) references.push({ name, node: node(to) })
            else truncated = true
          }
          if (to === target) {
            if (retainers.length < limit) retainers.push({ name, node: node(offset) })
            else truncated = true
          }
        }
      }
      return { node: node(target), references, retainers, truncated }
    },
  }
}
