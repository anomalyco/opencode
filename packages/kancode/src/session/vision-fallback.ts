import type { ModelMessage } from "ai"
import * as Stream from "effect/Stream"
import { Effect } from "effect"
import { SessionV1 } from "@kancode/core/v1/session"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@kancode/core/provider"
import { ModelV2 } from "@kancode/core/model"
import { LLM } from "./llm"
import { LLMEvent, type LLMEvent as LLMEventType } from "@kancode/llm"
import { Permission } from "@/permission"
import type { Agent } from "@/agent/agent"
import { ModelState } from "./model-state"

type Modality = "image" | "pdf"

type UserModelMessage = Extract<ModelMessage, { role: "user" }>

type UserContentPart = UserModelMessage["content"] extends infer C
  ? C extends readonly (infer P)[]
    ? P
    : never
  : never

type MediaPart = Extract<UserContentPart, { type: "file" } | { type: "image" }>

const VISION_AGENT: Agent.Info = {
  name: "vision",
  mode: "primary",
  native: true,
  hidden: true,
  // Disable thinking for the describe side-pass. Ollama Gemma4 (and similar)
  // via OpenAI-compat often puts the whole answer in `reasoning` with empty
  // `content` when thinking is on — and vision+think can hang or return no
  // final text. `reasoningEffort: "none"` / `think: false` keep the answer in
  // content when the provider honors them.
  options: {
    reasoningEffort: "none",
    think: false,
  },
  permission: Permission.fromConfig({ "*": "deny" }),
  prompt:
    "You describe images and PDFs for a coding agent. Be factual and concise. Focus on UI text, code, diagrams, errors, and layout. Do not speculate.",
}

/** Collect assistant text; if content is empty, use reasoning (Ollama Gemma4 quirk). */
function collectDescribeText(stream: Stream.Stream<LLMEventType, unknown>) {
  return stream.pipe(
    Stream.filter((e) => LLMEvent.is.textDelta(e) || LLMEvent.is.reasoningDelta(e)),
    Stream.runFold(
      () => ({ text: "", reasoning: "" }),
      (acc, e) => {
        if (LLMEvent.is.textDelta(e)) return { ...acc, text: acc.text + e.text }
        return { ...acc, reasoning: acc.reasoning + e.text }
      },
    ),
    Effect.map((acc) => {
      const text = acc.text.trim()
      if (text) return text
      return acc.reasoning.trim()
    }),
    Effect.catch(() => Effect.succeed("")),
  )
}

function mimeOf(part: MediaPart): string | undefined {
  if (part.type === "image") {
    const image = String(part.image)
    if (image.startsWith("data:")) {
      return image.split(";")[0]?.replace("data:", "") || undefined
    }
    return undefined
  }
  return part.mediaType
}

function modalityOf(mime: string | undefined): Modality | undefined {
  if (!mime) return undefined
  if (mime.startsWith("image/")) return "image"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

function supports(model: Provider.Model, modality: Modality) {
  return model.capabilities.input[modality] === true
}

function isMediaPart(part: UserContentPart): part is MediaPart {
  return part.type === "file" || part.type === "image"
}

/** True when any user media part would be stripped by unsupportedParts for this primary. */
export function hasUnsupportedMedia(messages: ModelMessage[], model: Provider.Model) {
  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (!isMediaPart(part)) continue
      const modality = modalityOf(mimeOf(part))
      if (!modality) continue
      if (!supports(model, modality)) return true
    }
  }
  return false
}

export type Surface = {
  modality: Modality
  providerID: string
  modelID: string
  /** Clean description body (no `[Image description via …]` wrapper). */
  text: string
}

export type DescribeResult = {
  messages: ModelMessage[]
  /** Descriptions for the last user message only — persist for TUI transcript. */
  surfaces: Surface[]
}

export function isVisionFallbackPart(part: {
  type: string
  text?: string
  metadata?: Record<string, unknown>
}): boolean {
  return part.type === "text" && part.metadata?.visionFallback === true
}

/**
 * Surfaces not yet persisted on the user message.
 * Match by description text so a later agent step can append results that
 * failed earlier without dropping them behind a coarse "any part exists" gate.
 */
export function unpersistedSurfaces(
  parts: ReadonlyArray<{ type: string; text?: string; metadata?: Record<string, unknown> }>,
  surfaces: Surface[],
): Surface[] {
  const seen = new Set(
    parts.filter(isVisionFallbackPart).map((p) => p.text ?? ""),
  )
  return surfaces.filter((surface) => !seen.has(surface.text))
}

