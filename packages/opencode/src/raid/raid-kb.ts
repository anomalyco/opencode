/**
 * RAID Knowledge Base - SQLite-backed document storage with FTS
 * Handles document CRUD operations, full-text search, and metadata management
 */

import Database from "better-sqlite3"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { get_encoding } from "@dqbd/tiktoken"
import matter from "gray-matter"
import type {
  RaidDocument,
  RaidSearchOptions,
  RaidSearchResult,
  RaidStats,
  RaidConfig,
  RaidDocumentMetadata,
} from "./raid-types"

const encoding = get_encoding("cl100k_base")

/**
 * RAID Knowledge Base - manages documents in SQLite with FTS
 */
export class RaidKnowledgeBase {
  private db: Database.Database
  private config: RaidConfig

  constructor(config: RaidConfig) {
    this.config = config
    this.db = this.initDatabase(config.dbPath)
  }

  /**
   * Initialize SQLite database with schema
   */
  private initDatabase(dbPath: string): Database.Database {
    // Ensure directory exists
    mkdir(dirname(dbPath), { recursive: true }).catch(() => {})

    const db = new Database(dbPath)
    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")

    // Create documents table
    db.exec(`
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

    // Create FTS virtual table for full-text search
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        title,
        content,
        keywords,
        summary,
        content='documents',
        content_rowid='rowid'
      )
    `)

    // Create triggers to keep FTS in sync
    db.exec(`
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

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
      CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
      CREATE INDEX IF NOT EXISTS idx_documents_content_type ON documents(content_type);
    `)

    return db
  }

  /**
   * Add or update a document
   */
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

    const stmt = this.db.prepare(`
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
    `)

    stmt.run(
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
    )

    return document
  }

  /**
   * Get document by ID
   */
  getDocument(id: string): RaidDocument | null {
    const stmt = this.db.prepare("SELECT * FROM documents WHERE id = ?")
    const row = stmt.get(id) as any

    if (!row) return null

    return this.rowToDocument(row)
  }

  /**
   * Search documents using FTS
   */
  search(query: string, options: RaidSearchOptions = {}): RaidSearchResult[] {
    const {
      maxResults = 10,
      includeContent = true,
      sourceFilter = "both",
      tagsFilter = [],
      contentTypeFilter = [],
    } = options

    let sql = `
      SELECT 
        d.*,
        bm25(documents_fts) as rank,
        snippet(documents_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
      FROM documents_fts
      JOIN documents d ON documents_fts.rowid = d.rowid
      WHERE documents_fts MATCH ?
    `

    const params: any[] = [query]

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

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as any[]

    return rows.map((row) => ({
      document: this.rowToDocument(row),
      relevanceScore: -row.rank, // BM25 returns negative scores
      snippets: [row.snippet],
      highlightedContent: includeContent ? row.snippet : undefined,
    }))
  }

  /**
   * List all documents with optional filters
   */
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

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as any[]

    return rows.map((row) => this.rowToDocument(row))
  }

  /**
   * Delete document by ID
   */
  deleteDocument(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM documents WHERE id = ?")
    const result = stmt.run(id)
    return result.changes > 0
  }

  /**
   * Delete all documents from a source
   */
  deleteAllDocuments(source?: "project" | "global"): number {
    let sql = "DELETE FROM documents"
    const params: any[] = []

    if (source) {
      sql += " WHERE source = ?"
      params.push(source)
    }

    const stmt = this.db.prepare(sql)
    const result = stmt.run(...params)
    return result.changes
  }

  /**
   * Get knowledge base statistics
   */
  getStats(): RaidStats {
    const totalStmt = this.db.prepare(
      "SELECT COUNT(*) as count, SUM(token_count) as tokens FROM documents",
    )
    const projectStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM documents WHERE source = 'project'",
    )
    const globalStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM documents WHERE source = 'global'",
    )
    const keywordsStmt = this.db.prepare(`
      SELECT json_each.value as keyword, COUNT(*) as count
      FROM documents, json_each(documents.keywords)
      GROUP BY keyword
      ORDER BY count DESC
      LIMIT 20
    `)

    const total = totalStmt.get() as any
    const project = projectStmt.get() as any
    const global = globalStmt.get() as any
    const keywords = keywordsStmt.all() as any[]

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

  /**
   * Update document shard IDs
   */
  updateShardIds(docId: string, shardIds: string[]): void {
    const stmt = this.db.prepare("UPDATE documents SET shard_ids = ?, updated_at = ? WHERE id = ?")
    stmt.run(JSON.stringify(shardIds), Date.now(), docId)
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close()
  }

  /**
   * Count tokens in text
   */
  private countTokens(text: string): number {
    try {
      return encoding.encode(text).length
    } catch {
      // Fallback to rough estimate
      return Math.ceil(text.length / 4)
    }
  }

  /**
   * Extract metadata from content
   */
  private extractMetadata(content: string, filePath?: string): RaidDocumentMetadata {
    let contentType: RaidDocumentMetadata["contentType"] = "text"
    let extractedKeywords: string[] = []
    let summary = ""

    // Detect content type
    if (filePath) {
      const ext = filePath.split(".").pop()?.toLowerCase()
      if (ext === "md" || ext === "markdown") {
        contentType = "markdown"
      } else if (["js", "ts", "py", "go", "java", "cpp", "c", "rs", "rb"].includes(ext ?? "")) {
        contentType = "code"
      }
    }

    // Try to parse frontmatter for markdown
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

    // Extract keywords from content (simple approach)
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

    // Generate summary (first 200 chars)
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

  /**
   * Convert database row to RaidDocument
   */
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
