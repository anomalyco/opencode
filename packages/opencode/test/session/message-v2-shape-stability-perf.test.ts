import { describe, expect, test } from "bun:test"

interface MessageRow {
  id: string
  session_id: string
  time_created: number
  time_updated: number
  data: Record<string, unknown>
}

interface PartRow {
  id: string
  message_id: string
  session_id: string
  time_created: number
  time_updated: number
  data: Record<string, unknown>
}

// The "before" implementation: pre-fix info()/part() helpers from
// packages/opencode/src/session/message-v2.ts at HEAD before this change.
// Spreads row.data; the resulting object's hidden-class (JSC Structure)
// depends on which optional keys row.data contains. This is the source of
// the megamorphic IC explosion under varied real-world data.
const infoSpread = (row: MessageRow) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
  }) as Record<string, unknown>

const partSpread = (row: PartRow) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  }) as Record<string, unknown>

// The "after" implementation: shape-stable explicit construction with a
// FIXED key list per discriminator. Every Assistant info has the same
// Structure regardless of which optional fields row.data carries. Mirrors
// the production helpers in src/session/message-v2.ts post-fix.
function infoNormalized(row: MessageRow) {
  const d = row.data as Record<string, unknown>
  if (d.role === "assistant") {
    return {
      role: "assistant",
      time: d.time,
      error: d.error,
      parentID: d.parentID,
      modelID: d.modelID,
      providerID: d.providerID,
      mode: d.mode,
      agent: d.agent,
      path: d.path,
      summary: d.summary,
      cost: d.cost,
      tokens: d.tokens,
      structured: d.structured,
      variant: d.variant,
      finish: d.finish,
      id: row.id,
      sessionID: row.session_id,
    } as Record<string, unknown>
  }
  return {
    role: "user",
    time: d.time,
    format: d.format,
    summary: d.summary,
    agent: d.agent,
    model: d.model,
    system: d.system,
    tools: d.tools,
    id: row.id,
    sessionID: row.session_id,
  } as Record<string, unknown>
}

function partNormalized(row: PartRow) {
  const d = row.data as Record<string, unknown>
  const id = row.id
  const sessionID = row.session_id
  const messageID = row.message_id
  switch (d.type as string) {
    case "text":
      return { type: "text", text: d.text, synthetic: d.synthetic, ignored: d.ignored, time: d.time, metadata: d.metadata, id, sessionID, messageID }
    case "reasoning":
      return { type: "reasoning", text: d.text, metadata: d.metadata, time: d.time, id, sessionID, messageID }
    case "tool":
      return { type: "tool", callID: d.callID, tool: d.tool, state: d.state, metadata: d.metadata, id, sessionID, messageID }
    case "file":
      return { type: "file", mime: d.mime, filename: d.filename, url: d.url, source: d.source, id, sessionID, messageID }
    case "compaction":
      return { type: "compaction", auto: d.auto, overflow: d.overflow, tail_start_id: d.tail_start_id, id, sessionID, messageID }
    case "step-start":
      return { type: "step-start", snapshot: d.snapshot, id, sessionID, messageID }
    case "step-finish":
      return { type: "step-finish", reason: d.reason, snapshot: d.snapshot, cost: d.cost, tokens: d.tokens, id, sessionID, messageID }
    default:
      return { type: d.type, id, sessionID, messageID }
  }
}

