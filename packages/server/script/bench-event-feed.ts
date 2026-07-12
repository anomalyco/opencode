import { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { EventV2 } from "@opencode-ai/core/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { DateTime } from "effect"
import { EventFeed } from "../src/event-feed"

const clients = Number(process.argv[2] ?? 10)
const events = Number(process.argv[3] ?? 1_000)
const mode = process.argv[4] ?? "current"
const runs = 9
const event: OpenCodeEvent = {
  id: EventV2.ID.make("evt_benchmark"),
  created: DateTime.makeUnsafe(Date.now()),
  type: "mcp.status.changed",
  location: { directory: AbsolutePath.make("/tmp/opencode-benchmark") },
  metadata: {
    output: "x".repeat(8_192),
    nested: Array.from({ length: 32 }, (_, index) => ({ index, value: `value-${index}` })),
  },
  data: { server: "benchmark" },
}

function current() {
  let bytes = 0
  for (let index = 0; index < events; index++) {
    for (let client = 0; client < clients; client++) bytes += EventFeed.frame(event).length
  }
  return bytes
}

function shared() {
  let bytes = 0
  for (let index = 0; index < events; index++) {
    const encoded = EventFeed.frame(event)
    for (let client = 0; client < clients; client++) bytes += encoded.length
  }
  return bytes
}

const benchmark = mode === "shared" ? shared : current
benchmark()

const samples = Array.from({ length: runs }, () => {
  Bun.gc(true)
  const start = performance.now()
  const bytes = benchmark()
  return { duration: performance.now() - start, bytes }
})
const durations = samples.map((sample) => sample.duration).toSorted((a, b) => a - b)
const median = durations[Math.floor(durations.length / 2)]
const absoluteDeviations = durations.map((duration) => Math.abs(duration - median)).toSorted((a, b) => a - b)
const mad = absoluteDeviations[Math.floor(absoluteDeviations.length / 2)]

console.log(`mode=${mode} clients=${clients} events=${events} runs=${runs}`)
console.log(
  `median=${median.toFixed(3)}ms mad=${mad.toFixed(3)}ms best=${durations[0].toFixed(3)}ms worst=${durations[durations.length - 1].toFixed(3)}ms`,
)
console.log(`METRIC event_feed_${mode}_ms=${median.toFixed(3)}`)
console.log(`METRIC event_feed_${mode}_mad_ms=${mad.toFixed(3)}`)
