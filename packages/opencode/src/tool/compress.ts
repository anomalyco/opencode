import { Agent } from "@/agent/agent"
import { runHiddenJSON, type HiddenJSONModel } from "@/agent/hidden-json"
import { Auth } from "@/auth"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Tool } from "@/tool/shared/tool"
import { Token } from "@/util/token"
import z from "zod"

const DESCRIPTION = `Summarize the latest contiguous read-only exploration tail in the current assistant turn so future agent context can carry a compact summary instead of all raw discovery output.

Use this after a heavy discovery pass when older read-only tool results are no longer needed in full.

What it does:
- Finds the most recent contiguous tail of completed read-only tool results in the current assistant turn
- Lets you keep the newest few results raw with \`keep_last\`
- Lets you keep specific results raw with semantic \`keep\` selectors
- In \`preview\` mode, shows what would be compressed without mutating anything
- In \`apply\` mode, runs a lightweight hidden compression pass, writes a structured carry-forward summary, and marks the source tool results as hidden from future agent context while keeping them visible in the session UI
- The structured summary is optimized for continuation: current focus, findings, decisions, relevant files, open questions, next step, and risks

Current scope:
- \`recent\` only
- Read-only canonical discovery tools only: inspect, search, localgit_state, localgit_log, localgit_annotate, lsp, discover_batch

When summarization fails, the tool now emits a conservative fallback summary instead of dropping the whole compression pass.


Safety rules:
- Protected items are not compressed when they carry loaded instruction files, attachments, or existing compression markers
- Use this right after exploration. If a non-read-only step already broke the tail, this tool will skip instead of guessing a wider block.`

const id = "compress"
const name = "compress-agent"
const allow = new Set([
  "inspect",
  "search",
  "localgit_state",
  "localgit_log",
  "localgit_annotate",
  "lsp",
  "discover_batch",
  "lib_batch",
])

const pick = z
  .object({
    tool: z.string().optional().describe("Exact canonical discovery tool name to keep raw, such as inspect or search."),
    path: z.string().optional().describe("Substring match against input filePath or path."),
    pattern: z.string().optional().describe("Substring match against input pattern."),
    title: z.string().optional().describe("Substring match against the tool title or label."),
    text: z.string().optional().describe("Substring match against the item label or preview text."),
  })
  .refine((input) => Object.values(input).some(Boolean), {
    message: "keep items must include at least one of tool, path, pattern, title, or text",
  })

const input = z.object({
  goal: z
    .string()
    .min(1)
    .describe(
      "What the agent still needs from this discovery block after compression. Use the user's language when helpful.",
    ),
  mode: z.enum(["preview", "apply"]).default("apply").describe("Preview candidates only, or apply compression now."),
  scope: z
    .enum(["recent"])
    .default("recent")
    .describe(
      "Compression scope. `recent` targets the latest contiguous read-only tail in the current assistant turn.",
    ),
  keep_last: z.coerce
    .number()
    .int()
    .min(0)
    .max(20)
    .default(2)
    .describe("How many of the newest eligible read-only tool results to keep raw."),
  keep: z.array(pick).optional().describe("Additional semantic selectors for tool results that should stay raw."),
})

const shape = z.object({
  summary: z.string().min(1),
  current_focus: z.string().min(1).optional(),
  findings: z.array(z.string()).max(12).default([]),
  decisions: z.array(z.string()).max(8).default([]),
  files: z.array(z.string()).max(20).default([]),
  open_questions: z.array(z.string()).max(8).default([]),
  next_step: z.string().min(1).optional(),
  risks: z.array(z.string()).max(8).default([]),
})