// Deterministic LCG-seeded synthetic generator. No real user data; produces
// data of representative variety: half assistant, half user, optional fields
// (summary, error, variant, finish, structured) present in a fraction of rows.
// This shape variety is what causes the JSStructureHeap to balloon to ~50k
// Structures in production - and what shape normalization is designed to fix.
function makeRng(seed = 7) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function generate(messageCount: number, avgPartsPerMessage: number) {
  const rng = makeRng(11)
  const baseTime = 1700000000000
  const messages: MessageRow[] = []
  const parts: PartRow[] = []
  for (let i = 0; i < messageCount; i++) {
    const isAssistant = i % 2 === 1
    const role = isAssistant ? "assistant" : "user"
    const id = `msg_${i.toString().padStart(8, "0")}`
    const t = baseTime + i * 1000
    const data: Record<string, unknown> = {
      role,
      time: { created: t, completed: t + 500 },
      agent: "build",
    }
    if (isAssistant) {
      data.parentID = `msg_${(i - 1).toString().padStart(8, "0")}`
      data.modelID = "claude-opus-4-7"
      data.providerID = "anthropic"
      data.mode = "primary"
      data.path = { cwd: "/home/test/proj", root: "/home/test/proj" }
      data.cost = rng() * 0.1
      data.tokens = {
        input: Math.floor(rng() * 1000),
        output: Math.floor(rng() * 1000),
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      // Optional fields appear in random subsets - this is the shape variety
      // that makes JSStructureHeap explode under real workloads.
      if (rng() < 0.3) data.summary = true
      if (rng() < 0.1) data.error = { name: "AbortedError", message: "aborted" }
      if (rng() < 0.4) data.finish = "stop"
      if (rng() < 0.2) data.variant = "high"
      if (rng() < 0.15) data.structured = { schema: "json" }
    } else {
      data.model = { providerID: "anthropic", modelID: "claude-opus-4-7" }
      if (rng() < 0.5) data.summary = { title: "x".repeat(40), body: "x".repeat(200), diffs: [] }
      if (rng() < 0.3) data.format = { type: "text" }
      if (rng() < 0.4) data.tools = { read: true, bash: true }
      if (rng() < 0.2) data.system = "x".repeat(100)
    }
    messages.push({ id, session_id: "ses_synth", time_created: t, time_updated: t, data })

    const pCount = Math.max(1, Math.floor(avgPartsPerMessage + (rng() - 0.5) * avgPartsPerMessage))
    for (let p = 0; p < pCount; p++) {
      const pid = `prt_${i.toString().padStart(8, "0")}_${p.toString().padStart(3, "0")}`
      const r = rng()
      const partType = r < 0.4 ? "text" : r < 0.55 ? "reasoning" : r < 0.75 ? "tool" : r < 0.85 ? "step-start" : "step-finish"
      const pdata: Record<string, unknown> = { type: partType }
      switch (partType) {
        case "text":
          pdata.text = "x".repeat(Math.floor(rng() * 500))
          if (rng() < 0.2) pdata.metadata = { source: "tool" }
          if (rng() < 0.3) pdata.synthetic = true
          if (rng() < 0.1) pdata.ignored = true
          break
        case "reasoning":
          pdata.text = "x".repeat(Math.floor(rng() * 300))
          pdata.time = { start: t, end: t + 50 }
          if (rng() < 0.2) pdata.metadata = {}
          break
        case "tool":
          pdata.callID = `call_${i}_${p}`
          pdata.tool = ["bash", "read", "edit"][Math.floor(rng() * 3)]
          pdata.state = { status: "completed", input: { x: 1 }, output: "x".repeat(100), title: "t", metadata: {}, time: { start: t, end: t + 100 } }
          if (rng() < 0.15) pdata.metadata = { tag: "x" }
          break
        case "step-start":
          if (rng() < 0.5) pdata.snapshot = "x".repeat(40)
          break
        case "step-finish":
          pdata.reason = "stop"
          pdata.cost = rng() * 0.01
          pdata.tokens = { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } }
          if (rng() < 0.4) pdata.snapshot = "x".repeat(40)
          break
      }
      parts.push({ id: pid, message_id: id, session_id: "ses_synth", time_created: t + p, time_updated: t + p, data: pdata })
    }
  }
  return { messages, parts }
}

function measure(fn: () => unknown): { ms: number; result: unknown } {
  const start = performance.now()
  const result = fn()
  return { ms: performance.now() - start, result }
}

