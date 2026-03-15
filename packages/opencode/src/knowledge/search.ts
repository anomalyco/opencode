import { Database } from "../storage/db"
import { KnowledgeEntryTable, KnowledgeSearchIndexTable } from "./knowledge.sql"
import { eq, like, and, desc, sql, type SQL } from "drizzle-orm"
import { Log } from "../util/log"

const log = Log.create({ service: "knowledge.search" })

export namespace KnowledgeSearch {
  export interface Result {
    id: string
    type: "pattern" | "knowledge" | "log"
    title: string
    description: string
    tags: string[]
    category?: string
    confidence: number
    semanticScore: number
    tagRelevance: number
    confidenceScore: number
    timeCreated: number
  }

  export async function execute(input: {
    query: string
    type?: "pattern" | "knowledge" | "log" | "all"
    limit?: number
    minConfidence?: number
  }): Promise<Result[]> {
    const limit = Math.min(input.limit ?? 5, 20)
    const minConf = Math.max(0, Math.min(1, input.minConfidence ?? 0.6))
    const minConfInt = Math.round(minConf * 100)

    try {
      const results = Database.use((db) => {
        // Build FTS query: search tags, title, description
        const query = input.query.toLowerCase()
        const queryWords = query.split(/\s+/).filter(Boolean)

        // Build all where conditions
        const whereConditions: SQL[] = [sql`${KnowledgeEntryTable.confidence} >= ${minConfInt}`]

        // Filter by type if specified
        if (input.type && input.type !== "all") {
          whereConditions.push(eq(KnowledgeEntryTable.type, input.type))
        }

        // Add FTS conditions: match query words in tags, title, or description
        for (const word of queryWords) {
          const pattern = `%${word}%`
          whereConditions.push(
            sql`(
              ${KnowledgeSearchIndexTable.tag_vector} LIKE ${pattern} OR
              ${KnowledgeSearchIndexTable.title_text} LIKE ${pattern} OR
              ${KnowledgeSearchIndexTable.description_text} LIKE ${pattern}
            )`,
          )
        }

        return db
          .select({
            id: KnowledgeEntryTable.id,
            type: KnowledgeEntryTable.type,
            title: KnowledgeEntryTable.title,
            description: KnowledgeEntryTable.description,
            tags: KnowledgeEntryTable.tags,
            category: KnowledgeEntryTable.category,
            confidence: KnowledgeEntryTable.confidence,
            timeCreated: KnowledgeEntryTable.time_created,
            tagVector: KnowledgeSearchIndexTable.tag_vector,
            titleText: KnowledgeSearchIndexTable.title_text,
            descriptionText: KnowledgeSearchIndexTable.description_text,
          })
          .from(KnowledgeEntryTable)
          .innerJoin(KnowledgeSearchIndexTable, eq(KnowledgeEntryTable.id, KnowledgeSearchIndexTable.entry_id))
          .where(and(...whereConditions))
          .orderBy(desc(KnowledgeEntryTable.confidence))
          .limit(limit)
          .all()
      })

      // Transform results with scoring
      return results.map((row) => {
        const tags = row.tags as string[]
        const semanticScore = computeSemanticScore(input.query, row.titleText, row.descriptionText, row.tagVector)
        const tagRelevance = computeTagRelevance(tags)
        const confScore = (row.confidence ?? 50) / 100

        return {
          id: row.id,
          type: row.type as "pattern" | "knowledge" | "log",
          title: row.title,
          description: row.description,
          tags,
          category: row.category ?? undefined,
          confidence: row.confidence ?? 50,
          semanticScore,
          tagRelevance,
          confidenceScore: confScore,
          timeCreated: row.timeCreated,
        }
      })
    } catch (err) {
      log.error("search failed", { error: err, query: input.query })
      return []
    }
  }

  function computeSemanticScore(query: string, title: string, description: string, tags: string): number {
    const q = query.toLowerCase()
    let score = 0

    // Exact tag match: 1.0
    const tagList = tags.split(/\s+/)
    if (tagList.some((t) => t.toLowerCase() === q)) return 1.0

    // Title contains query: 0.8
    if (title.includes(q)) score = Math.max(score, 0.8)

    // Description contains query: 0.6
    if (description.includes(q)) score = Math.max(score, 0.6)

    // Partial tag match: 0.7
    if (tagList.some((t) => t.toLowerCase().includes(q))) score = Math.max(score, 0.7)

    return score || 0.3 // Default low score if any match
  }

  function computeTagRelevance(tags: string[]): number {
    // Critical tags: 2.0x
    // Recovery tags: 1.5x
    // Architecture tags: 1.2x
    // Default: 1.0x

    let multiplier = 1.0

    const criticalTags = ["critical", "breaking-change", "security"]
    const recoveryTags = ["recovery", "retry", "fallback", "workaround"]
    const architectureTags = ["architecture", "design-pattern", "refactor"]

    for (const tag of tags) {
      if (criticalTags.includes(tag)) multiplier = Math.max(multiplier, 2.0)
      else if (recoveryTags.includes(tag)) multiplier = Math.max(multiplier, 1.5)
      else if (architectureTags.includes(tag)) multiplier = Math.max(multiplier, 1.2)
    }

    return multiplier
  }
}
