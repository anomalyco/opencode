import { Effect, Layer, Stream, Schema, Option } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionStatusEvent } from "../../schema/src/session-status-event"
import { BackgroundJob } from "../background-job"
import { Database } from "../database/database"
import { SessionHistory } from "../session/history"
import { SessionMessage } from "../session/message"
import { LLM, LLMEvent } from "@opencode-ai/llm"
import { SessionStore } from "../session/store"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionRunnerModel } from "../session/runner/model"
import * as Memory from "./index"

const SUMMARY_TEMPLATE = `Analyze this session for non-obvious learnings worth remembering across sessions.

Extract ONLY insights that are:
- Hidden relationships between files/modules
- Non-obvious configuration or env vars
- Debugging breakthroughs (the root cause, not the symptom)
- API quirks and workarounds
- Architectural decisions and their reasoning

Do NOT extract:
- Obvious facts from documentation
- Standard language/framework behavior
- Session-specific details (file names being edited, current task)
- Things already in the project's AGENTS.md

Output as a JSON array of strings. Each string is one standalone memory.
Output [] if nothing worth remembering was learned.`

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const jobs = yield* BackgroundJob.Service
    const { db } = yield* Database.Service
    const memory = yield* Memory.Service
    const store = yield* SessionStore.Service
    const llm = yield* LLM.Service
    const models = yield* ModelV2.Service
    const providers = yield* ProviderV2.Service

    yield* Effect.forkDaemon(
      events.subscribe(SessionStatusEvent.Status).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            // 1. Wait for the session to become fully idle before extracting.
            // We use 'session.idle' instead of compaction because compaction runs 
            // mid-session when tokens overflow. 'idle' means the task has settled.
            if (event.data.status.type !== "idle") return

            const sessionID = event.data.sessionID
            
            // 2. Load the recent session history
            const messages = yield* SessionHistory.loadForRunner(db, sessionID, 0)
            
            // 3. Filter trivial sessions. 
            // We use "assistant turns with completed tool calls" as a proxy for "meaningful work".
            // If the user just asked "what is 2+2" (no tools), we don't need to extract memories.
            const meaningfulTurns = messages.filter(
              (m) =>
                m.type === "assistant" &&
                m.content.some((part) => part.type === "tool_call" && part.state.status === "completed")
            ).length

            if (meaningfulTurns < 3) {
              yield* Effect.logDebug("Skipping memory extraction: session too short or trivial", { sessionID })
              return
            }

            const session = yield* store.get(sessionID)
            if (!session) return

            const modelEntry = yield* SessionRunnerModel.resolve(sessionID, session.agent_id, models, providers).pipe(
              Effect.catchAll(() => Effect.succeed(null))
            )
            if (!modelEntry) {
              yield* Effect.logDebug("Skipping memory extraction: no model configured", { sessionID })
              return
            }

            // 4. Spin up a BackgroundJob.
            // Extraction uses an LLM call which takes time. We don't want to block the 
            // event loop or the user's UI while we think about what to remember.
            yield* jobs.start({
              type: "memory-extract",
              title: "Extracting project memory",
              run: Effect.gen(function* () {
                // 5. Serialize the conversation so the LLM can read it
                const conversation = messages
                  .map((m) => {
                    if (m.type === "user") return `[User]: ${m.text}`
                    if (m.type === "assistant") {
                      // Extract text responses and tool calls
                      const parts = m.content.map(part => {
                        if (part.type === "text") return part.text
                        if (part.type === "tool_call") return `[Tool: ${part.name}]`
                        return ""
                      }).filter(Boolean).join("\n")
                      return `[Assistant]:\n${parts}`
                    }
                    if (m.type === "shell") return `[Shell Command]: ${m.command}`
                    return ""
                  })
                  .filter(Boolean)
                  .join("\n\n")

                // 7. Stream the LLM response (constrained to JSON via the prompt)
                let content = ""
                const stream = llm.stream({
                  model: modelEntry.model,
                  system: [{ text: SUMMARY_TEMPLATE }],
                  messages: [{ role: "user", content: [{ type: "text", text: conversation }] }],
                  temperature: 0,
                  maxTokens: 1024,
                })

                yield* stream.pipe(
                  Stream.runForEach((chunk) => {
                    if (chunk.type === "content.text.delta") {
                      content += chunk.text
                    }
                    return Effect.void
                  })
                )

                // 8. Parse the JSON array and store each memory
                const cleaned = content.replace(/```(?:json)?/gi, "").trim()
                const parseResult = yield* Effect.try({
                  try: () => JSON.parse(cleaned),
                  catch: (error) => error
                }).pipe(
                  Effect.map(Schema.decodeUnknownOption(Schema.Array(Schema.String))),
                  Effect.catchAll(() => Effect.succeed(Option.none()))
                )

                if (Option.isSome(parseResult) && parseResult.value.length > 0) {
                  yield* Effect.logInfo("Extracted new memories", { sessionID, count: parseResult.value.length })
                  for (const text of parseResult.value) {
                    if (text.trim().length > 0) {
                      yield* memory.store(text.trim(), "auto", sessionID)
                    }
                  }
                  
                  // 9. Enforce a cap on auto-extracted memories to prevent unbounded growth
                  yield* memory.pruneAuto(200)
                } else if (Option.isNone(parseResult)) {
                  yield* Effect.logWarning("Failed to parse extracted memories", { sessionID, content })
                }
              }).pipe(Effect.catchAll((error) => Effect.logError("Memory extraction job failed", { error }))),
            })
          }).pipe(Effect.catchAll((error) => Effect.logError("Memory extraction event handler failed", { error })))
        )
      )
    )
  })
)

export const node = makeGlobalNode({
  name: "memory-extract",
  layer,
  deps: [
    EventV2.node,
    BackgroundJob.node,
    Database.node,
    Memory.node,
    SessionStore.node,
    LLM.node,
    ModelV2.node,
    ProviderV2.node,
  ],
})
