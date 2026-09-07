import type {
  AgentListOutput,
  CommandListOutput,
  LocationRef,
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

function location(ref: LocationRef) {
  return {
    location: {
      directory: ref.directory,
      workspace: ref.workspaceID,
    },
  }
}

function defaultCost(model: CurrentModel) {
  const picked = model.cost.find((cost) => cost.tier === undefined) ?? model.cost[0]
  if (!picked) return
  return model.cost.every((cost) => cost.input === 0) ? 0 : picked.input
}

function runAgent(input: CurrentAgent): RunAgent {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    mode: input.mode,
    hidden: input.hidden,
  }
}

function runCommand(input: CurrentCommand): RunCommand {
  return {
    name: input.name,
    description: input.description,
  }
}

function runSkill(input: CurrentSkill): RunCommand {
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
    const cost = defaultCost(model)
    provider.models[model.id] = {
      name: model.name,
      cost: cost === undefined ? undefined : { input: cost },
      limit: { context: model.limit.context },
      status: model.status,
      variants: Object.fromEntries((model.variants ?? []).map((variant) => [variant.id, {}])),
    }
    grouped.set(provider.id, provider)
  }

  return [...grouped.values()]
}

export async function loadRunAgents(sdk: OpenCodeClient, ref: LocationRef, signal?: AbortSignal): Promise<RunAgent[]> {
  const result = await sdk.agent.list(location(ref), ...requestOptions(signal))
  return result.data.map(runAgent)
}

export async function loadRunCommands(
  sdk: OpenCodeClient,
  ref: LocationRef,
  signal?: AbortSignal,
): Promise<RunCommand[]> {
  const [commands, skills, preferences] = await Promise.all([
    sdk.command.list(location(ref), ...requestOptions(signal)),
    sdk.skill.list(location(ref), ...requestOptions(signal)),
    sdk.preferences.list(...requestOptions(signal)),
  ])
  const disabled = new Set(
    preferences
      .filter((entry) => entry.target.kind === "skill.activation" && entry.value === "disabled")
      .map((entry) => entry.target.id),
  )
  return [
    ...commands.data.map(runCommand),
    ...skills.data.filter((skill) => !disabled.has(skill.id) && skill.slash !== false).map(runSkill),
  ]
}

export async function loadRunReferences(
  sdk: OpenCodeClient,
  ref: LocationRef,
  signal?: AbortSignal,
): Promise<RunReference[]> {
  const result = await sdk.reference.list(location(ref), ...requestOptions(signal))
  return result.data.filter((reference) => !reference.hidden)
}

export async function loadRunProviders(
  sdk: OpenCodeClient,
  ref: LocationRef,
  signal?: AbortSignal,
): Promise<RunProvider[]> {
  const [providers, models] = await Promise.all([
    sdk.provider.list(location(ref), ...requestOptions(signal)),
    sdk.model.list(location(ref), ...requestOptions(signal)),
  ])
  return runProviders([...providers.data], [...models.data])
}

function requestOptions(signal?: AbortSignal): [] | [{ signal: AbortSignal }] {
  return signal ? [{ signal }] : []
}
