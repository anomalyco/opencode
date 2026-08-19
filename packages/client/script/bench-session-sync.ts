// Benchmark: legacy createData vs engine createEngineData session sync.
//
// Scenarios per layer:
//   hydrate  — populate a session with TRANSCRIPT messages
//   deltas   — stream DELTAS text deltas into the active assistant message
//   retained — heap retained by the populated layer (post-GC)
//
// Run from packages/client: bun run bench:sync
// Emits METRIC lines (median of RUNS after 1 warmup).

import { heapStats } from "bun:jsc"
import { createRoot } from "solid-js"
import { createData } from "../src/solid/data"
import type { CreateDataInput } from "../src/solid/data"
import { createEngineData } from "../src/solid/engine-data"
import type { OpenCodeEvent, SessionMessageInfo } from "../src/promise"

const TRANSCRIPT = Number(process.env.BENCH_TRANSCRIPT ?? 200)
const DELTAS = Number(process.env.BENCH_DELTAS ?? 2000)
const RUNS = Number(process.env.BENCH_RUNS ?? 7)

const sessionID = "ses_bench"
const assistantID = `msg_a${TRANSCRIPT - 1}`

function transcript(): SessionMessageInfo[] {
  return Array.from({ length: TRANSCRIPT }, (_, index): SessionMessageInfo => {
    const created = 1_700_000_000_000 + index
    if (index % 2 === 0)
      return { id: `msg_u${index}`, type: "user", text: `user message ${index} ${"lorem ".repeat(40)}`, time: { created } }
    return {
      id: `msg_a${index}`,
      type: "assistant",
      time: index === TRANSCRIPT - 1 ? { created } : { created, completed: created + 1 },
      agent: "build",
      content: [{ type: "text", text: `assistant reply ${index} ${"ipsum ".repeat(40)}` }],
    } as SessionMessageInfo
  })
}

function sessionInfo() {
  return {
    id: sessionID,
    projectID: "proj_bench",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    title: "bench",
    location: { directory: "/bench" },
  }
}

const textStarted = (seq: number) => ({
  id: "evt_start",
  created: 3,
  type: "session.text.started" as const,
  durable: { aggregateID: sessionID, seq, version: 1 },
  data: { sessionID, assistantMessageID: assistantID, ordinal: 0 },
})
const textDelta = (index: number) => ({
  id: `evt_d${index}`,
  created: 4,
  type: "session.text.delta" as const,
  data: { sessionID, assistantMessageID: assistantID, ordinal: 0, delta: "x" },
})
const textEnded = (seq: number) => ({
  id: "evt_end",
  created: 5,
  type: "session.text.ended" as const,
  durable: { aggregateID: sessionID, seq, version: 1 },
  data: { sessionID, assistantMessageID: assistantID, ordinal: 0, text: "END" },
})

type Layer = {
  hydrate: () => Promise<void>
  dispatch: (event: Record<string, unknown>) => void
  finalText: () => string | undefined
  dispose: () => void
}

type MessageReader = {
  session: { message: { get: (sessionID: string, messageID: string) => SessionMessageInfo | undefined } }
}

function lastText(data: MessageReader) {
  const message = data.session.message.get(sessionID, assistantID)
  const part = message?.type === "assistant" ? message.content.findLast((item) => item.type === "text") : undefined
  return part?.type === "text" ? part.text : undefined
}

function legacyLayer(): Layer {
  let handler: ((event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void) | undefined
  const messages = transcript()
  const api = {
    session: { get: async () => sessionInfo() },
    message: { list: async () => ({ data: messages.toReversed(), cursor: {} }) },
  } as unknown as ReturnType<CreateDataInput["api"]>
  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "/bench",
      event: {
        on: () => () => {},
        listen(next) {
          handler = next
          return () => {}
        },
      },
      connection: { status: () => "connected" },
    })
    return {
      async hydrate() {
        await data.session.sync(sessionID)
        await data.session.message.sync(sessionID)
      },
      dispatch(event) {
        handler?.({ name: event.type as OpenCodeEvent["type"], details: event as unknown as OpenCodeEvent })
      },
      finalText: () => lastText(data),
      dispose,
    }
  })
}

function engineLayer(): Layer {
  const queue: Array<Record<string, unknown>> = []
  let wake: (() => void) | undefined
  const api = {
    session: {
      snapshot: async () => ({
        session: sessionInfo(),
        children: [],
        inbox: [],
        messages: transcript(),
        seq: 10,
      }),
      async *log() {
        yield { type: "log.synced", aggregateID: sessionID, seq: 10 }
        while (true) {
          const item = queue.shift()
          if (item) {
            yield item
            continue
          }
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
      prompt: async () => ({}),
    },
  } as unknown as ReturnType<CreateDataInput["api"]>
  return createRoot((dispose) => {
    const data = createEngineData({
      api: () => api,
      directory: "/bench",
      event: { on: () => () => {}, listen: () => () => {} },
      connection: { status: () => "connected" },
    })
    return {
      async hydrate() {
        await data.session.sync(sessionID)
      },
      dispatch(event) {
        queue.push(event)
        wake?.()
        wake = undefined
      },
      finalText: () => lastText(data),
      dispose,
    }
  })
}

async function settle(check: () => boolean) {
  for (let attempt = 0; attempt < 10_000; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("scenario did not settle")
}

async function scenario(make: () => Layer) {
  const layer = make()
  const hydrateStart = performance.now()
  await layer.hydrate()
  const hydrate = performance.now() - hydrateStart

  const deltaStart = performance.now()
  layer.dispatch(textStarted(11))
  for (let index = 0; index < DELTAS; index++) layer.dispatch(textDelta(index))
  layer.dispatch(textEnded(12))
  await settle(() => layer.finalText() === "END")
  const deltas = performance.now() - deltaStart

  Bun.gc(true)
  const retained = heapStats().heapSize
  layer.dispose()
  return { hydrate, deltas, retained }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function measure(name: string, make: () => Layer) {
  await scenario(make) // warmup
  Bun.gc(true)
  const baseline = heapStats().heapSize
  const runs: Awaited<ReturnType<typeof scenario>>[] = []
  for (let run = 0; run < RUNS; run++) runs.push(await scenario(make))
  const hydrate = median(runs.map((run) => run.hydrate))
  const deltas = median(runs.map((run) => run.deltas))
  const retained = median(runs.map((run) => run.retained)) - baseline
  console.log(
    `${name}: hydrate ${hydrate.toFixed(2)}ms  deltas ${deltas.toFixed(2)}ms (${((deltas * 1000) / DELTAS).toFixed(1)}µs/delta)  retained ${(retained / 1024 / 1024).toFixed(2)}MB`,
  )
  console.log(`METRIC ${name}_hydrate_ms=${hydrate.toFixed(3)}`)
  console.log(`METRIC ${name}_deltas_ms=${deltas.toFixed(3)}`)
  console.log(`METRIC ${name}_retained_mb=${(retained / 1024 / 1024).toFixed(3)}`)
}

console.log(`transcript=${TRANSCRIPT} deltas=${DELTAS} runs=${RUNS}`)
await measure("legacy", legacyLayer)
await measure("engine", engineLayer)
