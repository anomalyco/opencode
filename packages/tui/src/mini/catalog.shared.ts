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
      status: model.status,
      variants: Object.fromEntries((model.variants ?? []).map((variant) => [variant.id, {}])),
    }
    grouped.set(provider.id, provider)
  }

  return [...grouped.values()]
}

export async function waitForDefaultModel(input: {
  sdk: OpenCodeClient
  location: LocationRef
  timeoutMs?: number
  requestTimeoutMs?: number
  active?: () => boolean
  signal?: AbortSignal
}): Promise<{ providerID: string; modelID: string } | undefined> {
  const deadline = Date.now() + (input.timeoutMs ?? 5_000)
  while (Date.now() < deadline && !input.signal?.aborted && (input.active?.() ?? true)) {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(input.requestTimeoutMs ?? 1_000, Math.max(1, deadline - Date.now())),
    )
    const abort = () => controller.abort()
    input.signal?.addEventListener("abort", abort, { once: true })
    const model = await abortable(
      input.sdk.model
        .default(location(input.location), { signal: controller.signal })
        .then((result) => result.data)
        .catch(() => undefined),
      controller.signal,
    ).finally(() => {
      clearTimeout(timeout)
      input.signal?.removeEventListener("abort", abort)
    })
    if (model) return { providerID: model.providerID, modelID: model.id }
    await wait(25, input.signal)
  }
}

function abortable<A>(task: Promise<A>, signal: AbortSignal): Promise<A | undefined> {
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      resolve(undefined)
    }
    signal.addEventListener("abort", abort, { once: true })
    void task.then((value) => {
      signal.removeEventListener("abort", abort)
      resolve(value)
    })
  })
}

function wait(delay: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, delay))
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", done)
      resolve()
    }
  })
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
  const [commands, skills] = await Promise.all([
    sdk.command.list(location(ref), ...requestOptions(signal)),
    sdk.skill.list(location(ref), ...requestOptions(signal)),
  ])
  return [...commands.data.map(runCommand), ...skills.data.filter((skill) => skill.slash !== false).map(runSkill)]
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
