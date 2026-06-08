// Microbenchmarks for the 5 targeted performance issues.
// These run synchronously to measure raw function throughput.

import { Token } from "../src/util/token"
import type { SessionMessage } from "../src/session/message"

// ── Helpers ───────────────────────────────────────────────────────────────

function format(ms: number): string {
  return ms.toFixed(3) + "ms"
}

function quantile(sorted: number[], q: number): number {
  const idx = Math.floor(sorted.length * q)
  return sorted[Math.min(idx, sorted.length - 1)]
}

function bench(label: string, fn: () => unknown, iterations: number) {
  // warmup
  for (let i = 0; i < Math.min(iterations, 100); i++) fn()

  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  const sorted = [...times].sort((a, b) => a - b)
  const total = sorted.reduce((a, b) => a + b, 0)
  const avg = total / sorted.length
  const ops = (sorted.length / (total / 1000)).toFixed(0)
  console.log(`${label}:`)
  console.log(`  total:    ${format(total)} (${ops} ops/s)`)
  console.log(`  avg:      ${format(avg)}`)
  console.log(`  p50:      ${format(quantile(sorted, 0.5))}`)
  console.log(`  p95:      ${format(quantile(sorted, 0.95))}`)
  return { avg, total, ops: Number(ops) }
}

// ── Test data ─────────────────────────────────────────────────────────────

