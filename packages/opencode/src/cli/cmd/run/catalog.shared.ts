import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { RunAgent, RunCommand, RunProvider, RunReference } from "./types"

type CurrentAgent = NonNullable<Awaited<ReturnType<OpencodeClient["v2"]["agent"]["list"]>>["data"]>["data"][number]
type CurrentCommand = NonNullable<Awaited<ReturnType<OpencodeClient["v2"]["command"]["list"]>>["data"]>["data"][number]
type CurrentSkill = NonNullable<Awaited<ReturnType<OpencodeClient["v2"]["skill"]["list"]>>["data"]>["data"][number]
type CurrentProvider = NonNullable<
  Awaited<ReturnType<OpencodeClient["v2"]["provider"]["list"]>>["data"]
>["data"][number]
type CurrentModel = NonNullable<Awaited<ReturnType<OpencodeClient["v2"]["model"]["list"]>>["data"]>["data"][number]

function location(directory: string) {
  return {
    location: {
      directory,
    },
  }
}

function defaultCost(model: CurrentModel) {
  const picked = model.cost.find((cost) => cost.tier === undefined) ?? model.cost[0]
  if (!picked) {
    return undefined
  }

  return {
    ...picked,
    input: model.cost.every((cost) => cost.input === 0) ? 0 : picked.input,
  }
}

export function runAgent(input: CurrentAgent): RunAgent {
  return {
    name: input.id,
    description: input.description,
    mode: input.mode,
    hidden: input.hidden,
  }
}

export function runCommand(input: CurrentCommand): RunCommand {
  return {
    name: input.name,
    description: input.description,
  }
}

export function runSkill(input: CurrentSkill): RunCommand {
  return {
    name: input.name,
    description: input.description,
    source: "skill",
  }
}

export function runProviders(providers: CurrentProvider[], models: CurrentModel[]): RunProvider[] {
  const grouped = new Map<string, RunProvider>()

  for (const provider of providers) {
    grouped.set(provider.id, {
      id: provider.id,
      name: provider.name,
      models: {},
    })
  }

  for (const model of models) {
    const provider = grouped.get(model.providerID) ?? {
      id: model.providerID,
      name: model.providerID,
      models: {},
    }
    provider.models[model.id] = {
      id: model.id,
      providerID: model.providerID,
      name: model.name,
      capabilities: model.capabilities,
      cost: defaultCost(model),
      limit: model.limit,
      status: model.status,
      variants: Object.fromEntries(model.variants.map((variant) => [variant.id, {}])),
    }
    grouped.set(provider.id, provider)
  }

  return [...grouped.values()]
}

// A location boots its plugins in a deferred background batch after the layer
// is built, so first-turn model resolution can observe empty catalog state.
// For explicit --model flows, wait for that exact ref to appear before prompt
// admission. On timeout, return and let the real execution error surface.
export async function waitForCatalogReady(input: {
  sdk: OpencodeClient
  directory: string
  model: { providerID: string; modelID: string }
  timeoutMs?: number
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 5_000)
  while (Date.now() < deadline) {
    const models = await input.sdk.v2.model
      .list(location(input.directory), { throwOnError: true })
      .then((result) => result.data?.data ?? [])
      .catch(() => undefined)
    if (models?.some((model) => model.providerID === input.model.providerID && model.id === input.model.modelID)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

export async function waitForDefaultModel(input: {
  sdk: OpencodeClient
  directory: string
  timeoutMs?: number
  active?: () => boolean
}): Promise<{ providerID: string; modelID: string } | undefined> {
  const deadline = Date.now() + (input.timeoutMs ?? 5_000)
  while (Date.now() < deadline && (input.active?.() ?? true)) {
    const model = await input.sdk.v2.model
      .default(location(input.directory), { throwOnError: true })
      .then((result) => result.data?.data)
      .catch(() => undefined)
    if (model) return { providerID: model.providerID, modelID: model.id }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

export async function loadRunAgents(sdk: OpencodeClient, directory: string): Promise<RunAgent[]> {
  const result = await sdk.v2.agent.list(location(directory), { throwOnError: true })
  return (result.data?.data ?? []).map(runAgent)
}

export async function loadRunCommands(sdk: OpencodeClient, directory: string): Promise<RunCommand[]> {
  const [commands, skills] = await Promise.all([
    sdk.v2.command.list(location(directory), { throwOnError: true }),
    sdk.v2.skill.list(location(directory), { throwOnError: true }),
  ])
  return [
    ...(commands.data?.data ?? []).map(runCommand),
    ...(skills.data?.data ?? []).filter((skill) => skill.slash !== false).map(runSkill),
  ]
}

export async function loadRunReferences(sdk: OpencodeClient, directory: string): Promise<RunReference[]> {
  const result = await sdk.v2.reference.list(location(directory), { throwOnError: true })
  return (result.data?.data ?? []).filter((reference) => !reference.hidden)
}

export async function loadRunProviders(sdk: OpencodeClient, directory: string): Promise<RunProvider[]> {
  const [providers, models] = await Promise.all([
    sdk.v2.provider.list(location(directory), { throwOnError: true }),
    sdk.v2.model.list(location(directory), { throwOnError: true }),
  ])
  return runProviders(providers.data?.data ?? [], models.data?.data ?? [])
}
