import { Context, Effect, Layer, Schema } from "effect"

import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Token } from "@/util"

import { Agent } from "@/agent/agent"
import { Config } from "@/config"
import { MCP } from "@/mcp"
import { Provider, ProviderTransform } from "@/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Skill } from "@/skill"
import { ToolRegistry } from "@/tool"

import * as Session from "./session"
import { SessionID } from "./schema"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { SessionAssemble } from "./assemble"
import { SessionOverflow } from "./overflow"
import * as MessageV2 from "./message-v2"

// --- API schema -------------------------------------------------------------

// A single surfaced piece of context. `tokens` / `chars` are diagnostic
// estimates produced by `Token.estimate` (chars/4 heuristic); they never drive
// totals or overflow decisions. Use `Usage.current` for the authoritative
// figure.
export const ContextItem = Schema.Struct({
  label: Schema.String,
  tokens: Schema.Number,
  chars: Schema.Number,
  detail: Schema.optional(Schema.String),
  // Optional logical grouping key. Currently used for MCP tools so the UI
  // can render per-server subtotals under the single "MCP tools" section.
  group: Schema.optional(Schema.String),
})
  .annotate({ identifier: "SessionContextItem" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ContextItem = Schema.Schema.Type<typeof ContextItem>

export const ContextSection = Schema.Struct({
  key: Schema.Literals(["system", "rules", "skills", "tools", "mcp_tools", "agent", "messages"]),
  label: Schema.String,
  tokens: Schema.Number,
  chars: Schema.Number,
  items: Schema.Array(ContextItem),
})
  .annotate({ identifier: "SessionContextSection" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ContextSection = Schema.Schema.Type<typeof ContextSection>

// Authoritative usage snapshot derived from the last completed assistant turn.
// Mirrors `overflow.isOverflow` accounting (input + output + cache.read +
// cache.write) so the /context report is consistent with what actually
// triggers auto-compaction.
export const Usage = Schema.Struct({
  // True when figures come from the provider's reported LanguageModelUsage on
  // the most recent assistant turn. False before any turn has completed — in
  // that case `current` is 0 and the UI should fall back to diagnostics.
  authoritative: Schema.Boolean,
  // Last assistant turn raw usage (0 when !authoritative).
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  // The sum that `overflow.isOverflow` uses to decide compaction.
  current: Schema.Number,
  // Total context window the model advertises.
  contextLimit: Schema.Number,
  // Output token reservation honored by provider transforms.
  outputReserve: Schema.Number,
  // What overflow.usable() returns: context minus reserved output / compaction
  // buffer. This is the effective budget for prompt content.
  usable: Schema.Number,
  // Raw `current >= usable` (independent of compaction config). Surfaces the
  // true budget state even when auto-compaction is disabled.
  overBudget: Schema.Boolean,
  // Whether auto-compaction would trigger on the next turn. Equal to
  // `overBudget` unless the user has disabled `compaction.auto`.
  overflow: Schema.Boolean,
})
  .annotate({ identifier: "SessionContextUsage" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Usage = Schema.Schema.Type<typeof Usage>

export const ContextInfo = Schema.Struct({
  model: Schema.Struct({
    providerID: Schema.String,
    modelID: Schema.String,
  }),
  agent: Schema.String,
  usage: Usage,
  // Diagnostic breakdown of static pieces assembled into the next call. Each
  // item's `tokens` is a `Token.estimate` of its rendered content. Sum across
  // sections is only an approximation of what the provider will count.
  sections: Schema.Array(ContextSection),
})
  .annotate({ identifier: "SessionContextInfo" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ContextInfo = Schema.Schema.Type<typeof ContextInfo>

export const GetInput = Schema.Struct({
  sessionID: SessionID,
  providerID: ProviderID,
  modelID: ModelID,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type GetInput = Schema.Schema.Type<typeof GetInput>

// --- Service ----------------------------------------------------------------

export interface Interface {
  readonly compute: (input: GetInput) => Effect.Effect<ContextInfo>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionContext") {}

function stringItem(label: string, text: string, detail?: string): ContextItem {
  return {
    label,
    chars: text.length,
    tokens: Token.estimate(text),
    detail,
  }
}

// Human-readable detail for each system-prompt segment so the /context UI
// explains *what* the cryptic labels like `base/0` or `env/0` actually are.
function describeSegment(s: SessionAssemble.LabeledSegment): string | undefined {
  switch (s.kind) {
    case "base":
      return "Provider base prompt (model-family specific coding-agent system prompt)"
    case "agent_prompt":
      return "Agent-specific prompt override (from agent config)"
    case "env":
      return "Runtime environment: model id, cwd, workspace, git, platform, date"
    case "user_system":
      return "Per-turn user-supplied system text"
    case "structured_output":
      return "Structured-output tool enforcement"
    case "instructions":
      return "Project rules / AGENTS.md content"
    case "skills":
      return "Available skills (name + description injected into prompt)"
  }
}

function buildSection(key: ContextSection["key"], label: string, items: ContextItem[]): ContextSection {
  return {
    key,
    label,
    tokens: items.reduce((acc, it) => acc + it.tokens, 0),
    chars: items.reduce((acc, it) => acc + it.chars, 0),
    items,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const sys = yield* SystemPrompt.Service
    const instruction = yield* Instruction.Service
    const registry = yield* ToolRegistry.Service
    const mcp = yield* MCP.Service
    const config = yield* Config.Service
    const skill = yield* Skill.Service

    const compute = Effect.fn("SessionContext.compute")(function* (input: GetInput) {
      const model = yield* provider.getModel(input.providerID, input.modelID)
      // Raw history from the store. Walked via filterCompacted to select only
      // messages the LLM actually sees this turn (post any compaction rollups).
      const allMsgs = yield* sessions.messages({ sessionID: input.sessionID })
      const msgs = MessageV2.filterCompacted(allMsgs)

      // Agent resolution mirrors session/prompt.ts behavior.
      const defaultAgentName = yield* agents.defaultAgent()
      const agent = yield* agents.get(SessionAssemble.lastUserAgent(msgs) ?? defaultAgentName)

      // --- Static breakdown (diagnostic) ------------------------------------
      const lastUser = msgs.findLast((m) => m.info.role === "user")
      const userSystem = lastUser?.info.role === "user" ? lastUser.info.system : undefined
      const [skills, instructions, availableSkills] = yield* Effect.all([
        sys.skills(agent),
        instruction.system().pipe(Effect.orDie),
        skill.available(agent),
      ])
      const segments = SessionAssemble.systemSegments({
        model,
        agent,
        env: sys.environment(model),
        skills,
        instructions,
        userSystem,
        format: { type: "text" },
      })
      const pickItems = (kinds: SessionAssemble.LabeledSegment["kind"][]): ContextItem[] =>
        segments.filter((s) => kinds.includes(s.kind)).map((s) => stringItem(s.label, s.text, describeSegment(s)))

      const systemItems = pickItems(["base", "agent_prompt", "env", "user_system", "structured_output"])
      // Skills: show one row per available skill. The text used for size
      // estimation is the skill's description — that is what's injected into
      // the system prompt via `Skill.fmt`. Full skill content is only loaded
      // on demand via the skill tool, so it's not counted here.
      const skillsItems: ContextItem[] = availableSkills
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((s) => stringItem(s.name, s.description, s.description))
      const rulesItems = pickItems(["instructions"])

      const agentMetaText = JSON.stringify(
        {
          name: agent.name,
          description: agent.description,
          mode: agent.mode,
          model: agent.model,
          temperature: agent.temperature,
          topP: agent.topP,
          steps: agent.steps,
        },
        null,
        2,
      )
      const agentItems: ContextItem[] = [
        {
          label: agent.name,
          tokens: 0,
          chars: agentMetaText.length,
          detail: `${agent.mode} agent`,
        },
      ]

      const toolDefs = yield* registry.tools({
        providerID: input.providerID,
        modelID: ModelID.make(model.api.id),
        agent,
      })
      const toolItems: ContextItem[] = toolDefs.map((item) => {
        const rendered = SessionAssemble.renderBuiltinTool(model, item)
        const body = (rendered.description ?? "") + "\n" + JSON.stringify(rendered.schema)
        return { label: rendered.id, chars: body.length, tokens: Token.estimate(body) }
      })

      const mcpItems: ContextItem[] = []
      for (const [key, item] of Object.entries(yield* mcp.tools())) {
        if (!item.execute) continue
        const rendered = yield* SessionAssemble.renderMcpTool(model, key, item)
        const body = (rendered.description ?? "") + "\n" + JSON.stringify(rendered.schema)
        const server = SessionAssemble.mcpServerFromKey(key)
        mcpItems.push({
          label: rendered.id,
          chars: body.length,
          tokens: Token.estimate(body),
          detail: server,
          group: server,
        })
      }

      // Pure-estimate messages block, always rendered as a diagnostic. When
      // the authoritative usage supersedes it, the UI can use `detail` to
      // explain that the line is not the top-line number.
      const messagesSerialized = JSON.stringify(msgs.map((m) => ({ info: m.info, parts: m.parts })))

      // --- Authoritative usage ---------------------------------------------
      // Walk backwards for the last assistant turn that reported usage. Gate
      // on `SessionOverflow.currentTokens > 0` (same expression overflow uses
      // to decide compaction) so the /context view can never disagree about
      // whether an authoritative number exists.
      const lastAssistant = msgs.findLast((m) => m.info.role === "assistant")
      const t =
        lastAssistant && lastAssistant.info.role === "assistant" && SessionOverflow.currentTokens(lastAssistant.info.tokens) > 0
          ? lastAssistant.info.tokens
          : undefined

      const cfg = yield* config.get()
      const usableBudget = SessionOverflow.usable({ cfg, model })
      const outputReserve = ProviderTransform.maxOutputTokens(model)

      const usage: Usage = t
        ? {
            authoritative: true,
            input: t.input,
            output: t.output,
            reasoning: t.reasoning,
            cacheRead: t.cache.read,
            cacheWrite: t.cache.write,
            current: SessionOverflow.currentTokens(t),
            contextLimit: model.limit.context,
            outputReserve,
            usable: usableBudget,
            overBudget: usableBudget > 0 && SessionOverflow.currentTokens(t) >= usableBudget,
            overflow: SessionOverflow.isOverflow({ cfg, tokens: t, model }),
          }
        : {
            authoritative: false,
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            current: 0,
            contextLimit: model.limit.context,
            outputReserve,
            usable: usableBudget,
            overBudget: false,
            overflow: false,
          }

      const messagesItems: ContextItem[] = (() => {
        if (msgs.length === 0) return []
        const userMsgs = msgs.filter((m) => m.info.role === "user")
        const asstMsgs = msgs.filter((m) => m.info.role === "assistant")
        const sizeOf = (list: typeof msgs) =>
          JSON.stringify(list.map((m) => ({ info: m.info, parts: m.parts })))
        const userText = sizeOf(userMsgs)
        const asstText = sizeOf(asstMsgs)
        const compactedOut = allMsgs.length - msgs.length
        const totalDetail = usage.authoritative ? "superseded by usage above" : "estimated"
        const compactedNote = compactedOut > 0 ? ` · ${compactedOut} older compacted out` : ""
        const items: ContextItem[] = [
          {
            label: `Total ${msgs.length} message(s) in context`,
            tokens: Token.estimate(messagesSerialized),
            chars: messagesSerialized.length,
            detail: totalDetail + compactedNote,
          },
        ]
        if (userMsgs.length > 0) {
          items.push({
            label: `User (${userMsgs.length})`,
            tokens: Token.estimate(userText),
            chars: userText.length,
            detail: "prompts + attached parts (current session, post-compaction)",
          })
        }
        if (asstMsgs.length > 0) {
          items.push({
            label: `Assistant (${asstMsgs.length}) — ${agent.name}`,
            tokens: Token.estimate(asstText),
            chars: asstText.length,
            detail: "responses + tool calls + tool results (current session, post-compaction)",
          })
        }
        return items
      })()

      const sections: ContextSection[] = [
        buildSection("system", "System prompt", systemItems),
        ...(skillsItems.length > 0 ? [buildSection("skills", "Skills", skillsItems)] : []),
        buildSection("rules", "Rules / memory", rulesItems),
        buildSection("agent", "Agent", agentItems),
        buildSection("tools", "Built-in tools", toolItems),
        buildSection("mcp_tools", "MCP tools", mcpItems),
        buildSection("messages", "Messages", messagesItems),
      ]

      return {
        model: { providerID: model.providerID, modelID: model.api.id },
        agent: agent.name,
        usage,
        sections,
      } satisfies ContextInfo
    })

    return Service.of({ compute })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Skill.defaultLayer),
  ),
)

export * as SessionContext from "./context"
