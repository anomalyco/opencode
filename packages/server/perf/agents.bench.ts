import { bench, script } from "@hona/strobe"
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client"
import assert from "node:assert/strict"
import { provider, reads, report } from "./provider"
import type { start } from "./server"
import { diagnose, idle } from "./diagnostics"

let mock: ReturnType<typeof provider>
let client: OpenCodeClient
let directory: string
let roots: string[]
const output = process.env.SERVER_BENCH_DIAGNOSTICS
let baseline: Awaited<ReturnType<typeof idle>>

async function parents(n: number) {
  return Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const session = await client.session.create(
        {
          title: `Inventory ${i}`,
          location: { directory },
          model: { providerID: "fixture", id: "scripted" },
        },
        { signal: AbortSignal.timeout(60_000) },
      )
      return session.id
    }),
  )
}

export default bench({
  targets: { server: script("./server.ts") },
  params: {
    parents: { run: [10], more: [1, 2] },
    children: { run: [10], more: [1, 6, 20] },
    interval: { run: [20], more: [5] },
  },
  async setup(ctx) {
    mock = provider(ctx.params.children, ctx.params.interval)
    const info = await ctx.call<Awaited<ReturnType<typeof start>>>("start", mock.server.url.origin)
    directory = info.directory
    client = OpenCode.make({
      baseUrl: info.baseUrl,
      headers: { authorization: `Basic ${btoa(`opencode:${info.password}`)}` },
    })
    roots = await parents(ctx.params.parents)
    if (output) baseline = await idle(client)
  },
  cases: {
    "concurrent agent trees": {
      primary: "cpu.work",
      metrics: [
        "run.duration",
        "cpu.app.total",
        "count.steps",
        "count.tools",
        "count.deltas",
        "count.peak_children",
        "count.provider_frames",
        "count.provider_bytes",
      ],
      async run(ctx) {
        const signal = AbortSignal.timeout(180_000)
        const events = client.event.subscribe({ signal })[Symbol.asyncIterator]()
        try {
          assert.equal((await events.next()).value?.type, "server.connected")
          const work = async (activity?: (children: number) => void) => {
            const before = { ...mock.traffic }
            const [counts] = await Promise.all([
              observe(events, ctx.params.children, activity),
              Promise.all(
                roots.map((sessionID, i) =>
                  client.session.prompt({ sessionID, text: `Inspect bench-parent-${i}` }, { signal }),
                ),
              ),
            ])
            assert.equal(mock.traffic.requests - before.requests, counts.steps, "one HTTP request per step; no retries")
            return {
              ...counts,
              provider_frames: mock.traffic.frames - before.frames,
              provider_bytes: mock.traffic.bytes - before.bytes,
            }
          }
          const counts = output ? await diagnose(output, ctx, client, baseline, work) : await work()
          for (const [key, value] of Object.entries(counts)) ctx.count(key, value)
        } finally {
          await events.return?.()
        }
      },
      async reset(ctx) {
        await Promise.all(
          roots.map((sessionID) => client.session.remove({ sessionID }, { signal: AbortSignal.timeout(60_000) })),
        )
        roots = await parents(ctx.params.parents)
      },
    },
  },
  async teardown(ctx) {
    await mock.server.stop(true)
    await ctx.call("stop")
  },
})

// Admission and provider EOF are both too early. Finish at the public execution-success event for
// each root, after its foreground subagents returned. Count the actual traffic seen by a client.
async function observe(events: AsyncIterator<OpenCodeEvent>, fanout: number, activity?: (children: number) => void) {
  const children = new Map(roots.map((id) => [id, new Set<string>()]))
  const active = new Set<string>()
  const completed = new Set<string>()
  const reports = new Set<string>()
  const counts = { steps: 0, tools: 0, deltas: 0, peak_children: 0 }
  while (!roots.every((id) => completed.has(id))) {
    const item = await events.next()
    assert.ok(!item.done, `Stream closed before all parents completed: ${JSON.stringify(counts)}`)
    const event = item.value
    switch (event.type) {
      case "session.created":
        if (event.data.parentID) children.get(event.data.parentID)?.add(event.data.sessionID)
        break
      case "session.execution.started":
        if (!children.has(event.data.sessionID)) {
          active.add(event.data.sessionID)
          activity?.(active.size)
        }
        counts.peak_children = Math.max(counts.peak_children, active.size)
        break
      case "session.execution.succeeded":
        if (active.delete(event.data.sessionID)) activity?.(active.size)
        completed.add(event.data.sessionID)
        break
      case "session.text.delta":
        counts.deltas++
        break
      case "session.text.ended":
        if (event.data.text === report) reports.add(event.data.sessionID)
        break
      case "session.step.ended":
        counts.steps++
        break
      case "session.tool.success":
        counts.tools++
        break
      case "session.execution.failed":
      case "session.execution.interrupted":
      case "session.step.failed":
      case "session.tool.failed":
      case "permission.asked":
        throw new Error(`${event.type}: ${JSON.stringify(event.data)}`)
    }
  }
  for (const ids of children.values()) assert.equal(ids.size, fanout, "children per parent")
  const sessions = new Set([...roots, ...Array.from(children.values()).flatMap((ids) => [...ids])])
  assert.deepEqual(completed, sessions, "every child must finish")
  assert.deepEqual(reports, sessions, "every session must stream a complete report")
  assert.equal(counts.steps, roots.length * (2 + (reads + 1) * fanout))
  assert.equal(counts.tools, (reads + 1) * roots.length * fanout)
  assert.ok(counts.deltas > sessions.size, "reports must stream, not arrive as a single result")
  return counts
}
