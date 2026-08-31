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

export interface PersonalizationPluginState {
  profile: UserProfileData
  memories: MemoryRecord[]
  userId: string
  embedder?: (text: string) => Promise<Float32Array>
  extractor?: (text: string, model?: unknown) => Promise<ExtractedSignals>
  db?: any
}

export function createPersonalizationPlugin(initialState?: Partial<PersonalizationPluginState>) {
  let profile = initialState?.profile ?? { ...DEFAULT_USER_PROFILE }
  const memories: MemoryRecord[] = initialState?.memories ? [...initialState.memories] : []
  const userId = initialState?.userId ?? "default_developer"
  const embedder = initialState?.embedder ?? generateEmbedding
  const customExtractor = initialState?.extractor
  const db = initialState?.db

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

        let signals: ExtractedSignals
        if (customExtractor) {
          signals = await customExtractor(text, input.model)
        } else {
          // 1. Try fast local/natural directive extraction
          signals = parseStructuredSignals(text)
          // 2. If no signals found and model is present, attempt LLM extraction
          if (signals.preferenceMemories.length === 0 && !signals.profileDelta && input.model) {
            signals = await Effect.runPromise(
              extractSignalsWithLLM({
                message: text,
                model: input.model,
                currentProfile: profile,
              }),
            ).catch(() => signals)
          }
        }

        // 1. Apply dynamic profile drift
        if (signals.profileDelta) {
          profile = applyProfileDrift(profile, signals.profileDelta, 0.25)
          if (sessionDb) {
            await saveUserProfile(sessionDb, userId, profile).catch(() => {})
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
              await saveMemory(sessionDb, record).catch(() => {})
              await logBehaviorEvent(sessionDb, {
                userId,
                sessionId: input.sessionID,
                eventType: "prompt_correction",
                contextText: text,
                inferredKey: item.category,
                inferredValue: item.content,
              }).catch(() => {})
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