function rec(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function str(input: unknown) {
  if (typeof input !== "string") return
  const text = input.trim()
  if (!text) return
  return text
}

function txt(input: unknown): string[] {
  if (!input) return []
  if (Array.isArray(input)) return input.flatMap(txt)
  const text = str(input)
  return text ? [text] : []
}

function low(input?: string) {
  return input?.toLocaleLowerCase()
}

function fit(needle: string | undefined, hay: string | undefined) {
  const a = low(needle)
  const b = low(hay)
  if (!a || !b) return false
  return b.includes(a)
}

function meta(part: MessageV2.ToolPart) {
  if (part.state.status !== "completed") return
  return rec(part.state.metadata)
}

function cmp(part: MessageV2.ToolPart) {
  const data = rec(meta(part)?.compress)
  if (!data) return
  return {
    role: str(data.role),
    hidden: data.hidden_from_agent === true,
    gid: str(data.group_id),
  }
}

function locked(part: MessageV2.ToolPart) {
  if (part.state.status !== "completed") return "not completed"
  if (MessageV2.isCompressedResult(part)) return "already compressed"
  if ((part.state.attachments ?? []).length > 0) return "has attachments"
  if ((meta(part)?.loaded as unknown[] | undefined)?.some((item) => typeof item === "string"))
    return "loads instructions"
  if (cmp(part)?.role) return "already compressed"
}

function info(part: MessageV2.ToolPart) {
  const data = part.state.status === "completed" ? part.state.input : {}
  const file = str(data.filePath)
  const dir = str(data.path)
  const pattern = str(data.pattern)
  const title = str(part.state.status === "completed" ? part.state.title : undefined) ?? part.tool
  const head = file ?? dir ?? pattern
  return {
    file,
    path: dir,
    pattern,
    title,
    label: head ? `${part.tool} · ${head}` : `${part.tool} · ${title}`,
  }
}

function preview(part: MessageV2.ToolPart) {
  if (part.state.status !== "completed") return ""
  const text = str(meta(part)?.preview) ?? part.state.output
  return text.split("\n").slice(0, 20).join("\n").slice(0, 4000)
}

function gist(part: MessageV2.ToolPart) {
  const data = meta(part) ?? {}
  return {
    count: typeof data.count === "number" ? data.count : undefined,
    matches: typeof data.matches === "number" ? data.matches : undefined,
    truncated: data.truncated === true,
    dirs: typeof data.dirs === "number" ? data.dirs : undefined,
    headings: typeof data.headings === "number" ? data.headings : undefined,
    loaded: Array.isArray(data.loaded) ? data.loaded.length : undefined,
  }
}

function row(part: MessageV2.ToolPart) {
  const data = info(part)
  const text = preview(part)
  return {
    part,
    ...data,
    preview: text,
    text: [data.label, data.title, data.file, data.path, data.pattern, text].flatMap(txt).join("\n"),
    why: locked(part),
  }
}

function keep(rule: z.infer<typeof pick>, item: ReturnType<typeof row>) {
  if (rule.tool && rule.tool !== item.part.tool) return false
  if (rule.path && !fit(rule.path, item.file ?? item.path ?? item.label)) return false
  if (rule.pattern && !fit(rule.pattern, item.pattern)) return false
  if (rule.title && !fit(rule.title, [item.title, item.label].join("\n"))) return false
  if (rule.text && !fit(rule.text, item.text)) return false
  return true
}

function item(part: ReturnType<typeof row>, why?: string) {
  return {
    id: part.part.id,
    tool: part.part.tool,
    title: part.title,
    label: part.label,
    file: part.file,
    path: part.path,
    pattern: part.pattern,
    why,
  }
}

function estimate(part: ReturnType<typeof row>) {
  return Token.estimate(part.part.state.status === "completed" ? part.part.state.output : "")
}

function ready(input: unknown): input is Provider.Model {
  return !!input && typeof input === "object" && "id" in input && "providerID" in input
}

async function models(agent: Agent.Info, hint?: unknown) {
  const base = agent.model
    ? agent.model
    : ready(hint)
      ? { providerID: hint.providerID, modelID: hint.id }
      : await Provider.defaultModel()
  const full = await Provider.getModel(base.providerID, base.modelID)
  const token = await Auth.get(full.providerID).catch(() => undefined)
  const picks = agent.model ? [full] : [await Provider.getSmallModel(full.providerID), full].filter(Boolean)
  const seen = new Set<string>()
  const out: HiddenJSONModel[] = []
  for (const mdl of picks) {
    if (!mdl) continue
    const key = `${mdl.providerID}/${mdl.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      model: mdl,
      language: await Provider.getLanguage(mdl),
      options: {
        ...(!agent.model && mdl.id !== full.id ? ProviderTransform.smallOptions(mdl) : {}),
        ...(mdl.providerID === "openai" && token?.type === "oauth" ? { store: false } : {}),
      },
      prompt: agent.prompt ?? "",
      oauth: mdl.providerID === "openai" && token?.type === "oauth",
      ...(mdl.capabilities.temperature ? { temperature: agent.temperature ?? 0 } : {}),
    })
  }
  return out
}

function pack(input: {
  goal: string
  kept: Array<ReturnType<typeof row> & { why: string }>
  safe: Array<ReturnType<typeof row> & { why: string }>
  selected: ReturnType<typeof row>[]
}) {
  return [
    "Prepare a safe read-only context compression summary for the caller agent.",
    "Write the summary in the same language as the compression goal when that language is clear.",
    "Return exactly one JSON object that matches the requested schema.",
    "Do not invent facts, file paths, or conclusions that are not supported by the source items.",
    "If the evidence is ambiguous or partial, say so in risks.",
    "Preserve the most implementation-relevant files, patterns, and findings.",
    "Prefer concise, carry-forward decisions and next-step guidance over broad prose.",
    "",
    "Required JSON schema:",
    JSON.stringify(
      {
        summary: "string",
        current_focus: "string",
        findings: ["string"],
        decisions: ["string"],
        files: ["string"],
        open_questions: ["string"],
        next_step: "string",
        risks: ["string"],
      },
      null,
      2,
    ),
    "",
    "Compression goal:",
    input.goal,
    "",
    "Items that will remain raw in context:",
    ...(input.kept.length ? input.kept.map((part, i) => `${i + 1}. ${part.label} (${part.why})`) : ["- none"]),
    "",
    "Items that are protected and must remain raw:",
    ...(input.safe.length ? input.safe.map((part, i) => `${i + 1}. ${part.label} (${part.why})`) : ["- none"]),
    "",
    "Items to compress:",
    ...input.selected.flatMap((part, i) => [
      `<item index="${i + 1}" id="${part.part.id}">`,
      `tool: ${part.part.tool}`,
      `label: ${part.label}`,
      `input: ${JSON.stringify(part.part.state.input, null, 2)}`,
      `metadata: ${JSON.stringify(gist(part.part), null, 2)}`,
      "preview:",
      part.preview || "(empty)",
      "</item>",
      "",
    ]),
  ].join("\n")
}

function fallback(input: {
  goal: string
  selected: ReturnType<typeof row>[]
  kept: Array<ReturnType<typeof item>>
  safe: Array<ReturnType<typeof item>>
  reason: string
}) {
  return {
    summary: `Compression used a conservative fallback summary because the summarizer failed: ${input.reason}`,
    current_focus: input.goal,
    findings: input.selected.slice(0, 8).map((part) => `${part.part.tool}: ${part.label}`),
    decisions: ["A fallback summary was emitted instead of skipping compression entirely."],
    files: Array.from(new Set(input.selected.flatMap((part) => txt([part.file, part.path])))).slice(0, 20),
    open_questions: [],
    next_step: "Re-run discovery only if the compressed labels are not enough for the next action.",
    risks: [`Compression summary failed: ${input.reason}`],
  } satisfies z.infer<typeof shape>
}

function normalize(reason: string) {
  if (reason.includes("Unexpected EOF")) return "empty output"
  return reason
}

function text(input: {
  goal: string
  kept: Array<ReturnType<typeof item>>
  safe: Array<ReturnType<typeof item>>
  selected: Array<ReturnType<typeof item>>
  result?: z.infer<typeof shape>
  skipped?: string
}) {
  const head = input.result
    ? [`Compression goal: ${input.goal}`, "", input.result.summary]
    : input.skipped
      ? [`Compression skipped: ${input.skipped}`]
      : ["Compression preview ready."]
  const block = (label: string, rows: string[]) =>
    rows.length > 0 ? ["", `${label}:`, ...rows.map((row) => `- ${row}`)] : []
  return [
    ...head,
    ...block("Current focus", input.result?.current_focus ? [input.result.current_focus] : []),
    ...block("Key findings", input.result?.findings ?? []),
    ...block("Decisions", input.result?.decisions ?? []),
    ...block("Relevant files", input.result?.files ?? []),
    ...block("Open questions", input.result?.open_questions ?? []),
    ...block("Next step", input.result?.next_step ? [input.result.next_step] : []),
    ...block(
      "Kept raw",
      input.kept.map((part) => `${part.label}${part.why ? ` (${part.why})` : ""}`),
    ),
    ...block(
      "Protected raw",
      input.safe.map((part) => `${part.label}${part.why ? ` (${part.why})` : ""}`),
    ),
    ...block(
      "Compressed",
      input.selected.map((part) => part.label),
    ),
    ...block("Risks", input.result?.risks ?? []),
  ].join("\n")
}

function pickRecent(parts: MessageV2.Part[]) {
  const out: ReturnType<typeof row>[] = []
  let on = false
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (!on && (part.type === "step-start" || part.type === "step-finish")) continue
    if (part.type !== "tool") break
    if (part.tool === id) {
      if (!on) continue
      break
    }
    if (!allow.has(part.tool)) break
    if (part.state.status !== "completed") break
    on = true
    out.push(row(part))
  }
  return out.reverse()
}

async function pickEarlier(sessionID: MessageV2.Part["sessionID"], messageID: MessageV2.Part["messageID"]) {
  const msgs = await Session.messages({ sessionID })
  const at = msgs.findIndex((item) => item.info.id === messageID)
  if (at < 0) return [] as ReturnType<typeof row>[]
  const out: ReturnType<typeof row>[][] = []
  for (const msg of msgs.slice(0, at).reverse()) {
    if (msg.info.role !== "assistant") break
    const rows = pickRecent(msg.parts)
    if (rows.length === 0) break
    out.push(rows)
  }
  return out.reverse().flat()
}

export const CompressTool = Tool.define(id, {
  description: DESCRIPTION,
  parameters: input,
  async execute(args, ctx) {
    await ctx.ask({
      permission: id,
      patterns: [args.scope],
      always: ["*"],
      metadata: { goal: args.goal, mode: args.mode, scope: args.scope },
    })
    ctx.metadata({
      title: args.mode === "preview" ? "Previewing context compression" : "Compressing context",
      metadata: {
        action: args.mode,
        status: "running",
        phase: "selecting",
        scope: args.scope,
      },
    })

    const msg = MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
    if (msg.info.role !== "assistant") throw new Error("compress can only run from an assistant message")
    const rows = pickRecent(msg.parts)
    const recent = rows.length > 0 ? rows : await pickEarlier(ctx.sessionID, ctx.messageID)
    if (recent.length === 0) {
      return {
        title: "compress",
        metadata: {
          action: args.mode,
          sessionId: ctx.sessionID,
          status: "skipped",
          scope: args.scope,
          count: { total: 0, selected: 0, kept: 0, protected: 0 },
          items: { selected: [], kept: [], protected: [] },
        },
        output: text({
          goal: args.goal,
          kept: [],
          safe: [],
          selected: [],
          skipped: "no recent read-only tail found",
        }),
      }
    }

    const raw = recent.filter((part) => !part.why)
    const tail = new Set((args.keep_last > 0 ? raw.slice(-args.keep_last) : []).map((part) => part.part.id))
    const held = raw.filter((part) => tail.has(part.part.id) || (args.keep ?? []).some((rule) => keep(rule, part)))
    const kept = new Map(held.map((part) => [part.part.id, part]))
    const safe = recent.filter((part): part is typeof part & { why: string } => !!part.why)
    const selected = recent.filter((part) => !part.why && !kept.has(part.part.id))
    const data = {
      action: args.mode,
      scope: args.scope,
      count: {
        total: recent.length,
        selected: selected.length,
        kept: held.length,
        protected: safe.length,
      },
      items: {
        selected: selected.map((part) => item(part)),
        kept: held.map((part) => item(part, tail.has(part.part.id) ? "keep_last" : "keep")),
        protected: safe.map((part) => item(part, part.why)),
      },
    }

    if (selected.length === 0) {
      return {
        title: "compress",
        metadata: {
          ...data,
          sessionId: ctx.sessionID,
          status: "skipped",
        },
        output: text({
          goal: args.goal,
          kept: data.items.kept,
          safe: data.items.protected,
          selected: data.items.selected,
          skipped: "nothing remained after keep rules and protections",
        }),
      }
    }

    if (args.mode === "preview") {
      return {
        title: "compress",
        metadata: {
          ...data,
          sessionId: ctx.sessionID,
          status: "preview",
        },
        output: text({
          goal: args.goal,
          kept: data.items.kept,
          safe: data.items.protected,
          selected: data.items.selected,
        }),
      }
    }

    ctx.metadata({
      title: "Compressing context",
      metadata: {
        ...data,
        status: "running",
        phase: "summarizing",
      },
    })
    const next = await Agent.get(name)
    if (!next) throw new Error("compress-agent is not configured")

    let result: z.infer<typeof shape>
    let model: { providerID: string; modelID: string } | undefined
    let reason: string | undefined
    let fallback_used: string | undefined
    try {
      const out = await runHiddenJSON({
        model: await models(next, ctx.extra?.model),
        messages: [
          {
            role: "user",
            content: pack({
              goal: args.goal,
              kept: held.map((part) => ({ ...part, why: tail.has(part.part.id) ? "keep_last" : "keep" })),
              safe,
              selected,
            }),
          },
        ],
        schema: shape,
        toolDescription: "Return the compression summary in the required schema.",
      })
      result = out.output
      model = {
        providerID: out.model.providerID,
        modelID: out.model.id,
      }
    } catch (error) {
      reason = normalize(error instanceof Error ? error.message : String(error))
      fallback_used = reason
      result = fallback({
        goal: args.goal,
        selected,
        kept: data.items.kept,
        safe: data.items.protected,
        reason,
      })
    }

    const gid = crypto.randomUUID()
    const now = Date.now()
    const source_tokens = selected.reduce((sum, part) => sum + estimate(part), 0)
    const summary_tokens = Token.estimate(
      [
        result.summary,
        result.current_focus,
        ...result.findings,
        ...result.decisions,
        ...result.files,
        ...result.open_questions,
        result.next_step,
        ...result.risks,
      ]
        .flatMap(txt)
        .join("\n"),
    )
    const manifest = {
      version: 1,
      group_id: gid,
      goal: args.goal,
      scope: args.scope,
      keep_last: args.keep_last,
      time: now,
      source_count: selected.length,
      kept_count: held.length,
      protected_count: safe.length,
      source_part_ids: selected.map((part) => part.part.id),
      source_labels: selected.map((part) => part.label),
      estimated: {
        source_tokens,
        summary_tokens,
        saved_tokens: Math.max(0, source_tokens - summary_tokens),
      },
    }

    ctx.metadata({
      title: "Applying context compression",
      metadata: {
        ...data,
        sessionId: ctx.sessionID,
        status: "running",
        phase: "marking",
        group_id: gid,
        model: next.model,
        result,
        manifest,
        ...(fallback_used ? { fallback: fallback_used } : {}),
      },
    })

    await Promise.all(
      selected.map(async (part) => {
        const state = part.part.state
        if (state.status !== "completed") return
        await Session.updatePart({
          ...part.part,
          state: {
            ...state,
            metadata: {
              ...(state.metadata ?? {}),
              compress: {
                group_id: gid,
                role: "source",
                hidden_from_agent: true,
                time: now,
              },
            },
          },
        })
      }),
    )

    return {
      title: "compress",
      metadata: {
        ...data,
        sessionId: ctx.sessionID,
        status: "completed",
        phase: "done",
        group_id: gid,
        model,
        result,
        manifest,
        ...(fallback_used ? { fallback: fallback_used } : {}),
        compress: {
          group_id: gid,
          role: "summary",
          source_count: selected.length,
          hidden_from_agent: false,
          time: now,
        },
      },
      output: text({
        goal: args.goal,
        kept: data.items.kept,
        safe: data.items.protected,
        selected: data.items.selected,
        result,
      }),
    }
  },
})
