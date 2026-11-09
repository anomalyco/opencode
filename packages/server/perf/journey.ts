import { OpenCode, type OpenCodeClient, type OpenCodeEvent, type SessionInfo, type JsonValue } from "@opencode/client"
import assert from "node:assert/strict"
import { diagnose, idle } from "./diagnostics"
import { messagesProvider } from "./messages-provider"
import type { start } from "./server"

export const metrics = ["cpu.work", "run.duration", "count.steps", "count.tools", "count.request_bytes", "count.frames"]

type Context = {
  case: string
  params: { exchanges: number; children?: number }
  call<A>(name: string, ...args: unknown[]): Promise<A>
  count(key: string, n: number): void
}
const model = { providerID: "fixture", id: "scripted" }
// Deterministic source-like ASCII, not user data. A read result has a fixed byte budget, not a guessed token count.
const lines = Array.from(
  { length: 512 },
  (_, i) => `export const bin${i} = { sku: "widget-${i}", units: ${i + 17}, shelf: ${i % 8} }`,
).join("\n")

export function journey() {
  let client: OpenCodeClient
  let template: SessionInfo
  let provider: ReturnType<typeof messagesProvider>
  let root: string
  let children: string[]
  let baseline: Awaited<ReturnType<typeof idle>>
  const output = process.env.SERVER_BENCH_DIAGNOSTICS

  async function seed(exchanges: number, parentID?: string) {
    const agent = parentID ? "general" : "build"
    const messages = Array.from({ length: exchanges }, (_, i): JsonValue[] => {
      const id = () => `msg_${crypto.randomUUID()}`
      const time = { created: i * 3 + 1, completed: i * 3 + 2 }
      return [
        { id: id(), time, type: "user", text: `Review the inventory in bin ${i}.` },
        {
          id: id(),
          time,
          type: "assistant",
          agent,
          model,
          finish: "tool-calls",
          content: [
            {
              type: "tool",
              id: `seed_${i}`,
              name: "read",
              time,
              state: {
                status: "completed",
                input: { path: "fixture.md" },
                content: [{ type: "text", text: `inventory-history-${i}:\n${lines}` }],
              },
            },
          ],
        },
        {
          id: id(),
          time,
          type: "assistant",
          agent,
          model,
          finish: "stop",
          content: [{ type: "text", text: `Bin ${i} is accounted for.` }],
        },
      ]
    }).flat()
    const session = await client.experimental.session.import(
      {
        info: { ...template, id: `ses_${crypto.randomUUID()}`, parentID, agent, model },
        messages,
        location: template.location,
      },
      { signal: AbortSignal.timeout(60_000) },
    )
    return session.id
  }

  async function prepare(ctx: Context) {
    root = await seed(ctx.params.exchanges)
    children = await Promise.all(
      Array.from({ length: ctx.params.children ?? 0 }, () => seed(ctx.params.exchanges, root)),
    )
    provider.reset(children)
  }

  async function observe(events: AsyncIterator<OpenCodeEvent>, activity?: (n: number) => void) {
    const active = new Set<string>()
    const done = new Set<string>()
    const notifications = new Set<string>()
    let ack = ""
    let wakes = 0
    let steps = 0
    let tools = 0
    let peak = 0
    let parked = false
    while (true) {
      const item = await events.next()
      assert.ok(!item.done, `Disconnected: ${steps} steps, ${done.size} children, ${notifications.size} notifications`)
      const event = item.value
      switch (event.type) {
        case "session.execution.failed":
        case "session.execution.interrupted":
        case "session.tool.failed":
        case "session.step.failed":
        case "permission.asked":
          throw new Error(`${event.type}: ${JSON.stringify(event.data)}`)
        case "session.execution.started":
          if (event.data.sessionID === root) {
            wakes++
            break
          }
          assert.ok(children.includes(event.data.sessionID))
          active.add(event.data.sessionID)
          activity?.(active.size)
          peak = Math.max(peak, active.size)
          break
        case "session.step.ended":
          steps++
          break
        case "session.tool.success":
          tools++
          break
        case "session.inbox.enqueued": {
          if (event.data.item.type !== "synthetic") break
          const id = event.data.item.payload.metadata?.childID
          assert.ok(event.data.sessionID === root && typeof id === "string" && children.includes(id))
          assert.ok(!notifications.has(id), "duplicate completion notification")
          notifications.add(id)
          break
        }
        case "session.text.ended":
          if (event.data.sessionID === root) ack = event.data.text
          break
        case "session.execution.succeeded": {
          if (event.data.sessionID !== root) {
            assert.ok(active.delete(event.data.sessionID))
            done.add(event.data.sessionID)
            activity?.(active.size)
            break
          }
          if (!children.length) {
            assert.equal(ack, "## Inventory verified")
            break
          }
          assert.equal(ack, `## Received ${notifications.size} of ${children.length}`)
          assert.equal(wakes, notifications.size + 1, "parent must resume from an idle boundary for each delivery")
          if (!notifications.size) parked = true
          if (notifications.size < children.length) {
            provider.release(notifications.size)
            continue
          }
          break
        }
      }
      if (event.type !== "session.execution.succeeded" || event.data.sessionID !== root) continue
      break
    }
    assert.equal(done.size, children.length)
    assert.equal(peak, children.length)
    assert.equal(parked, children.length > 0)
    assert.equal(tools, children.length ? 2 * children.length : 2)
    assert.equal(steps, children.length ? 3 * children.length + 2 : 3)
    assert.equal(provider.traffic.requests, steps)
    return {
      steps,
      tools,
      frames: provider.traffic.frames,
      request_bytes: provider.traffic.requestBytes,
      peak_children: peak,
      parent_executions: wakes,
    }
  }

  return {
    async setup(ctx: Context) {
      provider = messagesProvider()
      const info = await ctx.call<Awaited<ReturnType<typeof start>>>("start", provider.server.url.origin, true)
      client = OpenCode.make({
        baseUrl: info.baseUrl,
        headers: { authorization: `Basic ${btoa(`opencode:${info.password}`)}` },
      })
      template = await client.session.create({
        title: "Inventory review",
        model,
        location: { directory: info.directory },
      })
      await prepare(ctx)
      if (output) baseline = await idle(client)
    },
    async run(ctx: Context) {
      const signal = AbortSignal.timeout(180_000)
      const events = client.event.subscribe({ signal })[Symbol.asyncIterator]()
      try {
        assert.equal((await events.next()).value?.type, "server.connected")
        const work = async (activity?: (n: number) => void) => {
          const before = await ctx.call<number>("mainCpuUs")
          const [counts] = await Promise.all([
            observe(events, activity),
            client.session.prompt(
              { sessionID: root, text: children.length ? "WORKLOAD:dispatch" : "WORKLOAD:coding" },
              { signal },
            ),
          ])
          return { ...counts, main_thread_cpu_us: (await ctx.call<number>("mainCpuUs")) - before }
        }
        const counts = output ? await diagnose(output, ctx, client, baseline, work) : await work()
        for (const [key, n] of Object.entries(counts)) ctx.count(key, n)
      } finally {
        await events.return?.()
      }
    },
    async reset(ctx: Context) {
      await client.session.remove({ sessionID: root })
      await prepare(ctx)
    },
    async teardown(ctx: Context) {
      await provider.server.stop(true)
      await ctx.call("stop")
    },
  }
}
