import type {
  AgentListOutput,
  CommandListOutput,
  ModelListOutput,
  OpenCodeClient,
  ProviderListOutput,
  SkillListOutput,
} from "@opencode-ai/client/promise"
import type { RunAgent, RunCommand, RunProvider, RunReference } from "./types"

type CurrentAgent = AgentListOutput["data"][number]
type CurrentCommand = CommandListOutput["data"][number]
type CurrentSkill = SkillListOutput["data"][number]
type CurrentProvider = ProviderListOutput["data"][number]
type CurrentModel = ModelListOutput["data"][number]

function location(directory: string, workspace?: string) {
  return {
    location: {
      directory,
      workspace,
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
    id: input.id,
    name: input.name,
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
    name: input.id,
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
      variants: Object.fromEntries((model.variants ?? []).map((variant) => [variant.id, {}])),
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
  sdk: OpenCodeClient
  directory: string
  workspace?: string
  model: { providerID: string; modelID: string }
  timeoutMs?: number
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 5_000)
  while (Date.now() < deadline) {
    const models = await input.sdk.model
      .list(location(input.directory, input.workspace))
      .then((result) => result.data)
      .catch(() => undefined)
    if (models?.some((model) => model.providerID === input.model.providerID && model.id === input.model.modelID)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

export async function waitForDefaultModel(input: {
  sdk: OpenCodeClient
  directory: string
  timeoutMs?: number
  active?: () => boolean
}): Promise<{ providerID: string; modelID: string } | undefined> {
  const deadline = Date.now() + (input.timeoutMs ?? 5_000)
  while (Date.now() < deadline && (input.active?.() ?? true)) {
    const model = await input.sdk.model
      .default(location(input.directory))
      .then((result) => result.data)
      .catch(() => undefined)
    if (model) return { providerID: model.providerID, modelID: model.id }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

export async function loadRunAgents(sdk: OpenCodeClient, directory: string): Promise<RunAgent[]> {
  const result = await sdk.agent.list(location(directory))
  return result.data.map(runAgent)
}

export async function loadRunCommands(sdk: OpenCodeClient, directory: string): Promise<RunCommand[]> {
  const [commands, skills] = await Promise.all([
    sdk.command.list(location(directory)),
    sdk.skill.list(location(directory)),
  ])
  return [...commands.data.map(runCommand), ...skills.data.filter((skill) => skill.slash !== false).map(runSkill)]
}

export async function loadRunReferences(sdk: OpenCodeClient, directory: string): Promise<RunReference[]> {
  const result = await sdk.reference.list(location(directory))
  return result.data.filter((reference) => !reference.hidden)
}

export async function loadRunProviders(sdk: OpenCodeClient, directory: string): Promise<RunProvider[]> {
  const [providers, models] = await Promise.all([
    sdk.provider.list(location(directory)),
    sdk.model.list(location(directory)),
  ])
  return runProviders([...providers.data], [...models.data])
}
