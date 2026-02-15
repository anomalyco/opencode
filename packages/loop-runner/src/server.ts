import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk"
import type { Part, TextPart, Provider } from "@opencode-ai/sdk/v2/client"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "../../..")

function getExecutable(): string {
  const platform = process.platform === "darwin" ? "darwin" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  return resolve(root, `packages/opencode/dist/opencode-${platform}-${arch}/bin/opencode`)
}

interface LoopConfig {
  model: { providerID: string; modelID: string }
  system: string
  user: string
  working: string
  persistent: string
  monitor: { command: string; interval: number } | null
  interval: number
  maxIterations: number
  autoApprove: boolean
}

interface LoopState {
  running: boolean
  iteration: number
  sessionID: string | null
  lastOutput: string
  monitorOutput: string
  history: Array<{ iteration: number; prompt: string; response: string; timestamp: number }>
}

const state: LoopState = {
  running: false,
  iteration: 0,
  sessionID: null,
  lastOutput: "",
  monitorOutput: "",
  history: [],
}

let config: LoopConfig = {
  model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  system:
    "You are a helpful assistant running in a continuous loop. You have access to working memory (cleared each iteration) and persistent memory (maintained across iterations).",
  user: "Analyze the current state and take appropriate action.",
  working: "",
  persistent: "",
  monitor: null,
  interval: 5000,
  maxIterations: 0,
  autoApprove: true,
}

let opencodeServer: Awaited<ReturnType<typeof createOpencodeServer>> | null = null
let opencodeClient: ReturnType<typeof createOpencodeClient> | null = null
let loopAbort: AbortController | null = null
let monitorAbort: AbortController | null = null

const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()

function broadcast(data: unknown) {
  const message = `data: ${JSON.stringify(data)}\n\n`
  const encoded = new TextEncoder().encode(message)
  for (const controller of clients) {
    try {
      controller.enqueue(encoded)
    } catch {
      clients.delete(controller)
    }
  }
}

