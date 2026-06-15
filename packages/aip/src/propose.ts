import type { LLMClient, LLMRequest } from "@opencode-ai/evolve"
import type { ActionRegistry } from "./actions.ts"
import { describeSubgraph, type Subgraph } from "./graph.ts"

/** The model's choice: either invoke an action with params, or answer directly. */
export interface Proposal {
  action: string
  params: Record<string, unknown>
  rationale?: string
}

export interface ProposeOptions {
  query: string
  subgraph: Subgraph
  actions: ActionRegistry
  temperature?: number
}

/** Build the prompt that asks the model to pick an action over the subgraph. */
export function buildProposePrompt(opts: ProposeOptions): LLMRequest {
  const actionList = opts.actions
    .list()
    .map((a) => `- ${a.name} (on ${a.targetType}): ${a.description}`)
    .join("\n")

  const system =
    "You are the reasoning layer of an AIP-style agent. Given the user's query and a slice of the " +
    "knowledge graph, choose exactly one available action to take. Respond with ONLY a JSON object: " +
    `{"action": "<name>", "params": { ... }, "rationale": "<why>"}.`

  const prompt = [
    `User query: ${opts.query}`,
    "",
    "Knowledge graph slice:",
    describeSubgraph(opts.subgraph),
    "",
    "Available actions:",
    actionList,
    "",
    'Reply with one JSON object: {"action","params","rationale"}.',
  ].join("\n")

  return { system, prompt, temperature: opts.temperature }
}

/** Extract the first JSON object from a model reply and shape it as a Proposal. */
export function parseProposal(reply: string): Proposal | undefined {
  const json = extractJson(reply)
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json) as Partial<Proposal>
    if (!parsed.action || typeof parsed.action !== "string") return undefined
    return { action: parsed.action, params: parsed.params ?? {}, rationale: parsed.rationale }
  } catch {
    return undefined
  }
}

function extractJson(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\n([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) return undefined
  return body.slice(start, end + 1)
}

export interface ProposeResult {
  proposal: Proposal
  /** Validation error from the action, if the chosen action rejected the params. */
  validationError?: string
}

/**
 * Ask the model to choose an action, then validate the choice against the
 * registry. Falls back to an `answer` proposal when the model returns prose.
 */
export async function propose(llm: LLMClient, opts: ProposeOptions): Promise<ProposeResult> {
  const reply = await llm.complete(buildProposePrompt(opts))
  const parsed = parseProposal(reply)
  if (!parsed) {
    return { proposal: { action: "answer", params: { text: reply.trim() }, rationale: "free-form reply" } }
  }
  const action = opts.actions.get(parsed.action)
  if (!action) {
    return {
      proposal: parsed,
      validationError: `unknown action "${parsed.action}"`,
    }
  }
  const validationError = action.validate?.(parsed.params)
  return { proposal: parsed, validationError }
}
