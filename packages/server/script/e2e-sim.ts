process.chdir(process.env.OPENCODE_SIMULATION_ROOT!)

import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createRoutes } from "../src/routes"

const routes = createRoutes("simtest")
const handler = HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: false })

const anchor = process.env.OPENCODE_SIMULATION_ROOT!
const auth = "Basic " + Buffer.from("opencode:simtest").toString("base64")
const location = `location%5Bdirectory%5D=${encodeURIComponent(anchor)}`

const api = async (method: string, path: string, body?: unknown) => {
  const response = await handler.handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: auth, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    undefined as never,
  )
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : undefined
}

for (let attempt = 0; attempt < 30; attempt++) {
  const providers = await api("GET", `/api/provider?${location}`)
  if (providers?.data?.length) {
    console.log("providers:", JSON.stringify(providers.data.map((provider: { id: string }) => provider.id)))
    break
  }
  if (attempt === 29) throw new Error("no providers after 15s")
  await new Promise((resolve) => setTimeout(resolve, 500))
}
const models = await api("GET", `/api/model?${location}`)
console.log(
  "models:",
  JSON.stringify(models?.data?.map?.((model: { providerID: string; id: string }) => `${model.providerID}/${model.id}`)),
)

const control = await (async () => {
  for (let port = 40950; port < 40970; port++) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`)
    const ok = await new Promise<boolean>((resolve) => {
      socket.addEventListener("open", () => resolve(true), { once: true })
      socket.addEventListener("error", () => resolve(false), { once: true })
    })
    if (ok) return socket
  }
  throw new Error("no backend control websocket found")
})()

const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
const exchanges: Array<{ id: string; body: unknown }> = []
const exchangeWaiters: Array<(exchange: { id: string; body: unknown }) => void> = []
let nextID = 1

control.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data))
  if (message.method === "llm.request") {
    const waiter = exchangeWaiters.shift()
    if (waiter) waiter(message.params)
    else exchanges.push(message.params)
    return
  }
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(message.error.message))
  else entry.resolve(message.result)
})

const call = (method: string, params?: unknown) => {
  const id = nextID++
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    control.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout: ${method}`))
    }, 30_000)
  })
}

console.log("attach:", JSON.stringify(await call("llm.attach")))

const session = await api("POST", `/api/session?${location}`, {})
const sessionID = session.data.id
console.log("session:", sessionID)
await api("POST", `/api/session/${sessionID}/prompt?${location}`, { prompt: { text: "Hello simulated model" } })
console.log("prompt admitted")

const exchange = await new Promise<{ id: string; body: unknown }>((resolve, reject) => {
  const queued = exchanges.shift()
  if (queued) return resolve(queued)
  exchangeWaiters.push(resolve)
  setTimeout(() => reject(new Error("no exchange within 30s")), 30_000)
})
console.log("exchange opened:", exchange.id)
const requestBody = exchange.body as { model?: string; messages?: unknown[] }
console.log("request model:", requestBody.model, "messages:", requestBody.messages?.length)

await call("llm.chunk", {
  id: exchange.id,
  items: [
    { type: "textDelta", text: "Hello from " },
    { type: "textDelta", text: "the driver!" },
  ],
})
await call("llm.finish", { id: exchange.id, reason: "stop" })
console.log("driver responded")

for (let attempt = 0; attempt < 60; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 500))
  const messages = await api("GET", `/api/session/${sessionID}/message?${location}`).catch(() => undefined)
  const text = (messages?.data ?? [])
    .filter((message: { type: string }) => message.type === "assistant")
    .flatMap((message: { content?: Array<{ type: string; text?: string }> }) => message.content ?? [])
    .filter((part: { type: string }) => part.type === "text")
    .map((part: { text?: string }) => part.text)
    .join("")
  if (text.includes("Hello from the driver!")) {
    console.log("ASSISTANT TEXT OK:", JSON.stringify(text))
    await handler.dispose()
    process.exit(0)
  }
}

await handler.dispose()
throw new Error("assistant text did not appear")
