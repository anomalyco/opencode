/**
 * Context Drain Plugin for OpenCode (Enhanced v2)
 *
 * Implements intelligent context management by:
 * 1. Storing file summaries and metadata in SQLite
 * 2. Proactively draining context BEFORE compaction is triggered
 * 3. Tracking token usage and providing early warnings
 * 4. Priority decay for older files to keep working set fresh
 * 5. Three memory tiers: working (loop), session, and persistent
 *
 * Key optimizations to avoid compaction:
 * - Aggressive tool output summarization (store only what's needed)
 * - Proactive pruning based on token budget
 * - Smart priority management with time-based decay
 * - File content deduplication (reference SQLite instead of context)
 *
 * Hooks:
 * - tool.execute.before: Track reads, potentially inject cached summaries
 * - tool.execute.after: Capture tool outputs and file metadata
 * - experimental.session.compacting: Custom compaction with SQLite-backed context
 * - session.stop: Persist important context
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname, extname } from "path";
import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

type MemoryType =
  | "file"
  | "tool_output"
  | "code_summary"
  | "conversation"
  | "decision";

interface MemoryEntry {
  id: string;
  sessionID: string;
  projectID: string;
  type: MemoryType;
  key: string;
  summary: string;
  content?: string;
  metadata: Record<string, unknown>;
  tokenCount: number;
  priority: number;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  decayFactor: number;
}

interface FileMetadata {
  path: string;
  extension: string;
  language: string;
  lineCount: number;
  size: number;
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
  namespaces: string[];
  lastModified?: number;
}

interface ContextDrainConfig {
  dbPath: string;
  maxWorkingMemoryTokens: number;
  maxSessionMemoryTokens: number;
  summaryMaxTokens: number;
  pruneAfterAccesses: number;
  enablePersistentMemory: boolean;
  // New: Proactive management thresholds
  proactivePruneThreshold: number; // Start pruning when this % of budget is used
  priorityDecayRate: number; // How much priority decays per access cycle
  maxFileEntriesPerSession: number;
  maxToolOutputsPerSession: number;
}

interface SessionTokenTracker {
  sessionID: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  lastModelLimit: number;
  fileReadsThisLoop: number;
  toolCallsThisLoop: number;
  loopCount: number;
}

// ============================================================================
// Language Detection
// ============================================================================

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  scala: "scala",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  php: "php",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "zsh",
  fish: "fish",
  sql: "sql",
  md: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  vue: "vue",
  svelte: "svelte",
  zig: "zig",
  nim: "nim",
  elm: "elm",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  fs: "fsharp",
  clj: "clojure",
  r: "r",
  jl: "julia",
  dart: "dart",
  v: "v",
  cr: "crystal",
};

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || "unknown";
}

// ============================================================================
// Content Analysis (Enhanced)
// ============================================================================

function extractFileMetadata(filePath: string, content: string): FileMetadata {
  const lines = content.split("\n");
  const language = detectLanguage(filePath);

  const metadata: FileMetadata = {
    path: filePath,
    extension: extname(filePath).slice(1),
    language,
    lineCount: lines.length,
    size: content.length,
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    namespaces: [],
  };

  // Language-specific extraction
  if (["typescript", "javascript"].includes(language)) {
    extractJSMetadata(content, metadata);
  } else if (language === "python") {
    extractPythonMetadata(content, metadata);
  } else if (language === "go") {
    extractGoMetadata(content, metadata);
  } else if (language === "rust") {
    extractRustMetadata(content, metadata);
  }

  return metadata;
}

function extractJSMetadata(content: string, metadata: FileMetadata): Promise<void> {
  // Import patterns
  const importPatterns = [
    /import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+["']([^"']+)["']/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of importPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (!metadata.imports.includes(match[1])) {
        metadata.imports.push(match[1]);
      }
    }
  }

  // Export patterns
  const exportPattern =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+(\w+)/g;
  const exportMatches = content.matchAll(exportPattern);
  for (const match of exportMatches) {
    if (!metadata.exports.includes(match[1])) {
      metadata.exports.push(match[1]);
    }
  }

  // Function patterns (improved)
  const funcPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/g,
    /(\w+)\s*(?::\s*\([^)]*\)\s*=>|=\s*async\s+function)/g,
  ];

  for (const pattern of funcPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (!metadata.functions.includes(match[1]) && match[1] !== "async") {
        metadata.functions.push(match[1]);
      }
    }
  }

  // Class patterns
  const classPattern = /class\s+(\w+)/g;
  const classMatches = content.matchAll(classPattern);
  for (const match of classMatches) {
    if (!metadata.classes.includes(match[1])) {
      metadata.classes.push(match[1]);
    }
  }

  // Namespace patterns (TypeScript)
  const namespacePattern = /(?:export\s+)?namespace\s+(\w+)/g;
  const namespaceMatches = content.matchAll(namespacePattern);
  for (const match of namespaceMatches) {
    if (!metadata.namespaces.includes(match[1])) {
      metadata.namespaces.push(match[1]);
    }
  }

  // Interface/Type patterns
  const typePattern = /(?:export\s+)?(?:interface|type)\s+(\w+)/g;
  const typeMatches = content.matchAll(typePattern);
  for (const match of typeMatches) {
    if (!metadata.classes.includes(`type:${match[1]}`)) {
      metadata.classes.push(`type:${match[1]}`);
    }
  }
}

function extractPythonMetadata(content: string, metadata: FileMetadata): Promise<void> {
  const importPatterns = [/^import\s+(\S+)/gm, /^from\s+(\S+)\s+import/gm];

  for (const pattern of importPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      metadata.imports.push(match[1]);
    }
  }

  const funcPattern = /^(?:async\s+)?def\s+(\w+)/gm;
  const funcMatches = content.matchAll(funcPattern);
  for (const match of funcMatches) {
    metadata.functions.push(match[1]);
  }

  const classPattern = /^class\s+(\w+)/gm;
  const classMatches = content.matchAll(classPattern);
  for (const match of classMatches) {
    metadata.classes.push(match[1]);
  }
}

function extractGoMetadata(content: string, metadata: FileMetadata): Promise<void> {
  const importPattern = /import\s+(?:\(\s*)?["']([^"']+)["']/g;
  const importMatches = content.matchAll(importPattern);
  for (const match of importMatches) {
    metadata.imports.push(match[1]);
  }

  const funcPattern = /func\s+(?:\([^)]+\)\s+)?(\w+)/g;
  const funcMatches = content.matchAll(funcPattern);
  for (const match of funcMatches) {
    metadata.functions.push(match[1]);
  }

  const typePattern = /type\s+(\w+)\s+(?:struct|interface)/g;
  const typeMatches = content.matchAll(typePattern);
  for (const match of typeMatches) {
    metadata.classes.push(match[1]);
  }
}

function extractRustMetadata(content: string, metadata: FileMetadata): Promise<void> {
  const usePattern = /use\s+([^;]+);/g;
  const useMatches = content.matchAll(usePattern);
  for (const match of useMatches) {
    metadata.imports.push(match[1].trim());
  }

  const funcPattern = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g;
  const funcMatches = content.matchAll(funcPattern);
  for (const match of funcMatches) {
    metadata.functions.push(match[1]);
  }

  const structPattern = /(?:pub\s+)?(?:struct|enum|impl|trait)\s+(\w+)/g;
  const structMatches = content.matchAll(structPattern);
  for (const match of structMatches) {
    metadata.classes.push(match[1]);
  }
}

// ============================================================================
// Summary Generation (Enhanced - More Concise)
// ============================================================================

function generateFileSummary(
  filePath: string,
  content: string,
  metadata: FileMetadata,
): string {
  const parts: string[] = [];

  // Compact header
  parts.push(`[${metadata.language}] ${filePath} (${metadata.lineCount}L)`);

  // Compact exports/classes/namespaces
  const exports = [...metadata.exports, ...metadata.namespaces].slice(0, 8);
  if (exports.length > 0) {
    parts.push(
      `Exports: ${exports.join(", ")}${metadata.exports.length > 8 ? "..." : ""}`,
    );
  }

  // Compact types
  const types = metadata.classes
    .filter((c) => c.startsWith("type:"))
    .map((c) => c.slice(5));
  const classes = metadata.classes.filter((c) => !c.startsWith("type:"));
  if (classes.length > 0 || types.length > 0) {
    const combined = [...classes.slice(0, 5), ...types.slice(0, 3)];
    parts.push(
      `Types: ${combined.join(", ")}${classes.length + types.length > 8 ? "..." : ""}`,
    );
  }

  // Compact functions (only top 10)
  if (metadata.functions.length > 0) {
    const funcs = metadata.functions.slice(0, 10);
    parts.push(
      `Fn: ${funcs.join(", ")}${metadata.functions.length > 10 ? `(+${metadata.functions.length - 10})` : ""}`,
    );
  }

  // Key imports (only local/relative)
  const localImports = metadata.imports.filter(
    (i) => i.startsWith(".") || i.startsWith("@/") || i.startsWith("~/"),
  );
  if (localImports.length > 0) {
    parts.push(`Deps: ${localImports.slice(0, 5).join(", ")}`);
  }

  return parts.join(" | ");
}

function generateToolOutputSummary(
  toolName: string,
  output: string,
  callID: string,
): string {
  const maxLen = 300;

  // For file listings, just count
  if (
    toolName === "glob" ||
    toolName === "Glob" ||
    toolName === "ls" ||
    toolName === "List"
  ) {
    const lines = output.split("\n").filter((l) => l.trim());
    return `${toolName}: ${lines.length} files found`;
  }

  // For grep, count matches
  if (toolName === "grep" || toolName === "Grep") {
    const matchCount = (output.match(/Line \d+:/g) || []).length;
    return `${toolName}: ${matchCount} matches`;
  }

  // For bash, summarize exit status
  if (toolName === "bash" || toolName === "Bash") {
    const hasError =
      output.toLowerCase().includes("error") ||
      output.toLowerCase().includes("failed");
    return `${toolName}: ${hasError ? "completed with errors" : "completed"} (${output.length} chars)`;
  }

  // Default: very short
  if (output.length <= maxLen) {
    return `${toolName}: ${output.slice(0, 100)}...`;
  }

  return `${toolName}: ${output.slice(0, 100)}... (${output.length} chars)`;
}

// ============================================================================
// Token Estimation (Improved)
// ============================================================================

function estimateTokens(text: string): number {
  if (!text) return 0;
  // More accurate: ~3.5 chars per token for code, ~4 for English
  return Math.ceil(text.length / 3.5);
}

// ============================================================================
// Database Manager (Enhanced)
// ============================================================================

class ContextDatabase {
  private db: Database;
  private config: ContextDrainConfig;

  constructor(config: ContextDrainConfig) {
    this.config = config;

    const dir = dirname(config.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(config.dbPath);
    this.initSchema();
  }

  private initSchema(): Promise<void> {
    // Main memory table with decay factor
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        key TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        token_count INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        decay_factor REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(session_id, key)
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_memory_session ON memory(session_id, type, priority DESC)`,
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id, type)`,
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(session_id, key)`,
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_memory_accessed ON memory(accessed_at DESC)`,
    );
    // Note: SQLite doesn't support expression indexes directly, so we use separate indexes
    // and compute effective priority (priority * decay_factor) at query time
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_memory_priority ON memory(session_id, priority DESC)`,
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_memory_decay ON memory(session_id, decay_factor DESC)`,
    );

    // Working memory table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS working_memory (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        loop_id TEXT NOT NULL,
        file_path TEXT,
        summary TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_working_session_loop ON working_memory(session_id, loop_id)`,
    );

    // Session token tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_tokens (
        session_id TEXT PRIMARY KEY,
        estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
        last_model_limit INTEGER NOT NULL DEFAULT 0,
        file_reads_this_loop INTEGER NOT NULL DEFAULT 0,
        tool_calls_this_loop INTEGER NOT NULL DEFAULT 0,
        loop_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);

    // Decision log for important choices made
    this.db.run(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        context TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id, created_at DESC)`,
    );
  }

  // -------------------------------------------------------------------------
  // Memory Operations
  // -------------------------------------------------------------------------

  store(entry: Omit<MemoryEntry, "id" | "decayFactor">): string {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Use UPSERT to handle duplicates
    this.db.run(
      `
      INSERT INTO memory 
      (id, session_id, project_id, type, key, summary, content, metadata, token_count, priority, decay_factor, created_at, accessed_at, access_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?, ?)
      ON CONFLICT(session_id, key) DO UPDATE SET
        summary = excluded.summary,
        content = excluded.content,
        metadata = excluded.metadata,
        token_count = excluded.token_count,
        priority = MAX(priority, excluded.priority),
        accessed_at = excluded.accessed_at,
        access_count = access_count + 1
    `,
      [
        id,
        entry.sessionID,
        entry.projectID,
        entry.type,
        entry.key,
        entry.summary,
        entry.content || null,
        JSON.stringify(entry.metadata),
        entry.tokenCount,
        entry.priority,
        entry.createdAt,
        entry.accessedAt,
        entry.accessCount,
      ],
    );

    return id;
  }

  get(sessionID: string, key: string): MemoryEntry | null {
    const row = this.db
      .query(`SELECT * FROM memory WHERE session_id = ? AND key = ?`)
      .get(sessionID, key) as Record<string, unknown> | null;

    if (!row) return null;

    this.db.run(
      `UPDATE memory SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?`,
      [Date.now(), row.id as string],
    );

    return this.rowToEntry(row);
  }

  getByType(sessionID: string, type: MemoryType, limit = 50): MemoryEntry[] {
    const rows = this.db
      .query(
        `
      SELECT * FROM memory 
      WHERE session_id = ? AND type = ?
      ORDER BY (priority * decay_factor) DESC, accessed_at DESC
      LIMIT ?
    `,
      )
      .all(sessionID, type, limit) as Record<string, unknown>[];

    return rows.map((row) => this.rowToEntry(row));
  }

  getRecentFiles(sessionID: string, limit = 20): MemoryEntry[] {
    const rows = this.db
      .query(
        `
      SELECT * FROM memory 
      WHERE session_id = ? AND type = 'file'
      ORDER BY accessed_at DESC
      LIMIT ?
    `,
      )
      .all(sessionID, limit) as Record<string, unknown>[];

    return rows.map((row) => this.rowToEntry(row));
  }

  getAllForSession(sessionID: string): MemoryEntry[] {
    const rows = this.db
      .query(
        `
      SELECT * FROM memory 
      WHERE session_id = ?
      ORDER BY (priority * decay_factor) DESC, accessed_at DESC
    `,
      )
      .all(sessionID) as Record<string, unknown>[];

    return rows.map((row) => this.rowToEntry(row));
  }

  getContextBudget(sessionID: string, maxTokens: number): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    let tokenCount = 0;

    const rows = this.db
      .query(
        `
      SELECT * FROM memory 
      WHERE session_id = ?
      ORDER BY (priority * decay_factor) DESC, accessed_at DESC
    `,
      )
      .all(sessionID) as Record<string, unknown>[];

    for (const row of rows) {
      const entry = this.rowToEntry(row);
      if (tokenCount + entry.tokenCount > maxTokens) {
        continue;
      }
      entries.push(entry);
      tokenCount += entry.tokenCount;
    }

    return entries;
  }

  updatePriority(sessionID: string, key: string, priority: number): Promise<void> {
    this.db.run(
      `UPDATE memory SET priority = ?, decay_factor = 1.0 WHERE session_id = ? AND key = ?`,
      [priority, sessionID, key],
    );
  }

  // Apply decay to all entries (call at end of each loop)
  applyDecay(sessionID: string, decayRate: number): Promise<void> {
    this.db.run(
      `
      UPDATE memory 
      SET decay_factor = MAX(0.1, decay_factor * ?)
      WHERE session_id = ? AND type != 'decision'
    `,
      [1 - decayRate, sessionID],
    );
  }

  prune(sessionID: string, keepCount = 100): number {
    const result = this.db.run(
      `
      DELETE FROM memory 
      WHERE session_id = ? 
      AND id NOT IN (
        SELECT id FROM memory 
        WHERE session_id = ? 
        ORDER BY (priority * decay_factor) DESC, accessed_at DESC 
        LIMIT ?
      )
    `,
      [sessionID, sessionID, keepCount],
    );

    return result.changes;
  }

  // Proactive prune based on token budget
  proactivePrune(sessionID: string, maxTokens: number): number {
    let totalTokens = 0;
    const rows = this.db
      .query(
        `
      SELECT id, token_count FROM memory 
      WHERE session_id = ?
      ORDER BY (priority * decay_factor) DESC, accessed_at DESC
    `,
      )
      .all(sessionID) as Array<{ id: string; token_count: number }>;

    const toKeep: string[] = [];
    for (const row of rows) {
      if (totalTokens + row.token_count <= maxTokens) {
        toKeep.push(row.id);
        totalTokens += row.token_count;
      }
    }

    if (toKeep.length === rows.length) return 0;

    const placeholders = toKeep.map(() => "?").join(",");
    const result = this.db.run(
      `DELETE FROM memory WHERE session_id = ? AND id NOT IN (${placeholders})`,
      [sessionID, ...toKeep],
    );

    return result.changes;
  }

  getTotalTokens(sessionID: string): number {
    const result = this.db
      .query(
        `SELECT SUM(token_count) as total FROM memory WHERE session_id = ?`,
      )
      .get(sessionID) as { total: number | null };
    return result?.total || 0;
  }

  getEntryCount(sessionID: string, type?: MemoryType): number {
    if (type) {
      const result = this.db
        .query(
          `SELECT COUNT(*) as count FROM memory WHERE session_id = ? AND type = ?`,
        )
        .get(sessionID, type) as { count: number };
      return result?.count || 0;
    }
    const result = this.db
      .query(`SELECT COUNT(*) as count FROM memory WHERE session_id = ?`)
      .get(sessionID) as {
      count: number;
    };
    return result?.count || 0;
  }

  // -------------------------------------------------------------------------
  // Working Memory Operations
  // -------------------------------------------------------------------------

  storeWorkingMemory(
    sessionID: string,
    loopID: string,
    filePath: string,
    summary: string,
    metadata: Record<string, unknown>,
    priority = 0,
  ): string {
    const id = `wm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    this.db.run(
      `INSERT INTO working_memory (id, session_id, loop_id, file_path, summary, metadata, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sessionID,
        loopID,
        filePath,
        summary,
        JSON.stringify(metadata),
        priority,
        Date.now(),
      ],
    );

    return id;
  }

  getWorkingMemory(
    sessionID: string,
    loopID: string,
  ): Array<{
    filePath: string;
    summary: string;
    metadata: Record<string, unknown>;
  }> {
    const rows = this.db
      .query(
        `SELECT file_path, summary, metadata FROM working_memory WHERE session_id = ? AND loop_id = ? ORDER BY priority DESC, created_at DESC`,
      )
      .all(sessionID, loopID) as Array<{
      file_path: string;
      summary: string;
      metadata: string;
    }>;

    return rows.map((row) => ({
      filePath: row.file_path,
      summary: row.summary,
      metadata: JSON.parse(row.metadata),
    }));
  }

  clearWorkingMemory(sessionID: string, loopID?: string): Promise<void> {
    if (loopID) {
      this.db.run(
        `DELETE FROM working_memory WHERE session_id = ? AND loop_id = ?`,
        [sessionID, loopID],
      );
    } else {
      this.db.run(`DELETE FROM working_memory WHERE session_id = ?`, [
        sessionID,
      ]);
    }
  }

  // -------------------------------------------------------------------------
  // Session Token Tracking
  // -------------------------------------------------------------------------

  getSessionTokens(sessionID: string): SessionTokenTracker | null {
    const row = this.db
      .query(`SELECT * FROM session_tokens WHERE session_id = ?`)
      .get(sessionID) as Record<string, unknown> | null;
    if (!row) return null;

    return {
      sessionID: row.session_id as string,
      estimatedInputTokens: row.estimated_input_tokens as number,
      estimatedOutputTokens: row.estimated_output_tokens as number,
      lastModelLimit: row.last_model_limit as number,
      fileReadsThisLoop: row.file_reads_this_loop as number,
      toolCallsThisLoop: row.tool_calls_this_loop as number,
      loopCount: row.loop_count as number,
    };
  }

  updateSessionTokens(tracker: SessionTokenTracker): Promise<void> {
    this.db.run(
      `
      INSERT INTO session_tokens (session_id, estimated_input_tokens, estimated_output_tokens, last_model_limit, file_reads_this_loop, tool_calls_this_loop, loop_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        estimated_input_tokens = excluded.estimated_input_tokens,
        estimated_output_tokens = excluded.estimated_output_tokens,
        last_model_limit = excluded.last_model_limit,
        file_reads_this_loop = excluded.file_reads_this_loop,
        tool_calls_this_loop = excluded.tool_calls_this_loop,
        loop_count = excluded.loop_count,
        updated_at = excluded.updated_at
    `,
      [
        tracker.sessionID,
        tracker.estimatedInputTokens,
        tracker.estimatedOutputTokens,
        tracker.lastModelLimit,
        tracker.fileReadsThisLoop,
        tracker.toolCallsThisLoop,
        tracker.loopCount,
        Date.now(),
      ],
    );
  }

  incrementLoopCount(sessionID: string): number {
    this.db.run(
      `
      INSERT INTO session_tokens (session_id, estimated_input_tokens, estimated_output_tokens, last_model_limit, file_reads_this_loop, tool_calls_this_loop, loop_count, updated_at)
      VALUES (?, 0, 0, 0, 0, 0, 1, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        loop_count = loop_count + 1,
        file_reads_this_loop = 0,
        tool_calls_this_loop = 0,
        updated_at = excluded.updated_at
    `,
      [sessionID, Date.now()],
    );

    const result = this.db
      .query(`SELECT loop_count FROM session_tokens WHERE session_id = ?`)
      .get(sessionID) as {
      loop_count: number;
    };
    return result?.loop_count || 1;
  }

  incrementFileReads(sessionID: string): Promise<void> {
    this.db.run(
      `UPDATE session_tokens SET file_reads_this_loop = file_reads_this_loop + 1 WHERE session_id = ?`,
      [sessionID],
    );
  }

  incrementToolCalls(sessionID: string): Promise<void> {
    this.db.run(
      `UPDATE session_tokens SET tool_calls_this_loop = tool_calls_this_loop + 1 WHERE session_id = ?`,
      [sessionID],
    );
  }

  // -------------------------------------------------------------------------
  // Decision Log
  // -------------------------------------------------------------------------

  logDecision(sessionID: string, decision: string, context?: string): Promise<void> {
    const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.db.run(
      `INSERT INTO decisions (id, session_id, decision, context, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, sessionID, decision, context || null, Date.now()],
    );
  }

  getRecentDecisions(
    sessionID: string,
    limit = 10,
  ): Array<{ decision: string; context?: string; createdAt: number }> {
    const rows = this.db
      .query(
        `SELECT decision, context, created_at FROM decisions WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sessionID, limit) as Array<{
      decision: string;
      context: string | null;
      created_at: number;
    }>;

    return rows.map((row) => ({
      decision: row.decision,
      context: row.context || undefined,
      createdAt: row.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Persistent Memory (Cross-Session)
  // -------------------------------------------------------------------------

  getProjectMemory(projectID: string, limit = 50): MemoryEntry[] {
    const rows = this.db
      .query(
        `
      SELECT * FROM memory 
      WHERE project_id = ?
      ORDER BY access_count DESC, accessed_at DESC
      LIMIT ?
    `,
      )
      .all(projectID, limit) as Record<string, unknown>[];

    return rows.map((row) => this.rowToEntry(row));
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row.id as string,
      sessionID: row.session_id as string,
      projectID: row.project_id as string,
      type: row.type as MemoryType,
      key: row.key as string,
      summary: row.summary as string,
      content: row.content as string | undefined,
      metadata: JSON.parse(row.metadata as string),
      tokenCount: row.token_count as number,
      priority: row.priority as number,
      decayFactor: row.decay_factor as number,
      createdAt: row.created_at as number,
      accessedAt: row.accessed_at as number,
      accessCount: row.access_count as number,
    };
  }

  close(): Promise<void> {
    this.db.close();
  }
}

// ============================================================================
// Plugin State
// ============================================================================

const DEFAULT_CONFIG: ContextDrainConfig = {
  dbPath: join(homedir(), ".local", "share", "opencode", "context-drain.db"),
  maxWorkingMemoryTokens: 8000,
  maxSessionMemoryTokens: 24000, // Reduced for more aggressive management
  summaryMaxTokens: 400,
  pruneAfterAccesses: 80,
  enablePersistentMemory: true,
  proactivePruneThreshold: 0.7, // Start pruning at 70% of budget
  priorityDecayRate: 0.15, // 15% decay per loop
  maxFileEntriesPerSession: 50,
  maxToolOutputsPerSession: 30,
};

let db: ContextDatabase | null = null;
let loopCounter: Record<string, number> = {};

function getDB(config: ContextDrainConfig = DEFAULT_CONFIG): ContextDatabase {
  if (!db) {
    db = new ContextDatabase(config);
  }
  return db;
}

function getCurrentLoopID(sessionID: string): string {
  if (!loopCounter[sessionID]) {
    loopCounter[sessionID] = 0;
  }
  return `loop_${loopCounter[sessionID]}`;
}

function incrementLoop(sessionID: string): string {
  if (!loopCounter[sessionID]) {
    loopCounter[sessionID] = 0;
  }
  loopCounter[sessionID]++;
  return getCurrentLoopID(sessionID);
}

// ============================================================================
// File Path Extraction (Improved)
// ============================================================================

function extractFilePath(
  toolOutput: string,
  toolArgs?: Record<string, unknown>,
): string | null {
  // First, check tool args for filePath
  if (toolArgs?.filePath && typeof toolArgs.filePath === "string") {
    return toolArgs.filePath;
  }

  // Check for common patterns in output
  const patterns = [
    /^<file>\n(\d+)\|\s*(.+?)$/m, // Read tool format
    /^File:\s*(.+?)$/m,
    /^Reading\s+(.+?)(?:\n|$)/,
    /^Wrote\s+(.+?)$/m,
    /^Edited\s+(.+?)$/m,
    /filePath['":\s]+([^\s'"]+)/,
  ];

  for (const pattern of patterns) {
    const match = toolOutput.match(pattern);
    if (match) {
      // Return the last captured group (the path)
      return match[match.length - 1]?.trim() || null;
    }
  }

  return null;
}

// ============================================================================
// Plugin Export
// ============================================================================

export default async function contextDrain(input: {
  client: unknown;
  project: string;
  worktree: string;
  directory: string;
  serverUrl: string;
  $: unknown;
}) {
  const projectID = input.project;
  const database = getDB();

  return {
    // -------------------------------------------------------------------------
    // Commands
    // -------------------------------------------------------------------------
    command: {
      "context-status": {
        description: "Show current context drain memory status",
        template:
          "Show the current context drain memory status for this session.",
      },
      "context-clear": {
        description: "Clear context drain memory for this session",
        template: "Clear the context drain memory for this session.",
      },
      "context-files": {
        description: "List recently accessed files in memory",
        template:
          "List the recently accessed files stored in context drain memory.",
      },
      "context-budget": {
        description: "Show token budget usage and recommendations",
        template:
          "Show the current token budget usage and recommendations for avoiding compaction.",
      },
    },

    // -------------------------------------------------------------------------
    // Tools
    // -------------------------------------------------------------------------
    tool: {
      "context-status": {
        description: "Get context drain memory status for the session",
        args: {},
        async execute(
          _args: Record<string, never>,
          ctx: { sessionID: string },
        ) {
          const sessionID = ctx.sessionID;
          const entries = database.getAllForSession(sessionID);
          const byType: Record<string, number> = {};
          let totalTokens = 0;

          for (const entry of entries) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
            totalTokens += entry.tokenCount;
          }

          const tracker = database.getSessionTokens(sessionID);

          return JSON.stringify(
            {
              sessionID,
              projectID,
              totalEntries: entries.length,
              totalTokens,
              byType,
              currentLoop: getCurrentLoopID(sessionID),
              sessionTracker: tracker,
              budgetUsage: `${Math.round((totalTokens / DEFAULT_CONFIG.maxSessionMemoryTokens) * 100)}%`,
            },
            null,
            2,
          );
        },
      },

      "context-clear": {
        description: "Clear context drain memory for the session",
        args: {},
        async execute(
          _args: Record<string, never>,
          ctx: { sessionID: string },
        ) {
          const sessionID = ctx.sessionID;
          const pruned = database.prune(sessionID, 0);
          database.clearWorkingMemory(sessionID);
          return `Cleared ${pruned} memory entries for session ${sessionID}`;
        },
      },

      "context-files": {
        description: "List recently accessed files in memory",
        args: {},
        async execute(
          _args: Record<string, never>,
          ctx: { sessionID: string },
        ) {
          const sessionID = ctx.sessionID;
          const files = database.getRecentFiles(sessionID, 20);

          if (files.length === 0) {
            return "No files in memory";
          }

          const result = files
            .map((f) => {
              const effectivePriority =
                Math.round(f.priority * f.decayFactor * 10) / 10;
              return `${f.key} (p:${effectivePriority}, accesses:${f.accessCount})`;
            })
            .join("\n");

          return `Recent files in memory (${files.length}):\n${result}`;
        },
      },

      "context-recall": {
        description: "Recall context about a specific file or topic",
        args: {
          query: z.string().describe("File path or topic to recall"),
        },
        async execute(args: { query: string }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID;
          const entry = database.get(sessionID, args.query);

          if (entry) {
            return `Memory for ${args.query}:\n${entry.summary}\n\nMetadata: ${JSON.stringify(entry.metadata, null, 2)}`;
          }

          const entries = database.getAllForSession(sessionID);
          const matches = entries.filter(
            (e) =>
              e.key.includes(args.query) ||
              e.summary.toLowerCase().includes(args.query.toLowerCase()),
          );

          if (matches.length === 0) {
            return `No memory found for: ${args.query}`;
          }

          return matches
            .slice(0, 5)
            .map((m) => `${m.key}:\n${m.summary}`)
            .join("\n\n");
        },
      },

      "context-budget": {
        description: "Show token budget usage and recommendations",
        args: {},
        async execute(
          _args: Record<string, never>,
          ctx: { sessionID: string },
        ) {
          const sessionID = ctx.sessionID;
          const totalTokens = database.getTotalTokens(sessionID);
          const fileCount = database.getEntryCount(sessionID, "file");
          const toolCount = database.getEntryCount(sessionID, "tool_output");
          const budgetPercent = Math.round(
            (totalTokens / DEFAULT_CONFIG.maxSessionMemoryTokens) * 100,
          );

          const recommendations: string[] = [];
          if (budgetPercent > 80) {
            recommendations.push(
              "Consider using /context-clear to free up space",
            );
          }
          if (fileCount > 30) {
            recommendations.push(
              `${fileCount} files tracked - old files will be automatically pruned`,
            );
          }
          if (toolCount > 20) {
            recommendations.push(
              `${toolCount} tool outputs stored - consider if all are needed`,
            );
          }

          return [
            `Token Budget: ${totalTokens}/${DEFAULT_CONFIG.maxSessionMemoryTokens} (${budgetPercent}%)`,
            `Files: ${fileCount}, Tool outputs: ${toolCount}`,
            `Loop: ${getCurrentLoopID(sessionID)}`,
            recommendations.length > 0
              ? `\nRecommendations:\n- ${recommendations.join("\n- ")}`
              : "",
          ].join("\n");
        },
      },
    },

    // -------------------------------------------------------------------------
    // Hooks
    // -------------------------------------------------------------------------

    /**
     * Before tool execution - track what's being accessed
     */
    async ["tool.execute.before"](
      hookInput: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> {
      const sessionID = hookInput.sessionID;
      const tool = hookInput.tool;

      // Track file reads
      if (tool === "read" || tool === "Read") {
        database.incrementFileReads(sessionID);

        // Check if we already have this file cached
        const filePath = output.args?.filePath as string | undefined;
        if (filePath) {
          const existing = database.get(sessionID, filePath);
          if (existing) {
            // Boost priority since it's being re-read
            database.updatePriority(
              sessionID,
              filePath,
              Math.min(10, existing.priority + 1),
            );
          }
        }
      }

      // Track all tool calls
      database.incrementToolCalls(sessionID);
    },

    /**
     * After tool execution, capture relevant context (optimized)
     */
    async ["tool.execute.after"](
      hookInput: { tool: string; sessionID: string; callID: string },
      result:
        | {
            output?: string;
            title?: string;
            input?: Record<string, unknown>;
            attachments?: unknown[];
          }
        | undefined,
    ): Promise<void> {
      if (!result?.output) return;

      const sessionID = hookInput.sessionID;
      const tool = hookInput.tool;
      const output = result.output;

      // Handle file read tools
      if (tool === "read" || tool === "Read") {
        const filePath = extractFilePath(output, result.input);
        if (filePath) {
          const metadata = extractFileMetadata(filePath, output);
          const summary = generateFileSummary(filePath, output, metadata);

          database.store({
            sessionID,
            projectID,
            type: "file",
            key: filePath,
            summary,
            content: undefined, // Don't store full content to save space
            metadata: metadata as unknown as Record<string, unknown>,
            tokenCount: estimateTokens(summary),
            priority: 5,
            createdAt: Date.now(),
            accessedAt: Date.now(),
            accessCount: 1,
          });

          database.storeWorkingMemory(
            sessionID,
            getCurrentLoopID(sessionID),
            filePath,
            summary,
            metadata as unknown as Record<string, unknown>,
            5,
          );

          // Proactive pruning: limit file entries
          const fileCount = database.getEntryCount(sessionID, "file");
          if (fileCount > DEFAULT_CONFIG.maxFileEntriesPerSession) {
            database.proactivePrune(
              sessionID,
              DEFAULT_CONFIG.maxSessionMemoryTokens,
            );
          }
        }
      }

      // Handle search/grep results (very minimal storage)
      if (
        tool === "grep" ||
        tool === "Grep" ||
        tool === "glob" ||
        tool === "Glob"
      ) {
        const summary = generateToolOutputSummary(
          tool,
          output,
          hookInput.callID,
        );

        database.store({
          sessionID,
          projectID,
          type: "tool_output",
          key: `${tool}_${hookInput.callID}`,
          summary,
          content: undefined, // Don't store output
          metadata: { tool, callID: hookInput.callID },
          tokenCount: estimateTokens(summary),
          priority: 2, // Lower priority than files
          createdAt: Date.now(),
          accessedAt: Date.now(),
          accessCount: 1,
        });

        // Limit tool outputs
        const toolCount = database.getEntryCount(sessionID, "tool_output");
        if (toolCount > DEFAULT_CONFIG.maxToolOutputsPerSession) {
          // Delete oldest tool outputs
          database.prune(sessionID, DEFAULT_CONFIG.pruneAfterAccesses);
        }
      }

      // Handle write/edit tools - boost priority for modified files
      if (
        tool === "write" ||
        tool === "Write" ||
        tool === "edit" ||
        tool === "Edit"
      ) {
        const filePath = extractFilePath(output, result.input);
        if (filePath) {
          database.updatePriority(sessionID, filePath, 9); // High priority for modified files
          database.logDecision(sessionID, `Modified: ${filePath}`);
        }
      }
    },

    /**
     * During compaction, inject context from SQLite
     */
    async ["experimental.session.compacting"](
      hookInput: { sessionID: string },
      output: { context: string[]; prompt?: string },
    ): Promise<void> {
      const sessionID = hookInput.sessionID;

      // Increment loop counter
      const loopNum = incrementLoop(sessionID);
      database.incrementLoopCount(sessionID);

      // Apply decay to all entries
      database.applyDecay(sessionID, DEFAULT_CONFIG.priorityDecayRate);

      // Get context within token budget
      const entries = database.getContextBudget(
        sessionID,
        DEFAULT_CONFIG.maxSessionMemoryTokens,
      );

      if (entries.length === 0) return;

      // Build compact context sections
      const fileContext: string[] = [];
      const recentDecisions: string[] = [];

      for (const entry of entries) {
        if (entry.type === "file") {
          fileContext.push(entry.summary);
        }
      }

      // Get recent decisions
      const decisions = database.getRecentDecisions(sessionID, 5);
      for (const d of decisions) {
        recentDecisions.push(d.decision);
      }

      // Inject compact context
      if (fileContext.length > 0) {
        output.context.push(
          `## Files in Memory (${fileContext.length})\n${fileContext.join("\n")}`,
        );
      }

      if (recentDecisions.length > 0) {
        output.context.push(`## Recent Actions\n${recentDecisions.join("\n")}`);
      }

      // Add persistent project memory if enabled
      if (DEFAULT_CONFIG.enablePersistentMemory) {
        const projectMemory = database.getProjectMemory(projectID, 5);
        const projectContext = projectMemory
          .filter((m) => m.sessionID !== sessionID)
          .map((m) => m.summary)
          .slice(0, 3);

        if (projectContext.length > 0) {
          output.context.push(
            `## Project Memory\n${projectContext.join("\n")}`,
          );
        }
      }

      // Aggressive pruning after compaction
      database.prune(sessionID, DEFAULT_CONFIG.pruneAfterAccesses);

      // Clear old working memory
      const oldLoopID = `loop_${(loopCounter[sessionID] || 1) - 2}`;
      database.clearWorkingMemory(sessionID, oldLoopID);
    },

    /**
     * On session stop, persist important context
     */
    async ["session.stop"](
      hookInput: {
        sessionID: string;
        step: number;
        lastAssistantText?: string;
      },
      output: { stop: boolean; prompt?: string; systemMessage?: string },
    ): Promise<void> {
      // Boost priority for files mentioned in the final response
      if (hookInput.lastAssistantText) {
        const fileMatches = hookInput.lastAssistantText.matchAll(
          /`([^`]+\.[a-z]{1,5})`/g,
        );
        for (const match of fileMatches) {
          database.updatePriority(hookInput.sessionID, match[1], 7);
        }

        // Log key decisions/completions mentioned
        const donePatterns = [
          /completed?\s+(.+)/gi,
          /finished?\s+(.+)/gi,
          /created?\s+(.+)/gi,
          /fixed?\s+(.+)/gi,
        ];

        for (const pattern of donePatterns) {
          const matches = hookInput.lastAssistantText.matchAll(pattern);
          for (const match of matches) {
            if (match[1] && match[1].length < 100) {
              database.logDecision(hookInput.sessionID, match[0].slice(0, 100));
            }
          }
        }
      }
    },
  };
}
