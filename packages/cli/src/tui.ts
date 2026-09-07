import { run } from "@opencode-ai/tui"
import { TuiConfig } from "@opencode-ai/tui/config"
import { createBuiltinPlugins } from "@opencode-ai/tui/builtins"
import type { TuiPluginHost } from "@opencode-ai/tui/plugin/runtime"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"

// Slots render nothing (not even their fallback children) until a plugin host calls setupSlots,
// and the home and session screens are slot-wrapped, so a no-op host leaves the TUI blank.
// Register the built-in feature plugins; loading external plugin packages stays out of this host.
const pluginHost: TuiPluginHost = {
  async start(input) {
    const slots = input.runtime.setupSlots(input.api)
    for (const plugin of createBuiltinPlugins({ experimentalEventSystem: false })) {
      if (plugin.enabled === false) continue
      // Object.create keeps the host api's getters live; a spread would snapshot them.
      const api = Object.assign(Object.create(input.api), {
        slots: {
          register(slotPlugin: { order?: number; slots: object }) {
            slots.register({ ...slotPlugin, id: plugin.id } as never)
            return plugin.id
          },
        },
      })
      await plugin
        .tui(api, undefined, { id: plugin.id } as never)
        .catch((error) => console.error("Failed to start builtin TUI plugin", plugin.id, error))
    }
  },
  async dispose() {},
}

