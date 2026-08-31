export * as Plugin from "./plugin"

import type { Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import type { UserProfileData } from "./profile"
import { DEFAULT_USER_PROFILE, applyProfileDrift } from "./profile"
import type { MemoryRecord } from "./memory"
import { generateEmbedding } from "./memory"
import { buildPersonalizationContext } from "./aggregator"
import { extractSignalsWithLLM, parseStructuredSignals, type ExtractedSignals } from "./extractor"
import { saveUserProfile, saveMemory, logBehaviorEvent, loadUserProfile, loadMemories } from "./store"
import { Effect } from "effect"
import { LLMClient } from "@opencode-ai/llm"
import { logPersonalization } from "./logger"

export interface PersonalizationPluginState {
  profile: UserProfileData
  memories: MemoryRecord[]
  userId: string
  embedder?: (text: string) => Promise<Float32Array>
  extractor?: (text: string, model?: unknown) => Promise<ExtractedSignals>
  db?: any
  llmClient?: any
  runPromise?: <A>(effect: Effect.Effect<A, any, any>) => Promise<A>
}

export function createPersonalizationPlugin(initialState?: Partial<PersonalizationPluginState>) {
  let profile = initialState?.profile ?? { ...DEFAULT_USER_PROFILE }
  const memories: MemoryRecord[] = initialState?.memories ? [...initialState.memories] : []
  const userId = initialState?.userId ?? "default_developer"
  const embedder = initialState?.embedder ?? generateEmbedding
  const customExtractor = initialState?.extractor
  const db = initialState?.db
  const llmClient = initialState?.llmClient
  const runPromise = initialState?.runPromise

  let isInitialized = false

  async function ensureInitialized() {
    if (isInitialized || !db) return
    try {
      const persistedProfile = await loadUserProfile(db, userId)
      if (persistedProfile) {
        profile = persistedProfile
      }
      const persistedMemories = await loadMemories(db, userId)
      if (persistedMemories.length > 0) {
        for (const pm of persistedMemories) {
          if (!memories.some((m) => m.id === pm.id)) {
            memories.push(pm)
          }
        }
      }
    } catch {
      // Gracefully continue with in-memory state
    }
    isInitialized = true
  }

  return async (_input: PluginInput, options?: PluginOptions): Promise<Hooks> => {
    const sessionDb = db || options?.db
    if (sessionDb && !isInitialized) {
      await ensureInitialized()
    }

    return {
      "experimental.chat.system.transform": async (_input, output) => {
        const personalizationText = buildPersonalizationContext({
          profile,
          memories,
        })
        if (personalizationText) {
          output.system.push(personalizationText)
        }
      },

      "chat.message": async (input, output) => {
        const text = output.parts
          .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
          .filter(Boolean)
          .join("\n")
          .trim()

        if (!text) return

        logPersonalization("chat.message:start", { text, model: input.model, sessionID: input.sessionID })

        let signals: ExtractedSignals = {
          preferenceMemories: [],
          semanticMemories: [],
          workingMemories: [],
        }

        try {
          if (customExtractor) {
            signals = await customExtractor(text, input.model)
          } else if (runPromise && input.model) {
            signals = await runPromise(
              extractSignalsWithLLM({
                message: text,
                model: input.model,
                currentProfile: profile,
              }),
            )
          } else if (input.model) {
            signals = await Effect.runPromise(
              extractSignalsWithLLM({
                message: text,
                model: input.model,
                currentProfile: profile,
              }).pipe(
                llmClient ? Effect.provideService(LLMClient.Service, llmClient) : (e) => e,
              ),
            )
          } else {
            signals = parseStructuredSignals(text)
          }
        } catch (err) {
          logPersonalization("chat.message:extraction_error", err)
          signals = parseStructuredSignals(text)
        }

        logPersonalization("chat.message:signals_extracted", {
          preferenceCount: signals.preferenceMemories.length,
          semanticCount: signals.semanticMemories.length,
          hasProfileDelta: !!signals.profileDelta,
        })

        // 1. Apply dynamic profile drift
        if (signals.profileDelta) {
          profile = applyProfileDrift(profile, signals.profileDelta, 0.25)
          if (sessionDb) {
            try {
              await saveUserProfile(sessionDb, userId, profile)
              logPersonalization("chat.message:profile_saved", { userId })
            } catch (dbErr) {
              logPersonalization("chat.message:saveUserProfile_error", dbErr)
            }
          }
        }

        // 2. Ingest new preference/semantic/working memories with neural embeddings
        const now = Date.now()
        const items = [...signals.preferenceMemories, ...signals.semanticMemories, ...signals.workingMemories]
        for (const item of items) {
          const isDuplicate = memories.some(
            (m) => m.content.toLowerCase() === item.content.toLowerCase() && m.tier === item.tier,
          )
          if (!isDuplicate) {
            let embedding: Float32Array | undefined
            try {
              embedding = await embedder(item.content)
            } catch {
              embedding = undefined
            }

            const record: MemoryRecord = {
              id: `mem_${now}_${Math.random().toString(36).slice(2, 7)}`,
              userId,
              tier: item.tier,
              category: item.category,
              content: item.content,
              confidence: item.confidence,
              embedding,
              accessCount: 0,
              createdAt: now,
              updatedAt: now,
            }

            memories.push(record)

            if (sessionDb) {
              try {
                await saveMemory(sessionDb, record)
                logPersonalization("chat.message:memory_saved", { id: record.id, category: record.category, content: record.content })
              } catch (dbErr) {
                logPersonalization("chat.message:saveMemory_error", dbErr)
              }
              try {
                await logBehaviorEvent(sessionDb, {
                  userId,
                  sessionId: input.sessionID,
                  eventType: "prompt_correction",
                  contextText: text,
                  inferredKey: item.category,
                  inferredValue: item.content,
                })
              } catch (dbErr) {
                logPersonalization("chat.message:logBehaviorEvent_error", dbErr)
              }
            }
          }
        }
      },

      "tool.execute.after": async (input, output) => {
        if (!sessionDb) return
        logBehaviorEvent(sessionDb, {
          userId,
          sessionId: input.sessionID,
          eventType: "tool_invoked",
          contextText: `Tool ${input.tool} executed with output length ${output.output?.length ?? 0}`,
          inferredKey: "tool",
          inferredValue: input.tool,
        }).catch(() => {})
      },

      "experimental.session.compacting": async (_input, output) => {
        const keyRules = memories
          .filter((m) => m.tier === "preference")
          .slice(-5)
          .map((m) => `- ${m.content}`)
          .join("\n")

        if (keyRules) {
          output.context.push(`Preserved Developer Preferences:\n${keyRules}`)
        }
      },
    }
  }
}

export const PersonalizationPlugin = createPersonalizationPlugin()
