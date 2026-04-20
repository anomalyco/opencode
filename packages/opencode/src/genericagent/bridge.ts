import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { NamedError } from "@opencode-ai/util/error"

type Opts = {
  hostname: string
  port: number
  cors?: string[]
}

const log = Log.create({ service: "genericagent" })
const directory = "/genericagent"
const projectID = "genericagent"
const providerID = "genericagent"
const modelID = "python"
const version = Installation.VERSION

const fileUnsupported =
  "GenericAgent does not expose a project filesystem yet. Use a normal project to browse files, or keep chatting in GenericAgent without the file tree."

const pendingMessage =
  "GenericAgent Python runtime is not wired yet (Phase 6). Your message was received but will not be processed."

function welcomeSession() {
  const created = Date.now()
  return {
    id: "welcome",
    slug: "welcome",
    projectID,
    directory,
    title: "Welcome to GenericAgent",
    version,
    time: { created, updated: created },
  }
}

function welcomeInfo() {
  const id = Identifier.ascending("message")
  return {
    id,
    sessionID: "welcome",
    role: "assistant" as const,
    time: { created: Date.now() },
    providerID,
    modelID,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    path: { cwd: directory, root: directory },
    version,
  }
}

function welcomeMessage() {
  const info = welcomeInfo()
  const part = {
    id: Identifier.ascending("part"),
    messageID: info.id,
    sessionID: info.sessionID,
    type: "text" as const,
    text:
      "👋 GenericAgent backend is registered but its Python runtime is not wired yet. This is a placeholder welcome session — chat will echo a notice until Phase 6 lands.",
    time: { start: Date.now(), end: Date.now() },
  }
  return { info, parts: [part] }
}

const provider = {
  id: providerID,
  name: "GenericAgent",
  env: [] as string[],
  models: {
    [modelID]: {
      id: modelID,
      name: "GenericAgent (Python)",
      release_date: "",
      attachment: false,
      reasoning: false,
      temperature: false,
      tool_call: false,
      knowledge: "",
      last_updated: "",
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      limit: { context: 0, output: 0 },
      experimental: true,
    },
  },
}

const agent = {
  name: "genericagent",
  builtIn: true,
  description: "Python GenericAgent (placeholder)",
  mode: "primary" as const,
  model: { providerID, modelID },
  prompt: "",
  tools: {},
  permission: { edit: "allow", bash: {}, webfetch: "allow" },
  options: {},
  temperature: 0,
  topP: 1,
}