export function runTui(transport: { url: string; headers: RequestInit["headers"] }) {
  const config = TuiConfig.resolve({}, { terminalSuspend: false })
  return run({
    ...transport,
    args: {},
    config,
    fetch: gracefulFetch,
    pluginHost,
  }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}

const legacyDefaults: Record<string, unknown> = {
  "/config/providers": { providers: [], default: {} },
  "/provider": { all: [], default: {}, connected: [] },
  "/agent": [],
  "/config": {},
  "/path": { state: "", config: "", worktree: "", directory: "" },
  "/project/current": { id: "global", worktree: "", time: { created: 0 } },
  "/session": [],
}

// The TUI still reads these v1 routes, which the v2 daemon does not serve. Empty stubs kept it
// rendering but left onboarding blind to providers the daemon already knows (an env key shows as
// a connection in /api/integration). Answer them from the v2 API in the v1 shapes the TUI
// expects; the empty stub stays as the fallback when an adapter call fails.
const legacyAdapters: Record<
  string,
  (origin: string, directory: string | null, headers?: HeadersInit) => Promise<unknown>
> = {
  "/provider": async (origin, directory, headers) => {
    const { providers, connected } = await v1Providers(origin, directory, headers)
    return { all: providers, default: {}, connected }
  },
  "/config/providers": async (origin, directory, headers) => {
    const { providers } = await v1Providers(origin, directory, headers)
    return { providers, default: {} }
  },
  // v1 agents are keyed by name; v2 agents by id.
  "/agent": async (origin, directory, headers) =>
    ((await v2(origin, "/api/agent", directory, headers)) as any[]).map((agent) => ({
      name: agent.id,
      mode: "primary",
      builtIn: true,
      permission: { edit: "allow", bash: {} },
      tools: {},
      options: {},
    })),
  // The project gate: sync refuses to leave the loading state until the path has a worktree.
  "/path": async (origin, directory, headers) => {
    const location = (await v2raw(origin, "/api/location", directory, headers)) as any
    return {
      state: "",
      config: "",
      worktree: location.project?.directory ?? location.directory ?? "",
      directory: location.directory ?? "",
    }
  },
  "/project/current": async (origin, directory, headers) => {
    const location = (await v2raw(origin, "/api/location", directory, headers)) as any
    return {
      id: location.project?.id ?? "global",
      worktree: location.project?.directory ?? location.directory ?? "",
      time: { created: 0 },
    }
  },
  "/session": async (origin, directory, headers) =>
    ((await v2(origin, "/api/session", directory, headers)) as any[]).map(v1Session),
}

// Session reads with a session ID in the path. The daemon has no todo or diff endpoints yet, so
// those answer empty; the store fills from events as they exist.
const legacyReads: [RegExp, (m: RegExpMatchArray, o: string, d: string | null, h?: HeadersInit) => Promise<unknown>][] =
  [
    [/^\/session\/([^/]+)$/, async (m, o, d, h) => v1Session(await v2(o, `/api/session/${m[1]}`, d, h))],
    [
      /^\/session\/([^/]+)\/message$/,
      async (m, o, d, h) => v1Messages(m[1], (await v2(o, `/api/session/${m[1]}/message`, d, h)) as any[]),
    ],
    [/^\/session\/([^/]+)\/todo$/, async () => []],
    [/^\/session\/([^/]+)\/diff$/, async () => []],
  ]

// The v1 writes the TUI still issues. The v2 daemon takes agent and model per session rather than
// per message, so the prompt write switches them first. File attachments do not translate yet;
// only the text parts ride along.
const legacyWrites: [
  RegExp,
  (m: RegExpMatchArray, body: any, o: string, d: string | null, h?: HeadersInit) => Promise<unknown>,
][] = [
  [
    /^\/session$/,
    async (m, body, o, d, h) =>
      v1Session(
        await v2post(
          o,
          "/api/session",
          {
            agent: body?.agent,
            model: modelRef(body?.model, body?.variant),
            location: body?.directory ? { directory: body.directory } : undefined,
          },
          d,
          h,
        ),
      ),
  ],
  [
    /^\/session\/([^/]+)\/message$/,
    async (m, body, o, d, h) => {
      const sessionID = m[1]
      if (body?.agent) await v2post(o, `/api/session/${sessionID}/agent`, { agent: body.agent }, d, h).catch(() => {})
      const model = modelRef(body?.model, body?.variant)
      if (model) await v2post(o, `/api/session/${sessionID}/model`, { model }, d, h).catch(() => {})
      const text = ((body?.parts ?? []) as any[])
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
      const admitted = (await v2post(o, `/api/session/${sessionID}/prompt`, { prompt: { text } }, d, h)) as any
      // v1 answered with the finished assistant message; v2 admits asynchronously. The TUI ignores
      // the body, so a skeleton keeps the contract without waiting for the turn.
      return {
        info: v1AssistantInfo(sessionID, { id: admitted?.id ?? "", time: { created: admitted?.timeCreated } }),
        parts: [],
      }
    },
  ],
  [
    /^\/session\/([^/]+)\/abort$/,
    async (m, body, o, d, h) => {
      await v2post(o, `/api/session/${m[1]}/interrupt`, {}, d, h)
      return true
    },
  ],
]

function modelRef(model: any, variant?: string) {
  if (!model?.providerID) return undefined
  return { id: model.id ?? model.modelID, providerID: model.providerID, variant: variant ?? model.variant }
}

function v1Session(info: any) {
  return {
    id: info.id,
    slug: info.slug ?? info.id,
    projectID: info.projectID ?? "",
    directory: info.directory ?? info.location?.directory ?? "",
    path: info.path ?? "",
    parentID: info.parentID,
    title: info.title ?? "",
    version: info.version ?? "v2",
    cost: info.cost ?? 0,
    tokens: info.tokens,
    time: {
      created: epoch(info.time?.created),
      updated: epoch(info.time?.updated ?? info.time?.created),
    },
  }
}

function v1AssistantInfo(sessionID: string, item: any) {
  return {
    id: item.id,
    sessionID,
    role: "assistant",
    time: {
      created: epoch(item.time?.created),
      completed: item.time?.completed ? epoch(item.time.completed) : undefined,
    },
    parentID: "",
    modelID: item.model?.id ?? "",
    providerID: item.model?.providerID ?? "",
    mode: item.agent ?? "build",
    agent: item.agent ?? "build",
    path: { cwd: "", root: "" },
    cost: item.cost ?? 0,
    tokens: item.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: item.finish,
    error: item.error ? { name: "UnknownError", data: { message: item.error?.message ?? "unknown error" } } : undefined,
  }
}

function v1UserInfo(sessionID: string, item: any) {
  return {
    id: item.id,
    sessionID,
    role: "user",
    time: { created: epoch(item.time?.created) },
    agent: "build",
    model: { providerID: "", modelID: "" },
  }
}

function v1TextPart(sessionID: string, messageID: string, id: string, text: string) {
  return { id, sessionID, messageID, type: "text", text }
}

function v1ToolState(state: any, time: any) {
  const start = epoch(time?.ran ?? time?.created)
  const end = epoch(time?.completed ?? time?.created)
  const output = ((state?.content ?? []) as any[])
    .filter((item) => typeof item?.text === "string")
    .map((item) => item.text)
    .join("\n")
  switch (state?.status) {
    case "completed":
      return {
        status: "completed",
        input: state.input ?? {},
        output,
        title: "",
        metadata: state.structured ?? {},
        time: { start, end },
      }
    case "error":
      return {
        status: "error",
        input: state.input ?? {},
        error: state.error?.message ?? "tool failed",
        time: { start, end },
      }
    case "running":
      return { status: "running", input: state.input ?? {}, time: { start } }
    default:
      return { status: "pending", input: {}, raw: typeof state?.input === "string" ? state.input : "" }
  }
}

// Part ids prefix the message id so live deltas and hydration reconcile onto the same rows.
function v1Parts(sessionID: string, message: any): any[] {
  const parts: any[] = []
  for (const item of (message.content ?? []) as any[]) {
    const id = `${message.id}-${item.id}`
    if (item.type === "text") parts.push(v1TextPart(sessionID, message.id, id, item.text ?? ""))
    if (item.type === "reasoning")
      parts.push({
        id,
        sessionID,
        messageID: message.id,
        type: "reasoning",
        text: item.text ?? "",
        time: {
          start: epoch(item.time?.created ?? message.time?.created),
          end: item.time?.completed ? epoch(item.time.completed) : undefined,
        },
      })
    if (item.type === "tool")
      parts.push({
        id,
        sessionID,
        messageID: message.id,
        type: "tool",
        callID: item.id,
        tool: item.name,
        state: v1ToolState(item.state, item.time),
      })
  }
  return parts
}

// Agent and model switches, shell, system, synthetic, and compaction entries have no v1
// transcript shape; the view derives that context from events instead.
function v1Messages(sessionID: string, items: any[]): { info: any; parts: any[] }[] {
  const out: { info: any; parts: any[] }[] = []
  for (const item of items) {
    if (item.type === "user")
      out.push({
        info: v1UserInfo(sessionID, item),
        parts: [v1TextPart(sessionID, item.id, `${item.id}-text`, item.text ?? "")],
      })
    if (item.type === "assistant") out.push({ info: v1AssistantInfo(sessionID, item), parts: v1Parts(sessionID, item) })
  }
  return out.sort((a, b) => a.info.id.localeCompare(b.info.id))
}

const epoch = (value: unknown) =>
  typeof value === "number" ? value : Date.parse(typeof value === "string" ? value : "") || 0

// Some v2 responses are the object itself, not a data envelope.
async function v2raw(origin: string, path: string, directory: string | null, headers?: HeadersInit) {
  const url = new URL(origin + path)
  if (directory) url.searchParams.set("location[directory]", directory)
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${path} responded ${response.status}`)
  return response.json()
}

async function v2post(origin: string, path: string, payload: unknown, directory: string | null, headers?: HeadersInit) {
  const url = new URL(origin + path)
  if (directory) url.searchParams.set("location[directory]", directory)
  const merged = new Headers(headers)
  merged.set("content-type", "application/json")
  const response = await fetch(url, { method: "POST", headers: merged, body: JSON.stringify(payload) })
  if (!response.ok) throw new Error(`${path} responded ${response.status}`)
  const body = (await response.json().catch(() => ({}))) as { data?: unknown }
  return body.data ?? body
}

async function readJsonBody(preserved: Request | undefined, init?: RequestInit): Promise<any> {
  if (typeof init?.body === "string") {
    try {
      return JSON.parse(init.body)
    } catch {
      return undefined
    }
  }
  if (preserved) return preserved.json().catch(() => undefined)
  return undefined
}

async function v1Providers(origin: string, directory: string | null, headers?: HeadersInit) {
  const [providers, models, integrations] = (await Promise.all([
    v2(origin, "/api/provider", directory, headers),
    v2(origin, "/api/model", directory, headers),
    v2(origin, "/api/integration", directory, headers),
  ])) as [any[], any[], any[]]
  const methods = new Map(integrations.map((item) => [item.id, item]))
  const mapped = providers.map((provider) => ({
    id: provider.id,
    name: provider.name ?? provider.id,
    source: "env",
    env:
      (methods.get(provider.id)?.methods ?? [])
        .filter((method: any) => method.type === "env")
        .flatMap((method: any) => method.names ?? []) ?? [],
    options: {},
    models: Object.fromEntries(
      models.filter((m) => m.providerID === provider.id).map((m) => [m.id, v1Model(m)]),
    ),
  }))
  const connected = new Set(integrations.filter((item) => item.connections?.length).map((item) => item.id))
  return {
    providers: mapped,
    connected: mapped.map((p) => p.id).filter((id) => connected.has(id)),
  }
}

function v1Model(m: any) {
  const cost = Array.isArray(m.cost) ? (m.cost[0] ?? {}) : (m.cost ?? {})
  const io = (kinds: unknown) => {
    const list: string[] = Array.isArray(kinds) ? kinds : []
    return {
      text: list.some((k) => k.startsWith("text")),
      audio: list.includes("audio"),
      image: list.includes("image"),
      video: list.includes("video"),
      pdf: list.includes("pdf"),
    }
  }
  return {
    id: m.id,
    providerID: m.providerID,
    api: { id: m.api?.id ?? m.id, url: m.api?.url ?? "", npm: m.api?.package ?? "" },
    name: m.name ?? m.id,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: io(m.capabilities?.input).image,
      toolcall: m.capabilities?.tools ?? true,
      input: io(m.capabilities?.input),
      output: io(m.capabilities?.output),
    },
    cost: {
      input: cost.input ?? 0,
      output: cost.output ?? 0,
      cache: { read: cost.cache?.read ?? 0, write: cost.cache?.write ?? 0 },
    },
    limit: { context: m.limit?.context ?? 0, output: m.limit?.output ?? 0 },
    status: m.status ?? "active",
    options: {},
    headers: {},
  }
}

// The TUI blocks its first render on the global event stream, one more v1 route. The v2 daemon
// streams the same v2 event payloads on /api/event without the global envelope, so wrap each
// frame in the {directory, payload} envelope the TUI reads. Heartbeat comments pass through.
async function globalEventStream(origin: string, directory: string | null, headers?: HeadersInit) {
  const upstream = await fetch(`${origin}/api/event`, { headers })
  if (!upstream.ok || !upstream.body) throw new Error(`/api/event responded ${upstream.status}`)
  let buffer = ""
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let sink: TransformStreamDefaultController<Uint8Array> | undefined
  const emit = (dir: string, payload: unknown) => {
    try {
      sink?.enqueue(encoder.encode(`data: ${JSON.stringify({ directory: dir, payload })}\n\n`))
    } catch {}
  }
  const project = createSessionProjector(origin, headers, emit)
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      sink = controller
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      for (;;) {
        const index = buffer.indexOf("\n\n")
        if (index === -1) break
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        controller.enqueue(encoder.encode(wrapFrame(frame, directory) + "\n\n"))
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue
          try {
            project(JSON.parse(line.slice(5)))
          } catch {}
        }
      }
    },
    flush() {
      sink = undefined
      project.dispose()
    },
  })
  return new Response(upstream.body.pipeThrough(transform), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

// The sync store understands the legacy message.* events, which the v2 daemon never emits. Project
// its session.next.* stream into them: admissions and text deltas map directly for low latency,
// and every other session.next.* event schedules a debounced re-read of the session so the store
// converges on what the daemon persisted (tools, reasoning, tokens, titles).
function createSessionProjector(origin: string, headers: HeadersInit | undefined, emit: (dir: string, payload: unknown) => void) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  // The SDK validates every frame against the event schema; a nonconforming frame kills the
  // stream, so synthetic events carry the required id and full property sets.
  let counter = 0
  const legacyEvent = (type: string, properties: Record<string, unknown>) => ({
    id: `evt_bridge_${(counter += 1)}`,
    type,
    properties,
  })
  const resync = (sessionID: string, dir: string) => {
    clearTimeout(timers.get(sessionID))
    timers.set(
      sessionID,
      setTimeout(async () => {
        timers.delete(sessionID)
        try {
          const [info, items] = await Promise.all([
            v2(origin, `/api/session/${sessionID}`, null, headers),
            v2(origin, `/api/session/${sessionID}/message`, null, headers),
          ])
          emit(dir, legacyEvent("session.updated", { sessionID, info: v1Session(info) }))
          for (const message of v1Messages(sessionID, items as any[])) {
            emit(dir, legacyEvent("message.updated", { sessionID, info: message.info }))
            for (const part of message.parts)
              emit(dir, legacyEvent("message.part.updated", { sessionID, part, time: Date.now() }))
          }
        } catch {}
      }, 250),
    )
  }
  const handle = (event: any) => {
    const type = event?.type
    if (typeof type !== "string") return
    const data = event.data ?? {}
    const dir = event.location?.directory ?? ""
    const sessionID = data.sessionID ?? event.durable?.aggregateID
    if (type === "session.created" && data.info) {
      emit(dir, legacyEvent("session.updated", { sessionID: data.info.id, info: v1Session(data.info) }))
      return
    }
    if (type === "session.status" && sessionID) {
      emit(dir, legacyEvent("session.status", { sessionID, status: data.status }))
      return
    }
    if (!sessionID || !type.startsWith("session.next.")) return
    if (type === "session.next.prompted") {
      emit(
        dir,
        legacyEvent("message.updated", {
          sessionID,
          info: v1UserInfo(sessionID, { id: data.messageID, time: { created: data.timestamp } }),
        }),
      )
      emit(
        dir,
        legacyEvent("message.part.updated", {
          sessionID,
          part: v1TextPart(sessionID, data.messageID, `${data.messageID}-text`, data.prompt?.text ?? ""),
          time: Date.now(),
        }),
      )
      return
    }
    if (type === "session.next.step.started" && data.assistantMessageID) {
      emit(
        dir,
        legacyEvent("message.updated", {
          sessionID,
          info: v1AssistantInfo(sessionID, {
            id: data.assistantMessageID,
            time: { created: data.timestamp },
            agent: data.agent,
            model: data.model,
          }),
        }),
      )
    }
    if (type === "session.next.text.started" && data.assistantMessageID && data.textID) {
      emit(
        dir,
        legacyEvent("message.part.updated", {
          sessionID,
          part: v1TextPart(sessionID, data.assistantMessageID, `${data.assistantMessageID}-${data.textID}`, ""),
          time: Date.now(),
        }),
      )
      return
    }
    if (type === "session.next.text.delta" && data.assistantMessageID && data.textID) {
      emit(
        dir,
        legacyEvent("message.part.delta", {
          sessionID,
          messageID: data.assistantMessageID,
          partID: `${data.assistantMessageID}-${data.textID}`,
          field: "text",
          delta: data.delta ?? "",
        }),
      )
      return
    }
    resync(sessionID, dir)
  }
  return Object.assign(handle, {
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  })
}

function wrapFrame(frame: string, directory: string | null): string {
  return frame
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data:")) return line
      try {
        const event = JSON.parse(line.slice(5))
        return (
          "data: " +
          JSON.stringify({
            directory: event?.location?.directory ?? directory ?? "",
            workspace: event?.location?.workspaceID,
            // The daemon's internal event shape carries data plus durable and location fields; the
            // SDK validates each frame against the global envelope, whose payload is only
            // {id, type, properties}, and a nonconforming frame kills the stream.
            payload: { id: event?.id ?? "", type: event?.type ?? "", properties: event?.data ?? {} },
          })
        )
      } catch {
        return line
      }
    })
    .join("\n")
}

async function v2(origin: string, path: string, directory: string | null, headers?: HeadersInit) {
  const url = new URL(origin + path)
  if (directory) url.searchParams.set("location[directory]", directory)
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${path} responded ${response.status}`)
  const body = (await response.json()) as { data?: unknown }
  return body.data ?? []
}

const gracefulFetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    // The passthrough fetch consumes a Request's body; keep a clone in case a write needs bridging.
    const preserved =
      input instanceof Request && input.method !== "GET" && !init?.body ? input.clone() : undefined
    const response = await fetch(input, init)
    const url = new URL(input instanceof Request ? input.url : input)
    if (response.status !== 404) return response
    // The SDK may carry auth on a Request object rather than in init.
    const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined)
    const directory = url.searchParams.get("directory") ?? url.searchParams.get("workspace")
    if (url.pathname === "/global/event") {
      return globalEventStream(url.origin, directory, headers).catch(() => response)
    }
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    if (method === "POST") {
      for (const [pattern, handler] of legacyWrites) {
        const match = url.pathname.match(pattern)
        if (!match) continue
        const body = await readJsonBody(preserved, init)
        // A failed write surfaces the daemon's own response rather than a fabricated success.
        return handler(match, body, url.origin, directory, headers).then(Response.json, () => response)
      }
      return response
    }
    if (method !== "GET") return response
    for (const [pattern, handler] of legacyReads) {
      const match = url.pathname.match(pattern)
      if (!match) continue
      return handler(match, url.origin, directory, headers).then(Response.json, () => response)
    }
    const fallback = legacyDefaults[url.pathname]
    if (fallback === undefined) return response
    const adapt = legacyAdapters[url.pathname]
    if (adapt === undefined) return Response.json(fallback)
    return adapt(url.origin, directory, headers).then(
      (body) => Response.json(body),
      () => Response.json(fallback),
    )
  },
  { preconnect: fetch.preconnect },
)
