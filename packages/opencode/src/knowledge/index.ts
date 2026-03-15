import { Database } from "../storage/db"
import { KnowledgeEntryTable, KnowledgeSearchIndexTable } from "./knowledge.sql"
import { KnowledgeHealth } from "./health"
import { KnowledgeSearch } from "./search"
import { ulid } from "ulid"
import { Log } from "../util/log"
import type { SessionID } from "../session/schema"

const log = Log.create({ service: "knowledge" })

export namespace Knowledge {
  export interface WritePatternInput {
    sessionID?: string
    agent: string
    title: string
    description: string
    context: Record<string, any>
    tags: string[]
    confidence: number
    firstAttemptFailed: boolean
    attempts: number
  }

  export interface WriteKnowledgeInput {
    sessionID?: string
    agent: string
    title: string
    description: string
    category: string
    impact: "high" | "medium" | "low"
    tags: string[]
    relatedFiles?: string[]
    decisionRationale?: string
  }

  export interface WriteLogInput {
    sessionID?: string
    agent: string
    build: {
      what: string
      how: string
      where: string
    }
    changes: {
      filesAdded: number
      linesAdded: number
      testsAdded?: number
    }
    tags: string[]
  }

  // Re-export search and health
  export const search = KnowledgeSearch.execute
  export const health = KnowledgeHealth

  export async function writePattern(input: WritePatternInput): Promise<string> {
    if (!KnowledgeHealth.isHealthy()) {
      log.warn("writePattern called while system unhealthy, skipping")
      return ""
    }

    const id = ulid()
    const now = Date.now()
    const weights = computeTagWeights(input.tags)
    const content = {
      context: input.context,
      attempts: input.attempts,
    }

    try {
      Database.use((db) => {
        db.insert(KnowledgeEntryTable)
          .values({
            id,
            type: "pattern",
            session_id: input.sessionID as SessionID | undefined,
            agent: input.agent,
            title: input.title,
            description: input.description,
            content,
            tags: input.tags,
            tag_weights: weights,
            confidence: Math.round(input.confidence * 100),
            first_attempt_failed: input.firstAttemptFailed ? 1 : 0,
            time_created: now,
            time_updated: now,
          })
          .run()

        // Update search index
        db.insert(KnowledgeSearchIndexTable)
          .values({
            entry_id: id,
            tag_vector: input.tags.join(" "),
            title_text: input.title.toLowerCase(),
            description_text: input.description.toLowerCase(),
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      log.info("pattern written", { id, title: input.title })
      return id
    } catch (err) {
      log.error("writePattern failed", { error: err, title: input.title })
      return ""
    }
  }

  export async function writeKnowledge(input: WriteKnowledgeInput): Promise<string> {
    if (!KnowledgeHealth.isHealthy()) {
      log.warn("writeKnowledge called while system unhealthy, skipping")
      return ""
    }

    const id = ulid()
    const now = Date.now()
    const weights = computeTagWeights(input.tags)
    const content = {
      decisionRationale: input.decisionRationale,
      relatedFiles: input.relatedFiles,
    }

    try {
      Database.use((db) => {
        db.insert(KnowledgeEntryTable)
          .values({
            id,
            type: "knowledge",
            session_id: input.sessionID as SessionID | undefined,
            agent: input.agent,
            title: input.title,
            description: input.description,
            content,
            tags: input.tags,
            tag_weights: weights,
            category: input.category,
            impact: input.impact,
            time_created: now,
            time_updated: now,
          })
          .run()

        db.insert(KnowledgeSearchIndexTable)
          .values({
            entry_id: id,
            tag_vector: input.tags.join(" "),
            title_text: input.title.toLowerCase(),
            description_text: input.description.toLowerCase(),
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      log.info("knowledge written", { id, title: input.title })
      return id
    } catch (err) {
      log.error("writeKnowledge failed", { error: err, title: input.title })
      return ""
    }
  }

  export async function writeLog(input: WriteLogInput): Promise<string> {
    if (!KnowledgeHealth.isHealthy()) {
      log.warn("writeLog called while system unhealthy, skipping")
      return ""
    }

    const id = ulid()
    const now = Date.now()
    const weights = computeTagWeights(input.tags)
    const content = {
      what: input.build.what,
      how: input.build.how,
      where: input.build.where,
      changes: input.changes,
    }

    try {
      Database.use((db) => {
        db.insert(KnowledgeEntryTable)
          .values({
            id,
            type: "log",
            session_id: input.sessionID as SessionID | undefined,
            agent: input.agent,
            title: `[${input.agent}] ${input.build.what}`,
            description: `How: ${input.build.how} | Where: ${input.build.where}`,
            content,
            tags: input.tags,
            tag_weights: weights,
            time_created: now,
            time_updated: now,
          })
          .run()

        db.insert(KnowledgeSearchIndexTable)
          .values({
            entry_id: id,
            tag_vector: input.tags.join(" "),
            title_text: input.build.what.toLowerCase(),
            description_text: `${input.build.how} ${input.build.where}`.toLowerCase(),
            time_created: now,
            time_updated: now,
          })
          .run()
      })

      log.info("log written", { id, what: input.build.what })
      return id
    } catch (err) {
      log.error("writeLog failed", { error: err, what: input.build.what })
      return ""
    }
  }

  function computeTagWeights(tags: string[]): Record<string, number> | undefined {
    const weights: Record<string, number> = {}
    let hasWeight = false

    const criticalTags = ["critical", "breaking-change", "security"]
    const recoveryTags = ["recovery", "retry", "fallback", "workaround"]
    const architectureTags = ["architecture", "design-pattern", "refactor"]

    for (const tag of tags) {
      if (criticalTags.includes(tag)) {
        weights[tag] = 2.0
        hasWeight = true
      } else if (recoveryTags.includes(tag)) {
        weights[tag] = 1.5
        hasWeight = true
      } else if (architectureTags.includes(tag)) {
        weights[tag] = 1.2
        hasWeight = true
      }
    }

    return hasWeight ? weights : undefined
  }
}
