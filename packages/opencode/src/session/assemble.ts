import { Effect } from "effect"
import { asSchema, type Tool as AITool } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"

import { toJsonSchema } from "@/util/effect-zod"
import { Provider, ProviderTransform } from "@/provider"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"

// Extra system block appended when the user requests structured output.
// Defined here (rather than in prompt.ts) so both the prompt pipeline and the
// /context inspection endpoint stay in sync on what the model actually sees.
export const STRUCTURED_OUTPUT_SYSTEM_PROMPT =
  "IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema."

export type LabeledSegment = {
  // Short label used by the /context UI. Semantic categories (not positional).
  kind: "base" | "agent_prompt" | "env" | "skills" | "instructions" | "user_system" | "structured_output"
  label: string
  text: string
}

export type SystemInput = {
  model: Provider.Model
  agent: Agent.Info
  env: string[]
  skills: string | undefined
  instructions: string[]
  userSystem: string | undefined
  format: { type: "text" } | { type: "json_schema"; [k: string]: unknown }
}

// Build the system prompt segments in the **exact** order llm.ts uses before
// plugin transforms. See session/llm.ts:99-111.
//
// Order (post-llm header construction):
//   header = [agent.prompt || provider(model), ...middleSegments, userSystem]
// where middleSegments is what session/prompt.ts calls `system` — namely:
//   [env..., skills?, instructions..., structuredOutput?]
//
// This function returns both (a) the flat string list that caller code can
// reduce/join however it wants, and (b) labeled segments so the /context
// endpoint can display the breakdown.
export function systemSegments(input: SystemInput): LabeledSegment[] {
  const base: LabeledSegment[] = input.agent.prompt
    ? [{ kind: "agent_prompt", label: `agent-prompt/${input.agent.name}`, text: input.agent.prompt }]
    : SystemPrompt.provider(input.model).map((text, i) => ({
        kind: "base" as const,
        label: `base/${i}`,
        text,
      }))

  const env: LabeledSegment[] = input.env.map((text, i) => ({
    kind: "env" as const,
    label: `env/${i}`,
    text,
  }))

  const skills: LabeledSegment[] = input.skills
    ? [{ kind: "skills", label: "skills", text: input.skills }]
    : []

  const instructions: LabeledSegment[] = input.instructions.map((text) => {
    const newline = text.indexOf("\n")
    const label =
      newline > 0 && text.startsWith("Instructions from: ")
        ? text.slice("Instructions from: ".length, newline).trim()
        : "rules"
    return { kind: "instructions", label, text }
  })

  const userSystem: LabeledSegment[] = input.userSystem
    ? [{ kind: "user_system", label: "user-system", text: input.userSystem }]
    : []

  const structured: LabeledSegment[] =
    input.format.type === "json_schema"
      ? [{ kind: "structured_output", label: "structured-output", text: STRUCTURED_OUTPUT_SYSTEM_PROMPT }]
      : []

  return [...base, ...env, ...skills, ...instructions, ...structured, ...userSystem]
}

// Produce the "middle" list that session/prompt.ts passes into
// handle.process({ system, ... }) — i.e. everything except the agent/provider
// header and the user-per-turn override, which llm.ts adds on its own.
export function middleSegments(input: {
  env: string[]
  skills: string | undefined
  instructions: string[]
  format: { type: "text" } | { type: "json_schema"; [k: string]: unknown }
}): string[] {
  const out = [...input.env, ...(input.skills ? [input.skills] : []), ...input.instructions]
  if (input.format.type === "json_schema") out.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
  return out
}

// Mirror of session/llm.ts:99-111: join agent/provider header + middle
// segments + per-turn user.system into a single string the way the provider
// sees it. Context inspection uses this to avoid drift.
export function joinedHeader(input: {
  model: Provider.Model
  agent: Agent.Info
  middle: string[]
  userSystem: string | undefined
}): string {
  return [
    ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
    ...input.middle,
    ...(input.userSystem ? [input.userSystem] : []),
  ]
    .filter((x) => x)
    .join("\n")
}

// --- Tool rendering ---------------------------------------------------------

export type RenderedTool = {
  id: string
  description: string | undefined
  schema: JSONSchema7
}

// Render a built-in tool exactly the way session/prompt.ts does before handing
// it to the AI SDK. The output matches what the provider receives on the wire.
// Parameters typed via structural shape (rather than importing Tool.Def with
// its generics) since we only read `id`, `description`, and `parameters`.
export function renderBuiltinTool(
  model: Provider.Model,
  item: { id: string; description?: string; parameters: Parameters<typeof toJsonSchema>[0] },
): RenderedTool {
  return {
    id: item.id,
    description: item.description,
    schema: ProviderTransform.schema(model, toJsonSchema(item.parameters)),
  }
}

// Render an MCP-provided tool. `asSchema(...).jsonSchema` is typed as sync-or-
// Promise by the AI SDK but is synchronous for the `jsonSchema()` wrappers we
// construct; session/prompt.ts defensively wraps with `Effect.promise`, which
// we mirror here for consistency.
export const renderMcpTool = Effect.fn("Assemble.renderMcpTool")(function* (
  model: Provider.Model,
  key: string,
  item: AITool,
) {
  const raw = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
  return {
    id: key,
    description: item.description,
    schema: ProviderTransform.schema(model, raw),
  } satisfies RenderedTool
})

// Key shape from mcp/index.ts is `<sanitized-client>_<sanitized-tool>`.
export function mcpServerFromKey(key: string): string {
  const sep = key.indexOf("_")
  return sep > 0 ? key.slice(0, sep) : key
}

// --- Last-user agent lookup -------------------------------------------------

// Walk messages backwards to find the agent the user most recently selected.
// Used by both the summarize route and the context endpoint to keep the
// breakdown aligned with what the next model call will use.
export function lastUserAgent(msgs: readonly MessageV2.WithParts[]): string | undefined {
  const match = msgs.findLast((m) => m.info.role === "user" && m.info.agent)
  if (!match || match.info.role !== "user") return undefined
  return match.info.agent
}

export * as SessionAssemble from "./assemble"