function label(modality: Modality, fallback: { providerID: string; modelID: string }) {
  const kind = modality === "pdf" ? "PDF" : "Image"
  return `[${kind} description via ${fallback.providerID}/${fallback.modelID}]`
}

function describePrompt(modality: Modality) {
  if (modality === "pdf") {
    return "Describe this PDF for a coding agent. Be factual and concise. Focus on text, structure, diagrams, and anything relevant to software work."
  }
  return "Describe this image for a coding agent. Be factual and concise. Focus on UI text, code, diagrams, errors, and layout."
}

const describePart = Effect.fn("VisionFallback.describePart")(function* (input: {
  part: MediaPart
  modality: Modality
  fallback: Provider.Model
  sessionID: string
  user: SessionV1.User
}) {
  const llm = yield* LLM.Service
  // Do not pass `small: true` — for openai-compatible reasoning models that
  // picks the first variant (`reasoningEffort: "low"`), which re-enables
  // thinking and fights the vision agent's `none` / `think: false` options.
  const text = yield* collectDescribeText(
    llm.stream({
      agent: VISION_AGENT,
      user: input.user,
      system: [],
      tools: {},
      model: input.fallback,
      sessionID: input.sessionID,
      retries: 1,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: describePrompt(input.modality) }, input.part],
        },
      ],
    }),
  ).pipe(
    Effect.timeout("45 seconds"),
    Effect.catch(() => Effect.succeed("")),
  )

  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .trim()
  if (!cleaned) {
    yield* Effect.logWarning("vision fallback describe empty", {
      "session.id": input.sessionID,
      providerID: input.fallback.providerID,
      modelID: input.fallback.id,
      modality: input.modality,
    })
    return undefined
  }

  yield* Effect.logInfo("vision fallback describe ok", {
    "session.id": input.sessionID,
    providerID: input.fallback.providerID,
    modelID: input.fallback.id,
    modality: input.modality,
    chars: cleaned.length,
  })

  return {
    type: "text" as const,
    text: `${label(input.modality, { providerID: input.fallback.providerID, modelID: input.fallback.id })}\n${cleaned}`,
    surface: {
      modality: input.modality,
      providerID: input.fallback.providerID,
      modelID: input.fallback.id,
      text: cleaned,
    } satisfies Surface,
  }
})

/**
 * Rewrite user image/PDF parts the primary cannot accept into text descriptions
 * from the configured vision fallback. Outbound rewrite is for the primary LLM only;
 * `surfaces` are for the last user message so the caller can persist a TUI transcript part.
 * Caller resolves `fallback` via `ModelState.readFallbackFor` (undefined = no rewrite).
 */
export const describeUnsupported = Effect.fn("VisionFallback.describeUnsupported")(function* (input: {
  messages: ModelMessage[]
  model: Provider.Model
  sessionID: string
  user: SessionV1.User
  fallback: ModelState.ModelRef | undefined
}) {
  const empty: DescribeResult = { messages: input.messages, surfaces: [] }
  if (!input.fallback) return empty
  if (!hasUnsupportedMedia(input.messages, input.model)) return empty

  const provider = yield* Provider.Service
  const fallback = yield* provider
    .getModel(ProviderV2.ID.make(input.fallback.providerID), ModelV2.ID.make(input.fallback.modelID))
    .pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!fallback) return empty

  let lastUserIndex = -1
  for (let i = input.messages.length - 1; i >= 0; i--) {
    if (input.messages[i]?.role === "user") {
      lastUserIndex = i
      break
    }
  }

  const out: ModelMessage[] = []
  const surfaces: Surface[] = []
  for (let i = 0; i < input.messages.length; i++) {
    const msg = input.messages[i]!
    if (msg.role !== "user" || !Array.isArray(msg.content)) {
      out.push(msg)
      continue
    }

    const content: UserContentPart[] = []
    for (const part of msg.content) {
      if (!isMediaPart(part)) {
        content.push(part)
        continue
      }
      const modality = modalityOf(mimeOf(part))
      if (!modality || supports(input.model, modality)) {
        content.push(part)
        continue
      }
      if (!supports(fallback, modality)) {
        content.push(part)
        continue
      }

      const described = yield* describePart({
        part,
        modality,
        fallback,
        sessionID: input.sessionID,
        user: input.user,
      })
      if (!described) {
        content.push(part)
        continue
      }
      content.push({ type: "text", text: described.text })
      if (i === lastUserIndex) surfaces.push(described.surface)
    }

    out.push({ ...msg, content })
  }

  return { messages: out, surfaces }
})

export * as VisionFallback from "./vision-fallback"