describe("MessageV2 shape stability", () => {
  test("shape-stable info: every assistant has the same hidden-class regardless of optional-key presence", () => {
    const a1: MessageRow = {
      id: "msg_a1",
      session_id: "s",
      time_created: 1,
      time_updated: 1,
      data: { role: "assistant", time: { created: 1 }, agent: "b", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, mode: "p", parentID: "m0", modelID: "m", providerID: "p" },
    }
    const a2: MessageRow = {
      id: "msg_a2",
      session_id: "s",
      time_created: 2,
      time_updated: 2,
      data: { role: "assistant", time: { created: 2 }, agent: "b", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, mode: "p", parentID: "m1", modelID: "m", providerID: "p", summary: true, finish: "stop", variant: "high" },
    }
    const o1 = infoNormalized(a1)
    const o2 = infoNormalized(a2)
    const keys1 = Object.keys(o1).join(",")
    const keys2 = Object.keys(o2).join(",")
    expect(keys1).toBe(keys2)
  })

  test("perf: shape variety degrades property access (megamorphic IC). normalized stays fast.", () => {
    const { messages } = generate(5000, 0)
    const objsSpread = messages.map((m) => infoSpread(m))
    const objsNorm = messages.map((m) => infoNormalized(m))

    const uniqueShapes = (objs: Record<string, unknown>[]) =>
      new Set(objs.map((o) => Object.keys(o).sort().join("|"))).size

    const shapesSpread = uniqueShapes(objsSpread)
    const shapesNorm = uniqueShapes(objsNorm)

    for (let i = 0; i < 100; i++) {
      let _w = 0
      for (const o of objsSpread) _w += typeof o.cost === "number" ? o.cost : 0
      for (const o of objsNorm) _w += typeof o.cost === "number" ? o.cost : 0
    }

    const ACCESS_ITERS = 200
    const tSpread = measure(() => {
      let acc = 0
      for (let i = 0; i < ACCESS_ITERS; i++) {
        for (const o of objsSpread) {
          acc += typeof o.role === "string" ? o.role.length : 0
          acc += typeof o.cost === "number" ? o.cost : 0
          acc += o.summary ? 1 : 0
          acc += o.finish ? 1 : 0
          acc += o.error ? 1 : 0
          acc += o.variant ? 1 : 0
          acc += o.structured ? 1 : 0
        }
      }
      return acc
    })
    const tNorm = measure(() => {
      let acc = 0
      for (let i = 0; i < ACCESS_ITERS; i++) {
        for (const o of objsNorm) {
          acc += typeof o.role === "string" ? o.role.length : 0
          acc += typeof o.cost === "number" ? o.cost : 0
          acc += o.summary ? 1 : 0
          acc += o.finish ? 1 : 0
          acc += o.error ? 1 : 0
          acc += o.variant ? 1 : 0
          acc += o.structured ? 1 : 0
        }
      }
      return acc
    })

    const speedup = tSpread.ms / tNorm.ms
    console.log(
      [
        `[perf] info(): shape-stable vs spread on 5000-msg varied workload (200 access iters × 7 properties)`,
        `[perf] unique Structures: spread=${shapesSpread}  normalized=${shapesNorm}`,
        `[perf] access time:      spread=${tSpread.ms.toFixed(1)}ms  normalized=${tNorm.ms.toFixed(1)}ms  speedup=${speedup.toFixed(1)}x`,
      ].join("\n"),
    )

    // Spread version must produce strictly more unique shapes than normalized.
    // Normalized must produce <= 2 (user, assistant).
    expect(shapesSpread).toBeGreaterThan(shapesNorm)
    expect(shapesNorm).toBeLessThanOrEqual(2)
    // Wall-clock speedup expected on JSC due to monomorphic vs megamorphic
    // inline caches. Even on engines without the IC penalty the normalized
    // version should be no slower (allow 10% noise).
    expect(tNorm.ms).toBeLessThan(tSpread.ms * 1.1)
  })

  test("perf: part() shape stability across 12 part types", () => {
    const { parts } = generate(2500, 5)
    const objsSpread = parts.map((p) => partSpread(p))
    const objsNorm = parts.map((p) => partNormalized(p))
    const uniqueShapes = (objs: Record<string, unknown>[]) =>
      new Set(objs.map((o) => Object.keys(o).sort().join("|"))).size
    const shapesSpread = uniqueShapes(objsSpread)
    const shapesNorm = uniqueShapes(objsNorm)
    console.log(`[perf] part() unique Structures: spread=${shapesSpread}  normalized=${shapesNorm}`)
    expect(shapesSpread).toBeGreaterThan(shapesNorm)
    expect(shapesNorm).toBeLessThanOrEqual(12)
  })
})
