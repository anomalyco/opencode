# Task 2: Knowledge Core System

**Files:**

- Create: `src/knowledge/index.ts`
- Create: `src/knowledge/health.ts`
- Create: `src/knowledge/search.ts`

**Goal:** Implement core Knowledge namespace with write operations (pattern, knowledge, log) and search functionality.

---

## Step 1: Create Health Module

Create `src/knowledge/health.ts`:

```typescript
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { Database } from "../storage/db"
import { KnowledgeEntryTable } from "./knowledge.sql"
import { Log } from "../util/log"

const log = Log.create({ service: "knowledge.health" })

let healthy = false
let lastError: Error | undefined

export namespace KnowledgeHealth {
  export async function init() {
    try {
      // Verify tables exist by attempting a query
      await Database.use((db) => {
        db.select().from(KnowledgeEntryTable).limit(1)
      })
      healthy = true
      lastError = undefined
      log.info("Knowledge system healthy")
    } catch (err) {
      healthy = false
      lastError = err instanceof Error ? err : new Error(String(err))
      log.error("Knowledge system init failed", { error: lastError.message })
      Bus.publish(TuiEvent.ToastShow, {
        title: "Knowledge System",
        message: "Failed to initialize knowledge database. Knowledge search unavailable.",
        variant: "error",
        duration: 10000,
      })
    }
  }

  export function isHealthy(): boolean {
    return healthy
  }

  export function getStatus(): { healthy: boolean; error?: string } {
    return {
      healthy,
      error: lastError?.message,
    }
  }
}
```

---

## Step 2: Create Search Module

Create `src/knowledge/search.ts`:

```typescript
import { Database } from "../storage/db"
import { KnowledgeEntryTable, KnowledgeSearchIndexTable } from "./knowledge.sql"
import { eq, like, and, desc, sql } from "drizzle-orm"
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
      const results = await Database.use((db) => {
        // Build FTS query: search tags, title, description
        const query = input.query.toLowerCase()
        const queryWords = query.split(/\s+/).filter(Boolean)

        let stmt = db
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

        // Filter by type if specified
        if (input.type && input.type !== "all") {
          stmt = stmt.where(eq(KnowledgeEntryTable.type, input.type))
        }

        // Filter by confidence threshold
        stmt = stmt.where(sql`${KnowledgeEntryTable.confidence} >= ${minConfInt}`)

        // Add FTS conditions: match query words in tags, title, or description
        const conditions = queryWords.map((word) => {
          const pattern = `%${word}%`
          return sql`(
            ${KnowledgeSearchIndexTable.tag_vector} LIKE ${pattern} OR
            ${KnowledgeSearchIndexTable.title_text} LIKE ${pattern} OR
            ${KnowledgeSearchIndexTable.description_text} LIKE ${pattern}
          )`
        })

        if (conditions.length > 0) {
          stmt = stmt.where(and(...conditions))
        }

        return stmt.orderBy(desc(KnowledgeEntryTable.confidence)).limit(limit)
      })

      // Transform results with scoring
      return results.map((row) => {
        const tags = JSON.parse(row.tags as string) as string[]
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
```

---

## Step 3: Create Main Knowledge Namespace

Create `src/knowledge/index.ts`:

