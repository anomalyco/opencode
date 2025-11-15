/**
 * RAID Knowledge Base Plugin
 * 
 * Provides SQLite-backed document storage with full-text search,
 * AI-powered document sharding, and intelligent query orchestration.
 * 
 * Tools:
 * - kb-ingest: Ingest documents into the knowledge base
 * - kb-search: Full-text search across documents
 * - kb-query: AI-powered natural language queries
 * - kb-manage: Manage documents (stats, list, get, delete, clear)
 */

import { type Plugin, tool } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { mkdir, readFile } from "node:fs/promises"
import { dirname, join, basename, extname, resolve as resolvePath } from "node:path"
import { homedir } from "node:os"
import { get_encoding } from "@dqbd/tiktoken"
import matter from "gray-matter"
import OpenAI from "openai"
import { ulid } from "ulid"

const encoding = get_encoding("cl100k_base")

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface RaidConfig {
  projectRoot: string
  globalKbPath: string
  dbPath: string
  enableAutoIndexing: boolean
  maxConcurrentShards: number
  baseUrl: string
  apiKey: string
  shardModel: string
  orchModel: string
  maxTokensPerShard: number
  numShards: number
  overlapTokens: number
}

interface RaidDocument {
  id: string
  title: string
  content: string
  filePath?: string
  tags: string[]
  keywords: string[]
  source: "project" | "global"
  createdAt: Date
  updatedAt: Date
  tokenCount: number
  shardIds: string[]
  metadata: RaidDocumentMetadata
}

interface RaidDocumentMetadata {
  contentType: "markdown" | "code" | "text" | "other"
  extractedKeywords: string[]
  summary: string
  fileSize?: number
  lastModified?: Date
  fileType?: string
}

interface RaidSearchOptions {
  maxResults?: number
  includeContent?: boolean
  sourceFilter?: "project" | "global" | "both"
  tagsFilter?: string[]
  contentTypeFilter?: ("markdown" | "code" | "text" | "other")[]
}

interface RaidSearchResult {
  document: RaidDocument
  relevanceScore: number
  snippets: string[]
  highlightedContent?: string
}

interface RaidStats {
  totalDocuments: number
  projectDocuments: number
  globalDocuments: number
  totalTokens: number
  avgTokensPerDocument: number
  topKeywords: Array<{ keyword: string; count: number }>
  lastUpdated: Date
}

interface RaidShard {
  id: string
  content: string
  startToken: number
  endToken: number
  documentId?: string
}

interface RaidQueryProgress {
  type: "routing" | "querying" | "fusing" | "complete" | "error"
  message: string
  shardsQueried?: number
  totalShards?: number
  error?: string
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULTS = {
  globalKbPath: join(homedir(), ".opencode", "raid"),
  enableAutoIndexing: true,
  maxConcurrentShards: 5,
  baseUrl: "https://api.openai.com/v1",
  shardModel: "gpt-4o-mini",
  orchModel: "gpt-4o",
  maxTokensPerShard: 4000,
  numShards: 10,
  overlapTokens: 200,
} as const

function loadRaidConfig(projectRoot?: string): RaidConfig {
  const root = projectRoot ?? process.cwd()
  const globalKb = process.env.RAID_GLOBAL_KB_PATH ?? DEFAULTS.globalKbPath

  return {
    projectRoot: root,
    globalKbPath: globalKb,
    dbPath: join(root, ".opencode", "raid.db"),
    enableAutoIndexing:
      process.env.RAID_AUTO_INDEX === "false" ? false : DEFAULTS.enableAutoIndexing,
    maxConcurrentShards: parseInt(
      process.env.RAID_MAX_CONCURRENT ?? String(DEFAULTS.maxConcurrentShards),
      10,
    ),
    baseUrl: process.env.RAID_BASE_URL ?? process.env.OPENAI_BASE_URL ?? DEFAULTS.baseUrl,
    apiKey: process.env.RAID_API_KEY ?? process.env.OPENAI_API_KEY ?? "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",
    shardModel: process.env.RAID_SHARD_MODEL ?? DEFAULTS.shardModel,
    orchModel: process.env.RAID_ORCH_MODEL ?? DEFAULTS.orchModel,
    maxTokensPerShard: parseInt(
      process.env.RAID_MAX_TOKENS_PER_SHARD ?? String(DEFAULTS.maxTokensPerShard),
      10,
    ),
    numShards: parseInt(process.env.RAID_NUM_SHARDS ?? String(DEFAULTS.numShards), 10),
    overlapTokens: parseInt(process.env.RAID_OVERLAP_TOKENS ?? String(DEFAULTS.overlapTokens), 10),
  }
}

function validateRaidConfig(config: RaidConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!config.projectRoot) errors.push("Project root is required")
  if (!config.globalKbPath) errors.push("Global knowledge base path is required")
  if (!config.dbPath) errors.push("Database path is required")
  if (!config.apiKey) errors.push("API key is required (set RAID_API_KEY or OPENAI_API_KEY)")
  if (config.maxConcurrentShards < 1) errors.push("maxConcurrentShards must be at least 1")
  if (config.maxTokensPerShard < 100) errors.push("maxTokensPerShard must be at least 100")
  if (config.numShards < 1) errors.push("numShards must be at least 1")
  if (config.overlapTokens < 0) errors.push("overlapTokens must be non-negative")

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ============================================================================
// KNOWLEDGE BASE
// ============================================================================

class RaidKnowledgeBase {
  private db: Database
  private config: RaidConfig