function makeLargeRequest(size: number) {
  const messages = Array.from({ length: size }, (_, i) => ({
    role: i % 2 === 0 ? "user" : ("assistant" as const),
    content: [
      { type: "text" as const, text: `Message ${i} `.repeat(50) },
      ...(i % 3 === 0 ? [{ type: "text" as const, text: "Another text block. ".repeat(20) }] : []),
    ],
    ...(i % 5 === 0
      ? {
          toolCalls: [
            { name: "read_file" as const, input: { path: "/src/main.ts" }, id: `tool_${i}` },
            { name: "search" as const, input: { query: "find".repeat(10) }, id: `tool_s_${i}` },
          ],
        }
      : {}),
  }))
  return {
    system: [{ type: "text" as const, text: "You are a helpful assistant. ".repeat(100) }],
    messages,
    tools: Array.from({ length: 20 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool ${i} does something. `.repeat(10),
      input: { type: "object" as const, properties: { x: { type: "string" as const } } },
    })),
  }
}

// ── Issue 1: Token Estimation ─────────────────────────────────────────────

function estimateViaJSONStringify(value: unknown): number {
  return Token.estimate(JSON.stringify(value))
}

function estimateViaWalker(value: unknown): number {
  if (typeof value === "string") return Math.round(value.length / 4)
  if (typeof value === "number" || typeof value === "boolean") return 1
  if (value === null || value === undefined) return 0
  if (Array.isArray(value)) {
    let total = 0
    for (let i = 0; i < value.length; i++) total += estimateViaWalker(value[i])
    return total
  }
  if (typeof value === "object") {
    let total = 0
    const entries = Object.entries(value as Record<string, unknown>)
    for (let i = 0; i < entries.length; i++) total += estimateViaWalker(entries[i][1])
    return total
  }
  return 0
}

function benchTokenEstimation() {
  const request = makeLargeRequest(50)
  console.log(`\n=== Issue 1: Token Estimation (50-message request, 500 iterations) ===\n`)

  bench("JSON.stringify-based estimate", () => estimateViaJSONStringify(request), 500)
  bench("Structure-walker estimate", () => estimateViaWalker(request), 500)
}

// ── Issue 3: Message Content Iteration ─────────────────────────────────────

const assistantToolTypes = ["tool"] as const

function iteration4Pass(items: { type: string; id: string; name: string; text?: string; state: { input: string | object }; provider: { executed: boolean } }[]) {
  const content = items
    .filter((i) => i.type === "text" || i.type === "reasoning" || i.type === "tool")
    .flatMap((i): { type: string; text?: string; id?: string; name?: string; input?: string }[] => {
      if (i.type === "text") return [{ type: "text", text: i.text ?? "" }]
      if (i.type === "reasoning") return i.text ? [{ type: "text", text: i.text }] : []
      return [{ type: "tool-call", id: i.id, name: i.name, input: i.state.input as string }]
    })
  const results = items
    .filter((i) => i.type === "tool" && !i.provider.executed)
    .map((i) => ({ type: "tool-result" as const, id: i.id, name: i.name }))
  return [...content, ...results]
}

function iteration1Pass(items: { type: string; id: string; name: string; text?: string; state: { input: string | object }; provider: { executed: boolean } }[]) {
  const content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] = []
  const results: { type: string; id: string; name: string }[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.type === "text") content.push({ type: "text", text: item.text })
    else if (item.type === "reasoning") { if (item.text) content.push({ type: "text", text: item.text }) }
    else {
      content.push({ type: "tool-call", id: item.id, name: item.name, input: item.state.input })
      if (!item.provider.executed) results.push({ type: "tool-result", id: item.id, name: item.name })
    }
  }
  return [...content, ...results]
}

function makeAssistantContent(count: number) {
  return Array.from({ length: count }, (_, i): { type: string; id: string; name: string; text?: string; state: { input: string | object }; provider: { executed: boolean } } => ({
    type: i % 3 === 0 ? "text" : i % 3 === 1 ? "reasoning" : "tool",
    id: `item_${i}`,
    name: "read_file",
    text: i % 3 !== 2 ? `Content ${i} `.repeat(20) : undefined,
    state: { input: `{"path":"/file${i}.ts"}` },
    provider: { executed: i % 2 === 0 },
  }))
}

function benchMessageContentIteration() {
  const content = makeAssistantContent(30)
  console.log(`\n=== Issue 3: Message Content Iteration (30 items, 1000 iterations) ===\n`)

  bench("4-pass (flatMap + filter + map + filter)", () => iteration4Pass(content), 1000)
  bench("1-pass (single for loop)", () => iteration1Pass(content), 1000)
}

// ── Issue 4: structuredClone ──────────────────────────────────────────────

interface Part {
  id: string
  sessionID: string
  messageID: string
  type: string
  data: { text: string; metadata: Record<string, unknown>; nested: { x: number; y: number }[] }
}

function makePart(size: number): Part {
  return {
    id: "part_1234567890",
    sessionID: "ses_abcdef1234567890",
    messageID: "msg_abcdef1234567890",
    type: "text",
    data: {
      text: "Hello world! ".repeat(size),
      metadata: { key1: "value1", key2: 42, key3: true, key4: null },
      nested: Array.from({ length: Math.min(size, 50) }, (_, i) => ({ x: i, y: i * 2 })),
    },
  }
}

function benchStructuredClone() {
  const small = makePart(1)
  const large = makePart(100)
  console.log(`\n=== Issue 4: Part Cloning (5000 iterations) ===\n`)

  bench("structuredClone (small part)", () => structuredClone(small), 5000)
  bench("JSON round-trip (small part)", () => JSON.parse(JSON.stringify(small)) as Part, 5000)
  bench("structuredClone (large part)", () => structuredClone(large), 5000)
  bench("JSON round-trip (large part)", () => JSON.parse(JSON.stringify(large)) as Part, 5000)
}

// ── Issue 5: Session List ─────────────────────────────────────────────────

function benchSessionListImpact() {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: `ses_${i}`,
    project_id: "global",
    slug: `session-${i}`,
    directory: `/project/dir${i % 10}`,
    title: `Session ${i}`,
    version: "1.0",
    time_created: Date.now() - i * 1000,
    time_updated: Date.now(),
    cost: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
  }))

  // Simulate: data is already loaded, we sort & reverse.
  // Cost of all() vs limit(50).all() is in the DB layer (not microbenchmarkable here),
  // so we benchmark the in-memory sort + map cost.
  console.log(`\n=== Issue 5: Session List Processing (1000 rows, 1000 iterations) ===\n`)

  bench("unlimited: sort + reverse + map", () => {
    const copy = [...rows]
    copy.sort((a, b) => b.time_created - a.time_created)
    return copy.map((r) => ({ id: r.id, slug: r.slug, title: r.title }))
  }, 1000)

  bench("limited (50): sort + reverse + map", () => {
    const copy = [...rows]
    copy.sort((a, b) => b.time_created - a.time_created)
    return copy.slice(0, 50).map((r) => ({ id: r.id, slug: r.slug, title: r.title }))
  }, 1000)
}

// ── Main ──────────────────────────────────────────────────────────────────

console.log("=== Hot-Path Microbenchmarks ===\n")

benchTokenEstimation()
benchMessageContentIteration()
benchStructuredClone()
benchSessionListImpact()

console.log("\n=== Done ===\n")
process.exit(0)
