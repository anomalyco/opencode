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
    ((await v2(origin, "/api/session", directory, headers)) as any[]).map((s) => ({
      id: s.id,
      projectID: s.projectID ?? "",
      directory: s.location?.directory ?? "",
      title: s.title ?? "",
      version: "v2",
      time: { created: epoch(s.time?.created), updated: epoch(s.time?.updated) },
    })),
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
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      for (;;) {
        const index = buffer.indexOf("\n\n")
        if (index === -1) break
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        controller.enqueue(encoder.encode(wrapFrame(frame, directory) + "\n\n"))
      }
    },
  })
  return new Response(upstream.body.pipeThrough(transform), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function wrapFrame(frame: string, directory: string | null): string {
  return frame
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data:")) return line
      try {
        const payload = JSON.parse(line.slice(5))
        return (
          "data: " +
          JSON.stringify({
            directory: payload?.location?.directory ?? directory ?? "",
            workspace: payload?.location?.workspaceID,
            payload,
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
    const response = await fetch(input, init)
    const url = new URL(input instanceof Request ? input.url : input)
    if (response.status !== 404) return response
    if (url.pathname === "/global/event") {
      const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined)
      const directory = url.searchParams.get("directory") ?? url.searchParams.get("workspace")
      return globalEventStream(url.origin, directory, headers).catch(() => response)
    }
    // Adapters answer reads only; a write (e.g. the v1 POST /session create) must surface its
    // real 404 rather than receive the GET adapter's body.
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    if (method !== "GET") return response
    const fallback = legacyDefaults[url.pathname]
    if (fallback === undefined) return response
    const adapt = legacyAdapters[url.pathname]
    if (adapt === undefined) return Response.json(fallback)
    // The SDK may carry auth on a Request object rather than in init.
    const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined)
    const directory = url.searchParams.get("directory") ?? url.searchParams.get("workspace")
    return adapt(url.origin, directory, headers).then(
      (body) => Response.json(body),
      () => Response.json(fallback),
    )
  },
  { preconnect: fetch.preconnect },
)
