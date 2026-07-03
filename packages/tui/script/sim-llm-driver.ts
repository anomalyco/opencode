const TuiPort = 40900
const BackendPort = 40950
const PortScanAttempts = 20

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

interface Control {
  call(method: string, params?: unknown): Promise<unknown>
  notifications(method: string): AsyncGenerator<unknown>
}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true })
    socket.addEventListener("error", () => reject(new Error(`cannot connect ${url}`)), { once: true })
  })
  return socket
}

async function discover(explicit: string | undefined, basePort: number, label: string): Promise<Control> {
  const socket = explicit
    ? await connect(explicit)
    : await (async () => {
        for (let port = basePort; port < basePort + PortScanAttempts; port++) {
          const found = await connect(`ws://127.0.0.1:${port}`).catch(() => undefined)
          if (found) return found
        }
        throw new Error(`no ${label} websocket found on ports ${basePort}-${basePort + PortScanAttempts - 1}`)
      })()

  const pending = new Map<number, Pending>()
  const buffered = new Map<string, unknown[]>()
  const waiters = new Map<string, Array<(value: unknown) => void>>()
  let nextID = 1

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
    if (typeof message.method === "string") {
      const waiter = waiters.get(message.method)?.shift()
      if (waiter) return waiter(message.params)
      buffered.set(message.method, [...(buffered.get(message.method) ?? []), message.params])
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })

  return {
    call(method, params) {
      const id = nextID++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`timeout: ${method}`))
        }, 30_000)
      })
    },
    async *notifications(method) {
      while (true) {
        const queued = buffered.get(method)?.shift()
        if (queued !== undefined) {
          yield queued
          continue
        }
        yield await new Promise<unknown>((resolve, reject) => {
          waiters.set(method, [...(waiters.get(method) ?? []), resolve])
          setTimeout(() => reject(new Error(`no ${method} notification received`)), 30_000)
        })
      }
    },
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const tui = await discover(process.argv[2], TuiPort, "TUI simulation")
const backend = await discover(process.argv[3], BackendPort, "backend simulation control")

console.log("attach:", JSON.stringify(await backend.call("llm.attach")))
await tui.call("ui.action", { action: { type: "typeText", text: "Hello simulated model" } })
await tui.call("ui.action", { action: { type: "pressEnter" } })
console.log("prompt submitted")

const exchange = (await backend.notifications("llm.request").next()).value as { id: string; body?: { model?: string } }
console.log("llm.request:", JSON.stringify({ id: exchange.id, model: exchange.body?.model }))
await backend.call("llm.chunk", { id: exchange.id, items: [{ type: "textDelta", text: "Streaming " }] })
await sleep(300)
await backend.call("llm.chunk", { id: exchange.id, items: [{ type: "textDelta", text: "from the driver!" }] })
await backend.call("llm.finish", { id: exchange.id, reason: "stop" })
console.log("exchange answered")

for (let attempt = 0; attempt < 30; attempt++) {
  await sleep(500)
  const state = (await tui.call("ui.render")) as { screen?: string }
  if ((state.screen ?? "").includes("Streaming from the driver!")) {
    console.log("SCREEN OK: assistant reply rendered")
    process.exit(0)
  }
}

throw new Error("assistant reply did not render")
