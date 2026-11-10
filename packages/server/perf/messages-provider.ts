import assert from "node:assert/strict"
import cassette from "../../ai/test/fixtures/recordings/anthropic-messages/anthropic-opus-4-7-image-tool-result.json"

const recorded = cassette.interactions[0].response.body.trimEnd().split("\n\n")
const encoder = new TextEncoder()
const encode = (event: string) => encoder.encode(`${event}\n\n`)
const frame = (type: string, data: object) => encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}`)
const start = encode(recorded[0])
const end = encode(recorded.at(-1)!)

type Block = { type: string; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
type RequestBody = {
  stream: boolean
  messages: { role: string; content: Block[] | string }[]
  tools: { name: string }[]
}
type Call = { name: string; id: string; input: object }

export function messagesProvider() {
  let children: readonly string[] = []
  let gates: ReturnType<typeof Promise.withResolvers<void>>[] = []
  let ready = new Set<number>()
  let allReady = Promise.withResolvers<void>()
  const traffic = { requests: 0, requestBytes: 0, frames: 0 }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      assert.equal(new URL(request.url).pathname, "/v1/messages")
      assert.equal(request.method, "POST")
      const raw = await request.text()
      const body: RequestBody = JSON.parse(raw)
      assert.equal(body.stream, true)
      traffic.requestBytes += Buffer.byteLength(raw)
      traffic.requests++
      const users = body.messages
        .filter((m) => m.role === "user")
        .flatMap((m) => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content))
      const text = users
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      const task = /WORKLOAD:(coding|dispatch|worker-(\d+))/.exec(text)
      assert.ok(task, "missing benchmark prompt")
      assert.ok(raw.includes("inventory-history-0:"), "prior tool output did not reach provider")
      const results = users.filter((p) => p.type === "tool_result" && p.tool_use_id?.startsWith("live_"))
      assert.ok(
        results.every((p) => !p.is_error),
        "real tool failed",
      )
      const calls: Call[] = []
      let answer = ""
      if (task[1] === "dispatch") {
        if (!results.length) {
          for (const [i, id] of children.entries())
            calls.push({
              name: "subagent",
              id: `live_dispatch_${i}`,
              input: {
                agent: "general",
                description: `Inspect inventory ${i}`,
                prompt: `WORKLOAD:worker-${i}`,
                sessionID: id,
                background: true,
              },
            })
        } else {
          assert.equal(results.length, children.length)
          const received = children.filter((id) => text.includes(`<subagent sessionID="${id}" state="completed"`))
          for (const id of received) assert.ok(text.includes(`## Worker ${children.indexOf(id)} complete`))
          answer = `## Received ${received.length} of ${children.length}`
        }
      } else if (task[1] === "coding") {
        if (!results.length) calls.push({ name: "read", id: "live_read", input: { path: "fixture.md", limit: 32 } })
        if (results.length === 1)
          calls.push({ name: "shell", id: "live_git", input: { command: "git ls-files -- fixture.md" } })
        if (results.length) assert.ok(JSON.stringify(results[0].content).includes("Inventory section 0:"))
        if (results.length === 2) {
          assert.ok(JSON.stringify(results[1].content).includes("fixture.md"))
          answer = "## Inventory verified"
        }
      } else {
        const i = Number(task[2])
        assert.ok(i < children.length)
        if (!results.length) {
          // Nine of thirteen workers run real shell jobs; the rest read the tracked file.
          const shell = i < Math.round((children.length * 9) / 13)
          calls.push({
            name: shell ? "shell" : "read",
            id: `live_work_${i}`,
            input: shell ? { command: "bun inventory.ts" } : { path: "fixture.md", limit: 32 },
          })
          await Bun.sleep(2500 + (i % 3) * 250)
        } else {
          assert.equal(results.length, 1)
          assert.ok(JSON.stringify(results[0].content).includes("Inventory section 0:"))
          assert.ok(!ready.has(i), "duplicate child final request")
          ready.add(i)
          if (ready.size === children.length) allReady.resolve()
          await Promise.all([allReady.promise, gates[i].promise])
          answer = `## Worker ${i} complete`
        }
      }
      assert.ok(calls.length || answer, "unexpected tool history")
      const frames = [start]
      const content = answer || "Checking the tracked inventory."
      frames.push(frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }))
      for (const part of content.match(/.{1,6}/g) ?? [])
        frames.push(frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: part } }))
      frames.push(frame("content_block_stop", { index: 0 }))
      calls.forEach((call, i) => {
        assert.ok(
          body.tools.some((t) => t.name === call.name),
          `missing ${call.name} tool`,
        )
        const index = i + 1
        frames.push(
          frame("content_block_start", {
            index,
            content_block: { type: "tool_use", name: call.name, id: call.id, input: {} },
          }),
        )
        for (const partial_json of JSON.stringify(call.input).match(/.{1,16}/g) ?? [])
          frames.push(frame("content_block_delta", { index, delta: { type: "input_json_delta", partial_json } }))
        frames.push(frame("content_block_stop", { index }))
      })
      frames.push(
        frame("message_delta", {
          delta: { stop_reason: calls.length ? "tool_use" : "end_turn" },
          usage: { output_tokens: 32 },
        }),
        end,
      )
      let index = 0
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (index) await Bun.sleep(10)
            controller.enqueue(frames[index++])
            traffic.frames++
            if (index === frames.length) controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
    error(error) {
      return Response.json(
        { type: "error", error: { type: "invalid_request_error", message: error.message } },
        { status: 400 },
      )
    },
  })
  return {
    server,
    traffic,
    reset(ids: readonly string[]) {
      children = ids
      gates = ids.map(() => Promise.withResolvers<void>())
      ready = new Set()
      allReady = Promise.withResolvers<void>()
      Object.assign(traffic, { requests: 0, requestBytes: 0, frames: 0 })
    },
    release(i: number) {
      gates[i].resolve()
    },
  }
}
