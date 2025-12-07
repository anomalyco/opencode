import type { SessionModelState, SessionModeState } from "@agentclientprotocol/sdk"
import type { ForgeClient } from "@forge/sdk"
import { matchAgent, getAllAgents } from "@/acp/agents"
import { Log } from "@/util/log"

export function parseAgentInput(input?: string | null): { agent?: string; model?: string } {
  if (!input) return {}
  const idx = input.lastIndexOf("/")
  if (idx > 0 && idx < input.length - 1) {
    return { agent: input.slice(0, idx), model: input.slice(idx + 1) }
  }
  return { agent: input }
}

export function modelSupported(models: SessionModelState | null | undefined, modelId: string) {
  return models?.availableModels?.some((model) => model.modelId === modelId)
}

function hasPlanKeyword(value?: string | null) {
  return typeof value === "string" && value.toLowerCase().includes("plan")
}

export function findPlanModeId(modes: SessionModeState | null | undefined): string | null {
  if (!modes?.availableModes?.length) return null
  const match = modes.availableModes.find((mode) => hasPlanKeyword(mode.id) || hasPlanKeyword(mode.name))
  return match?.id ?? null
}

export async function setAgentAndModel(
  sdk: ForgeClient,
  sessionID: string,
  agentName: string,
  modelId?: string,
): Promise<{ agent: string; modes: SessionModeState | null; models: SessionModelState | null }> {
  let agentResult:
    | Awaited<ReturnType<ForgeClient["session"]["agent"]>>
    | undefined

  try {
    agentResult = await sdk.session.agent({
      path: { id: sessionID },
      body: { agent: agentName },
    })
  } catch (error) {
    throw new Error(`Failed to set agent '${agentName}': ${error instanceof Error ? error.message : String(error)}`)
  }

  const updatedAgent = agentResult?.data?.agent ?? agentName
  const modes = (agentResult?.data?.modes ?? null) as SessionModeState | null
  const models = (agentResult?.data?.models ?? null) as SessionModelState | null

  if (modelId) {
    if (!modelSupported(models, modelId)) {
      throw new Error(`Agent '${updatedAgent}' does not support model '${modelId}'`)
    }

    try {
      await sdk.session.model({
        path: { id: sessionID },
        body: { model: modelId },
      })
    } catch (error) {
      throw new Error(
        `Failed to set model '${modelId}' for agent '${updatedAgent}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return { agent: updatedAgent, modes, models }
}

export type ModeFlagArgs = {
  planAgent: string
  planModel?: string
}

export type ModeSwitchConfig = ModeFlagArgs & {
  planModeId: string
  switched: boolean
}

export function collectModeFlags(args: Record<string, any>): ModeFlagArgs | null {
  const planInput = args["plan-agent"] ?? args.planAgent

  const planParsed = parseAgentInput(planInput)

  if (planParsed.agent) {
    return {
      planAgent: planParsed.agent ?? "",
      planModel: planParsed.model,
    }
  }

  return null
}

export function validateModeFlags(flags: ModeFlagArgs | null, args: Record<string, any>, fail: (msg: string) => never) {
  if (!flags) return

  if (!flags.planAgent) {
    fail("--plan-agent is required when using plan/implement mode flags")
  }

  if (args.command) {
    fail("Plan/implement mode flags are only supported with prompts (omit --command)")
  }
}

function resolveAgentInput(input?: string | null): { agent?: string; model?: string } {
  if (!input) return {}
  const parsed = parseAgentInput(input)
  const match = parsed.agent ? matchAgent(parsed.agent) : null
  if (parsed.agent && !match?.success) {
    const available = getAllAgents()
      .map((a) => a.name)
      .join(", ")
    throw new Error(`Agent '${parsed.agent}' not found. Available: ${available}`)
  }
  return {
    agent: match?.success ? match.match.name : parsed.agent,
    model: parsed.model,
  }
}

export async function applySessionSetup(input: {
  sdk: ForgeClient
  sessionID: string
  baseAgentInput?: string
  planAgentInput?: string
  planModelInput?: string
}): Promise<{
  sessionID: string
  baseAgent: string | null
  baseModel: string | null
  planAgent: string | null
  planModel: string | null
  planModeId: string | null
}> {
  const { sdk, sessionID } = input
  const log = Log.create({ service: "session-setup" })
  log.info("start", {
    sessionID,
    baseAgentInput: input.baseAgentInput ?? null,
    planAgentInput: input.planAgentInput ?? null,
    planModelInput: input.planModelInput ?? null,
  })
  const baseParsed = resolveAgentInput(input.baseAgentInput)
  const planParsed = resolveAgentInput(input.planAgentInput)

  let baseAgent: string | null = null
  let baseModel: string | null = null
  if (baseParsed.agent) {
    log.info("set-base-agent", { sessionID, agent: baseParsed.agent, model: baseParsed.model ?? null })
    const baseResult = await setAgentAndModel(sdk, sessionID, baseParsed.agent, baseParsed.model)
    baseAgent = baseResult.agent
    baseModel = baseParsed.model ?? baseResult.models?.currentModelId ?? null
    log.info("set-base-agent.done", { sessionID, agent: baseAgent, model: baseModel })
  }

  let planAgent: string | null = null
  let planModel: string | null = null
  let planModeId: string | null = null
  if (planParsed.agent) {
    log.info("set-plan-agent", {
      sessionID,
      agent: planParsed.agent,
      model: planParsed.model ?? input.planModelInput ?? null,
    })
    const planResult = await setAgentAndModel(sdk, sessionID, planParsed.agent, planParsed.model ?? input.planModelInput)
    planAgent = planResult.agent
    planModel = planParsed.model ?? input.planModelInput ?? null
    planModeId = findPlanModeId(planResult.modes)
    if (!planModeId) {
      throw new Error(`Agent '${planAgent}' does not support a planning mode`)
    }
    await sdk.session.mode({
      path: { id: sessionID },
      body: { mode: planModeId },
    })
    log.info("set-plan-mode.done", { sessionID, agent: planAgent, model: planModel, mode: planModeId })
  }

  return {
    sessionID,
    baseAgent,
    baseModel,
    planAgent,
    planModel,
    planModeId,
  }
}