async function startOpenCode() {
  if (opencodeServer) return
  const executable = getExecutable()
  console.log("Starting OpenCode server with executable:", executable)
  opencodeServer = await createOpencodeServer({ executable })
  opencodeClient = createOpencodeClient({ baseUrl: opencodeServer.url })
  console.log("OpenCode server started at", opencodeServer.url)
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runMonitor() {
  if (!config.monitor) return
  const { command, interval } = config.monitor
  monitorAbort = new AbortController()

  while (!monitorAbort.signal.aborted) {
    try {
      const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      state.monitorOutput = output + (stderr ? `\n[stderr]\n${stderr}` : "")
      broadcast({ type: "monitor", output: state.monitorOutput })
    } catch (err) {
      state.monitorOutput = `Error running monitor: ${err}`
    }
    await sleep(interval)
  }
}

async function runLoop() {
  if (!opencodeClient) {
    await startOpenCode()
  }
  if (!opencodeClient) throw new Error("Failed to start OpenCode")

  state.running = true
  state.iteration = 0
  loopAbort = new AbortController()
  broadcast({ type: "state", state })

  while (state.running && !loopAbort.signal.aborted) {
    if (config.maxIterations > 0 && state.iteration >= config.maxIterations) {
      state.running = false
      break
    }

    state.iteration++
    broadcast({ type: "iteration", iteration: state.iteration })

    const session = await opencodeClient.session.create()
    if (!session.data) {
      broadcast({ type: "error", message: "Failed to create session" })
      await sleep(config.interval)
      continue
    }
    state.sessionID = session.data.id

    const prompt = buildPrompt()
    broadcast({ type: "prompt", prompt, iteration: state.iteration })

    try {
      const result = await opencodeClient.session.prompt({
        path: { id: session.data.id },
        body: {
          model: config.model,
          parts: [{ type: "text", text: prompt }],
          system: config.system,
        },
      })

      if (result.data) {
        const response = extractResponse(result.data.parts)
        state.lastOutput = response
        state.history.push({
          iteration: state.iteration,
          prompt,
          response,
          timestamp: Date.now(),
        })
        if (state.history.length > 100) state.history.shift()
        broadcast({ type: "response", response, iteration: state.iteration })
      }
    } catch (err) {
      broadcast({ type: "error", message: String(err), iteration: state.iteration })
    }

    config.working = ""
    broadcast({ type: "state", state })

    if (state.running) {
      await sleep(config.interval)
    }
  }

  state.running = false
  broadcast({ type: "stopped" })
}

function buildPrompt(): string {
  const sections: string[] = []

  if (config.persistent) {
    sections.push(`## Persistent Memory\n${config.persistent}`)
  }

  if (config.working) {
    sections.push(`## Working Memory (this iteration only)\n${config.working}`)
  }

  if (state.monitorOutput) {
    sections.push(`## Monitor Output\n\`\`\`\n${state.monitorOutput}\n\`\`\``)
  }

  if (state.lastOutput) {
    sections.push(`## Previous Response\n${state.lastOutput}`)
  }

  sections.push(`## Current Task\n${config.user}`)
  sections.push(`\n---\nIteration: ${state.iteration}`)

  return sections.join("\n\n")
}

function extractResponse(parts: Part[]): string {
  return parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

async function fetchModels(): Promise<Array<{ providerID: string; modelID: string; name: string }>> {
  if (!opencodeClient) await startOpenCode()
  if (!opencodeClient) return []

  try {
    const providers = await opencodeClient.provider.list()
    if (!providers.data) return []

    const result: Array<{ providerID: string; modelID: string; name: string }> = []
    const data = providers.data

    for (const provider of data.all) {
      if (provider.models) {
        for (const [modelID, model] of Object.entries(provider.models)) {
          const m = model as { name: string }
          result.push({ providerID: provider.id, modelID, name: m.name })
        }
      }
    }
    return result
  } catch {
    return []
  }
}

const dir = new URL(".", import.meta.url).pathname

const server = Bun.serve({
  port: 3456,
  hostname: "0.0.0.0",
  async fetch(req: Request) {
    const url = new URL(req.url)
    const path = url.pathname

    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { headers })
    }

    if (path === "/" || path === "/index.html") {
      const html = await Bun.file(dir + "index.html").text()
      return new Response(html, { headers: { ...headers, "Content-Type": "text/html" } })
    }

    if (path === "/api/events") {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          clients.add(controller)
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ type: "connected", state, config })}\n\n`),
          )
        },
        cancel(controller) {
          clients.delete(controller)
        },
      })

      return new Response(stream, {
        headers: {
          ...headers,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      })
    }

    if (path === "/api/state") {
      return Response.json({ state, config }, { headers })
    }

    if (path === "/api/models") {
      const models = await fetchModels()
      return Response.json(models, { headers })
    }

    if (path === "/api/config" && req.method === "POST") {
      const body = (await req.json()) as Partial<LoopConfig>
      config = { ...config, ...body }
      broadcast({ type: "config", config })
      return Response.json({ ok: true, config }, { headers })
    }

    if (path === "/api/start" && req.method === "POST") {
      if (!state.running) {
        runLoop().catch(console.error)
        if (config.monitor) {
          runMonitor().catch(console.error)
        }
      }
      return Response.json({ ok: true }, { headers })
    }

    if (path === "/api/stop" && req.method === "POST") {
      state.running = false
      loopAbort?.abort()
      monitorAbort?.abort()
      return Response.json({ ok: true }, { headers })
    }

    if (path === "/api/working" && req.method === "POST") {
      const body = (await req.json()) as { working?: string }
      config.working = body.working ?? ""
      broadcast({ type: "config", config })
      return Response.json({ ok: true }, { headers })
    }

    if (path === "/api/persistent" && req.method === "POST") {
      const body = (await req.json()) as { persistent?: string }
      config.persistent = body.persistent ?? ""
      broadcast({ type: "config", config })
      return Response.json({ ok: true }, { headers })
    }

    if (path === "/api/history") {
      return Response.json(state.history, { headers })
    }

    return new Response("Not Found", { status: 404, headers })
  },
})

console.log(`Loop Runner webapp running at http://localhost:${server.port}`)
