import assert from "node:assert/strict"
import cassette from "../../ai/test/fixtures/recordings/zai-chat/glm-5-3-preserves-reasoning-through-a-tool-loop-and-follow-up.json"

type Chat = {
  model: string
  stream: boolean
  messages: { role: string; content: unknown; tool_call_id?: string }[]
  tools: { function: { name: string } }[]
}

const encoder = new TextEncoder()
const encode = (frame: string) => encoder.encode(`${frame}\n\n`)
const framesOf = (i: number) => cassette.interactions[i].response.body.trimEnd().split("\n\n")
const recorded = framesOf(0)
// Replay the 26 reasoning and 58 text frames byte-for-byte. Only the tool payloads have to
// change: a recorded weather-tool result would bypass the server work we are here to measure.
const prefix = recorded
  .slice(
    0,
    recorded.findIndex((line) => line.includes('"tool_calls":[')),
  )
  .map(encode)
assert.equal(prefix.length, 84)
const toolEnd = recorded.slice(-2).map(encode)
const stop = framesOf(1).slice(-2).map(encode)
const envelope = JSON.parse(recorded[0].slice(6))
const frame = (delta: object) => encode(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta }] })}`)
const fragments = [
  "## Inventory check\n\n",
  ...Array.from({ length: 12 }, (_, i) => [`- Row ${i + 1}: `, "`widgets` ", "matches the ", "fixture.\n"]).flat(),
  "\n```json\n",
  '{"widgets":17}',
  "\n```\n",
]
export const report = fragments.join("")
const markdown = fragments.map((content) => frame({ role: "assistant", content }))
export const reads = 3

// Route by prompt and tool history, never by arrival order. Runs outside the profiled process.
export function provider(children: number, interval: number) {
  const traffic = { requests: 0, frames: 0, bytes: 0 }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      assert.equal(new URL(request.url).pathname, "/v1/chat/completions")
      assert.equal(request.method, "POST")
      const chat: Chat = await request.json()
      assert.equal(chat.model, "scripted")
      assert.equal(chat.stream, true)
      const prompt = JSON.stringify(chat.messages.find((m) => m.role === "user")?.content)
      const match = /bench-parent-(\d+)|bench-child-(\d+)-(\d+)/.exec(prompt)
      assert.ok(match, `Unexpected model request: ${prompt?.slice(0, 200)}`)
      const parent = match[1] !== undefined
      const results = chat.messages.filter((m) => m.role === "tool")
      for (const [i, result] of results.entries()) {
        assert.ok(
          JSON.stringify(result.content).includes(parent ? "## Inventory check" : `Inventory section ${i}:`),
          `Failed ${result.tool_call_id}: ${JSON.stringify(result.content).slice(0, 160)}`,
        )
      }
      const final = parent ? results.length === children : results.length === reads
      const frames = final ? [...markdown, ...stop] : [...prefix]
      if (!final) {
        const name = parent ? "subagent" : "read"
        assert.ok(
          chat.tools.some((tool) => tool.function.name === name),
          `${name} was not advertised`,
        )
        assert.ok(parent ? results.length === 0 : results.length < reads, "Unexpected tool history")
        for (let i = 0; i < (parent ? children : 1); i++) {
          const args = JSON.stringify(
            parent
              ? { agent: "general", description: `Inspect row ${i}`, prompt: `Check bench-child-${match[1]}-${i}` }
              : { path: "fixture.md", offset: results.length * 32 + 1, limit: 32 },
          )
          const id = parent ? `dispatch_${match[1]}_${i}` : `read_${match[2]}_${match[3]}_${results.length}`
          for (let j = 0; j < args.length; j += 5) {
            const fn = { ...(j === 0 ? { name } : {}), arguments: args.slice(j, j + 5) }
            frames.push(
              frame({ tool_calls: [{ ...(j === 0 ? { id } : {}), type: "function", index: i, function: fn }] }),
            )
          }
        }
        frames.push(...toolEnd)
      }
      traffic.requests++
      let index = 0
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (index) await Bun.sleep(interval) // The cassette has wire frames, not arrival timestamps.
            const bytes = frames[index++]
            traffic.frames++
            traffic.bytes += bytes.length
            controller.enqueue(bytes)
            if (index === frames.length) controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
    error(error) {
      return Response.json({ error: { message: error.message } }, { status: 400 })
    },
  })
  return { server, traffic }
}
