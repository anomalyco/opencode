import type { SessionModelState, SessionModeState } from "@agentclientprotocol/sdk"
import type { ForgeClient } from "@forge/sdk"
import { matchAgent, getAllAgents } from "@/acp/agents"
import { Log } from "@/util/log"

export type AgentFlag = {
  name: string
  model?: string
  mode?: string
}

export type ResolvedAgent = {
  agent: string
  model: string | null
  modeId: string | null
}

function parseKeyValueAgent(input: string): AgentFlag {
  const parts = input
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    throw new Error("Agent value is empty")
  }

  const result: Partial<AgentFlag> = {}

  for (const part of parts) {
    const [key, ...rest] = part.split("=")
    if (!key || rest.length === 0) {
      throw new Error(`Invalid agent entry "${part}". Use name=... model=... mode=...`)
    }
    const value = rest.join("=")
    if (!value) {
      throw new Error(`Missing value for "${key}" in agent entry`)
    }
    if (key !== "name" && key !== "model" && key !== "mode") {
      throw new Error(`Unknown agent key "${key}". Allowed keys: name, model, mode`)
    }
    if (result[key as keyof AgentFlag]) {
      throw new Error(`Duplicate key "${key}" in agent entry`)
    }
    if (key === "name") result.name = value
    if (key === "model") result.model = value
    if (key === "mode") result.mode = value
  }

  if (!result.name) {
    throw new Error("Agent name is required (name=...)")
  }

  return result as AgentFlag
}

function parseBareAgent(input: string): AgentFlag {
  if (!input.trim()) throw new Error("Agent value is empty")
  const idx = input.lastIndexOf("/")
  if (idx > 0 && idx < input.length - 1) {
    return { name: input.slice(0, idx), model: input.slice(idx + 1) }
  }
  return { name: input }
}

/**
 * Parse --agent flags into structured entries.
 * Supports either key/value pairs ("name=claude model=opus") or bare values ("claude/opus").
 * // For plan-agent, mode is always forced to "plan" regardless of input.
 */
export function parseAgentFlags(
  agent?: string | null,
  planAgent?: string | null
): { agents: AgentFlag[]; rawCount: number } {
  const agents: AgentFlag[] = []
  let rawCount = 0

  // Parse plan-agent first (if present)
  if (planAgent != null && typeof planAgent === "string") {
    const trimmed = planAgent.trim()
    if (trimmed) {
      const hasKeyValue = trimmed.includes("=")
      const parsed = hasKeyValue ? parseKeyValueAgent(trimmed) : parseBareAgent(trimmed)
      // Force mode to "plan" for plan-agent
      parsed.mode = "plan"
      agents.push(parsed)
      rawCount++
    }
  }

  // Parse regular agent (if present)
  if (agent != null && typeof agent === "string") {
    const trimmed = agent.trim()
    if (trimmed) {
      const hasKeyValue = trimmed.includes("=")
      const parsed = hasKeyValue ? parseKeyValueAgent(trimmed) : parseBareAgent(trimmed)
      agents.push(parsed)
      rawCount++
    }
  }

  return { agents, rawCount }
}

export function modelSupported(models: SessionModelState | null | undefined, modelId: string) {
  return models?.availableModels?.some((model) => model.modelId === modelId)
}

export function findModeId(target: string, modes: SessionModeState | null | undefined): string | null {
  if (!modes?.availableModes?.length) return null
  const normalized = target.toLowerCase()
  const exact = modes.availableModes.find((mode) => mode.id === target || mode.name === target)
  if (exact) return exact.id
  const loose = modes.availableModes.find(
    (mode) => mode.id.toLowerCase() === normalized || mode.name.toLowerCase() === normalized,
  )
  if (loose) return loose.id
  return null
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

export function validateAgentFlags(agents: AgentFlag[], rawCount: number, fail: (msg: string) => never) {
  if (rawCount > 0 && agents.length === 0) {
    fail("Agent list is empty")
  }
  const missingName = agents.find((a) => !a.name || !a.name.trim())
  if (missingName) fail("Agent name is required")
}

function resolveAgentName(name: string) {
  const match = matchAgent(name)
  if (!match.success) {
    const available = getAllAgents()
      .map((a) => a.name)
      .join(", ")
    throw new Error(`Agent '${name}' not found. Available: ${available}`)
  }
  return match.match.name
}

function resolveMode(targetMode: string | undefined, modes: SessionModeState | null) {
  if (!targetMode) return modes?.currentModeId ?? modes?.availableModes?.[0]?.id ?? null
  const resolved = findModeId(targetMode, modes)
  if (!resolved) {
    const available = (modes?.availableModes ?? []).map((m) => m.id).join(", ")
    throw new Error(`Mode '${targetMode}' not available. Available: ${available || "none"}`)
  }
  return resolved
}

export async function applyAgentEntry(options: {
  sdk: ForgeClient
  sessionID: string
  entry: AgentFlag
  log?: ReturnType<typeof Log.create>
}): Promise<ResolvedAgent> {
  const log = options.log ?? Log.create({ service: "session-agent" })
  const agentName = resolveAgentName(options.entry.name)

  log.info("agent.apply", {
    sessionID: options.sessionID,
    agent: agentName,
    model: options.entry.model ?? null,
    mode: options.entry.mode ?? null,
  })

  const { modes, models, agent } = await setAgentAndModel(
    options.sdk,
    options.sessionID,
    agentName,
    options.entry.model,
  )

  const modeId = resolveMode(options.entry.mode, modes)
  if (modeId && modes?.currentModeId !== modeId) {
    await options.sdk.session.mode({
      path: { id: options.sessionID },
      body: { mode: modeId },
    })
    log.info("agent.apply.mode", { sessionID: options.sessionID, agent: agentName, mode: modeId })
  }

  const resolvedModel = options.entry.model ?? models?.currentModelId ?? null

  log.info("agent.apply.done", {
    sessionID: options.sessionID,
    agent,
    model: resolvedModel,
    mode: modeId,
  })

  return {
    agent,
    model: resolvedModel,
    modeId,
  }
}