  constructor(config: RaidConfig) {
    this.config = config
    this.db = this.initDatabase(config.dbPath)
  }

  private initDatabase(dbPath: string): Database {
    mkdir(dirname(dbPath), { recursive: true }).catch(() => {})

    const db = new Database(dbPath, { create: true })
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA foreign_keys = ON")

    db.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        file_path TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        keywords TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL CHECK(source IN ('project', 'global')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        shard_ids TEXT NOT NULL DEFAULT '[]',
        content_type TEXT NOT NULL DEFAULT 'text',
        extracted_keywords TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        file_size INTEGER,
        last_modified INTEGER,
        file_type TEXT
      )
    `)

    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        title,
        content,
        keywords,
        summary,
        content='documents',
        content_rowid='rowid'
      )
    `)

    db.run(`
      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, title, content, keywords, summary)
        VALUES (new.rowid, new.title, new.content, new.keywords, new.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        DELETE FROM documents_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        UPDATE documents_fts 
        SET title = new.title, content = new.content, keywords = new.keywords, summary = new.summary
        WHERE rowid = new.rowid;
      END;
    `)

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
      CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
      CREATE INDEX IF NOT EXISTS idx_documents_content_type ON documents(content_type);
    `)

    return db
  }

  async upsertDocument(
    doc: Partial<RaidDocument> & {
      id: string
      title: string
      content: string
      source: "project" | "global"
    },
  ): Promise<RaidDocument> {
    const now = Date.now()
    const tokens = this.countTokens(doc.content)
    const metadata = doc.metadata ?? this.extractMetadata(doc.content, doc.filePath)

    const document: RaidDocument = {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      filePath: doc.filePath,
      tags: doc.tags ?? [],
      keywords: doc.keywords ?? metadata.extractedKeywords,
      source: doc.source,
      createdAt: doc.createdAt ?? new Date(now),
      updatedAt: new Date(now),
      tokenCount: tokens,
      shardIds: doc.shardIds ?? [],
      metadata: {
        contentType: metadata.contentType,
        extractedKeywords: metadata.extractedKeywords,
        summary: metadata.summary,
        fileSize: metadata.fileSize,
        lastModified: metadata.lastModified,
        fileType: metadata.fileType,
      },
    }

    this.db.run(
      `
      INSERT INTO documents (
        id, title, content, file_path, tags, keywords, source,
        created_at, updated_at, token_count, shard_ids,
        content_type, extracted_keywords, summary, file_size, last_modified, file_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        file_path = excluded.file_path,
        tags = excluded.tags,
        keywords = excluded.keywords,
        source = excluded.source,
        updated_at = excluded.updated_at,
        token_count = excluded.token_count,
        shard_ids = excluded.shard_ids,
        content_type = excluded.content_type,
        extracted_keywords = excluded.extracted_keywords,
        summary = excluded.summary,
        file_size = excluded.file_size,
        last_modified = excluded.last_modified,
        file_type = excluded.file_type
    `,
      [
        document.id,
        document.title,
        document.content,
        document.filePath ?? null,
        JSON.stringify(document.tags),
        JSON.stringify(document.keywords),
        document.source,
        document.createdAt.getTime(),
        document.updatedAt.getTime(),
        document.tokenCount,
        JSON.stringify(document.shardIds),
        document.metadata.contentType,
        JSON.stringify(document.metadata.extractedKeywords),
        document.metadata.summary,
        document.metadata.fileSize ?? null,
        document.metadata.lastModified?.getTime() ?? null,
        document.metadata.fileType ?? null,
      ],
    )

    return document
  }

  getDocument(id: string): RaidDocument | null {
    const row = this.db.query("SELECT * FROM documents WHERE id = ?").get(id) as any

    if (!row) return null

    return this.rowToDocument(row)
  }

  search(query: string, options: RaidSearchOptions = {}): RaidSearchResult[] {
    const {
      maxResults = 10,
      includeContent = true,
      sourceFilter = "both",
      tagsFilter = [],
      contentTypeFilter = [],
    } = options

    const escapedQuery = query
      .replace(/"/g, '""')
      .split(/\s+/)
      .map((word) => `"${word}"`)
      .join(" OR ")

    let sql = `
      SELECT 
        d.*,
        bm25(documents_fts) as rank,
        snippet(documents_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
      FROM documents_fts
      JOIN documents d ON documents_fts.rowid = d.rowid
      WHERE documents_fts MATCH ?
    `

    const params: any[] = [escapedQuery]

    if (sourceFilter !== "both") {
      sql += " AND d.source = ?"
      params.push(sourceFilter)
    }

    if (tagsFilter.length > 0) {
      sql += " AND (" + tagsFilter.map(() => "d.tags LIKE ?").join(" OR ") + ")"
      tagsFilter.forEach((tag) => params.push(`%"${tag}"%`))
    }

    if (contentTypeFilter.length > 0) {
      sql += " AND d.content_type IN (" + contentTypeFilter.map(() => "?").join(",") + ")"
      params.push(...contentTypeFilter)
    }

    sql += " ORDER BY rank LIMIT ?"
    params.push(maxResults)

    const rows = this.db.query(sql).all(...params) as any[]

    return rows.map((row) => ({
      document: this.rowToDocument(row),
      relevanceScore: -row.rank,
      snippets: [row.snippet],
      highlightedContent: includeContent ? row.snippet : undefined,
    }))
  }

  listDocuments(
    options: { source?: "project" | "global"; limit?: number; offset?: number } = {},
  ): RaidDocument[] {
    const { source, limit = 100, offset = 0 } = options

    let sql = "SELECT * FROM documents"
    const params: any[] = []

    if (source) {
      sql += " WHERE source = ?"
      params.push(source)
    }

    sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
    params.push(limit, offset)

    const rows = this.db.query(sql).all(...params) as any[]

    return rows.map((row) => this.rowToDocument(row))
  }

  deleteDocument(id: string): boolean {
    this.db.run("DELETE FROM documents WHERE id = ?", [id])
    return true
  }

  deleteAllDocuments(source?: "project" | "global"): number {
    let sql = "DELETE FROM documents"

    if (source) {
      sql += " WHERE source = ?"
      this.db.run(sql, [source])
    } else {
      this.db.run(sql, [])
    }

    return 0
  }

  getStats(): RaidStats {
    const total = this.db
      .query("SELECT COUNT(*) as count, SUM(token_count) as tokens FROM documents")
      .get() as any

    const project = this.db
      .query("SELECT COUNT(*) as count FROM documents WHERE source = 'project'")
      .get() as any

    const global = this.db
      .query("SELECT COUNT(*) as count FROM documents WHERE source = 'global'")
      .get() as any

    const keywords = this.db
      .query(
        `
      SELECT json_each.value as keyword, COUNT(*) as count
      FROM documents, json_each(documents.keywords)
      GROUP BY keyword
      ORDER BY count DESC
      LIMIT 20
    `,
      )
      .all() as any[]

    const totalDocs = total.count || 0
    const totalTokens = total.tokens || 0

    return {
      totalDocuments: totalDocs,
      projectDocuments: project.count || 0,
      globalDocuments: global.count || 0,
      totalTokens,
      avgTokensPerDocument: totalDocs > 0 ? Math.round(totalTokens / totalDocs) : 0,
      topKeywords: keywords.map((k) => ({ keyword: k.keyword, count: k.count })),
      lastUpdated: new Date(),
    }
  }

  updateShardIds(docId: string, shardIds: string[]): void {
    this.db.run("UPDATE documents SET shard_ids = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(shardIds),
      Date.now(),
      docId,
    ])
  }

  close(): void {
    this.db.close()
  }

  private countTokens(text: string): number {
    try {
      return encoding.encode(text).length
    } catch {
      return Math.ceil(text.length / 4)
    }
  }

  private extractMetadata(content: string, filePath?: string): RaidDocumentMetadata {
    let contentType: RaidDocumentMetadata["contentType"] = "text"
    let extractedKeywords: string[] = []
    let summary = ""

    if (filePath) {
      const ext = filePath.split(".").pop()?.toLowerCase()
      if (ext === "md" || ext === "markdown") {
        contentType = "markdown"
      } else if (["js", "ts", "py", "go", "java", "cpp", "c", "rs", "rb"].includes(ext ?? "")) {
        contentType = "code"
      }
    }

    if (contentType === "markdown") {
      try {
        const parsed = matter(content)
        if (parsed.data.keywords) {
          extractedKeywords = Array.isArray(parsed.data.keywords)
            ? parsed.data.keywords
            : String(parsed.data.keywords)
                .split(",")
                .map((k) => k.trim())
        }
        if (parsed.data.description) {
          summary = String(parsed.data.description)
        }
      } catch {}
    }

    if (extractedKeywords.length === 0) {
      const words = content
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 4)

      const wordCounts = new Map<string, number>()
      words.forEach((w) => wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1))

      extractedKeywords = Array.from(wordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word)
    }

    if (!summary) {
      summary = content.slice(0, 200).replace(/\n/g, " ").trim()
      if (content.length > 200) summary += "..."
    }

    return {
      contentType,
      extractedKeywords,
      summary,
      fileType: filePath?.split(".").pop(),
    }
  }

  private rowToDocument(row: any): RaidDocument {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      filePath: row.file_path,
      tags: JSON.parse(row.tags),
      keywords: JSON.parse(row.keywords),
      source: row.source,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      tokenCount: row.token_count,
      shardIds: JSON.parse(row.shard_ids),
      metadata: {
        contentType: row.content_type,
        extractedKeywords: JSON.parse(row.extracted_keywords),
        summary: row.summary,
        fileSize: row.file_size,
        lastModified: row.last_modified ? new Date(row.last_modified) : undefined,
        fileType: row.file_type,
      },
    }
  }
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

interface ShardWithScore {
  shard: RaidShard
  score: number
  reasoning: string
}

interface ShardAnswer {
  shardId: string
  answer: string
  confidence: number
  sources: string[]
}

class RaidOrchestrator {
  private client: OpenAI
  private config: RaidConfig
  private kb: RaidKnowledgeBase

  constructor(config: RaidConfig, kb: RaidKnowledgeBase) {
    this.config = config
    this.kb = kb
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    })
  }

  async shardDocument(documentId: string, content: string): Promise<RaidShard[]> {
    const tokens = encoding.encode(content)
    const totalTokens = tokens.length
    const shardSize = this.config.maxTokensPerShard
    const overlap = this.config.overlapTokens
    const shards: RaidShard[] = []

    let startToken = 0
    let shardIndex = 0

    while (startToken < totalTokens) {
      const endToken = Math.min(startToken + shardSize, totalTokens)
      const shardTokens = tokens.slice(startToken, endToken)
      const shardContent = new TextDecoder().decode(encoding.decode(shardTokens))

      shards.push({
        id: `${documentId}-shard-${shardIndex}`,
        content: shardContent,
        startToken,
        endToken,
        documentId,
      })

      shardIndex++
      startToken = endToken - overlap

      if (endToken >= totalTokens) break
    }

    return shards
  }

  async routeQuery(
    query: string,
    shards: RaidShard[],
    maxShards: number = 5,
  ): Promise<ShardWithScore[]> {
    if (shards.length <= maxShards) {
      return shards.map((shard) => ({
        shard,
        score: 1.0,
        reasoning: "All shards included due to small document size",
      }))
    }

    const shardSummaries = shards.map((shard, idx) => ({
      id: shard.id,
      index: idx,
      preview: shard.content.slice(0, 200) + "...",
      tokenRange: `${shard.startToken}-${shard.endToken}`,
    }))

    const routingPrompt = `You are a document routing expert. Given a user query and document shard previews, identify which shards are most likely to contain relevant information.

Query: "${query}"

Available shards:
${shardSummaries.map((s) => `- Shard ${s.index} (${s.id}): ${s.preview}`).join("\n")}

Return a JSON array of the top ${maxShards} most relevant shard indices with scores (0-1) and reasoning. Format:
[{"index": 0, "score": 0.95, "reasoning": "Contains information about X"}]

Only return the JSON array, nothing else.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.orchModel,
        messages: [{ role: "user", content: routingPrompt }],
        temperature: 0.1,
        max_tokens: 500,
      })

