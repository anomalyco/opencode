// The backend driver: answers the simulated provider's model calls (`llm.request`) over the server's drive backend
// endpoint (packages/simulation/src/backend/simulated-provider.ts).
import { Schema } from "effect"
import { Backend, JsonRpc } from "@opencode/protocol/simulation"

// The items stream in order. At `{ hold: name }` the reply waits, its step still running, until the scenario's
// `{ release: name }` step; the items before it are sent first. `finish: false` sends no `llm.finish`, for a reply
// whose items already end the call (a provider error).
export type Reply = { items: (Backend.Item | { hold: string })[]; finish?: Backend.FinishReason | false }

export type Invocation = { id: string; url: string; body: unknown }

// `answer` returns the reply for each invocation, in the order they arrive.
export async function startBackend(url: string, answer: (invocation: Invocation) => Reply) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  const pending = new Map<number, (value: JsonRpc.Response) => void>()
  const invocations: Invocation[] = []
  const failures: string[] = []
  const holds = new Map<string, PromiseWithResolvers<void>>()
  const hold = (name: string) => holds.get(name) ?? holds.set(name, Promise.withResolvers()).get(name)!
  let id = 0
  const call = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const current = ++id
      const timer = setTimeout(() => reject(new Error(`backend ${method}: no response`)), 30_000)
      pending.set(current, (response) => {
        clearTimeout(timer)
        pending.delete(current)
        if (response.error) reject(new Error(`backend ${method}: ${response.error.message}`))
        else resolve(response.result)
      })
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: current, method, ...(params === undefined ? {} : { params }) }))
    })
  const stream = async (invocation: Invocation, reply: Reply) => {
    const batch: Backend.Item[] = []
    const flush = async () => {
      if (batch.length) await call("llm.chunk", { id: invocation.id, items: batch.splice(0) })
    }
    for (const item of reply.items) {
      if (!("hold" in item)) {
        batch.push(item)
        continue
      }
      await flush()
      await hold(item.hold).promise
    }
    await flush()
    if (reply.finish === false) return
    await call("llm.finish", { id: invocation.id, reason: reply.finish ?? "stop" })
  }
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id !== undefined && message.id !== null) {
      pending.get(Number(message.id))?.(Schema.decodeUnknownSync(JsonRpc.Response)(message))
      return
    }
    const notification = Schema.decodeUnknownSync(Backend.Notification)(message)
    if (notification.method !== "llm.request") return
    const invocation = notification.params
    invocations.push(invocation)
    stream(invocation, answer(invocation)).catch((error: Error) => failures.push(error.message))
  }
  await call("simulation.handshake", {
    client: { name: "opencode-parity", version: "1" },
    expectedRole: "backend",
    offeredVersions: [1],
    requiredCapabilities: ["llm.attach", "llm.chunk", "llm.finish"],
    optionalCapabilities: [],
  })
  await call("llm.attach")
  return { invocations, failures, release: (name: string) => hold(name).resolve(), close: () => socket.close() }
}
