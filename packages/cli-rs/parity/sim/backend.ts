// The backend driver: answers the simulated provider's model calls (`llm.request`) over the server's drive backend
// endpoint (packages/simulation/src/backend/simulated-provider.ts).
import { Schema } from "effect"
import { Backend, JsonRpc } from "@opencode/protocol/simulation"

export type Reply = { items: Backend.Item[]; finish?: Backend.FinishReason }

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
    const reply = answer(invocation)
    call("llm.chunk", { id: invocation.id, items: reply.items })
      .then(() => call("llm.finish", { id: invocation.id, reason: reply.finish ?? "stop" }))
      .catch((error: Error) => failures.push(error.message))
  }
  await call("simulation.handshake", {
    client: { name: "opencode-parity", version: "1" },
    expectedRole: "backend",
    offeredVersions: [1],
    requiredCapabilities: ["llm.attach", "llm.chunk", "llm.finish"],
    optionalCapabilities: [],
  })
  await call("llm.attach")
  return { invocations, failures, close: () => socket.close() }
}
