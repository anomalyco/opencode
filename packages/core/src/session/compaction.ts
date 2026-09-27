export * as SessionCompaction from "./compaction"

import { LLM, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@opencode-ai/llm"
import { DateTime, Effect, Stream } from "effect"
import type { Config } from "../config"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { Token } from "../util/token"
import { buildTranscriptCompaction, parseSummaries, type Segment } from "./compaction-transcript"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_OUTPUT_TOKENS = 4_096
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`
const SUMMARY_UPDATE_INSTRUCTIONS = `The <prior-summary> summarizes everything that happened before the <conversation>. Construct a new summary that combines both. The <prior-summary> is discarded after this: anything you do not carry into the new summary is lost.

When combining:
- Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary> even when the <conversation> does not mention them. Drop only what is finished and no longer needed.
- The <conversation> is more recent than the <prior-summary>. Where they conflict, the conversation wins: state the corrected fact and drop the old claim.
- Add new progress, decisions, constraints, and context from the conversation.
- Move completed work from "Active" to "Completed".
- If a blocker has been resolved, update the summary to reflect that while keeping any details still needed to continue the work.
- Update "Objective" and "Next Move" to reflect the current work state.`

type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

type Settings = {
  readonly auto: boolean
  readonly buffer: number
  readonly tokens: number
  readonly mode: "summary" | "transcript"
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly config: readonly Config.Entry[]
}

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly request: LLMRequest
}

const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serialize = (message: SessionMessage.Message) => {
  if (message.type === "user") {
    const files = message.files?.map((file) => `[Attached ${file.mime}: ${file.name ?? file.uri}]`) ?? []
    return [`[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content))}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output)}`
  return ""
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
      mode: current.mode ?? result.mode,
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS, mode: "summary" },
  )
}

const select = (
  entries: readonly Entry[],
  tokens: number,
): {
  readonly head: string
  readonly recent: string
  readonly split: number
  readonly filtered: readonly Entry[]
} | undefined => {
  const filtered = entries.filter((entry) => entry.message.type !== "compaction")
  const rendered = filtered.map((entry) => serialize(entry.message))
  if (rendered.every((item) => !item)) return
  let total = 0
  let split = filtered.length
  for (let index = filtered.length - 1; index >= 0; index--) {
    const item = rendered[index] ?? ""
    if (!item) continue
    const next = total + Token.estimate(item)
    if (next > tokens) break
    total = next
    split = index
  }
  return {
    head: rendered.slice(0, split).filter(Boolean).join("\n\n"),
    recent: rendered.slice(split).filter(Boolean).join("\n\n"),
    split,
    filtered,
  }
}

/** Split head messages into transcript segments: user/assistant text verbatim, everything else condensable. */
const toSegments = (messages: readonly SessionMessage.Message[]): Segment[] => {
  const segments: Segment[] = []
  for (const message of messages) {
    if (message.type === "user") {
      if (message.text) segments.push({ type: "text", role: "user", text: message.text })
      for (const file of message.files ?? []) segments.push({ type: "file", mime: file.mime, filename: file.name })
      continue
    }
    if (message.type === "assistant") {
      for (const part of message.content) {
        if (part.type === "text" && part.text) segments.push({ type: "text", role: "assistant", text: part.text })
        if (part.type === "reasoning" && part.text) segments.push({ type: "reasoning", text: part.text })
        if (part.type !== "tool") continue
        const call = { type: "tool", tool: part.name, input: part.state.input } as const
        if (part.state.status === "completed") {
          segments.push({ ...call, status: "completed", output: truncate(serializeToolContent(part.state.content)) })
          continue
        }
        if (part.state.status === "error") {
          segments.push({ ...call, status: "error", error: part.state.error.message })
          continue
        }
        segments.push({ ...call, status: part.state.status })
      }
      continue
    }
    if (message.type === "system") segments.push({ type: "note", label: "system", text: message.text })
    if (message.type === "synthetic") segments.push({ type: "note", label: "synthetic", text: message.text })
    if (message.type === "shell")
      segments.push({ type: "note", label: "shell", text: `${message.command}\n${truncate(message.output)}` })
  }
  return segments
}

export const buildPrompt = (input: { readonly previousSummary?: string; readonly context: readonly string[] }) => {
  const conversation = `Here is the conversation so far:\n\n<conversation>\n${input.context.join("\n\n")}\n</conversation>`
  if (!input.previousSummary)
    return [
      conversation,
      "Create a new anchored summary from the conversation history in the <conversation> tags above so another coding agent can continue the work.",
      SUMMARY_TEMPLATE,
    ].join("\n\n")
  return [
    conversation,
    `Here is the summary of the conversation before the <conversation> above:\n\n<prior-summary>\n${input.previousSummary}\n</prior-summary>`,
    SUMMARY_UPDATE_INSTRUCTIONS,
    SUMMARY_TEMPLATE,
  ].join("\n\n")
}

export const make = (dependencies: Dependencies) => {
  const config = settings(dependencies.config)
  const compactAfterOverflow = Effect.fn("SessionCompaction.compactAfterOverflow")(function* (input: Input) {
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const selected = select(input.entries, config.tokens)
    const previousSummary = input.entries.find((entry) => entry.message.type === "compaction")?.message
    if (!selected || (selected.head.length === 0 && previousSummary?.type !== "compaction")) return false
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)

    if (config.mode === "transcript") {
      const transcript = buildTranscriptCompaction({
        segments: toSegments(selected.filtered.slice(0, selected.split).map((entry) => entry.message)),
        previousSummary:
          previousSummary?.type === "compaction"
            ? [previousSummary.summary, previousSummary.recent].filter(Boolean).join("\n\n")
            : undefined,
      })
      // Keep the transcript inside the same window the classic summary prompt may occupy.
      if (transcript.estimateTokens <= context - summaryOutput) {
        const messageID = SessionMessage.ID.create()
        yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
          sessionID: input.sessionID,
          messageID,
          timestamp: yield* DateTime.now,
          reason: "auto",
        })
        let summaries = new Map<number, string>()
        // Skip the model call when the item list itself would not fit the
        // window; mechanical lines keep the transcript compaction running.
        if (transcript.prompt && Token.estimate(transcript.prompt) <= context - summaryOutput) {
          const chunks: string[] = []
          let failed = false
          const summarized = yield* dependencies.llm
            .stream(
              LLM.request({
                model: input.model,
                http: input.request.http,
                messages: [Message.user(transcript.prompt)],
                tools: [],
                generation: { maxTokens: summaryOutput },
              }),
            )
            .pipe(
              Stream.runForEach((event) => {
                if (LLMEvent.is.providerError(event)) failed = true
                if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
                return Effect.void
              }),
              Effect.as(true),
              Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
            )
          // A failed or empty summarization pass degrades to deterministic
          // mechanical lines; transcript compaction itself never fails here.
          if (summarized && !failed) summaries = parseSummaries(chunks.join(""))
        }
        const text = transcript.assemble(summaries)
        yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
          sessionID: input.sessionID,
          messageID,
          timestamp: yield* DateTime.now,
          reason: "auto",
          text,
          recent: selected.recent,
        })
        return true
      }
    }

    const summaryPrompt = buildPrompt({
      previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
      context: [previousSummary?.type === "compaction" ? previousSummary.recent : "", selected.head].filter(Boolean),
    })
    if (Token.estimate(summaryPrompt) > context - summaryOutput) return false
    const messageID = SessionMessage.ID.create()
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: "auto",
    })

    const chunks: string[] = []
    let failed = false
    const summarized = yield* dependencies.llm
      .stream(
        LLM.request({
          model: input.model,
          http: input.request.http,
          messages: [Message.user(summaryPrompt)],
          tools: [],
          generation: { maxTokens: summaryOutput },
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          return Effect.void
        }),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
      )
    const summary = chunks.join("")
    if (!summarized || failed || !summary.trim()) return false
    yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: "auto",
      text: summary,
      recent: selected.recent,
    })
    return true
  })
  const compactIfNeeded = Effect.fn("SessionCompaction.compactIfNeeded")(function* (input: Input) {
    if (!config.auto) return false
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    if (
      estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools }) <=
      context - Math.max(output, config.buffer)
    )
      return false
    return yield* compactAfterOverflow(input)
  })
  return {
    compactIfNeeded,
    compactAfterOverflow,
  }
}