class Events {
  private listeners = new Set<(event: { directory: string; payload: unknown }) => void>()
  on(listener: (event: { directory: string; payload: unknown }) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(event: { directory: string; payload: unknown }) {
    for (const listener of this.listeners) listener(event)
  }
}

export namespace GenericAgentBridge {
  export function createApp(opts: Opts) {
    const app = new Hono()
    const events = new Events()
    return app
      .onError((err, c) => {
        const message = err instanceof Error ? err.message : String(err)
        log.error("genericagent bridge request failed", { error: message })
        return c.json(new NamedError.Unknown({ message }).toObject(), { status: 500 })
      })
      .use((c, next) => {
        const password = process.env.OPENCODE_SERVER_PASSWORD
        if (!password || c.req.method === "OPTIONS") return next()
        return basicAuth({ username: process.env.OPENCODE_SERVER_USERNAME ?? "opencode", password })(c, next)
      })
      .use(
        cors({
          origin(input) {
            if (!input) return
            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (
              input === "tauri://localhost" ||
              input === "http://tauri.localhost" ||
              input === "https://tauri.localhost"
            )
              return input
            if (opts.cors?.includes(input)) return input
            return
          },
        }),
      )
      .get("/global/health", (c) => c.json({ healthy: true, version }))
      .get("/global/config", (c) => c.json({ model: `${providerID}/${modelID}` }))
      .patch("/global/config", async (c) =>
        c.json(await c.req.json().catch(() => ({ model: `${providerID}/${modelID}` }))),
      )
      .post("/global/dispose", (c) => c.json(true))
      .get("/global/event", async (c) => {
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({ data: JSON.stringify({ payload: { type: "server.connected", properties: {} } }) })
          const off = events.on((event) => {
            void stream.writeSSE({ data: JSON.stringify(event) })
          })
          const timer = setInterval(() => {
            stream.writeSSE({ data: JSON.stringify({ payload: { type: "server.heartbeat", properties: {} } }) })
          }, 10_000)
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              off()
              clearInterval(timer)
              resolve()
            })
          })
        })
      })
      .get("/path", (c) =>
        c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: directory,
          directory,
        }),
      )
      .get("/project", (c) =>
        c.json([
          {
            id: projectID,
            worktree: directory,
            name: "GenericAgent",
            time: { created: Date.now(), updated: Date.now() },
            sandboxes: [],
          },
        ]),
      )
      .get("/project/current", (c) =>
        c.json({
          id: projectID,
          worktree: directory,
          name: "GenericAgent",
          time: { created: Date.now(), updated: Date.now() },
          sandboxes: [],
        }),
      )
      .get("/provider", (c) =>
        c.json({
          all: [provider],
          default: { [providerID]: `${providerID}/${modelID}` },
          connected: [providerID],
        }),
      )
      .get("/provider/auth", (c) => c.json({}))
      .get("/config", (c) => c.json({}))
      .get("/command", (c) => c.json([]))
      .get("/agent", (c) => c.json([agent]))
      .get("/skill", (c) => c.json([]))
      .get("/mcp", (c) => c.json({}))
      .get("/lsp", (c) => c.json([]))
      .get("/vcs", (c) => c.json({ branch: "genericagent" }))
      .get("/file", () => {
        throw new Error(fileUnsupported)
      })
      .get("/file/content", () => {
        throw new Error(fileUnsupported)
      })
      .get("/file/status", (c) => c.json([]))
      .get("/permission", (c) => c.json([]))
      .get("/question", (c) => c.json([]))
      .get("/session/status", (c) => c.json({}))
      .get("/session", (c) => c.json([welcomeSession()]))
      .post("/session", async (c) => {
        const body = (await c.req.json().catch(() => ({}))) as { id?: string; title?: string }
        const sid = body.id || crypto.randomUUID()
        return c.json({
          id: sid,
          slug: sid,
          projectID,
          directory,
          title: body.title || sid,
          version,
          time: { created: Date.now(), updated: Date.now() },
        })
      })
      .get("/session/:sessionID", (c) => {
        const sessionID = c.req.param("sessionID")
        if (sessionID === "welcome") return c.json(welcomeSession())
        return c.json({
          id: sessionID,
          slug: sessionID,
          projectID,
          directory,
          title: sessionID,
          version,
          time: { created: Date.now(), updated: Date.now() },
        })
      })
      .get("/session/:sessionID/todo", (c) => c.json([]))
      .get("/session/:sessionID/children", (c) => c.json([]))
      .get("/session/:sessionID/message", (c) => {
        const sessionID = c.req.param("sessionID")
        if (sessionID === "welcome") return c.json([welcomeMessage()])
        return c.json([])
      })
      .post("/session/:sessionID/prompt_async", (c) => {
        const sessionID = c.req.param("sessionID")
        log.info("genericagent prompt received (placeholder)", { sessionID })
        const info = {
          ...welcomeInfo(),
          sessionID,
        }
        const part = {
          id: Identifier.ascending("part"),
          messageID: info.id,
          sessionID,
          type: "text" as const,
          text: pendingMessage,
          time: { start: Date.now(), end: Date.now() },
        }
        return c.json({ info, parts: [part] })
      })
  }

  export function listen(opts: Opts) {
    const app = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4097) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)
    return server
  }
}
