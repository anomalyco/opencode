import type { CommandInfo, ModelInfo, ModelRef, OpenCodeClient, OpenCodeEvent } from "@opencode/client/promise"
import { FSUtil } from "@opencode/util/fs-util"
import type { ConfigOptionProvider } from "./config-option"

export type Catalog = {
  readonly providers: ConfigOptionProvider[]
  readonly models: ModelInfo[]
  readonly defaultModel: ModelRef
  readonly modes: Array<{ id: string; name: string; description?: string }>
  readonly defaultModeID: string
  readonly commands: CommandInfo[]
}

export type Live = {
  readonly cwd: string
  current: Catalog
}

// Provider, integration, and credential changes reach the catalog through model.updated.
const reloadOn = new Set<OpenCodeEvent["type"]>(["model.updated", "agent.updated", "command.updated"])

export function make(input: {
  readonly client: OpenCodeClient
  readonly signal?: AbortSignal
  readonly changed: (live: Live, previous: Catalog) => Promise<unknown>
}) {
  const entries = new Map<string, Promise<Live>>()
  const running = new Map<Live, Promise<void>>()
  const queued = new Set<Live>()
  let subscribed: Promise<void> | undefined

  const get = (cwd: string) => {
    const key = FSUtil.resolve(cwd)
    const cached = entries.get(key)
    if (cached) return cached
    // Subscribe before the first read so an update between the read and the subscription is not lost.
    const loaded = subscribe()
      .then(() => load(input.client, cwd))
      .then((current): Live => ({ cwd, current }))
      .catch((error) => {
        entries.delete(key)
        throw error
      })
    entries.set(key, loaded)
    return loaded
  }

  const reload = (live: Live) => {
    const current = running.get(live)
    if (current) {
      queued.add(live)
      return current
    }
    const run = (async () => {
      do {
        queued.delete(live)
        const next = await load(input.client, live.cwd).catch(() => undefined)
        if (!next) break
        const previous = live.current
        live.current = next
        await input.changed(live, previous).catch(() => {})
      } while (queued.has(live))
      running.delete(live)
    })()
    running.set(live, run)
    return run
  }

  const subscribe = () =>
    (subscribed ??= new Promise<void>((ready) => {
      void (async () => {
        for await (const event of input.client.event.subscribe({ signal: input.signal })) {
          if (event.type === "server.connected") ready()
          if (!reloadOn.has(event.type)) continue
          const directory = event.location?.directory
          const targets = directory === undefined ? [...entries.values()] : [entries.get(FSUtil.resolve(directory))]
          targets.forEach((entry) => void entry?.then(reload, () => {}))
        }
      })()
        .catch(() => {})
        .finally(ready)
    }))

  return { get, reload }
}

async function load(client: OpenCodeClient, cwd: string): Promise<Catalog> {
  const location = { directory: cwd }
  // Some providers discover models in the background after plugin startup begins.
  const deadline = Date.now() + 5_000
  let missing = "No models are available"
  while (Date.now() < deadline) {
    const [modelResult, defaultResult, agentResult, commandResult] = await Promise.all([
      client.model.list({ location }),
      client.model.default({ location }),
      client.agent.list({ location }),
      client.command.list({ location }),
    ])
    const models = modelResult.data.filter((model) => model.enabled)
    const preferred = defaultResult.data
    // Parallel reads can straddle initialization; select only from this model list.
    const defaultModel = preferred
      ? models.find((model) => model.providerID === preferred.providerID && model.id === preferred.id)
      : models[0]
    const agents = agentResult.data.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
    const defaultAgent = agents.find((agent) => agent.mode === "primary") ?? agents[0]
    if (defaultModel && defaultAgent) {
      return {
        providers: providers(models),
        models,
        defaultModel: {
          providerID: defaultModel.providerID,
          id: defaultModel.id,
          variant: defaultModel.variants.find((variant) => variant.id === "default")?.id,
        },
        modes: agents.map((agent) => ({ id: agent.id, name: agent.name, description: agent.description })),
        defaultModeID: defaultAgent.id,
        commands: commandResult.data,
      }
    }
    missing = defaultModel ? "No primary agents are available" : "No models are available"
    await Bun.sleep(25)
  }
  throw new Error(missing)
}

function providers(models: readonly ModelInfo[]): ConfigOptionProvider[] {
  return Array.from(new Set(models.map((model) => model.providerID)))
    .toSorted()
    .map((providerID) => ({
      id: providerID,
      name: providerID,
      models: models
        .filter((model) => model.providerID === providerID)
        .map((model) => ({ id: model.id, name: model.name, variants: model.variants.map((variant) => variant.id) })),
    }))
}

export * as ACPCatalog from "./catalog"
