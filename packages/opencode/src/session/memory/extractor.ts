import { Effect, Layer, ServiceMap } from "effect"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { MemoryStore } from "./store"
import { LLM } from "../llm"
import { MessageV2 } from "../message-v2"
import { Log } from "@/util/log"
import type { ExtractionResult } from "./types"
import type { SessionID } from "../schema"
import { makeRuntime } from "@/effect/run-service"

export namespace MemoryExtractor {
  const log = Log.create({ service: "memory.extractor" })

  export interface ExtractInput {
    messages: MessageV2.WithParts[]
    sessionID: SessionID
    projectID: string
  }

  export interface ExtractOutput {
    result: ExtractionResult
    summary: string
  }

  export interface Interface {
    readonly extract: (input: ExtractInput) => Effect.Effect<ExtractOutput | null>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/MemoryExtractor") {}

  export const layer: Layer.Layer<
    Service,
    never,
    Agent.Service | Provider.Service | MemoryStore.Service | LLM.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const provider = yield* Provider.Service
      const store = yield* MemoryStore.Service

      const extract = Effect.fn("MemoryExtractor.extract")(function* (input: ExtractInput) {
        const agent = yield* agents.get("memory")
        if (!agent) {
          log.info("memory agent not found")
          return null
        }

        const lastUser = input.messages.findLast(
          (m): m is MessageV2.WithParts & { info: MessageV2.User } => m.info.role === "user",
        )
        const modelRef = lastUser?.info.model
        const model = modelRef
          ? yield* provider.getModel(modelRef.providerID, modelRef.modelID)
          : yield* Effect.gen(function* () {
              const def = yield* provider.defaultModel()
              return yield* provider.getModel(def.providerID, def.modelID)
            })

        const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, model, { stripMedia: true })

        const extractionPrompt = `Extract structured memory from the conversation above following the JSON schema defined in your system prompt. Return ONLY valid JSON.`

        const result = yield* Effect.promise((signal) =>
          LLM.stream({
            agent,
            user: lastUser!.info,
            system: [],
            tools: {},
            messages: [...msgs, { role: "user", content: extractionPrompt }],
            model,
            sessionID: input.sessionID,
            abort: signal,
            retries: 1,
          }).then((r) => r.text),
        )

        const cleaned = result
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim()
        let parsed: ExtractionResult
        try {
          parsed = JSON.parse(cleaned)
        } catch (e) {
          log.info("extraction produced invalid JSON", { error: String(e) })
          return null
        }

        if (!parsed.goal && !parsed.instructions?.length && !parsed.accomplished?.length) {
          log.info("extraction produced empty data")
          return null
        }

        const windowID = crypto.randomUUID()
        const now = Date.now()
        const messageIDs = input.messages.map((m) => m.info.id)
        const firstTime = input.messages[0]?.info.time?.created ?? now

        yield* store.writeWindow({
          id: windowID,
          project_id: input.projectID,
          session_id: input.sessionID,
          started_at: firstTime,
          ended_at: now,
          goal: parsed.goal ?? "",
          instructions: parsed.instructions?.join("\n") ?? null,
          discoveries: parsed.discoveries?.join("\n") ?? null,
          accomplished: parsed.accomplished?.join("\n") ?? null,
          in_progress: parsed.in_progress?.join("\n") ?? null,
          blocked_on: parsed.blocked_on?.join("\n") ?? null,
          files_touched: parsed.files_touched ?? [],
          relevant_dirs: parsed.relevant_dirs ?? [],
          message_ids: messageIDs,
          parent_window_id: null,
        })

        if (parsed.facts?.length) {
          yield* store.writeFacts(
            parsed.facts.map((f) => ({
              id: crypto.randomUUID(),
              project_id: input.projectID,
              session_id: input.sessionID,
              category: f.category,
              subject: f.subject,
              value: f.value,
              confidence: f.category === "preference" ? 100 : f.category === "constraint" ? 90 : 50,
              source_hash: Bun.hash(f.subject + ":" + f.value).toString(36),
            })),
          )
        }

        if (parsed.artifacts?.length) {
          yield* store.writeArtifacts(
            parsed.artifacts.map((a) => ({
              id: crypto.randomUUID(),
              project_id: input.projectID,
              window_id: windowID,
              kind: a.kind,
              content: a.content,
              file_path: a.file_path ?? null,
              metadata: null,
            })),
          )
        }

        const summary = formatSummary(parsed)
        log.info("extraction complete", { windowID, facts: parsed.facts?.length, artifacts: parsed.artifacts?.length })

        return { result: parsed, summary }
      })

      return Service.of({ extract })
    }),
  )

  export const defaultLayer = layer
}

function formatSummary(r: ExtractionResult): string {
  const sections: string[] = []
  sections.push("## Goal\n")
  sections.push(r.goal ?? "No clear goal identified")
  if (r.instructions?.length) {
    sections.push("\n## Instructions\n")
    sections.push(r.instructions.map((i) => `- ${i}`).join("\n"))
  }
  if (r.discoveries?.length) {
    sections.push("\n## Discoveries\n")
    sections.push(r.discoveries.map((d) => `- ${d}`).join("\n"))
  }
  if (r.accomplished?.length) {
    sections.push("\n## Accomplished\n")
    sections.push(r.accomplished.map((a) => `- ${a}`).join("\n"))
  }
  if (r.in_progress?.length) {
    sections.push("\n## In Progress\n")
    sections.push(r.in_progress.map((i) => `- ${i}`).join("\n"))
  }
  if (r.blocked_on?.length) {
    sections.push("\n## Blocked On\n")
    sections.push(r.blocked_on.map((b) => `- ${b}`).join("\n"))
  }
  const files = [...(r.files_touched ?? []), ...(r.relevant_dirs ?? [])]
  if (files.length) {
    sections.push("\n## Relevant files / directories\n")
    sections.push(files.map((f) => `- ${f}`).join("\n"))
  }
  return sections.join("\n")
}
