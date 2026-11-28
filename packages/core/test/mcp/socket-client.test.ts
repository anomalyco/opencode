import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/client"
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server"
import { McpSocketClient } from "@opencode/core/mcp/socket-client"
import FastCheck from "fast-check"

// What a socket transport does with any interleaving of frames, starts, sends, closes and socket ends, against a model:
// frames are delivered once each, in arrival order, from start until the transport closes; onclose fires once; the
// socket is closed with 1000 only by close(); and sends and starts fail unless the transport is in a state to take them.
type Op =
  | { readonly _tag: "frame"; readonly valid: boolean; readonly then?: "frame" | "end" }
  | { readonly _tag: "start" | "send" | "close" | "end" }

const op: FastCheck.Arbitrary<Op> = FastCheck.oneof(
  FastCheck.record(
    {
      _tag: FastCheck.constant("frame" as const),
      valid: FastCheck.boolean(),
      then: FastCheck.constantFrom(undefined, "frame" as const, "end" as const),
    },
    { requiredKeys: ["_tag", "valid"] },
  ),
  FastCheck.record({
    _tag: FastCheck.constantFrom("start" as const, "send" as const, "close" as const, "end" as const),
  }),
)

describe("McpSocketClient", () => {
  test("delivers, sends and closes as the model says for any sequence", () =>
    FastCheck.assert(
      FastCheck.asyncProperty(FastCheck.array(op, { maxLength: 20 }), async (ops) => {
        const socket = { sent: [] as string[], closed: [] as Array<number | undefined> }
        const transport = McpSocketClient.make({
          send: (text) => void socket.sent.push(text),
          close: (code) => void socket.closed.push(code),
        })
        const seen = { messages: [] as number[], errors: 0, closes: 0 }
        // What each frame asks the transport to do once it is delivered, by id.
        const after = new Map<number, "frame" | "end">()
        let next = 0
        const frame = (valid: boolean, then?: "frame" | "end") => {
          const id = next++
          if (then) after.set(id, then)
          transport.deliver(valid ? JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }) : "not json")
        }
        transport.onmessage = (message) => {
          const id = Number((message as { id: number }).id)
          seen.messages.push(id)
          const then = after.get(id)
          if (then === "frame") frame(true)
          if (then === "end") transport.ended()
        }
        transport.onerror = () => void seen.errors++
        transport.onclose = () => void seen.closes++

        type Item = { readonly id: number; readonly valid: boolean; readonly then?: "frame" | "end" }
        const model = {
          phase: "ready" as "ready" | "open" | "closed",
          next: 0,
          queue: [] as Item[],
          flushing: false,
          delivered: [] as number[],
          errors: 0,
          closes: 0,
          closed: [] as number[],
          sent: 0,
        }
        const arrive = (valid: boolean, then?: "frame" | "end") => {
          const item = { id: model.next++, valid, then }
          if (model.phase === "closed") return
          model.queue.push(item)
          if (model.phase === "open") flush()
        }
        const flush = () => {
          if (model.flushing) return
          model.flushing = true
          while (model.phase === "open" && model.queue.length > 0) {
            const item = model.queue.shift()!
            if (!item.valid) {
              model.errors++
              continue
            }
            model.delivered.push(item.id)
            if (item.then === "frame") arrive(true)
            if (item.then === "end") end()
          }
          model.flushing = false
        }
        const end = () => {
          if (model.phase === "closed") return
          model.phase = "closed"
          model.queue = []
          model.closes++
        }

        for (const step of ops) {
          switch (step._tag) {
            case "frame":
              arrive(step.valid, step.then)
              frame(step.valid, step.then)
              break
            case "end":
              end()
              transport.ended()
              break
            case "send": {
              const sent = await transport.send({ jsonrpc: "2.0", id: "out", method: "ping" }).then(
                () => true,
                () => false,
              )
              expect(sent).toBe(model.phase === "open")
              if (sent) model.sent++
              break
            }
            case "close":
              if (model.phase !== "closed") model.closed.push(1000)
              end()
              await transport.close()
              break
            case "start": {
              const ready = model.phase === "ready"
              if (ready) {
                model.phase = "open"
                flush()
              }
              const started = await transport.start().then(
                () => true,
                () => false,
              )
              expect(started).toBe(ready)
            }
          }
        }
        expect(seen.messages).toEqual(model.delivered)
        expect(seen.errors).toBe(model.errors)
        expect(seen.closes).toBe(model.closes)
        expect(socket.closed).toEqual(model.closed)
        expect(socket.sent).toHaveLength(model.sent)
      }),
      { numRuns: 300, seed: 60694 },
    ))

  test("carries an MCP session between the SDK client and server", async () => {
    // Two transports wired back to back stand in for the two ends of one WebSocket.
    const ends: { client?: McpSocketClient.SocketTransport; server?: McpSocketClient.SocketTransport } = {}
    const link = (peer: () => McpSocketClient.SocketTransport | undefined) => ({
      send: (text: string) => queueMicrotask(() => peer()?.deliver(text)),
      close: () => queueMicrotask(() => peer()?.ended()),
    })
    ends.client = McpSocketClient.make(link(() => ends.server))
    ends.server = McpSocketClient.make(link(() => ends.client))

    const server = new McpServer({ name: "app", version: "1.0.0" })
    server.registerTool(
      "echo",
      {
        description: "Echo text",
        inputSchema: fromJsonSchema<{ text: string }>({
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        }),
      },
      async (input) => ({ content: [{ type: "text", text: `echo: ${input.text}` }] }),
    )
    const client = new Client({ name: "opencode", version: "1.0.0" })
    const closed = Promise.withResolvers<void>()
    server.server.onclose = () => closed.resolve()
    await Promise.all([server.connect(ends.server), client.connect(ends.client)])

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual(["echo"])
    expect(await client.callTool({ name: "echo", arguments: { text: "hi" } })).toMatchObject({
      content: [{ type: "text", text: "echo: hi" }],
    })

    await client.close()
    await closed.promise
  })
})