      const content = response.choices[0]?.message?.content ?? "[]"
      const routing = JSON.parse(content.trim()) as Array<{
        index: number
        score: number
        reasoning: string
      }>

      return routing
        .slice(0, maxShards)
        .map((r) => ({
          shard: shards[r.index],
          score: r.score,
          reasoning: r.reasoning,
        }))
        .filter((r) => r.shard)
    } catch (error) {
      return shards.slice(0, maxShards).map((shard) => ({
        shard,
        score: 1.0,
        reasoning: "Fallback routing due to error",
      }))
    }
  }

  async queryShard(shard: RaidShard, query: string): Promise<ShardAnswer> {
    const prompt = `You are an expert at answering questions based on document content.

Document content:
${shard.content}

Question: ${query}

Provide a concise, accurate answer based ONLY on the content above. If the content doesn't contain relevant information, say "No relevant information found in this section."

Also indicate your confidence level (0-1) and cite specific parts of the content.

Respond in JSON format:
{
  "answer": "your answer here",
  "confidence": 0.9,
  "sources": ["quote from content", "another quote"]
}

Only return the JSON, nothing else.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.shardModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 800,
      })

      const content = response.choices[0]?.message?.content ?? "{}"
      const parsed = JSON.parse(content.trim()) as {
        answer: string
        confidence: number
        sources: string[]
      }

      return {
        shardId: shard.id,
        answer: parsed.answer || "No answer generated",
        confidence: parsed.confidence ?? 0.5,
        sources: parsed.sources ?? [],
      }
    } catch (error) {
      return {
        shardId: shard.id,
        answer: `Error querying shard: ${error}`,
        confidence: 0,
        sources: [],
      }
    }
  }

  async queryShards(
    shards: RaidShard[],
    query: string,
    onProgress?: (progress: RaidQueryProgress) => void,
  ): Promise<ShardAnswer[]> {
    const answers: ShardAnswer[] = []
    const batchSize = this.config.maxConcurrentShards

    for (let i = 0; i < shards.length; i += batchSize) {
      const batch = shards.slice(i, i + batchSize)

      onProgress?.({
        type: "querying",
        message: `Querying shards ${i + 1}-${Math.min(i + batchSize, shards.length)} of ${shards.length}`,
        shardsQueried: i,
        totalShards: shards.length,
      })

      const batchPromises = batch.map((shard) => this.queryShard(shard, query))
      const batchAnswers = await Promise.all(batchPromises)
      answers.push(...batchAnswers)
    }

    return answers
  }

  async fuseAnswers(query: string, shardAnswers: ShardAnswer[]): Promise<string> {
    const relevantAnswers = shardAnswers
      .filter(
        (a) => a.confidence > 0.3 && !a.answer.toLowerCase().includes("no relevant information"),
      )
      .sort((a, b) => b.confidence - a.confidence)

    if (relevantAnswers.length === 0) {
      return "I couldn't find relevant information to answer your question in the knowledge base."
    }

    if (relevantAnswers.length === 1) {
      return relevantAnswers[0].answer
    }

    const fusionPrompt = `You are an expert at synthesizing information from multiple sources.

Question: ${query}

I have ${relevantAnswers.length} answers from different sections of a document:

${relevantAnswers
  .map(
    (a, i) => `Answer ${i + 1} (confidence: ${a.confidence}):
${a.answer}
${a.sources.length > 0 ? `Sources: ${a.sources.join("; ")}` : ""}
`,
  )
  .join("\n")}

Synthesize these answers into a single, coherent, comprehensive response. Combine complementary information and resolve any contradictions by favoring higher-confidence answers. Be concise but complete.

Provide only the final synthesized answer, no preamble.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.orchModel,
        messages: [{ role: "user", content: fusionPrompt }],
        temperature: 0.3,
        max_tokens: 1000,
      })

      return response.choices[0]?.message?.content?.trim() ?? relevantAnswers[0].answer
    } catch (error) {
      return relevantAnswers[0].answer
    }
  }

  async orchestrateQuery(
    query: string,
    documentIds?: string[],
    onProgress?: (progress: RaidQueryProgress) => void,
  ): Promise<string> {
    try {
      onProgress?.({
        type: "routing",
        message: "Finding relevant documents...",
      })

      let documents
      if (documentIds && documentIds.length > 0) {
        documents = documentIds
          .map((id) => this.kb.getDocument(id))
          .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
      } else {
        const searchResults = this.kb.search(query, { maxResults: 5 })
        documents = searchResults.map((r) => r.document)
      }

      if (documents.length === 0) {
        return "No relevant documents found in the knowledge base."
      }

      onProgress?.({
        type: "routing",
        message: `Found ${documents.length} relevant document(s), preparing shards...`,
      })

      const allShards: RaidShard[] = []
      for (const doc of documents) {
        const docShards = await this.shardDocument(doc.id, doc.content)
        allShards.push(...docShards)
      }

      onProgress?.({
        type: "routing",
        message: `Created ${allShards.length} shards, routing query...`,
      })

      const routedShards = await this.routeQuery(query, allShards, this.config.maxConcurrentShards)

      onProgress?.({
        type: "querying",
        message: `Querying ${routedShards.length} most relevant shards...`,
        totalShards: routedShards.length,
      })

      const shardAnswers = await this.queryShards(
        routedShards.map((rs) => rs.shard),
        query,
        onProgress,
      )

      onProgress?.({
        type: "fusing",
        message: "Synthesizing answers...",
      })

      const finalAnswer = await this.fuseAnswers(query, shardAnswers)

      onProgress?.({
        type: "complete",
        message: "Query complete",
      })

      return finalAnswer
    } catch (error) {
      onProgress?.({
        type: "error",
        message: "Query orchestration failed",
        error: String(error),
      })
      throw error
    }
  }

  async ingestDocument(
    documentId: string,
    content: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<string[]> {
    const shards = await this.shardDocument(documentId, content)

    onProgress?.(shards.length, shards.length)

    const shardIds = shards.map((s) => s.id)
    this.kb.updateShardIds(documentId, shardIds)

    return shardIds
  }

  async generateSummary(content: string, maxLength: number = 200): Promise<string> {
    const prompt = `Summarize the following document in ${maxLength} characters or less. Be concise and capture the key points:

${content.slice(0, 4000)}

Provide only the summary, no preamble.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.shardModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 100,
      })

      return response.choices[0]?.message?.content?.trim() ?? ""
    } catch {
      return content.slice(0, maxLength) + "..."
    }
  }

  async extractKeywords(content: string, maxKeywords: number = 10): Promise<string[]> {
    const prompt = `Extract the ${maxKeywords} most important keywords or key phrases from this document:

${content.slice(0, 4000)}

Return only a JSON array of keywords, nothing else. Format: ["keyword1", "keyword2", ...]`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.shardModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      })

      const content_text = response.choices[0]?.message?.content?.trim() ?? "[]"
      return JSON.parse(content_text) as string[]
    } catch {
      return []
    }
  }
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

export const RaidKnowledgeBasePlugin: Plugin = async (ctx) => {
  const projectRoot = ctx.directory
  const getConfig = () => loadRaidConfig(projectRoot)

  return {
    tool: {
      kb_ingest: tool({
        description: "Ingest documents into the KB knowledge base with automatic sharding, AI-powered summarization, and keyword extraction. This tool adds documents to the KB (Knowledge Base) system, which automatically shards large documents into overlapping chunks for efficient querying, extracts keywords and generates summaries using AI, supports both project-specific and global knowledge bases, and enables semantic search and intelligent query routing.",
        args: {
          filePath: tool.schema.string().describe("Path to the file or directory to ingest"),
          source: tool.schema
            .enum(["project", "global"])
            .describe("Whether this is a project-specific or global document")
            .default("project"),
          title: tool.schema
            .string()
            .describe("Optional title for the document (defaults to filename)")
            .optional(),
          tags: tool.schema
            .array(tool.schema.string())
            .describe("Optional tags for categorization")
            .optional()
            .default([]),
          generateSummary: tool.schema
            .boolean()
            .describe("Generate AI summary and extract keywords")
            .optional()
            .default(true),
        },
        async execute(params) {
          const { filePath, source, title, tags, generateSummary } = params
          const absolutePath = resolvePath(projectRoot, filePath)
          try {
            const config = getConfig()
            const validation = validateRaidConfig(config)

            if (!validation.valid) {
              return `KB configuration error:\n${validation.errors.join("\n")}`
            }

            const kb = new RaidKnowledgeBase(config)
            const orchestrator = new RaidOrchestrator(config, kb)

            const content = await readFile(absolutePath, "utf-8")

            if (!content.trim()) {
              kb.close()
              return `Error: File ${absolutePath} is empty`
            }

            const docId = ulid()
            const docTitle = title ?? basename(absolutePath, extname(absolutePath))

            let summary = ""
            let keywords: string[] = []

            if (generateSummary) {
              try {
                ;[summary, keywords] = await Promise.all([
                  orchestrator.generateSummary(content),
                  orchestrator.extractKeywords(content),
                ])
              } catch (error) {
                console.warn("Failed to generate AI metadata", error)
              }
            }

            const document = await kb.upsertDocument({
              id: docId,
              title: docTitle,
              content,
              filePath,
              tags: tags ?? [],
              keywords,
              source,
              metadata: {
                contentType: "text",
                extractedKeywords: keywords,
                summary,
              },
            })

            const shardIds = await orchestrator.ingestDocument(docId, content)

            kb.close()

            return `Successfully ingested document:
- ID: ${docId}
- Title: ${docTitle}
- Source: ${source}
- Tokens: ${document.tokenCount}
- Shards: ${shardIds.length}
- Tags: ${tags?.join(", ") || "none"}
- Keywords: ${keywords.slice(0, 5).join(", ")}${keywords.length > 5 ? "..." : ""}
${summary ? `- Summary: ${summary}` : ""}`
          } catch (error) {
            return `Error ingesting document: ${error}`
          }
        },
      }),

      kb_search: tool({
        description: "Search the KB knowledge base using full-text search with relevance ranking. This tool performs fast, SQLite FTS5-powered searches across all ingested documents, with BM25 relevance ranking, highlighted snippets, source filtering (project/global), tag and content type filtering, and configurable result limits.",
        args: {
          query: tool.schema.string().describe("Search query using FTS syntax"),
          maxResults: tool.schema
            .number()
            .describe("Maximum number of results to return")
            .optional()
            .default(10),
          source: tool.schema
            .enum(["project", "global", "both"])
            .describe("Filter by source")
            .optional()
            .default("both"),
          tags: tool.schema.array(tool.schema.string()).describe("Filter by tags").optional(),
          contentType: tool.schema
            .array(tool.schema.enum(["markdown", "code", "text", "other"]))
            .describe("Filter by content type")
            .optional(),
          includeContent: tool.schema
            .boolean()
            .describe("Include full content in results")
            .optional()
            .default(false),
        },
        async execute(params) {
          const { query, maxResults, source, tags, contentType, includeContent } = params
          try {
            const config = getConfig()
            const validation = validateRaidConfig(config)

            if (!validation.valid) {
              return `KB configuration error:\n${validation.errors.join("\n")}`
            }

            const kb = new RaidKnowledgeBase(config)

            const results = kb.search(query, {
              maxResults,
              includeContent,
              sourceFilter: source,
              tagsFilter: tags,
              contentTypeFilter: contentType,
            })

            kb.close()

            if (results.length === 0) {
              return `No results found for query: "${query}"`
            }

            const formatted = results
              .map((result, idx) => {
                const doc = result.document
                return `${idx + 1}. ${doc.title} (${doc.source})
   ID: ${doc.id}
   Score: ${result.relevanceScore.toFixed(3)}
   Tokens: ${doc.tokenCount}
   Tags: ${doc.tags.join(", ") || "none"}
   Keywords: ${doc.keywords.slice(0, 5).join(", ")}${doc.keywords.length > 5 ? "..." : ""}
   Summary: ${doc.metadata.summary}
   ${result.snippets.length > 0 ? `Preview: ${result.snippets[0]}` : ""}
   ${doc.filePath ? `File: ${doc.filePath}` : ""}
${includeContent ? `\nContent:\n${doc.content}\n` : ""}`
              })
              .join("\n\n")

            return `Found ${results.length} result(s) for "${query}":\n\n${formatted}`
          } catch (error) {
            return `Error searching documents: ${error}`
          }
        },
      }),

      kb_query: tool({
        description:
          "Query the KB knowledge base with AI-powered orchestration, intelligent shard routing, and answer fusion. This is the main KB query interface that uses advanced RAG techniques: Document Discovery (searches knowledge base for relevant documents), Smart Sharding (breaks large documents into overlapping chunks), Intelligent Routing (uses AI to select the most relevant shards), Parallel Querying (queries multiple shards concurrently), and Answer Fusion (synthesizes responses from multiple sources into a coherent answer).",
        args: {
          query: tool.schema
            .string()
            .describe("Natural language question to answer using the knowledge base"),
          documentIds: tool.schema
            .array(tool.schema.string())
            .describe("Optional specific document IDs to query (if empty, searches all relevant docs)")
            .optional(),
          showProgress: tool.schema
            .boolean()
            .describe("Show detailed progress during query orchestration")
            .optional()
            .default(true),
        },
        async execute(params) {
          const { query, documentIds, showProgress } = params
          try {
            const config = getConfig()
            const validation = validateRaidConfig(config)

            if (!validation.valid) {
              return `KB configuration error:\n${validation.errors.join("\n")}`
            }

            const kb = new RaidKnowledgeBase(config)
            const orchestrator = new RaidOrchestrator(config, kb)

            const onProgress = showProgress
              ? (progress: any) => {
                  if (progress.type === "routing") {
                    console.log(`Routing: ${progress.message}`)
                  } else if (progress.type === "querying") {
                    const percent =
                      progress.shardsQueried && progress.totalShards
                        ? Math.round((progress.shardsQueried / progress.totalShards) * 100)
                        : 0
                    console.log(`Querying (${percent}%): ${progress.message}`)
                  } else if (progress.type === "fusing") {
                    console.log(`Fusing: ${progress.message}`)
                  } else if (progress.type === "complete") {
                    console.log(`Complete: ${progress.message}`)
                  } else if (progress.type === "error") {
                    console.log(`Error: ${progress.message}`)
                  }
                }
              : undefined

            const answer = await orchestrator.orchestrateQuery(query, documentIds, onProgress)

            kb.close()

            return answer
          } catch (error) {
            return `Error querying knowledge base: ${error}`
          }
        },
      }),

      kb_manage: tool({
        description: "Manage the KB knowledge base - view statistics, list documents, get details, and delete documents. This tool provides administrative functions for the KB knowledge base with actions: stats (show knowledge base statistics), list (list all documents with filters and pagination), get (get full details and content of a specific document), delete (delete a specific document by ID), and clear (delete all documents optionally filtered by source).",
        args: {
          action: tool.schema
            .enum(["stats", "list", "get", "delete", "clear"])
            .describe("Action to perform"),
          documentId: tool.schema
            .string()
            .describe("Document ID (required for 'get' and 'delete' actions)")
            .optional(),
          source: tool.schema
            .enum(["project", "global"])
            .describe("Source filter for 'list' and 'clear' actions")
            .optional(),
          limit: tool.schema.number().describe("Limit for 'list' action").optional().default(20),
          offset: tool.schema.number().describe("Offset for 'list' action").optional().default(0),
        },
        async execute(params) {
          const { action, documentId, source, limit, offset } = params
          try {
            const config = getConfig()
            const validation = validateRaidConfig(config)

            if (!validation.valid) {
              return `KB configuration error:\n${validation.errors.join("\n")}`
            }

            const kb = new RaidKnowledgeBase(config)

            let result: string

            switch (action) {
              case "stats": {
                const stats = kb.getStats()
                result = `Knowledge Base Statistics:

Total Documents: ${stats.totalDocuments}
- Project: ${stats.projectDocuments}
- Global: ${stats.globalDocuments}

Total Tokens: ${stats.totalTokens.toLocaleString()}
Average Tokens/Doc: ${stats.avgTokensPerDocument}

Top Keywords:
${stats.topKeywords
  .slice(0, 10)
  .map((k, i) => `${i + 1}. ${k.keyword} (${k.count})`)
  .join("\n")}

Last Updated: ${stats.lastUpdated.toLocaleString()}`
                break
              }

              case "list": {
                const docs = kb.listDocuments({ source, limit, offset })

                if (docs.length === 0) {
                  result = `No documents found${source ? ` in ${source} knowledge base` : ""}`
                } else {
                  result =
                    `Documents${source ? ` (${source})` : ""} (${offset + 1}-${offset + docs.length}):\n\n` +
                    docs
                      .map(
                        (doc, idx) => `${offset + idx + 1}. ${doc.title}
   ID: ${doc.id}
   Source: ${doc.source}
   Type: ${doc.metadata.contentType}
   Tokens: ${doc.tokenCount}
   Shards: ${doc.shardIds.length}
   Tags: ${doc.tags.join(", ") || "none"}
   Created: ${doc.createdAt.toLocaleString()}
   Updated: ${doc.updatedAt.toLocaleString()}
   ${doc.filePath ? `File: ${doc.filePath}` : ""}
   Summary: ${doc.metadata.summary}`,
                      )
                      .join("\n\n")
                }
                break
              }

              case "get": {
                if (!documentId) {
                  result = "Error: documentId is required for 'get' action"
                  break
                }

                const doc = kb.getDocument(documentId)

                if (!doc) {
                  result = `Document not found: ${documentId}`
                } else {
                  result = `Document: ${doc.title}

ID: ${doc.id}
Source: ${doc.source}
Content Type: ${doc.metadata.contentType}
File Path: ${doc.filePath ?? "none"}

Metadata:
- Created: ${doc.createdAt.toLocaleString()}
- Updated: ${doc.updatedAt.toLocaleString()}
- Tokens: ${doc.tokenCount}
- Shards: ${doc.shardIds.length}
- Tags: ${doc.tags.join(", ") || "none"}
- Keywords: ${doc.keywords.join(", ") || "none"}

Summary:
${doc.metadata.summary}

Content:
${doc.content}`
                }
                break
              }

              case "delete": {
                if (!documentId) {
                  result = "Error: documentId is required for 'delete' action"
                  break
                }

                const deleted = kb.deleteDocument(documentId)
                result = deleted
                  ? `Successfully deleted document: ${documentId}`
                  : `Document not found: ${documentId}`
                break
              }

              case "clear": {
                const count = kb.deleteAllDocuments(source)
                result = `Deleted ${count} document(s)${source ? ` from ${source} knowledge base` : ""}`
                break
              }

              default:
                result = `Unknown action: ${action}`
            }

            kb.close()

            return result
          } catch (error) {
            return `Error managing knowledge base: ${error}`
          }
        },
      }),
    },
  }
}
