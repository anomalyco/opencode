import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import type { RecordInput } from "../../src/contract"
import { PROFILES } from "../../src/profile/profiles"
import { estimate, FALLBACK_CONTEXT, limit, maybe } from "../../src/runtime/compaction"
import { make, replay } from "../../src/session/store"
import { tmpdir } from "../lib/tmp"
import { agent, collector, handle, scriptedGateway, text } from "./fixture"

const usage = (input: number) => ({ input, output: 0, estimated: false })

async function setup(records: RecordInput[], opts: { contextWindow?: number; profile?: keyof typeof PROFILES } = {}) {
  const dir = await tmpdir()
  const store = make(path.join(dir.path, "sessions"))
  const session = await Effect.runPromise(
    store.create({ id: "", cwd: dir.path, agent: "build", model: "m", profile: "local", depth: 0, created_at: 1 }),
  )
  await Effect.runPromise(Effect.forEach(records, (record) => store.append(session, record), { discard: true }))
  const scripted = scriptedGateway([text("SUMMARY-TEXT")])
  const events = collector()
  const input = (turn: number) => ({
    session_id: session,
    agent_path: [],
    agent,
    handle: handle({ contextWindow: opts.contextWindow ?? 1000 }),
    profile: PROFILES[opts.profile ?? "local"],
    system: "",
    tools: [],
    turn,
    textProtocol: false,
    gateway: scripted.gateway,
    store,
    sink: events.sink,
  })
  return {
    store,
    session,
    scripted,
    events,
    maybe: (turn = 1, force = false) => Effect.runPromise(maybe(input(turn), force)),
    records: () => Effect.runPromise(store.read(session)),
    [Symbol.asyncDispose]: () => dir[Symbol.asyncDispose](),
  }
}

const exchange = (tokens: number): RecordInput[] => [
  { type: "user", turn: 0, text: "original goal", synthetic: false },
  { type: "text", turn: 0, text: "working" },
  { type: "step", turn: 0, reason: "stop", usage: usage(tokens) },
]

describe("compaction", () => {
  test("local triggers at 75% of the context window", async () => {
    await using under = await setup(exchange(700))
    expect(await under.maybe()).toBe("none")
    expect(under.scripted.requests).toHaveLength(0)

    await using over = await setup(exchange(760))
    expect(await over.maybe()).toBe("compacted")
    const request = over.scripted.requests[0]!
    expect(request.label).toBe("compaction")
    expect(request.maxTokens).toBe(4096)
    expect(request.system).toContain("context summarization agent")
    expect(JSON.stringify(request.messages)).toContain("original goal")
    const state = replay(await over.records())
    expect(state.messages).toHaveLength(1)
    expect(JSON.stringify(state.messages[0])).toContain("SUMMARY-TEXT")
    expect(JSON.stringify(state.messages[0])).toContain("Original request:\\noriginal goal")
    expect(over.events.events.some((event) => event.type === "status" && event.phase === "compact")).toBe(true)
  })

  test("local-min triggers at 60%", async () => {
    await using local = await setup(exchange(650), { profile: "local" })
    expect(await local.maybe()).toBe("none")
    await using min = await setup(exchange(650), { profile: "local-min" })
    expect(await min.maybe()).toBe("compacted")
  })

  test("stubs old tool outputs first and stops when that is enough", async () => {
    const big = "x".repeat(4000)
    const turns: RecordInput[] = Array.from({ length: 8 }, (_, turn): RecordInput[] => [
      { type: "tool_call", turn, call_id: `c${turn}`, name: "read", input: { filePath: `f${turn}.ts` } },
      { type: "step", turn, reason: "tool-calls", usage: usage(turn === 7 ? 9000 : 100) },
      { type: "tool_result", turn, call_id: `c${turn}`, name: "read", status: "ok", output: big, duration_ms: 1, bytes: 4000 },
    ]).flat()
    await using env = await setup([{ type: "user", turn: 0, text: "go", synthetic: false }, ...turns], { contextWindow: 12000 })
    expect(await env.maybe(8)).toBe("stubbed")
    expect(env.scripted.requests).toHaveLength(0)
    const records = await env.records()
    expect(records.find((record) => record.type === "prune")).toMatchObject({ before_turn: 2 })
    const sent = JSON.stringify(replay(records).messages)
    expect(sent).toContain("[output elided: read f0.ts, 4000 B")
    expect(sent).toContain("[output elided: read f1.ts, 4000 B")
    expect(sent.split(big)).toHaveLength(7) // turns 2..7 keep their output
  })

  test("unknown context (0) is not skipped: it falls back to 32768", async () => {
    expect(limit(agent, handle({ contextWindow: 0 }))).toBe(FALLBACK_CONTEXT)
    expect(limit({ ...agent, max_context_tokens: 500 }, handle({ contextWindow: 0 }))).toBe(500)
    await using under = await setup(exchange(24000), { contextWindow: 0 })
    expect(await under.maybe()).toBe("none")
    await using over = await setup(exchange(25000), { contextWindow: 0 })
    expect(await over.maybe()).toBe("compacted")
  })

  test("forced compaction runs even under the trigger", async () => {
    await using env = await setup(exchange(10))
    expect(await env.maybe(1, true)).toBe("compacted")
  })

  test("estimate adds 25% when step usage was estimated, and uses chars after a prune", () => {
    const records = [
      { type: "step", turn: 0, reason: "stop", usage: { input: 800, output: 0, estimated: true }, seq: 1, t: 1 },
    ] as Parameters<typeof replay>[0]
    expect(estimate(replay(records), "", [])).toBe(1000)
    const pruned = replay([...records, { type: "prune", before_turn: 0, seq: 2, t: 1 }])
    expect(estimate(pruned, "x".repeat(400), [])).toBe(Math.ceil((400 + 2 + 2) / 4))
  })
})