```typescript
import { Database } from "../storage/db"
import { KnowledgeEntryTable, KnowledgeSearchIndexTable } from "./knowledge.sql"
import { KnowledgeHealth } from "./health"
import { KnowledgeSearch } from "./search"
import { ulid } from "ulid"
import { Log } from "../util/log"

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
    const tags = JSON.stringify(input.tags)
    const weights = computeTagWeights(input.tags)
    const content = JSON.stringify({
      context: input.context,
      attempts: input.attempts,
    })

    try {
      Database.use((db) => {
        db.insert(KnowledgeEntryTable)
          .values({
            id,
            type: "pattern",
            session_id: input.sessionID,
            agent: input.agent,
            title: input.title,
            description: input.description,
            content,
            tags,
            tag_weights: weights ? JSON.stringify(weights) : undefined,
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
    const tags = JSON.stringify(input.tags)
    const weights = computeTagWeights(input.tags)
    const content = JSON.stringify({
      decisionRationale: input.decisionRationale,
      relatedFiles: input.relatedFiles,
    })

    try {
      Database.use((db) => {
        db.insert(KnowledgeEntryTable)
          .values({
            id,
            type: "knowledge",
            session_id: input.sessionID,
            agent: input.agent,
            title: input.title,
            description: input.description,
            content,
            tags,
            tag_weights: weights ? JSON.stringify(weights) : undefined,
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
    const tags = JSON.stringify(input.tags)
    const weights = computeTagWeights(input.tags)
    const content = JSON.stringify({
      what: input.build.what,
      how: input.build.how,
      where: input.build.where,
      changes: input.changes,
    })

    try {
      Database.use((db) => {
        db.insert(KnowledgeEntryTable)
          .values({
            id,
            type: "log",
            session_id: input.sessionID,
            agent: input.agent,
            title: `[${input.agent}] ${input.build.what}`,
            description: `How: ${input.build.how} | Where: ${input.build.where}`,
            content,
            tags,
            tag_weights: weights ? JSON.stringify(weights) : undefined,
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
```

---

## Step 4: Test Core Functionality

Create `src/knowledge/index.test.ts`:

```typescript
import { describe, it, expect } from "bun:test"
import { Knowledge } from "./index"
import { KnowledgeHealth } from "./health"
import { Database } from "../storage/db"

describe("Knowledge", () => {
  it("writes a pattern entry", async () => {
    const id = await Knowledge.writePattern({
      agent: "test",
      title: "Test Pattern",
      description: "A test pattern",
      context: { error: "ECONNREFUSED" },
      tags: ["recovery", "network"],
      confidence: 0.95,
      firstAttemptFailed: true,
      attempts: 3,
    })

    expect(id).toBeTruthy()
    expect(id.length).toBeGreaterThan(0)
  })

  it("writes a knowledge entry", async () => {
    const id = await Knowledge.writeKnowledge({
      agent: "test",
      title: "Test Knowledge",
      description: "A test knowledge entry",
      category: "architecture",
      impact: "high",
      tags: ["architecture"],
      decisionRationale: "For better structure",
    })

    expect(id).toBeTruthy()
  })

  it("writes a log entry", async () => {
    const id = await Knowledge.writeLog({
      agent: "test",
      build: { what: "Feature X", how: "Native tool", where: "src/tool/" },
      changes: { filesAdded: 3, linesAdded: 200 },
      tags: ["feature", "release"],
    })

    expect(id).toBeTruthy()
  })

  it("searches entries", async () => {
    // Write test data first
    await Knowledge.writePattern({
      agent: "test",
      title: "Network Retry Pattern",
      description: "Handles network failures",
      context: {},
      tags: ["recovery", "network"],
      confidence: 0.9,
      firstAttemptFailed: true,
      attempts: 2,
    })

    // Search
    const results = await Knowledge.search({
      query: "network",
      limit: 5,
    })

    expect(results.length).toBeGreaterThan(0)
  })
})
```

Run tests:

```bash
cd packages/opencode
bun test src/knowledge/index.test.ts
```

Expected: All tests pass.

---

## Step 5: Commit

```bash
git add src/knowledge/index.ts
git add src/knowledge/health.ts
git add src/knowledge/search.ts
git add src/knowledge/index.test.ts
git commit -m "feat: implement knowledge core system with write and search"
```

---

## Acceptance Criteria

✅ `writePattern()` creates pattern entries  
✅ `writeKnowledge()` creates knowledge entries  
✅ `writeLog()` creates log entries  
✅ `search()` returns results with semantic scoring  
✅ Health checks working (isHealthy, getStatus)  
✅ All unit tests passing  
✅ No console writes  
✅ Errors logged via Log.create
