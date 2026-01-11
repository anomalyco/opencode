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

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join, dirname, extname } from "path"
import { z } from "zod/v4"

// ============================================================================
// Types
// ============================================================================

type MemoryType = "file" | "tool_output" | "code_summary" | "conversation" | "decision"

interface MemoryEntry {
  id: string
  sessionID: string
  projectID: string
  type: MemoryType
  key: string
  summary: string
  content?: string
  metadata: Record<string, unknown>
  tokenCount: number
  priority: number
  createdAt: number
  accessedAt: number
  accessCount: number
  decayFactor: number
}

interface FileMetadata {
  path: string
  extension: string
  language: string
  lineCount: number
  size: number
  imports: string[]
  exports: string[]
  functions: string[]
  classes: string[]
  namespaces: string[]
  lastModified?: number
}

interface ContextDrainConfig {
  dbPath: string
  maxWorkingMemoryTokens: number
  maxSessionMemoryTokens: number
  summaryMaxTokens: number
  pruneAfterAccesses: number
  enablePersistentMemory: boolean
  // New: Proactive management thresholds
  proactivePruneThreshold: number // Start pruning when this % of budget is used
  priorityDecayRate: number // How much priority decays per access cycle
  maxFileEntriesPerSession: number
  maxToolOutputsPerSession: number
}

interface SessionTokenTracker {
  sessionID: string
  estimatedInputTokens: number
  estimatedOutputTokens: number
  lastModelLimit: number
  fileReadsThisLoop: number
  toolCallsThisLoop: number
  loopCount: number
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
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase()
  return EXTENSION_TO_LANGUAGE[ext] || "unknown"
}

// ============================================================================
// Code Pattern Detection
// ============================================================================

type CodePattern =
  | "react-component"
  | "react-hook"
  | "api-endpoint"
  | "database-model"
  | "utility-function"
  | "test-suite"
  | "config-file"
  | "type-definitions"
  | "middleware"
  | "event-handler"
  | "state-management"
  | "error-boundary"
  | "hoc"
  | "factory"
  | "singleton"
  | "observer"
  | "command"
  | "service"
  | "repository"
  | "controller"

interface PatternMatch {
  pattern: CodePattern
  confidence: number
  indicators: string[]
}

function detectCodePatterns(filePath: string, content: string, metadata: FileMetadata): PatternMatch[] {
  const patterns: PatternMatch[] = []
  const lowerContent = content.toLowerCase()
  const lowerPath = filePath.toLowerCase()

  // React Component detection
  if (metadata.language === "typescript" || metadata.language === "javascript") {
    const reactIndicators: string[] = []
    if (content.includes("import React") || content.includes("from 'react'") || content.includes('from "react"')) {
      reactIndicators.push("React import")
    }
    if (content.match(/function\s+\w+\s*\([^)]*\)\s*{[\s\S]*return\s*[(<]/)) {
      reactIndicators.push("JSX return")
    }
    if (content.includes("useState") || content.includes("useEffect") || content.includes("useContext")) {
      reactIndicators.push("React hooks usage")
    }
    if (content.match(/<\w+[\s/>]/)) {
      reactIndicators.push("JSX syntax")
    }
    if (reactIndicators.length >= 2) {
      patterns.push({
        pattern: "react-component",
        confidence: Math.min(1, reactIndicators.length * 0.3),
        indicators: reactIndicators,
      })
    }

    // React Hook detection
    if (content.match(/^export\s+(function|const)\s+use[A-Z]/m) || filePath.includes("/hooks/")) {
      patterns.push({
        pattern: "react-hook",
        confidence: 0.9,
        indicators: ["Custom hook pattern"],
      })
    }
  }

  // API Endpoint detection
  const apiIndicators: string[] = []
  if (lowerContent.includes("router.") || lowerContent.includes("app.get") || lowerContent.includes("app.post")) {
    apiIndicators.push("Route definitions")
  }
  if (lowerContent.includes("req.body") || lowerContent.includes("req.params") || lowerContent.includes("request.")) {
    apiIndicators.push("Request handling")
  }
  if (lowerContent.includes("res.json") || lowerContent.includes("res.send") || lowerContent.includes("response.")) {
    apiIndicators.push("Response handling")
  }
  if (lowerPath.includes("/api/") || lowerPath.includes("/routes/") || lowerPath.includes("/endpoints/")) {
    apiIndicators.push("API path")
  }
  if (apiIndicators.length >= 2) {
    patterns.push({
      pattern: "api-endpoint",
      confidence: Math.min(1, apiIndicators.length * 0.3),
      indicators: apiIndicators,
    })
  }

  // Database Model detection
  const dbIndicators: string[] = []
  if (lowerContent.includes("schema") || lowerContent.includes("model") || lowerContent.includes("entity")) {
    dbIndicators.push("Schema/Model definition")
  }
  if (lowerContent.includes("prisma") || lowerContent.includes("mongoose") || lowerContent.includes("typeorm")) {
    dbIndicators.push("ORM usage")
  }
  if (lowerContent.includes("@column") || lowerContent.includes("@entity") || lowerContent.includes("@table")) {
    dbIndicators.push("DB decorators")
  }
  if (dbIndicators.length >= 2) {
    patterns.push({
      pattern: "database-model",
      confidence: Math.min(1, dbIndicators.length * 0.35),
      indicators: dbIndicators,
    })
  }

  // Test Suite detection
  if (lowerPath.includes(".test.") || lowerPath.includes(".spec.") || lowerPath.includes("__tests__")) {
    const testIndicators: string[] = ["Test file path"]
    if (lowerContent.includes("describe(") || lowerContent.includes("it(") || lowerContent.includes("test(")) {
      testIndicators.push("Test blocks")
    }
    if (lowerContent.includes("expect(") || lowerContent.includes("assert")) {
      testIndicators.push("Assertions")
    }
    patterns.push({
      pattern: "test-suite",
      confidence: Math.min(1, testIndicators.length * 0.35),
      indicators: testIndicators,
    })
  }

  // Type Definitions detection
  if (lowerPath.includes(".d.ts") || lowerPath.includes("/types/") || lowerPath.includes("/interfaces/")) {
    patterns.push({
      pattern: "type-definitions",
      confidence: 0.9,
      indicators: ["Type definition file"],
    })
  } else if (content.match(/^(export\s+)?(interface|type)\s+\w+/gm)?.length || 0 > 3) {
    patterns.push({
      pattern: "type-definitions",
      confidence: 0.7,
      indicators: ["Multiple type exports"],
    })
  }

  // Middleware detection
  if (lowerContent.includes("middleware") || (lowerContent.includes("next(") && lowerContent.includes("req"))) {
    patterns.push({
      pattern: "middleware",
      confidence: 0.8,
      indicators: ["Middleware pattern"],
    })
  }

  // State Management detection
  if (
    lowerContent.includes("createstore") ||
    lowerContent.includes("createslice") ||
    lowerContent.includes("useReducer") ||
    lowerContent.includes("zustand") ||
    lowerContent.includes("recoil")
  ) {
    patterns.push({
      pattern: "state-management",
      confidence: 0.85,
      indicators: ["State management library"],
    })
  }

  // Service/Repository pattern
  if (lowerPath.includes("/services/") || lowerPath.includes("/repositories/")) {
    const patternType = lowerPath.includes("/services/") ? "service" : "repository"
    patterns.push({
      pattern: patternType,
      confidence: 0.85,
      indicators: [`${patternType} directory`],
    })
  }

  // Controller pattern
  if (lowerPath.includes("/controllers/") || lowerPath.includes("controller.")) {
    patterns.push({
      pattern: "controller",
      confidence: 0.85,
      indicators: ["Controller file"],
    })
  }

  // Config file detection
  if (lowerPath.includes("config") || lowerPath.endsWith(".config.ts") || lowerPath.endsWith(".config.js")) {
    patterns.push({
      pattern: "config-file",
      confidence: 0.9,
      indicators: ["Config file path"],
    })
  }

  // Utility function detection
  if (lowerPath.includes("/utils/") || lowerPath.includes("/helpers/") || lowerPath.includes("/lib/")) {
    patterns.push({
      pattern: "utility-function",
      confidence: 0.75,
      indicators: ["Utility directory"],
    })
  }

  return patterns.sort((a, b) => b.confidence - a.confidence)
}

// ============================================================================
// Semantic Importance Scoring
// ============================================================================

interface SemanticScore {
  score: number
  reasons: string[]
}

function calculateSemanticImportance(filePath: string, content: string, metadata: FileMetadata): SemanticScore {
  const reasons: string[] = []
  let score = 5 // Base score

  const lowerPath = filePath.toLowerCase()
  const lowerContent = content.toLowerCase()

  // High-value file patterns
  if (lowerPath.includes("config") || lowerPath.includes(".env") || lowerPath.includes("settings")) {
    score += 3
    reasons.push("configuration file")
  }

  if (lowerPath.includes("schema") || lowerPath.includes("types") || lowerPath.includes("interfaces")) {
    score += 2
    reasons.push("type definitions")
  }

  if (lowerPath.includes("api") || lowerPath.includes("routes") || lowerPath.includes("endpoints")) {
    score += 2
    reasons.push("API layer")
  }

  if (lowerPath.includes("auth") || lowerPath.includes("security") || lowerPath.includes("permission")) {
    score += 3
    reasons.push("security-related")
  }

  if (lowerPath.includes("test") || lowerPath.includes("spec") || lowerPath.includes("__test")) {
    score -= 1
    reasons.push("test file")
  }

  if (lowerPath.includes("generated") || lowerPath.includes(".d.ts")) {
    score -= 2
    reasons.push("generated/declaration file")
  }

  // Content-based scoring
  if (lowerContent.includes("export default") || lowerContent.includes("module.exports")) {
    score += 1
    reasons.push("module entry point")
  }

  if (lowerContent.includes("createcontext") || lowerContent.includes("provider")) {
    score += 2
    reasons.push("context provider")
  }

  if (lowerContent.includes("database") || lowerContent.includes("prisma") || lowerContent.includes("mongoose")) {
    score += 2
    reasons.push("database layer")
  }

  if (lowerContent.includes("error") && (lowerContent.includes("handler") || lowerContent.includes("catch"))) {
    score += 2
    reasons.push("error handling")
  }

  if (lowerContent.includes("middleware")) {
    score += 1
    reasons.push("middleware")
  }

  // Size-based adjustment
  if (metadata.lineCount > 500) {
    score += 1
    reasons.push("large file")
  }
  if (metadata.lineCount < 20) {
    score -= 1
    reasons.push("small file")
  }

  // Complexity indicators
  if (metadata.classes.length > 3 || metadata.functions.length > 15) {
    score += 1
    reasons.push("complex module")
  }

  // Entry point detection
  if (lowerPath.endsWith("index.ts") || lowerPath.endsWith("index.js") || lowerPath.endsWith("main.ts")) {
    score += 2
    reasons.push("entry point")
  }

  // Hook/plugin patterns
  if (lowerContent.includes("hook") || lowerContent.includes("plugin") || lowerContent.includes("extension")) {
    score += 1
    reasons.push("extensibility point")
  }

  return {
    score: Math.max(1, Math.min(10, score)), // Clamp between 1-10
    reasons,
  }
}

// ============================================================================
// Content Analysis (Enhanced)
// ============================================================================

function extractFileMetadata(filePath: string, content: string): FileMetadata {
  const lines = content.split("\n")
  const language = detectLanguage(filePath)

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
  }

  // Language-specific extraction
  if (["typescript", "javascript"].includes(language)) {
    extractJSMetadata(content, metadata)
  } else if (language === "python") {
    extractPythonMetadata(content, metadata)
  } else if (language === "go") {
    extractGoMetadata(content, metadata)
  } else if (language === "rust") {
    extractRustMetadata(content, metadata)
  }

  return metadata
}

function extractJSMetadata(content: string, metadata: FileMetadata): void {
  // Import patterns
  const importPatterns = [
    /import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+["']([^"']+)["']/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]

  for (const pattern of importPatterns) {
    const matches = content.matchAll(pattern)
    for (const match of matches) {
      if (!metadata.imports.includes(match[1])) {
        metadata.imports.push(match[1])
      }
    }
  }

  // Export patterns
  const exportPattern = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+(\w+)/g
  const exportMatches = content.matchAll(exportPattern)
  for (const match of exportMatches) {
    if (!metadata.exports.includes(match[1])) {
      metadata.exports.push(match[1])
    }
  }

  // Function patterns (improved)
  const funcPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/g,
    /(\w+)\s*(?::\s*\([^)]*\)\s*=>|=\s*async\s+function)/g,
  ]

  for (const pattern of funcPatterns) {
    const matches = content.matchAll(pattern)
    for (const match of matches) {
      if (!metadata.functions.includes(match[1]) && match[1] !== "async") {
        metadata.functions.push(match[1])
      }
    }
  }

  // Class patterns
  const classPattern = /class\s+(\w+)/g
  const classMatches = content.matchAll(classPattern)
  for (const match of classMatches) {
    if (!metadata.classes.includes(match[1])) {
      metadata.classes.push(match[1])
    }
  }

  // Namespace patterns (TypeScript)
  const namespacePattern = /(?:export\s+)?namespace\s+(\w+)/g
  const namespaceMatches = content.matchAll(namespacePattern)
  for (const match of namespaceMatches) {
    if (!metadata.namespaces.includes(match[1])) {
      metadata.namespaces.push(match[1])
    }
  }

  // Interface/Type patterns
  const typePattern = /(?:export\s+)?(?:interface|type)\s+(\w+)/g
  const typeMatches = content.matchAll(typePattern)
  for (const match of typeMatches) {
    if (!metadata.classes.includes(`type:${match[1]}`)) {
      metadata.classes.push(`type:${match[1]}`)
    }
  }
}

function extractPythonMetadata(content: string, metadata: FileMetadata): void {
  const importPatterns = [/^import\s+(\S+)/gm, /^from\s+(\S+)\s+import/gm]

  for (const pattern of importPatterns) {
    const matches = content.matchAll(pattern)
    for (const match of matches) {
      metadata.imports.push(match[1])
    }
  }

  const funcPattern = /^(?:async\s+)?def\s+(\w+)/gm
  const funcMatches = content.matchAll(funcPattern)
  for (const match of funcMatches) {
    metadata.functions.push(match[1])
  }

  const classPattern = /^class\s+(\w+)/gm
  const classMatches = content.matchAll(classPattern)
  for (const match of classMatches) {
    metadata.classes.push(match[1])
  }
}

function extractGoMetadata(content: string, metadata: FileMetadata): void {
  const importPattern = /import\s+(?:\(\s*)?["']([^"']+)["']/g
  const importMatches = content.matchAll(importPattern)
  for (const match of importMatches) {
    metadata.imports.push(match[1])
  }

  const funcPattern = /func\s+(?:\([^)]+\)\s+)?(\w+)/g
  const funcMatches = content.matchAll(funcPattern)
  for (const match of funcMatches) {
    metadata.functions.push(match[1])
  }

  const typePattern = /type\s+(\w+)\s+(?:struct|interface)/g
  const typeMatches = content.matchAll(typePattern)
  for (const match of typeMatches) {
    metadata.classes.push(match[1])
  }
}

function extractRustMetadata(content: string, metadata: FileMetadata): void {
  const usePattern = /use\s+([^;]+);/g
  const useMatches = content.matchAll(usePattern)
  for (const match of useMatches) {
    metadata.imports.push(match[1].trim())
  }

  const funcPattern = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g
  const funcMatches = content.matchAll(funcPattern)
  for (const match of funcMatches) {
    metadata.functions.push(match[1])
  }

  const structPattern = /(?:pub\s+)?(?:struct|enum|impl|trait)\s+(\w+)/g
  const structMatches = content.matchAll(structPattern)
  for (const match of structMatches) {
    metadata.classes.push(match[1])
  }
}

// ============================================================================
// Summary Generation (Enhanced - More Concise)
// ============================================================================

function generateFileSummary(filePath: string, content: string, metadata: FileMetadata): string {
  const parts: string[] = []

  // Compact header
  parts.push(`[${metadata.language}] ${filePath} (${metadata.lineCount}L)`)

  // Compact exports/classes/namespaces
  const exports = [...metadata.exports, ...metadata.namespaces].slice(0, 8)
  if (exports.length > 0) {
    parts.push(`Exports: ${exports.join(", ")}${metadata.exports.length > 8 ? "..." : ""}`)
  }

  // Compact types
  const types = metadata.classes.filter((c) => c.startsWith("type:")).map((c) => c.slice(5))
  const classes = metadata.classes.filter((c) => !c.startsWith("type:"))
  if (classes.length > 0 || types.length > 0) {
    const combined = [...classes.slice(0, 5), ...types.slice(0, 3)]
    parts.push(`Types: ${combined.join(", ")}${classes.length + types.length > 8 ? "..." : ""}`)
  }

  // Compact functions (only top 10)
  if (metadata.functions.length > 0) {
    const funcs = metadata.functions.slice(0, 10)
    parts.push(`Fn: ${funcs.join(", ")}${metadata.functions.length > 10 ? `(+${metadata.functions.length - 10})` : ""}`)
  }

  // Key imports (only local/relative)
  const localImports = metadata.imports.filter((i) => i.startsWith(".") || i.startsWith("@/") || i.startsWith("~/"))
  if (localImports.length > 0) {
    parts.push(`Deps: ${localImports.slice(0, 5).join(", ")}`)
  }

  return parts.join(" | ")
}

function generateToolOutputSummary(toolName: string, output: string, callID: string): string {
  const maxLen = 300

  // For file listings, just count
  if (toolName === "glob" || toolName === "Glob" || toolName === "ls" || toolName === "List") {
    const lines = output.split("\n").filter((l) => l.trim())
    return `${toolName}: ${lines.length} files found`
  }

  // For grep, count matches
  if (toolName === "grep" || toolName === "Grep") {
    const matchCount = (output.match(/Line \d+:/g) || []).length
    return `${toolName}: ${matchCount} matches`
  }

  // For bash, summarize exit status
  if (toolName === "bash" || toolName === "Bash") {
    const hasError = output.toLowerCase().includes("error") || output.toLowerCase().includes("failed")
    return `${toolName}: ${hasError ? "completed with errors" : "completed"} (${output.length} chars)`
  }

  // Default: very short
  if (output.length <= maxLen) {
    return `${toolName}: ${output.slice(0, 100)}...`
  }

  return `${toolName}: ${output.slice(0, 100)}... (${output.length} chars)`
}

// ============================================================================
// Token Estimation (Improved)
// ============================================================================

function estimateTokens(text: string): number {
  if (!text) return 0
  // More accurate: ~3.5 chars per token for code, ~4 for English
  return Math.ceil(text.length / 3.5)
}

// Unified time formatting utilities
function formatTimeAgo(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(mins: number): string {
  if (mins < 1) return "<1m"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`
}

// ============================================================================
// Database Manager (Enhanced)
// ============================================================================

class ContextDatabase {
  db: Database
  private config: ContextDrainConfig

  constructor(config: ContextDrainConfig) {
    this.config = config

    const dir = dirname(config.dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(config.dbPath)
    this.initSchema()
  }

  private initSchema(): void {
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
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_session ON memory(session_id, type, priority DESC)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id, type)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(session_id, key)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_accessed ON memory(accessed_at DESC)`)
    // Note: SQLite doesn't support expression indexes directly, so we use separate indexes
    // and compute effective priority (priority * decay_factor) at query time
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_priority ON memory(session_id, priority DESC)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_decay ON memory(session_id, decay_factor DESC)`)

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
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_working_session_loop ON working_memory(session_id, loop_id)`)

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
    `)

    // Decision log for important choices made
    this.db.run(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        context TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id, created_at DESC)`)

    // File relationships table for import/export tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_relationships (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source_file TEXT NOT NULL,
        target_file TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, source_file, target_file, relationship_type)
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_relationships_source ON file_relationships(session_id, source_file)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_relationships_target ON file_relationships(session_id, target_file)`)

    // Timeline events table for session history
    this.db.run(`
      CREATE TABLE IF NOT EXISTS timeline_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        loop_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_timeline_session ON timeline_events(session_id, created_at DESC)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_timeline_loop ON timeline_events(session_id, loop_id)`)

    // Context snapshots table for rollback capability
    this.db.run(`
      CREATE TABLE IF NOT EXISTS context_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        loop_id TEXT NOT NULL,
        snapshot_data TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        entry_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_session ON context_snapshots(session_id, created_at DESC)`)

    // Context evolution - track priority changes over time
    this.db.run(`
      CREATE TABLE IF NOT EXISTS context_evolution (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        file_key TEXT NOT NULL,
        priority_before REAL NOT NULL,
        priority_after REAL NOT NULL,
        decay_before REAL NOT NULL,
        decay_after REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_evolution_file ON context_evolution(session_id, file_key, created_at DESC)`,
    )

    // Context templates - reusable context configurations
    this.db.run(`
      CREATE TABLE IF NOT EXISTS context_templates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        files TEXT NOT NULL,
        focus_paths TEXT,
        patterns TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, name)
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_templates_project ON context_templates(project_id)`)
  }

  // -------------------------------------------------------------------------
  // Memory Operations
  // -------------------------------------------------------------------------

  store(entry: Omit<MemoryEntry, "id" | "decayFactor">): string {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

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
    )

    return id
  }

  get(sessionID: string, key: string): MemoryEntry | null {
    const row = this.db.query(`SELECT * FROM memory WHERE session_id = ? AND key = ?`).get(sessionID, key) as Record<
      string,
      unknown
    > | null

    if (!row) return null

    this.db.run(`UPDATE memory SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?`, [
      Date.now(),
      row.id as string,
    ])

    return this.rowToEntry(row)
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
      .all(sessionID, type, limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToEntry(row))
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
      .all(sessionID, limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToEntry(row))
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
      .all(sessionID) as Record<string, unknown>[]

    return rows.map((row) => this.rowToEntry(row))
  }

  getContextBudget(sessionID: string, maxTokens: number): MemoryEntry[] {
    const entries: MemoryEntry[] = []
    let tokenCount = 0

    const rows = this.db
      .query(
        `
      SELECT * FROM memory 
      WHERE session_id = ?
      ORDER BY (priority * decay_factor) DESC, accessed_at DESC
    `,
      )
      .all(sessionID) as Record<string, unknown>[]

    for (const row of rows) {
      const entry = this.rowToEntry(row)
      if (tokenCount + entry.tokenCount > maxTokens) {
        continue
      }
      entries.push(entry)
      tokenCount += entry.tokenCount
    }

    return entries
  }

  updatePriority(sessionID: string, key: string, priority: number, reason = "manual"): void {
    // Get current values for evolution tracking
    const current = this.db
      .query(`SELECT priority, decay_factor FROM memory WHERE session_id = ? AND key = ?`)
      .get(sessionID, key) as { priority: number; decay_factor: number } | null

    this.db.run(`UPDATE memory SET priority = ?, decay_factor = 1.0 WHERE session_id = ? AND key = ?`, [
      priority,
      sessionID,
      key,
    ])

    // Log evolution if there was a change
    if (current && Math.abs(current.priority - priority) > 0.1) {
      this.logEvolution(sessionID, key, current.priority, priority, current.decay_factor, 1.0, reason)
    }
  }

  // Apply decay to all entries (call at end of each loop)
  applyDecay(sessionID: string, decayRate: number): void {
    this.db.run(
      `
      UPDATE memory 
      SET decay_factor = MAX(0.1, decay_factor * ?)
      WHERE session_id = ? AND type != 'decision'
    `,
      [1 - decayRate, sessionID],
    )
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
    )

    return result.changes
  }

  // Proactive prune based on token budget
  proactivePrune(sessionID: string, maxTokens: number): number {
    let totalTokens = 0
    const rows = this.db
      .query(
        `
      SELECT id, token_count FROM memory 
      WHERE session_id = ?
      ORDER BY (priority * decay_factor) DESC, accessed_at DESC
    `,
      )
      .all(sessionID) as Array<{ id: string; token_count: number }>

    const toKeep: string[] = []
    for (const row of rows) {
      if (totalTokens + row.token_count <= maxTokens) {
        toKeep.push(row.id)
        totalTokens += row.token_count
      }
    }

    if (toKeep.length === rows.length) return 0

    const placeholders = toKeep.map(() => "?").join(",")
    const result = this.db.run(`DELETE FROM memory WHERE session_id = ? AND id NOT IN (${placeholders})`, [
      sessionID,
      ...toKeep,
    ])

    return result.changes
  }

  getTotalTokens(sessionID: string): number {
    const result = this.db
      .query(`SELECT SUM(token_count) as total FROM memory WHERE session_id = ?`)
      .get(sessionID) as { total: number | null }
    return result?.total || 0
  }

  getEntryCount(sessionID: string, type?: MemoryType): number {
    if (type) {
      const result = this.db
        .query(`SELECT COUNT(*) as count FROM memory WHERE session_id = ? AND type = ?`)
        .get(sessionID, type) as { count: number }
      return result?.count || 0
    }
    const result = this.db.query(`SELECT COUNT(*) as count FROM memory WHERE session_id = ?`).get(sessionID) as {
      count: number
    }
    return result?.count || 0
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
    const id = `wm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    this.db.run(
      `INSERT INTO working_memory (id, session_id, loop_id, file_path, summary, metadata, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionID, loopID, filePath, summary, JSON.stringify(metadata), priority, Date.now()],
    )

    return id
  }

  getWorkingMemory(
    sessionID: string,
    loopID: string,
  ): Array<{
    filePath: string
    summary: string
    metadata: Record<string, unknown>
  }> {
    const rows = this.db
      .query(
        `SELECT file_path, summary, metadata FROM working_memory WHERE session_id = ? AND loop_id = ? ORDER BY priority DESC, created_at DESC`,
      )
      .all(sessionID, loopID) as Array<{
      file_path: string
      summary: string
      metadata: string
    }>

    return rows.map((row) => ({
      filePath: row.file_path,
      summary: row.summary,
      metadata: JSON.parse(row.metadata),
    }))
  }

  clearWorkingMemory(sessionID: string, loopID?: string): void {
    if (loopID) {
      this.db.run(`DELETE FROM working_memory WHERE session_id = ? AND loop_id = ?`, [sessionID, loopID])
    } else {
      this.db.run(`DELETE FROM working_memory WHERE session_id = ?`, [sessionID])
    }
  }

  // -------------------------------------------------------------------------
  // Session Token Tracking
  // -------------------------------------------------------------------------

  getSessionTokens(sessionID: string): SessionTokenTracker | null {
    const row = this.db.query(`SELECT * FROM session_tokens WHERE session_id = ?`).get(sessionID) as Record<
      string,
      unknown
    > | null
    if (!row) return null

    return {
      sessionID: row.session_id as string,
      estimatedInputTokens: row.estimated_input_tokens as number,
      estimatedOutputTokens: row.estimated_output_tokens as number,
      lastModelLimit: row.last_model_limit as number,
      fileReadsThisLoop: row.file_reads_this_loop as number,
      toolCallsThisLoop: row.tool_calls_this_loop as number,
      loopCount: row.loop_count as number,
    }
  }

  updateSessionTokens(tracker: SessionTokenTracker): void {
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
    )
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
    )

    const result = this.db.query(`SELECT loop_count FROM session_tokens WHERE session_id = ?`).get(sessionID) as {
      loop_count: number
    }
    return result?.loop_count || 1
  }

  incrementFileReads(sessionID: string): void {
    this.db.run(`UPDATE session_tokens SET file_reads_this_loop = file_reads_this_loop + 1 WHERE session_id = ?`, [
      sessionID,
    ])
  }

  incrementToolCalls(sessionID: string): void {
    this.db.run(`UPDATE session_tokens SET tool_calls_this_loop = tool_calls_this_loop + 1 WHERE session_id = ?`, [
      sessionID,
    ])
  }

  // -------------------------------------------------------------------------
  // Decision Log
  // -------------------------------------------------------------------------

  logDecision(sessionID: string, decision: string, context?: string): void {
    const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    this.db.run(`INSERT INTO decisions (id, session_id, decision, context, created_at) VALUES (?, ?, ?, ?, ?)`, [
      id,
      sessionID,
      decision,
      context || null,
      Date.now(),
    ])
  }

  getRecentDecisions(sessionID: string, limit = 10): Array<{ decision: string; context?: string; createdAt: number }> {
    const rows = this.db
      .query(
        `SELECT decision, context, created_at FROM decisions WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sessionID, limit) as Array<{
      decision: string
      context: string | null
      created_at: number
    }>

    return rows.map((row) => ({
      decision: row.decision,
      context: row.context || undefined,
      createdAt: row.created_at,
    }))
  }

  // -------------------------------------------------------------------------
  // File Relationship Tracking
  // -------------------------------------------------------------------------

  storeRelationship(
    sessionID: string,
    sourceFile: string,
    targetFile: string,
    relationshipType: "imports" | "exports_to" | "extends" | "uses",
  ): void {
    const id = `rel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    this.db.run(
      `INSERT OR IGNORE INTO file_relationships (id, session_id, source_file, target_file, relationship_type, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, sessionID, sourceFile, targetFile, relationshipType, Date.now()],
    )
  }

  getRelatedFiles(
    sessionID: string,
    filePath: string,
  ): Array<{ file: string; relationship: string; direction: "incoming" | "outgoing" }> {
    const outgoing = this.db
      .query(`SELECT target_file, relationship_type FROM file_relationships WHERE session_id = ? AND source_file = ?`)
      .all(sessionID, filePath) as Array<{ target_file: string; relationship_type: string }>

    const incoming = this.db
      .query(`SELECT source_file, relationship_type FROM file_relationships WHERE session_id = ? AND target_file = ?`)
      .all(sessionID, filePath) as Array<{ source_file: string; relationship_type: string }>

    return [
      ...outgoing.map((r) => ({
        file: r.target_file,
        relationship: r.relationship_type,
        direction: "outgoing" as const,
      })),
      ...incoming.map((r) => ({
        file: r.source_file,
        relationship: r.relationship_type,
        direction: "incoming" as const,
      })),
    ]
  }

  getFileGraph(sessionID: string): Array<{ source: string; target: string; type: string }> {
    const rows = this.db
      .query(`SELECT source_file, target_file, relationship_type FROM file_relationships WHERE session_id = ?`)
      .all(sessionID) as Array<{ source_file: string; target_file: string; relationship_type: string }>

    return rows.map((r) => ({ source: r.source_file, target: r.target_file, type: r.relationship_type }))
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
      .all(projectID, limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToEntry(row))
  }

  // -------------------------------------------------------------------------
  // Database Statistics
  // -------------------------------------------------------------------------

  getStatistics(sessionID?: string): {
    totalMemoryEntries: number
    totalTokens: number
    entriesByType: Record<string, number>
    tokensByType: Record<string, number>
    avgPriority: number
    avgDecayFactor: number
    totalRelationships: number
    totalDecisions: number
    sessionsCount: number
    oldestEntry: number | null
    newestEntry: number | null
  } {
    const whereClause = sessionID ? `WHERE session_id = ?` : ""
    const params = sessionID ? [sessionID] : []

    // Entry counts by type
    const typeCountRows = this.db
      .query(`SELECT type, COUNT(*) as count, SUM(token_count) as tokens FROM memory ${whereClause} GROUP BY type`)
      .all(...params) as Array<{ type: string; count: number; tokens: number }>

    const entriesByType: Record<string, number> = {}
    const tokensByType: Record<string, number> = {}
    let totalMemoryEntries = 0
    let totalTokens = 0

    for (const row of typeCountRows) {
      entriesByType[row.type] = row.count
      tokensByType[row.type] = row.tokens || 0
      totalMemoryEntries += row.count
      totalTokens += row.tokens || 0
    }

    // Average priority and decay
    const avgRow = this.db
      .query(`SELECT AVG(priority) as avg_priority, AVG(decay_factor) as avg_decay FROM memory ${whereClause}`)
      .get(...params) as { avg_priority: number | null; avg_decay: number | null }

    // Relationships count
    const relCountRow = this.db
      .query(`SELECT COUNT(*) as count FROM file_relationships ${whereClause}`)
      .get(...params) as { count: number }

    // Decisions count
    const decCountRow = this.db.query(`SELECT COUNT(*) as count FROM decisions ${whereClause}`).get(...params) as {
      count: number
    }

    // Session count
    const sessionsRow = this.db.query(`SELECT COUNT(DISTINCT session_id) as count FROM memory`).get() as {
      count: number
    }

    // Time range
    const timeRow = this.db
      .query(`SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memory ${whereClause}`)
      .get(...params) as { oldest: number | null; newest: number | null }

    return {
      totalMemoryEntries,
      totalTokens,
      entriesByType,
      tokensByType,
      avgPriority: avgRow?.avg_priority || 0,
      avgDecayFactor: avgRow?.avg_decay || 1,
      totalRelationships: relCountRow?.count || 0,
      totalDecisions: decCountRow?.count || 0,
      sessionsCount: sessionsRow?.count || 0,
      oldestEntry: timeRow?.oldest || null,
      newestEntry: timeRow?.newest || null,
    }
  }

  // -------------------------------------------------------------------------
  // Search Functionality
  // -------------------------------------------------------------------------

  search(sessionID: string, query: string, limit = 20): MemoryEntry[] {
    const pattern = `%${query}%`
    const rows = this.db
      .query(
        `
        SELECT * FROM memory 
        WHERE session_id = ? AND (key LIKE ? OR summary LIKE ?)
        ORDER BY (priority * decay_factor) DESC, accessed_at DESC
        LIMIT ?
      `,
      )
      .all(sessionID, pattern, pattern, limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToEntry(row))
  }

  searchAll(query: string, limit = 50): MemoryEntry[] {
    const pattern = `%${query}%`
    const rows = this.db
      .query(
        `
        SELECT * FROM memory 
        WHERE key LIKE ? OR summary LIKE ?
        ORDER BY access_count DESC, accessed_at DESC
        LIMIT ?
      `,
      )
      .all(pattern, pattern, limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToEntry(row))
  }

  // -------------------------------------------------------------------------
  // Hot Files Detection
  // -------------------------------------------------------------------------

  getHotFiles(
    sessionID: string,
    limit = 10,
  ): Array<{
    file: string
    accessCount: number
    effectivePriority: number
    lastAccessed: number
    heatScore: number
  }> {
    const rows = this.db
      .query(
        `
        SELECT key, access_count, priority, decay_factor, accessed_at, created_at
        FROM memory 
        WHERE session_id = ? AND type = 'file'
        ORDER BY access_count DESC, (priority * decay_factor) DESC
        LIMIT ?
      `,
      )
      .all(sessionID, limit) as Array<{
      key: string
      access_count: number
      priority: number
      decay_factor: number
      accessed_at: number
      created_at: number
    }>

    return rows
      .map((row) => {
        // Heat score combines access frequency, priority, and recency
        const recencyFactor = Math.max(0.1, 1 - (Date.now() - row.accessed_at) / (3600000 * 2)) // 2 hour decay
        const heatScore = row.access_count * 2 + row.priority * row.decay_factor + recencyFactor * 3

        return {
          file: row.key,
          accessCount: row.access_count,
          effectivePriority: Math.round(row.priority * row.decay_factor * 100) / 100,
          lastAccessed: row.accessed_at,
          heatScore: Math.round(heatScore * 100) / 100,
        }
      })
      .sort((a, b) => b.heatScore - a.heatScore)
  }

  // -------------------------------------------------------------------------
  // Memory Aging Analytics
  // -------------------------------------------------------------------------

  getAgingAnalytics(sessionID: string): {
    totalEntries: number
    avgAge: number
    avgDecay: number
    staleEntries: number
    activeEntries: number
    decayDistribution: { fresh: number; aging: number; stale: number }
  } {
    const now = Date.now()
    const staleThreshold = 3600000 // 1 hour
    const activeThreshold = 300000 // 5 minutes

    const rows = this.db
      .query(`SELECT accessed_at, decay_factor FROM memory WHERE session_id = ?`)
      .all(sessionID) as Array<{ accessed_at: number; decay_factor: number }>

    if (rows.length === 0) {
      return {
        totalEntries: 0,
        avgAge: 0,
        avgDecay: 1,
        staleEntries: 0,
        activeEntries: 0,
        decayDistribution: { fresh: 0, aging: 0, stale: 0 },
      }
    }

    let totalAge = 0
    let totalDecay = 0
    let staleEntries = 0
    let activeEntries = 0
    const decayDistribution = { fresh: 0, aging: 0, stale: 0 }

    for (const row of rows) {
      const age = now - row.accessed_at
      totalAge += age
      totalDecay += row.decay_factor

      if (age > staleThreshold) staleEntries++
      if (age < activeThreshold) activeEntries++

      if (row.decay_factor > 0.7) decayDistribution.fresh++
      else if (row.decay_factor > 0.3) decayDistribution.aging++
      else decayDistribution.stale++
    }

    return {
      totalEntries: rows.length,
      avgAge: Math.round(totalAge / rows.length / 1000), // in seconds
      avgDecay: Math.round((totalDecay / rows.length) * 100) / 100,
      staleEntries,
      activeEntries,
      decayDistribution,
    }
  }

  // -------------------------------------------------------------------------
  // Context Compression
  // -------------------------------------------------------------------------

  compressSummaries(sessionID: string, maxTokensPerSummary = 200): number {
    const rows = this.db
      .query(`SELECT id, summary, token_count FROM memory WHERE session_id = ? AND token_count > ?`)
      .all(sessionID, maxTokensPerSummary) as Array<{ id: string; summary: string; token_count: number }>

    let compressed = 0
    for (const row of rows) {
      // Simple compression: take first portion up to token limit
      const targetChars = maxTokensPerSummary * 3.5
      if (row.summary.length > targetChars) {
        const compressedSummary = row.summary.slice(0, Math.floor(targetChars)) + "..."
        const newTokenCount = estimateTokens(compressedSummary)

        this.db.run(`UPDATE memory SET summary = ?, token_count = ? WHERE id = ?`, [
          compressedSummary,
          newTokenCount,
          row.id,
        ])
        compressed++
      }
    }

    return compressed
  }

  // -------------------------------------------------------------------------
  // Context Clusters Detection
  // -------------------------------------------------------------------------

  detectClusters(sessionID: string): Array<{
    name: string
    files: string[]
    totalTokens: number
    avgPriority: number
    pattern: string
  }> {
    const files = this.getByType(sessionID, "file", 100)
    if (files.length === 0) return []

    // Group by directory patterns
    const directoryGroups = new Map<string, MemoryEntry[]>()
    for (const file of files) {
      const parts = file.key.split("/")
      // Use first 2-3 directory levels as cluster key
      const clusterKey = parts.slice(0, Math.min(3, parts.length - 1)).join("/") || "root"

      if (!directoryGroups.has(clusterKey)) {
        directoryGroups.set(clusterKey, [])
      }
      directoryGroups.get(clusterKey)!.push(file)
    }

    // Group by semantic patterns
    const semanticPatterns = [
      { name: "API Layer", pattern: /(api|routes|endpoints|controllers)/i },
      { name: "Components", pattern: /(components|views|pages|screens)/i },
      { name: "Services", pattern: /(services|providers|adapters)/i },
      { name: "Utilities", pattern: /(utils|helpers|lib|common)/i },
      { name: "Types/Models", pattern: /(types|models|schemas|interfaces)/i },
      { name: "Tests", pattern: /(test|spec|__tests__|__mocks__)/i },
      { name: "Config", pattern: /(config|settings|env)/i },
      { name: "Database", pattern: /(db|database|prisma|migrations)/i },
    ]

    const clusters: Array<{
      name: string
      files: string[]
      totalTokens: number
      avgPriority: number
      pattern: string
    }> = []

    // Create clusters from directory groups (min 2 files)
    for (const [dir, entries] of directoryGroups) {
      if (entries.length >= 2) {
        const totalTokens = entries.reduce((sum, e) => sum + e.tokenCount, 0)
        const avgPriority = entries.reduce((sum, e) => sum + e.priority * e.decayFactor, 0) / entries.length

        // Find matching semantic pattern
        let patternMatch = "directory"
        for (const { name, pattern } of semanticPatterns) {
          if (pattern.test(dir)) {
            patternMatch = name
            break
          }
        }

        clusters.push({
          name: dir || "root",
          files: entries.map((e) => e.key),
          totalTokens,
          avgPriority: Math.round(avgPriority * 100) / 100,
          pattern: patternMatch,
        })
      }
    }

    // Sort by total tokens (most significant clusters first)
    return clusters.sort((a, b) => b.totalTokens - a.totalTokens)
  }

  // -------------------------------------------------------------------------
  // Context Health Score
  // -------------------------------------------------------------------------

  calculateHealthScore(sessionID: string): {
    score: number
    grade: "A" | "B" | "C" | "D" | "F"
    factors: Record<string, { score: number; weight: number; description: string }>
    recommendations: string[]
  } {
    const stats = this.getStatistics(sessionID)
    const aging = this.getAgingAnalytics(sessionID)
    const hotFiles = this.getHotFiles(sessionID, 5)
    const clusters = this.detectClusters(sessionID)

    const factors: Record<string, { score: number; weight: number; description: string }> = {}
    const recommendations: string[] = []

    // Factor 1: Budget utilization (optimal is 40-70%)
    const budgetPercent = (stats.totalTokens / 24000) * 100
    if (budgetPercent < 20) {
      factors.budget = { score: 60, weight: 0.2, description: "Under-utilized context" }
      recommendations.push("Context is under-utilized - explore more files")
    } else if (budgetPercent > 85) {
      factors.budget = { score: 40, weight: 0.2, description: "Near budget limit" }
      recommendations.push("Near token budget - consider compression or pruning")
    } else if (budgetPercent > 70) {
      factors.budget = { score: 70, weight: 0.2, description: "High utilization" }
    } else {
      factors.budget = { score: 100, weight: 0.2, description: "Optimal utilization" }
    }

    // Factor 2: Freshness (based on decay distribution)
    const freshPercent = aging.totalEntries > 0 ? (aging.decayDistribution.fresh / aging.totalEntries) * 100 : 100
    if (freshPercent > 70) {
      factors.freshness = { score: 100, weight: 0.25, description: "Context is fresh" }
    } else if (freshPercent > 40) {
      factors.freshness = { score: 70, weight: 0.25, description: "Moderate staleness" }
      recommendations.push("Some context is aging - re-read important files")
    } else {
      factors.freshness = { score: 40, weight: 0.25, description: "Context is stale" }
      recommendations.push("Context is stale - consider clearing old entries")
    }

    // Factor 3: Focus (hot files indicate good focus)
    const hotFileScore = hotFiles.length > 0 ? Math.min(100, hotFiles[0].heatScore * 10) : 50
    factors.focus = {
      score: hotFileScore,
      weight: 0.2,
      description: hotFiles.length > 0 ? "Good working focus" : "No clear focus",
    }

    // Factor 4: Organization (clusters indicate good structure)
    const clusterScore = clusters.length > 0 ? Math.min(100, 50 + clusters.length * 10) : 30
    factors.organization = {
      score: clusterScore,
      weight: 0.15,
      description: `${clusters.length} file clusters detected`,
    }

    // Factor 5: Relationship tracking
    const relationshipScore = stats.totalRelationships > 0 ? Math.min(100, 50 + stats.totalRelationships * 5) : 40
    factors.relationships = {
      score: relationshipScore,
      weight: 0.2,
      description: `${stats.totalRelationships} file relationships tracked`,
    }
    if (stats.totalRelationships === 0) {
      recommendations.push("No file relationships tracked yet")
    }

    // Calculate weighted score
    let totalScore = 0
    let totalWeight = 0
    for (const factor of Object.values(factors)) {
      totalScore += factor.score * factor.weight
      totalWeight += factor.weight
    }
    const finalScore = Math.round(totalScore / totalWeight)

    // Determine grade
    let grade: "A" | "B" | "C" | "D" | "F"
    if (finalScore >= 90) grade = "A"
    else if (finalScore >= 75) grade = "B"
    else if (finalScore >= 60) grade = "C"
    else if (finalScore >= 40) grade = "D"
    else grade = "F"

    return { score: finalScore, grade, factors, recommendations }
  }

  // -------------------------------------------------------------------------
  // Smart Pruning Recommendations
  // -------------------------------------------------------------------------

  getPruningRecommendations(
    sessionID: string,
    targetTokens?: number,
  ): {
    currentTokens: number
    targetTokens: number
    tokensToFree: number
    candidates: Array<{
      file: string
      tokens: number
      reason: string
      priority: number
    }>
  } {
    const stats = this.getStatistics(sessionID)
    const target = targetTokens || Math.floor(stats.totalTokens * 0.7)
    const tokensToFree = Math.max(0, stats.totalTokens - target)

    if (tokensToFree === 0) {
      return {
        currentTokens: stats.totalTokens,
        targetTokens: target,
        tokensToFree: 0,
        candidates: [],
      }
    }

    // Get all files sorted by effective priority (lowest first)
    const files = this.db
      .query(
        `
        SELECT key, token_count, priority, decay_factor, access_count, accessed_at
        FROM memory 
        WHERE session_id = ? AND type = 'file'
        ORDER BY (priority * decay_factor) ASC, accessed_at ASC
      `,
      )
      .all(sessionID) as Array<{
      key: string
      token_count: number
      priority: number
      decay_factor: number
      access_count: number
      accessed_at: number
    }>

    const candidates: Array<{
      file: string
      tokens: number
      reason: string
      priority: number
    }> = []

    let accumulated = 0
    const now = Date.now()

    for (const file of files) {
      if (accumulated >= tokensToFree) break

      const effectivePriority = file.priority * file.decay_factor
      const ageMinutes = Math.floor((now - file.accessed_at) / 60000)

      let reason: string
      if (file.decay_factor < 0.3) {
        reason = "Heavily decayed"
      } else if (ageMinutes > 60) {
        reason = `Stale (${ageMinutes}m old)`
      } else if (file.access_count === 1) {
        reason = "Single access"
      } else if (effectivePriority < 3) {
        reason = "Low priority"
      } else {
        reason = "Low relevance"
      }

      candidates.push({
        file: file.key,
        tokens: file.token_count,
        reason,
        priority: Math.round(effectivePriority * 100) / 100,
      })

      accumulated += file.token_count
    }

    return {
      currentTokens: stats.totalTokens,
      targetTokens: target,
      tokensToFree,
      candidates,
    }
  }

  // -------------------------------------------------------------------------
  // Timeline Events
  // -------------------------------------------------------------------------

  logTimelineEvent(
    sessionID: string,
    loopID: string,
    eventType: "file_read" | "file_write" | "tool_call" | "decision" | "compaction" | "prune" | "error",
    eventData: Record<string, unknown>,
  ): void {
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    this.db.run(
      `INSERT INTO timeline_events (id, session_id, loop_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, sessionID, loopID, eventType, JSON.stringify(eventData), Date.now()],
    )
  }

  getTimeline(
    sessionID: string,
    limit = 50,
  ): Array<{
    id: string
    loopID: string
    eventType: string
    eventData: Record<string, unknown>
    createdAt: number
  }> {
    const rows = this.db
      .query(`SELECT * FROM timeline_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(sessionID, limit) as Array<{
      id: string
      loop_id: string
      event_type: string
      event_data: string
      created_at: number
    }>

    return rows.map((row) => ({
      id: row.id,
      loopID: row.loop_id,
      eventType: row.event_type,
      eventData: JSON.parse(row.event_data),
      createdAt: row.created_at,
    }))
  }

  getTimelineByLoop(
    sessionID: string,
    loopID: string,
  ): Array<{
    eventType: string
    eventData: Record<string, unknown>
    createdAt: number
  }> {
    const rows = this.db
      .query(
        `SELECT event_type, event_data, created_at FROM timeline_events WHERE session_id = ? AND loop_id = ? ORDER BY created_at ASC`,
      )
      .all(sessionID, loopID) as Array<{
      event_type: string
      event_data: string
      created_at: number
    }>

    return rows.map((row) => ({
      eventType: row.event_type,
      eventData: JSON.parse(row.event_data),
      createdAt: row.created_at,
    }))
  }

  getTimelineSummary(sessionID: string): {
    totalEvents: number
    eventsByType: Record<string, number>
    eventsByLoop: Record<string, number>
    firstEvent: number | null
    lastEvent: number | null
  } {
    const typeRows = this.db
      .query(`SELECT event_type, COUNT(*) as count FROM timeline_events WHERE session_id = ? GROUP BY event_type`)
      .all(sessionID) as Array<{ event_type: string; count: number }>

    const loopRows = this.db
      .query(`SELECT loop_id, COUNT(*) as count FROM timeline_events WHERE session_id = ? GROUP BY loop_id`)
      .all(sessionID) as Array<{ loop_id: string; count: number }>

    const timeRow = this.db
      .query(`SELECT MIN(created_at) as first, MAX(created_at) as last FROM timeline_events WHERE session_id = ?`)
      .get(sessionID) as { first: number | null; last: number | null }

    const eventsByType: Record<string, number> = {}
    const eventsByLoop: Record<string, number> = {}
    let totalEvents = 0

    for (const row of typeRows) {
      eventsByType[row.event_type] = row.count
      totalEvents += row.count
    }

    for (const row of loopRows) {
      eventsByLoop[row.loop_id] = row.count
    }

    return {
      totalEvents,
      eventsByType,
      eventsByLoop,
      firstEvent: timeRow?.first || null,
      lastEvent: timeRow?.last || null,
    }
  }

  // -------------------------------------------------------------------------
  // Context Snapshots
  // -------------------------------------------------------------------------

  createSnapshot(sessionID: string, loopID: string): string {
    const entries = this.getAllForSession(sessionID)
    const stats = this.getStatistics(sessionID)

    const snapshotData = {
      entries: entries.map((e) => ({
        key: e.key,
        type: e.type,
        summary: e.summary,
        priority: e.priority,
        decayFactor: e.decayFactor,
        tokenCount: e.tokenCount,
      })),
      relationships: this.getFileGraph(sessionID),
      decisions: this.getRecentDecisions(sessionID, 20),
    }

    const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    this.db.run(
      `INSERT INTO context_snapshots (id, session_id, loop_id, snapshot_data, token_count, entry_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionID, loopID, JSON.stringify(snapshotData), stats.totalTokens, stats.totalMemoryEntries, Date.now()],
    )

    return id
  }

  getSnapshots(sessionID: string): Array<{
    id: string
    loopID: string
    tokenCount: number
    entryCount: number
    createdAt: number
  }> {
    const rows = this.db
      .query(
        `SELECT id, loop_id, token_count, entry_count, created_at FROM context_snapshots WHERE session_id = ? ORDER BY created_at DESC`,
      )
      .all(sessionID) as Array<{
      id: string
      loop_id: string
      token_count: number
      entry_count: number
      created_at: number
    }>

    return rows.map((row) => ({
      id: row.id,
      loopID: row.loop_id,
      tokenCount: row.token_count,
      entryCount: row.entry_count,
      createdAt: row.created_at,
    }))
  }

  getSnapshot(snapshotID: string): {
    entries: Array<{ key: string; type: string; summary: string; priority: number; tokenCount: number }>
    relationships: Array<{ source: string; target: string; type: string }>
    decisions: Array<{ decision: string; context?: string }>
  } | null {
    const row = this.db.query(`SELECT snapshot_data FROM context_snapshots WHERE id = ?`).get(snapshotID) as {
      snapshot_data: string
    } | null

    if (!row) return null
    return JSON.parse(row.snapshot_data)
  }

  restoreSnapshot(sessionID: string, snapshotID: string): { restored: number; errors: string[] } {
    const snapshot = this.getSnapshot(snapshotID)
    if (!snapshot) {
      return { restored: 0, errors: ["Snapshot not found"] }
    }

    // Clear current session data
    this.prune(sessionID, 0)

    const errors: string[] = []
    let restored = 0

    // Restore entries
    for (const entry of snapshot.entries) {
      try {
        this.store({
          sessionID,
          projectID: "", // Will be set from context
          type: entry.type as MemoryType,
          key: entry.key,
          summary: entry.summary,
          metadata: {},
          tokenCount: entry.tokenCount,
          priority: entry.priority,
          createdAt: Date.now(),
          accessedAt: Date.now(),
          accessCount: 1,
        })
        restored++
      } catch (e) {
        errors.push(`Failed to restore ${entry.key}: ${e}`)
      }
    }

    return { restored, errors }
  }

  compareSnapshots(
    snapshotID1: string,
    snapshotID2: string,
  ): {
    added: string[]
    removed: string[]
    changed: Array<{ key: string; oldPriority: number; newPriority: number }>
  } {
    const snap1 = this.getSnapshot(snapshotID1)
    const snap2 = this.getSnapshot(snapshotID2)

    if (!snap1 || !snap2) {
      return { added: [], removed: [], changed: [] }
    }

    const keys1 = new Map(snap1.entries.map((e) => [e.key, e]))
    const keys2 = new Map(snap2.entries.map((e) => [e.key, e]))

    const added: string[] = []
    const removed: string[] = []
    const changed: Array<{ key: string; oldPriority: number; newPriority: number }> = []

    // Find added and changed
    for (const [key, entry2] of keys2) {
      const entry1 = keys1.get(key)
      if (!entry1) {
        added.push(key)
      } else if (entry1.priority !== entry2.priority) {
        changed.push({ key, oldPriority: entry1.priority, newPriority: entry2.priority })
      }
    }

    // Find removed
    for (const key of keys1.keys()) {
      if (!keys2.has(key)) {
        removed.push(key)
      }
    }

    return { added, removed, changed }
  }

  // -------------------------------------------------------------------------
  // Context Prediction
  // -------------------------------------------------------------------------

  predictNextFiles(
    sessionID: string,
    limit = 5,
  ): Array<{
    file: string
    score: number
    reason: string
  }> {
    // Get current context
    const recentFiles = this.getRecentFiles(sessionID, 10)
    const relationships = this.getFileGraph(sessionID)
    const hotFiles = this.getHotFiles(sessionID, 5)

    if (recentFiles.length === 0) {
      return []
    }

    const predictions = new Map<string, { score: number; reasons: string[] }>()
    const currentFiles = new Set(recentFiles.map((f) => f.key))

    // Strategy 1: Files related to hot files (co-access pattern)
    for (const hot of hotFiles) {
      const related = relationships.filter((r) => r.source === hot.file || r.target === hot.file)
      for (const rel of related) {
        const targetFile = rel.source === hot.file ? rel.target : rel.source
        if (!currentFiles.has(targetFile)) {
          const existing = predictions.get(targetFile) || { score: 0, reasons: [] }
          existing.score += 3
          existing.reasons.push(`Related to hot file ${hot.file.split("/").pop()}`)
          predictions.set(targetFile, existing)
        }
      }
    }

    // Strategy 2: Files in same directory as recent files
    for (const file of recentFiles.slice(0, 5)) {
      const dir = file.key.split("/").slice(0, -1).join("/")

      // Look for other files in same cluster
      const clusters = this.detectClusters(sessionID)
      for (const cluster of clusters) {
        if (cluster.files.includes(file.key)) {
          for (const clusterFile of cluster.files) {
            if (!currentFiles.has(clusterFile)) {
              const existing = predictions.get(clusterFile) || { score: 0, reasons: [] }
              existing.score += 2
              existing.reasons.push(`Same cluster: ${cluster.name}`)
              predictions.set(clusterFile, existing)
            }
          }
        }
      }
    }

    // Strategy 3: Files imported by recent files but not yet read
    for (const file of recentFiles.slice(0, 5)) {
      const imports = relationships.filter((r) => r.source === file.key && r.type === "imports")
      for (const imp of imports) {
        if (!currentFiles.has(imp.target)) {
          const existing = predictions.get(imp.target) || { score: 0, reasons: [] }
          existing.score += 4
          existing.reasons.push(`Imported by ${file.key.split("/").pop()}`)
          predictions.set(imp.target, existing)
        }
      }
    }

    // Strategy 4: Common companion files (e.g., .test.ts for .ts files)
    for (const file of recentFiles.slice(0, 3)) {
      const companions = this.findCompanionFiles(file.key)
      for (const companion of companions) {
        if (!currentFiles.has(companion.path)) {
          const existing = predictions.get(companion.path) || { score: 0, reasons: [] }
          existing.score += companion.score
          existing.reasons.push(companion.reason)
          predictions.set(companion.path, existing)
        }
      }
    }

    // Convert to sorted array
    return Array.from(predictions.entries())
      .map(([file, data]) => ({
        file,
        score: data.score,
        reason: data.reasons[0] || "Pattern match",
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  private findCompanionFiles(filePath: string): Array<{ path: string; score: number; reason: string }> {
    const companions: Array<{ path: string; score: number; reason: string }> = []
    const baseName = filePath.replace(/\.[^/.]+$/, "")
    const ext = filePath.split(".").pop() || ""
    const dir = filePath.split("/").slice(0, -1).join("/")

    // Test file companions
    if (!filePath.includes(".test.") && !filePath.includes(".spec.")) {
      companions.push({ path: `${baseName}.test.${ext}`, score: 2, reason: "Test file" })
      companions.push({ path: `${baseName}.spec.${ext}`, score: 2, reason: "Spec file" })
      // Also check __tests__ directory pattern
      const fileName = filePath.split("/").pop() || ""
      companions.push({ path: `${dir}/__tests__/${fileName}`, score: 2, reason: "Test directory" })
    }

    // Type definition companions
    if (ext === "ts" || ext === "tsx") {
      companions.push({ path: `${baseName}.types.ts`, score: 1, reason: "Types file" })
      companions.push({ path: `${baseName}.d.ts`, score: 1, reason: "Declaration file" })
    }

    // Index file companion
    if (!filePath.endsWith("index.ts") && !filePath.endsWith("index.js")) {
      companions.push({ path: `${dir}/index.${ext}`, score: 1, reason: "Index file" })
    }

    // CSS/Style companions
    if (ext === "tsx" || ext === "jsx") {
      companions.push({ path: `${baseName}.css`, score: 1, reason: "Styles" })
      companions.push({ path: `${baseName}.module.css`, score: 1, reason: "CSS Module" })
      companions.push({ path: `${baseName}.scss`, score: 1, reason: "SCSS styles" })
      companions.push({ path: `${baseName}.styled.ts`, score: 1, reason: "Styled components" })
    }

    // Storybook companions
    if (ext === "tsx" || ext === "jsx") {
      companions.push({ path: `${baseName}.stories.${ext}`, score: 1, reason: "Storybook" })
      companions.push({ path: `${baseName}.stories.mdx`, score: 1, reason: "Storybook MDX" })
    }

    // Mock companions
    if (!filePath.includes(".mock.") && !filePath.includes("__mocks__")) {
      companions.push({ path: `${baseName}.mock.${ext}`, score: 1, reason: "Mock file" })
      const fileName = filePath.split("/").pop() || ""
      companions.push({ path: `${dir}/__mocks__/${fileName}`, score: 1, reason: "Mock directory" })
    }

    // Hook companions (if it's a component, check for related hook)
    if (ext === "tsx" && !baseName.includes("use")) {
      const componentName = baseName.split("/").pop() || ""
      companions.push({ path: `${dir}/use${componentName}.ts`, score: 1, reason: "Related hook" })
    }

    // Constants/config companions
    companions.push({ path: `${dir}/constants.ts`, score: 0.5, reason: "Constants" })
    companions.push({ path: `${dir}/config.ts`, score: 0.5, reason: "Config" })

    return companions
  }

  // -------------------------------------------------------------------------
  // Session Analytics
  // -------------------------------------------------------------------------

  getSessionAnalytics(sessionID: string): {
    duration: { start: number; end: number; totalMinutes: number }
    activity: { totalEvents: number; filesRead: number; filesWritten: number; toolCalls: number }
    efficiency: { avgAccessesPerFile: number; reuseRate: number; compressionRate: number }
    focus: { primaryCluster: string | null; focusScore: number }
  } {
    const timeline = this.getTimelineSummary(sessionID)
    const stats = this.getStatistics(sessionID)
    const files = this.getByType(sessionID, "file", 100)
    const clusters = this.detectClusters(sessionID)
    const health = this.calculateHealthScore(sessionID)

    // Duration
    const start = timeline.firstEvent || Date.now()
    const end = timeline.lastEvent || Date.now()
    const totalMinutes = Math.round((end - start) / 60000)

    // Activity counts
    const filesRead = timeline.eventsByType["file_read"] || 0
    const filesWritten = timeline.eventsByType["file_write"] || 0
    const toolCalls = timeline.eventsByType["tool_call"] || 0

    // Efficiency metrics
    const totalAccesses = files.reduce((sum, f) => sum + f.accessCount, 0)
    const avgAccessesPerFile = files.length > 0 ? Math.round((totalAccesses / files.length) * 10) / 10 : 0
    const multiAccessFiles = files.filter((f) => f.accessCount > 1).length
    const reuseRate = files.length > 0 ? Math.round((multiAccessFiles / files.length) * 100) : 0

    // Compression rate (how much we've saved vs raw file storage)
    const estimatedRawTokens = files.reduce((sum, f) => {
      const meta = f.metadata as { lineCount?: number }
      return sum + (meta.lineCount || 100) * 5 // Rough estimate
    }, 0)
    const compressionRate = estimatedRawTokens > 0 ? Math.round((1 - stats.totalTokens / estimatedRawTokens) * 100) : 0

    // Focus analysis
    const primaryCluster = clusters.length > 0 ? clusters[0].name : null
    const focusScore = health.factors.focus?.score || 0

    return {
      duration: { start, end, totalMinutes },
      activity: { totalEvents: timeline.totalEvents, filesRead, filesWritten, toolCalls },
      efficiency: { avgAccessesPerFile, reuseRate, compressionRate },
      focus: { primaryCluster, focusScore },
    }
  }

  // -------------------------------------------------------------------------
  // Garbage Collection
  // -------------------------------------------------------------------------

  garbageCollect(maxAgeDays = 7): {
    sessionsRemoved: number
    entriesRemoved: number
    snapshotsRemoved: number
    eventsRemoved: number
  } {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

    // Find old sessions
    const oldSessions = this.db
      .query(`SELECT DISTINCT session_id FROM memory WHERE accessed_at < ?`)
      .all(cutoff) as Array<{ session_id: string }>

    let entriesRemoved = 0
    let snapshotsRemoved = 0
    let eventsRemoved = 0

    for (const { session_id } of oldSessions) {
      // Remove memory entries
      const memResult = this.db.run(`DELETE FROM memory WHERE session_id = ?`, [session_id])
      entriesRemoved += memResult.changes

      // Remove snapshots
      const snapResult = this.db.run(`DELETE FROM context_snapshots WHERE session_id = ?`, [session_id])
      snapshotsRemoved += snapResult.changes

      // Remove timeline events
      const eventResult = this.db.run(`DELETE FROM timeline_events WHERE session_id = ?`, [session_id])
      eventsRemoved += eventResult.changes

      // Remove relationships
      this.db.run(`DELETE FROM file_relationships WHERE session_id = ?`, [session_id])

      // Remove decisions
      this.db.run(`DELETE FROM decisions WHERE session_id = ?`, [session_id])

      // Remove working memory
      this.db.run(`DELETE FROM working_memory WHERE session_id = ?`, [session_id])

      // Remove session tokens
      this.db.run(`DELETE FROM session_tokens WHERE session_id = ?`, [session_id])
    }

    return {
      sessionsRemoved: oldSessions.length,
      entriesRemoved,
      snapshotsRemoved,
      eventsRemoved,
    }
  }

  getDatabaseSize(): { tables: Record<string, number>; totalRows: number } {
    const tables: Record<string, number> = {}
    const tableNames = [
      "memory",
      "working_memory",
      "session_tokens",
      "decisions",
      "file_relationships",
      "timeline_events",
      "context_snapshots",
    ]

    let totalRows = 0
    for (const table of tableNames) {
      const result = this.db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
      tables[table] = result?.count || 0
      totalRows += tables[table]
    }

    return { tables, totalRows }
  }

  // -------------------------------------------------------------------------
  // Context Focus Mode
  // -------------------------------------------------------------------------

  setFocusMode(sessionID: string, focusPaths: string[]): void {
    // Boost priority for files matching focus paths
    for (const path of focusPaths) {
      const pattern = `%${path}%`
      this.db.run(
        `UPDATE memory SET priority = MIN(10, priority + 3), decay_factor = 1.0 WHERE session_id = ? AND key LIKE ?`,
        [sessionID, pattern],
      )
    }

    // Log the focus decision
    this.logDecision(sessionID, `Focus mode set: ${focusPaths.join(", ")}`)
    this.logTimelineEvent(sessionID, "loop_0", "decision", { action: "focus_mode", paths: focusPaths })
  }

  getFocusedFiles(sessionID: string, threshold = 7): MemoryEntry[] {
    const rows = this.db
      .query(
        `
        SELECT * FROM memory 
        WHERE session_id = ? AND type = 'file' AND (priority * decay_factor) >= ?
        ORDER BY (priority * decay_factor) DESC
      `,
      )
      .all(sessionID, threshold) as Record<string, unknown>[]

    return rows.map((row) => this.rowToEntry(row))
  }

  // -------------------------------------------------------------------------
  // Context Similarity
  // -------------------------------------------------------------------------

  calculateSimilarity(entry1: MemoryEntry, entry2: MemoryEntry): number {
    let score = 0
    const meta1 = entry1.metadata as Record<string, unknown>
    const meta2 = entry2.metadata as Record<string, unknown>

    // Same language
    if (meta1.language === meta2.language) score += 0.2

    // Same directory
    const dir1 = entry1.key.split("/").slice(0, -1).join("/")
    const dir2 = entry2.key.split("/").slice(0, -1).join("/")
    if (dir1 === dir2) score += 0.3

    // Shared imports
    const imports1 = new Set((meta1.imports as string[]) || [])
    const imports2 = new Set((meta2.imports as string[]) || [])
    const sharedImports = [...imports1].filter((i) => imports2.has(i)).length
    if (sharedImports > 0) score += Math.min(0.3, sharedImports * 0.1)

    // Shared code patterns
    const patterns1 = ((meta1.codePatterns as Array<{ pattern: string }>) || []).map((p) => p.pattern)
    const patterns2 = ((meta2.codePatterns as Array<{ pattern: string }>) || []).map((p) => p.pattern)
    const sharedPatterns = patterns1.filter((p) => patterns2.includes(p)).length
    if (sharedPatterns > 0) score += Math.min(0.2, sharedPatterns * 0.1)

    return Math.min(1, score)
  }

  findSimilarFiles(
    sessionID: string,
    filePath: string,
    limit = 5,
  ): Array<{
    file: string
    similarity: number
  }> {
    const targetEntry = this.get(sessionID, filePath)
    if (!targetEntry) return []

    const allFiles = this.getByType(sessionID, "file", 100)
    const similarities: Array<{ file: string; similarity: number }> = []

    for (const file of allFiles) {
      if (file.key === filePath) continue
      const similarity = this.calculateSimilarity(targetEntry, file)
      if (similarity > 0.2) {
        similarities.push({ file: file.key, similarity: Math.round(similarity * 100) / 100 })
      }
    }

    return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
  }

  getFilesByPattern(sessionID: string, pattern: CodePattern): MemoryEntry[] {
    const files = this.getByType(sessionID, "file", 100)
    return files.filter((f) => {
      const patterns = ((f.metadata as Record<string, unknown>).codePatterns as Array<{ pattern: string }>) || []
      return patterns.some((p) => p.pattern === pattern)
    })
  }

  // -------------------------------------------------------------------------
  // Context Bookmarks
  // -------------------------------------------------------------------------

  createBookmark(sessionID: string, name: string, fileKeys: string[], notes?: string): string {
    const id = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // Store as a special decision entry
    this.logDecision(sessionID, `BOOKMARK:${id}:${name}`, JSON.stringify({ files: fileKeys, notes }))

    return id
  }

  getBookmarks(sessionID: string): Array<{
    id: string
    name: string
    files: string[]
    notes?: string
    createdAt: number
  }> {
    const decisions = this.db
      .query(
        `SELECT decision, context, created_at FROM decisions WHERE session_id = ? AND decision LIKE 'BOOKMARK:%' ORDER BY created_at DESC`,
      )
      .all(sessionID) as Array<{ decision: string; context: string | null; created_at: number }>

    return decisions.map((d) => {
      const parts = d.decision.split(":")
      const id = parts[1]
      const name = parts.slice(2).join(":")
      const data = d.context ? JSON.parse(d.context) : { files: [], notes: undefined }

      return {
        id,
        name,
        files: data.files || [],
        notes: data.notes,
        createdAt: d.created_at,
      }
    })
  }

  restoreBookmark(sessionID: string, bookmarkId: string): number {
    const bookmarks = this.getBookmarks(sessionID)
    const bookmark = bookmarks.find((b) => b.id === bookmarkId)

    if (!bookmark) return 0

    // Boost priority for bookmarked files
    let restored = 0
    for (const file of bookmark.files) {
      const result = this.db.run(
        `UPDATE memory SET priority = MIN(10, priority + 2), decay_factor = 1.0 WHERE session_id = ? AND key = ?`,
        [sessionID, file],
      )
      restored += result.changes
    }

    this.logTimelineEvent(sessionID, "loop_0", "decision", {
      action: "restore_bookmark",
      bookmark: bookmark.name,
      files: bookmark.files.length,
    })

    return restored
  }

  // -------------------------------------------------------------------------
  // Context Insights
  // -------------------------------------------------------------------------

  generateInsights(sessionID: string): {
    observations: Array<{ type: string; message: string; severity: "info" | "warning" | "suggestion" }>
    suggestions: string[]
    score: number
  } {
    const observations: Array<{ type: string; message: string; severity: "info" | "warning" | "suggestion" }> = []
    const suggestions: string[] = []

    const stats = this.getStatistics(sessionID)
    const health = this.calculateHealthScore(sessionID)
    const aging = this.getAgingAnalytics(sessionID)
    const hotFiles = this.getHotFiles(sessionID, 5)
    const clusters = this.detectClusters(sessionID)
    const timeline = this.getTimelineSummary(sessionID)

    // Budget observations
    const budgetPercent = (stats.totalTokens / 24000) * 100
    if (budgetPercent > 85) {
      observations.push({
        type: "budget",
        message: `Token budget at ${budgetPercent.toFixed(0)}% - approaching limit`,
        severity: "warning",
      })
      suggestions.push("Run context-compress to reduce token usage")
      suggestions.push("Use context-prune-suggest to identify files to remove")
    } else if (budgetPercent > 70) {
      observations.push({
        type: "budget",
        message: `Token budget at ${budgetPercent.toFixed(0)}% - consider optimization`,
        severity: "info",
      })
    }

    // Freshness observations
    if (aging.decayDistribution.stale > aging.decayDistribution.fresh) {
      observations.push({
        type: "freshness",
        message: `More stale entries (${aging.decayDistribution.stale}) than fresh (${aging.decayDistribution.fresh})`,
        severity: "warning",
      })
      suggestions.push("Re-read important files to refresh their priority")
    }

    // Focus observations
    if (hotFiles.length === 0) {
      observations.push({
        type: "focus",
        message: "No clear working focus detected",
        severity: "info",
      })
      suggestions.push("Use context-focus to set focus on specific directories")
    } else if (hotFiles[0].heatScore > 15) {
      observations.push({
        type: "focus",
        message: `Strong focus on ${hotFiles[0].file.split("/").pop()} (heat: ${hotFiles[0].heatScore})`,
        severity: "info",
      })
    }

    // Cluster observations
    if (clusters.length === 0 && stats.totalMemoryEntries > 10) {
      observations.push({
        type: "organization",
        message: "Files are scattered - no clear clusters detected",
        severity: "info",
      })
      suggestions.push("Files seem unrelated - consider if all are needed")
    } else if (clusters.length > 5) {
      observations.push({
        type: "organization",
        message: `Working across ${clusters.length} different areas`,
        severity: "info",
      })
    }

    // Activity observations
    const readsPerWrite = timeline.eventsByType["file_read"] / (timeline.eventsByType["file_write"] || 1)
    if (readsPerWrite > 10) {
      observations.push({
        type: "activity",
        message: `High read-to-write ratio (${readsPerWrite.toFixed(1)}:1) - lots of exploration`,
        severity: "info",
      })
    }

    // Relationship observations
    if (stats.totalRelationships === 0 && stats.totalMemoryEntries > 5) {
      observations.push({
        type: "relationships",
        message: "No file relationships tracked - import analysis may help",
        severity: "suggestion",
      })
      suggestions.push("Use context-graph to see file dependencies")
    }

    // Pattern observations
    const files = this.getByType(sessionID, "file", 100)
    const patternCounts = new Map<string, number>()
    for (const file of files) {
      const patterns = ((file.metadata as Record<string, unknown>).codePatterns as Array<{ pattern: string }>) || []
      for (const p of patterns) {
        patternCounts.set(p.pattern, (patternCounts.get(p.pattern) || 0) + 1)
      }
    }

    const dominantPattern = [...patternCounts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (dominantPattern && dominantPattern[1] >= 3) {
      observations.push({
        type: "patterns",
        message: `Dominant pattern: ${dominantPattern[0]} (${dominantPattern[1]} files)`,
        severity: "info",
      })
    }

    // Calculate insight score (higher is better context quality)
    let score = health.score
    if (observations.filter((o) => o.severity === "warning").length > 2) {
      score -= 10
    }
    if (suggestions.length > 3) {
      score -= 5
    }

    return {
      observations,
      suggestions: [...new Set(suggestions)], // Dedupe
      score: Math.max(0, Math.min(100, score)),
    }
  }

  // -------------------------------------------------------------------------
  // Session Comparison
  // -------------------------------------------------------------------------

  listSessions(limit = 20): Array<{
    sessionID: string
    entryCount: number
    tokenCount: number
    lastAccessed: number
  }> {
    const rows = this.db
      .query(
        `
        SELECT session_id, COUNT(*) as count, SUM(token_count) as tokens, MAX(accessed_at) as last_accessed
        FROM memory
        GROUP BY session_id
        ORDER BY last_accessed DESC
        LIMIT ?
      `,
      )
      .all(limit) as Array<{
      session_id: string
      count: number
      tokens: number
      last_accessed: number
    }>

    return rows.map((r) => ({
      sessionID: r.session_id,
      entryCount: r.count,
      tokenCount: r.tokens || 0,
      lastAccessed: r.last_accessed,
    }))
  }

  compareSessions(
    sessionID1: string,
    sessionID2: string,
  ): {
    session1: { files: number; tokens: number; patterns: string[] }
    session2: { files: number; tokens: number; patterns: string[] }
    sharedFiles: string[]
    uniqueToSession1: string[]
    uniqueToSession2: string[]
  } {
    const files1 = this.getByType(sessionID1, "file", 100)
    const files2 = this.getByType(sessionID2, "file", 100)

    const keys1 = new Set(files1.map((f) => f.key))
    const keys2 = new Set(files2.map((f) => f.key))

    const sharedFiles = [...keys1].filter((k) => keys2.has(k))
    const uniqueToSession1 = [...keys1].filter((k) => !keys2.has(k))
    const uniqueToSession2 = [...keys2].filter((k) => !keys1.has(k))

    const getPatterns = (files: MemoryEntry[]): string[] => {
      const patterns = new Set<string>()
      for (const f of files) {
        const ps = ((f.metadata as Record<string, unknown>).codePatterns as Array<{ pattern: string }>) || []
        ps.forEach((p) => patterns.add(p.pattern))
      }
      return [...patterns]
    }

    return {
      session1: {
        files: files1.length,
        tokens: files1.reduce((sum, f) => sum + f.tokenCount, 0),
        patterns: getPatterns(files1),
      },
      session2: {
        files: files2.length,
        tokens: files2.reduce((sum, f) => sum + f.tokenCount, 0),
        patterns: getPatterns(files2),
      },
      sharedFiles,
      uniqueToSession1,
      uniqueToSession2,
    }
  }

  // -------------------------------------------------------------------------
  // Context Optimization
  // -------------------------------------------------------------------------

  autoOptimize(sessionID: string): {
    actions: string[]
    tokensSaved: number
    entriesRemoved: number
  } {
    const actions: string[] = []
    let tokensSaved = 0
    let entriesRemoved = 0
    const beforeStats = this.getStatistics(sessionID)

    // Step 1: Compress large summaries
    const compressed = this.compressSummaries(sessionID, 150)
    if (compressed > 0) {
      actions.push(`Compressed ${compressed} large summaries`)
    }

    // Step 2: Remove heavily decayed entries
    const decayedResult = this.db.run(
      `DELETE FROM memory WHERE session_id = ? AND decay_factor < 0.2 AND access_count < 2`,
      [sessionID],
    )
    if (decayedResult.changes > 0) {
      actions.push(`Removed ${decayedResult.changes} heavily decayed entries`)
      entriesRemoved += decayedResult.changes
    }

    // Step 3: Remove duplicate tool outputs (keep only recent)
    const toolOutputs = this.getByType(sessionID, "tool_output", 100)
    if (toolOutputs.length > 20) {
      const toRemove = toolOutputs.slice(20)
      for (const entry of toRemove) {
        this.db.run(`DELETE FROM memory WHERE id = ?`, [entry.id])
        entriesRemoved++
      }
      actions.push(`Removed ${toRemove.length} old tool outputs`)
    }

    // Step 4: Consolidate low-priority files in same directory
    const files = this.getByType(sessionID, "file", 100)
    const dirCounts = new Map<string, number>()
    for (const f of files) {
      const dir = f.key.split("/").slice(0, -1).join("/")
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1)
    }

    for (const [dir, count] of dirCounts) {
      if (count > 5) {
        // Keep only top 5 priority files per directory
        const dirFiles = files
          .filter((f) => f.key.startsWith(dir + "/"))
          .sort((a, b) => b.priority * b.decayFactor - a.priority * a.decayFactor)

        const toRemove = dirFiles.slice(5)
        for (const f of toRemove) {
          if (f.priority * f.decayFactor < 3) {
            this.db.run(`DELETE FROM memory WHERE id = ?`, [f.id])
            entriesRemoved++
          }
        }
        if (toRemove.length > 0) {
          actions.push(`Consolidated ${dir}: kept top 5 of ${count} files`)
        }
      }
    }

    const afterStats = this.getStatistics(sessionID)
    tokensSaved = beforeStats.totalTokens - afterStats.totalTokens

    if (actions.length === 0) {
      actions.push("Context already optimized - no changes needed")
    }

    this.logTimelineEvent(sessionID, getCurrentLoopID(sessionID), "decision", {
      action: "auto_optimize",
      tokensSaved,
      entriesRemoved,
    })

    return { actions, tokensSaved, entriesRemoved }
  }

  // -------------------------------------------------------------------------
  // Loop Diff - Compare context between loops
  // -------------------------------------------------------------------------

  getLoopDiff(
    sessionID: string,
    loopId1?: string,
    loopId2?: string,
  ): {
    loop1: string
    loop2: string
    added: Array<{ file: string; priority: number }>
    removed: Array<{ file: string; priority: number }>
    priorityChanges: Array<{ file: string; oldPriority: number; newPriority: number }>
    tokenDelta: number
  } {
    // Get snapshots for the loops
    const snapshots = this.db
      .query(
        `SELECT id, loop_id, snapshot_data, token_count FROM context_snapshots WHERE session_id = ? ORDER BY created_at DESC LIMIT 10`,
      )
      .all(sessionID) as Array<{ id: string; loop_id: string; snapshot_data: string; token_count: number }>

    if (snapshots.length < 2) {
      return {
        loop1: loopId1 || "unknown",
        loop2: loopId2 || "current",
        added: [],
        removed: [],
        priorityChanges: [],
        tokenDelta: 0,
      }
    }

    // Default to comparing last two snapshots
    const snap1 = loopId1 ? snapshots.find((s) => s.loop_id === loopId1) : snapshots[1]
    const snap2 = loopId2 ? snapshots.find((s) => s.loop_id === loopId2) : snapshots[0]

    if (!snap1 || !snap2) {
      return {
        loop1: loopId1 || "unknown",
        loop2: loopId2 || "current",
        added: [],
        removed: [],
        priorityChanges: [],
        tokenDelta: 0,
      }
    }

    const entries1 = JSON.parse(snap1.snapshot_data) as Array<{ key: string; priority: number; type: string }>
    const entries2 = JSON.parse(snap2.snapshot_data) as Array<{ key: string; priority: number; type: string }>

    const map1 = new Map(entries1.filter((e) => e.type === "file").map((e) => [e.key, e.priority]))
    const map2 = new Map(entries2.filter((e) => e.type === "file").map((e) => [e.key, e.priority]))

    const added: Array<{ file: string; priority: number }> = []
    const removed: Array<{ file: string; priority: number }> = []
    const priorityChanges: Array<{ file: string; oldPriority: number; newPriority: number }> = []

    // Find added files (in loop2 but not in loop1)
    for (const [file, priority] of map2) {
      if (!map1.has(file)) {
        added.push({ file, priority })
      } else {
        const oldPriority = map1.get(file)!
        if (Math.abs(oldPriority - priority) > 0.5) {
          priorityChanges.push({ file, oldPriority, newPriority: priority })
        }
      }
    }

    // Find removed files (in loop1 but not in loop2)
    for (const [file, priority] of map1) {
      if (!map2.has(file)) {
        removed.push({ file, priority })
      }
    }

    return {
      loop1: snap1.loop_id,
      loop2: snap2.loop_id,
      added,
      removed,
      priorityChanges,
      tokenDelta: (snap2.token_count || 0) - (snap1.token_count || 0),
    }
  }

  // -------------------------------------------------------------------------
  // Public Companion Files - Find related files (tests, types, styles)
  // -------------------------------------------------------------------------

  getCompanionFiles(
    sessionID: string,
    filePath: string,
  ): Array<{ path: string; exists: boolean; score: number; reason: string }> {
    const companions = this.findCompanionFiles(filePath)
    const existingFiles = new Set(this.getByType(sessionID, "file", 200).map((f) => f.key))

    return companions.map((c) => ({
      ...c,
      exists: existingFiles.has(c.path) || [...existingFiles].some((f) => f.endsWith(c.path.split("/").pop() || "")),
    }))
  }

  // -------------------------------------------------------------------------
  // Apply Pruning - Actually delete pruning candidates
  // -------------------------------------------------------------------------

  applyPruning(sessionID: string, targetTokens?: number): { removed: number; tokensSaved: number } {
    const beforeStats = this.getStatistics(sessionID)
    const recs = this.getPruningRecommendations(sessionID, targetTokens)

    if (recs.tokensToFree === 0) {
      return { removed: 0, tokensSaved: 0 }
    }

    let removed = 0
    let tokensFreed = 0

    for (const candidate of recs.candidates) {
      if (tokensFreed >= recs.tokensToFree) break

      this.db.run(`DELETE FROM memory WHERE session_id = ? AND key = ?`, [sessionID, candidate.file])
      removed++
      tokensFreed += candidate.tokens
    }

    const afterStats = this.getStatistics(sessionID)

    this.logTimelineEvent(sessionID, getCurrentLoopID(sessionID), "decision", {
      action: "apply_pruning",
      removed,
      tokensSaved: beforeStats.totalTokens - afterStats.totalTokens,
    })

    return { removed, tokensSaved: beforeStats.totalTokens - afterStats.totalTokens }
  }

  // -------------------------------------------------------------------------
  // Context Evolution Tracking
  // -------------------------------------------------------------------------

  logEvolution(
    sessionID: string,
    fileKey: string,
    priorityBefore: number,
    priorityAfter: number,
    decayBefore: number,
    decayAfter: number,
    reason: string,
  ): void {
    const id = `evo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    this.db.run(
      `INSERT INTO context_evolution (id, session_id, file_key, priority_before, priority_after, decay_before, decay_after, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionID, fileKey, priorityBefore, priorityAfter, decayBefore, decayAfter, reason, Date.now()],
    )
  }

  getFileHistory(
    sessionID: string,
    fileKey: string,
    limit = 50,
  ): Array<{
    priorityBefore: number
    priorityAfter: number
    decayBefore: number
    decayAfter: number
    reason: string
    createdAt: number
  }> {
    const rows = this.db
      .query(
        `SELECT priority_before, priority_after, decay_before, decay_after, reason, created_at
         FROM context_evolution
         WHERE session_id = ? AND file_key = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(sessionID, fileKey, limit) as Array<{
      priority_before: number
      priority_after: number
      decay_before: number
      decay_after: number
      reason: string
      created_at: number
    }>

    return rows.map((r) => ({
      priorityBefore: r.priority_before,
      priorityAfter: r.priority_after,
      decayBefore: r.decay_before,
      decayAfter: r.decay_after,
      reason: r.reason,
      createdAt: r.created_at,
    }))
  }

  // -------------------------------------------------------------------------
  // Context Templates
  // -------------------------------------------------------------------------

  createTemplate(
    projectID: string,
    name: string,
    files: string[],
    focusPaths?: string[],
    patterns?: string[],
    description?: string,
  ): string {
    const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    this.db.run(
      `INSERT INTO context_templates (id, project_id, name, description, files, focus_paths, patterns, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, name) DO UPDATE SET
         files = excluded.files,
         focus_paths = excluded.focus_paths,
         patterns = excluded.patterns,
         description = excluded.description`,
      [
        id,
        projectID,
        name,
        description || null,
        JSON.stringify(files),
        focusPaths ? JSON.stringify(focusPaths) : null,
        patterns ? JSON.stringify(patterns) : null,
        Date.now(),
      ],
    )

    return id
  }

  getTemplates(projectID: string): Array<{
    id: string
    name: string
    description: string | null
    files: string[]
    focusPaths: string[] | null
    patterns: string[] | null
    createdAt: number
  }> {
    const rows = this.db
      .query(`SELECT * FROM context_templates WHERE project_id = ? ORDER BY name`)
      .all(projectID) as Array<{
      id: string
      name: string
      description: string | null
      files: string
      focus_paths: string | null
      patterns: string | null
      created_at: number
    }>

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      files: JSON.parse(r.files) as string[],
      focusPaths: r.focus_paths ? (JSON.parse(r.focus_paths) as string[]) : null,
      patterns: r.patterns ? (JSON.parse(r.patterns) as string[]) : null,
      createdAt: r.created_at,
    }))
  }

  getTemplate(
    projectID: string,
    name: string,
  ): {
    id: string
    name: string
    description: string | null
    files: string[]
    focusPaths: string[] | null
    patterns: string[] | null
    createdAt: number
  } | null {
    const row = this.db
      .query(`SELECT * FROM context_templates WHERE project_id = ? AND name = ?`)
      .get(projectID, name) as {
      id: string
      name: string
      description: string | null
      files: string
      focus_paths: string | null
      patterns: string | null
      created_at: number
    } | null

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      files: JSON.parse(row.files) as string[],
      focusPaths: row.focus_paths ? (JSON.parse(row.focus_paths) as string[]) : null,
      patterns: row.patterns ? (JSON.parse(row.patterns) as string[]) : null,
      createdAt: row.created_at,
    }
  }

  deleteTemplate(projectID: string, name: string): boolean {
    const result = this.db.run(`DELETE FROM context_templates WHERE project_id = ? AND name = ?`, [projectID, name])
    return result.changes > 0
  }

  applyTemplate(sessionID: string, projectID: string, name: string): { filesApplied: number; focusSet: boolean } {
    const template = this.getTemplate(projectID, name)
    if (!template) return { filesApplied: 0, focusSet: false }

    // Boost priority for template files that exist in context
    let filesApplied = 0
    for (const file of template.files) {
      const existing = this.get(sessionID, file)
      if (existing) {
        this.updatePriority(sessionID, file, Math.min(10, existing.priority + 2))
        filesApplied++
      }
    }

    // Apply focus paths if present
    if (template.focusPaths && template.focusPaths.length > 0) {
      this.setFocusMode(sessionID, template.focusPaths)
    }

    return { filesApplied, focusSet: !!template.focusPaths }
  }

  // -------------------------------------------------------------------------
  // Export/Import
  // -------------------------------------------------------------------------

  exportSession(sessionID: string): string {
    const entries = this.getAllForSession(sessionID)
    const decisions = this.getRecentDecisions(sessionID, 100)
    const relationships = this.getFileGraph(sessionID)
    const tracker = this.getSessionTokens(sessionID)

    const exportData = {
      version: 2,
      exportedAt: Date.now(),
      sessionID,
      entries,
      decisions,
      relationships,
      tracker,
    }

    return JSON.stringify(exportData, null, 2)
  }

  importSession(data: string, newSessionID?: string): { imported: number; errors: string[] } {
    const errors: string[] = []
    let imported = 0

    // Safe JSON parsing with error handling
    let parsed: {
      version?: number
      sessionID: string
      entries?: MemoryEntry[]
      decisions?: Array<{ decision: string; context?: string }>
      relationships?: Array<{ source: string; target: string; type: string }>
    }

    try {
      parsed = JSON.parse(data)
    } catch (e) {
      return { imported: 0, errors: [`Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`] }
    }

    // Validate required fields
    if (!parsed || typeof parsed !== "object") {
      return { imported: 0, errors: ["Import data must be a valid object"] }
    }

    if (!parsed.sessionID || typeof parsed.sessionID !== "string") {
      return { imported: 0, errors: ["Missing or invalid sessionID in import data"] }
    }

    const targetSessionID = newSessionID || parsed.sessionID

    // Import entries
    if (parsed.entries) {
      for (const entry of parsed.entries) {
        try {
          this.store({
            sessionID: targetSessionID,
            projectID: entry.projectID,
            type: entry.type,
            key: entry.key,
            summary: entry.summary,
            content: entry.content,
            metadata: entry.metadata,
            tokenCount: entry.tokenCount,
            priority: entry.priority,
            createdAt: entry.createdAt,
            accessedAt: entry.accessedAt,
            accessCount: entry.accessCount,
          })
          imported++
        } catch (e) {
          errors.push(`Failed to import entry ${entry.key}: ${e}`)
        }
      }
    }

    // Import decisions
    if (parsed.decisions) {
      for (const decision of parsed.decisions) {
        this.logDecision(targetSessionID, decision.decision, decision.context)
        imported++
      }
    }

    // Import relationships
    if (parsed.relationships) {
      for (const rel of parsed.relationships) {
        this.storeRelationship(
          targetSessionID,
          rel.source,
          rel.target,
          rel.type as "imports" | "exports_to" | "extends" | "uses",
        )
        imported++
      }
    }

    return { imported, errors }
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
    }
  }

  close(): void {
    this.db.close()
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
}

let db: ContextDatabase | null = null
// In-memory cache for loop counter (backed by database)
// In-memory cache for loop counter with size limit to prevent memory leaks
const MAX_CACHED_SESSIONS = 100
const loopCounterCache = new Map<string, number>()

function cleanupLoopCache(): void {
  if (loopCounterCache.size > MAX_CACHED_SESSIONS) {
    // Remove oldest entries (first added)
    const entries = [...loopCounterCache.keys()]
    const toRemove = entries.slice(0, Math.floor(MAX_CACHED_SESSIONS / 2))
    for (const key of toRemove) {
      loopCounterCache.delete(key)
    }
  }
}

function getDB(config: ContextDrainConfig = DEFAULT_CONFIG): ContextDatabase {
  if (!db) {
    db = new ContextDatabase(config)
  }
  return db
}

function getCurrentLoopID(sessionID: string): string {
  // Check cache first
  if (loopCounterCache.has(sessionID)) {
    return `loop_${loopCounterCache.get(sessionID)}`
  }

  // Load from database
  if (db) {
    const tracker = db.getSessionTokens(sessionID)
    if (tracker) {
      loopCounterCache.set(sessionID, tracker.loopCount)
      cleanupLoopCache()
      return `loop_${tracker.loopCount}`
    }
  }

  loopCounterCache.set(sessionID, 0)
  cleanupLoopCache()
  return `loop_0`
}

function incrementLoop(sessionID: string): string {
  // Ensure we have current value
  getCurrentLoopID(sessionID)

  // Increment cache
  const current = loopCounterCache.get(sessionID) || 0
  loopCounterCache.set(sessionID, current + 1)

  // Return new loop ID (database is incremented separately via incrementLoopCount)
  return getCurrentLoopID(sessionID)
}

// ============================================================================
// File Path Extraction (Improved)
// ============================================================================

function extractFilePath(toolOutput: string, toolArgs?: Record<string, unknown>): string | null {
  // First, check tool args for filePath
  if (toolArgs?.filePath && typeof toolArgs.filePath === "string") {
    return toolArgs.filePath
  }

  // Check for common patterns in output
  const patterns = [
    /^<file>\n(\d+)\|\s*(.+?)$/m, // Read tool format
    /^File:\s*(.+?)$/m,
    /^Reading\s+(.+?)(?:\n|$)/,
    /^Wrote\s+(.+?)$/m,
    /^Edited\s+(.+?)$/m,
    /filePath['":\s]+([^\s'"]+)/,
  ]

  for (const pattern of patterns) {
    const match = toolOutput.match(pattern)
    if (match) {
      // Return the last captured group (the path)
      return match[match.length - 1]?.trim() || null
    }
  }

  return null
}

// ============================================================================
// Plugin Export
// ============================================================================

export default async function contextDrain(input: {
  client: unknown
  project: string
  worktree: string
  directory: string
  serverUrl: string
  $: unknown
}) {
  const projectID = input.project
  const database = getDB()

  return {
    // -------------------------------------------------------------------------
    // Commands
    // -------------------------------------------------------------------------
    command: {
      "context-status": {
        description: "Show current context drain memory status",
        template: "Show the current context drain memory status for this session.",
      },
      "context-clear": {
        description: "Clear context drain memory for this session",
        template: "Clear the context drain memory for this session.",
      },
      "context-files": {
        description: "List recently accessed files in memory",
        template: "List the recently accessed files stored in context drain memory.",
      },
      "context-budget": {
        description: "Show token budget usage and recommendations",
        template: "Show the current token budget usage and recommendations for avoiding compaction.",
      },
    },

    // -------------------------------------------------------------------------
    // Tools
    // -------------------------------------------------------------------------
    tool: {
      "context-status": {
        description: "Get context drain memory status for the session",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const entries = database.getAllForSession(sessionID)
          const byType: Record<string, number> = {}
          let totalTokens = 0

          for (const entry of entries) {
            byType[entry.type] = (byType[entry.type] || 0) + 1
            totalTokens += entry.tokenCount
          }

          const tracker = database.getSessionTokens(sessionID)

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
          )
        },
      },

      "context-clear": {
        description: "Clear context drain memory for the session",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const pruned = database.prune(sessionID, 0)
          database.clearWorkingMemory(sessionID)
          return `Cleared ${pruned} memory entries for session ${sessionID}`
        },
      },

      "context-help": {
        description: "Show help for context drain tools, commands, and concepts",
        args: {
          topic: z.string().optional().describe("Topic: 'tools', 'concepts', 'quick-start', or a specific tool name"),
        },
        async execute(args: { topic?: string }, _ctx: { sessionID: string }) {
          const toolList = [
            "Status & Info:",
            "  context-status    - Show current memory status (JSON)",
            "  context-overview  - Combined dashboard view",
            "  context-files     - List files in memory",
            "  context-budget    - Show token budget usage",
            "  context-stats     - Comprehensive statistics",
            "",
            "Search & Query:",
            "  context-recall    - Recall context about a file/topic",
            "  context-search    - Search memory by query",
            "  context-hot       - Show most active files",
            "  context-patterns  - Show detected code patterns",
            "  context-similar   - Find similar files",
            "",
            "Analytics:",
            "  context-health    - Context health score (A-F)",
            "  context-insights  - Auto-generated observations",
            "  context-analytics - Comprehensive session metrics",
            "  context-aging     - Memory freshness analysis",
            "  context-clusters  - File groupings by directory",
            "",
            "Management:",
            "  context-clear     - Clear all session memory",
            "  context-compress  - Compress large summaries",
            "  context-prune-suggest - Pruning recommendations",
            "  context-optimize  - Auto-optimize context",
            "  context-gc        - Garbage collect old sessions",
            "",
            "Snapshots & History:",
            "  context-snapshot  - Create/restore snapshots",
            "  context-diff      - Compare context between loops",
            "  context-timeline  - Session event timeline",
            "  context-history   - File priority evolution",
            "",
            "Organization:",
            "  context-focus     - Set focus mode on paths",
            "  context-bookmark  - Create/restore bookmarks",
            "  context-template  - Reusable context templates",
            "  context-graph     - File relationship graph",
            "",
            "Cross-Session:",
            "  context-sessions  - List/compare sessions",
            "  context-project   - Cross-session memory",
            "  context-export    - Export session to JSON",
            "  context-import    - Import from JSON",
            "",
            "Prediction:",
            "  context-predict   - Predict next needed files",
            "  context-companions - Find related files",
          ]

          const concepts = [
            "Key Concepts:",
            "",
            "Priority (1-10):",
            "  Higher = more important. Config files, auth, API endpoints",
            "  get higher scores automatically.",
            "",
            "Decay (0-1):",
            "  Decreases each compaction loop. Fresh files have decay=1,",
            "  stale files approach 0. Reset on access.",
            "",
            "Effective Priority:",
            "  priority * decay = how likely to be kept during pruning.",
            "",
            "Heat Score:",
            "  Combines access frequency + priority + recency.",
            "  Hot files are frequently accessed and important.",
            "",
            "Clusters:",
            "  Files grouped by directory or pattern (components/,",
            "  api/, hooks/, etc). Used for organized context injection.",
            "",
            "Health Grade (A-F):",
            "  Based on token budget, decay distribution, cluster",
            "  organization, and access patterns.",
          ]

          const quickStart = [
            "Quick Start:",
            "",
            "1. context-overview  - See current status at a glance",
            "2. context-health    - Check if optimization needed",
            "3. context-hot       - See most active files",
            "",
            "When context is bloated:",
            "  context-optimize   - Auto-fix common issues",
            "  context-prune-suggest apply=true - Prune low-value entries",
            "",
            "To save/restore context state:",
            "  context-snapshot action=create - Save current state",
            "  context-snapshot action=restore snapshotId=... - Restore",
            "",
            "To track changes:",
            "  context-diff       - What changed since last loop",
            "  context-history file=<path> - File priority evolution",
          ]

          if (args.topic === "tools") {
            return toolList.join("\n")
          }
          if (args.topic === "concepts") {
            return concepts.join("\n")
          }
          if (args.topic === "quick-start") {
            return quickStart.join("\n")
          }

          // Default: show overview
          return [
            "Context Drain Help",
            "==================",
            "",
            "Context Drain manages memory across compaction loops,",
            "tracking file summaries, priorities, and relationships.",
            "",
            "Topics:",
            "  topic='tools'       - List all 35 tools",
            "  topic='concepts'    - Explain key concepts",
            "  topic='quick-start' - Common workflows",
            "",
            ...quickStart,
          ].join("\n")
        },
      },

      "context-files": {
        description: "List recently accessed files in memory with priority, access count, and recency",
        args: {
          limit: z.number().optional().describe("Number of files to show (default: 20)"),
        },
        async execute(args: { limit?: number }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const files = database.getRecentFiles(sessionID, args.limit || 20)

          if (files.length === 0) {
            return "No files in memory"
          }

          const result = files
            .map((f) => {
              const effectivePriority = Math.round(f.priority * f.decayFactor * 10) / 10
              return `${f.key}\n  Priority: ${effectivePriority} | Accesses: ${f.accessCount} | ${formatTimeAgo(f.accessedAt)}`
            })
            .join("\n")

          return `Files in memory (${files.length}):\n\n${result}`
        },
      },

      "context-recall": {
        description: "Recall context about a specific file or topic",
        args: {
          query: z.string().describe("File path or topic to recall"),
        },
        async execute(args: { query: string }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const entry = database.get(sessionID, args.query)

          if (entry) {
            return `Memory for ${args.query}:\n${entry.summary}\n\nMetadata: ${JSON.stringify(entry.metadata, null, 2)}`
          }

          const entries = database.getAllForSession(sessionID)
          const matches = entries.filter(
            (e) => e.key.includes(args.query) || e.summary.toLowerCase().includes(args.query.toLowerCase()),
          )

          if (matches.length === 0) {
            return `No memory found for: ${args.query}`
          }

          return matches
            .slice(0, 5)
            .map((m) => `${m.key}:\n${m.summary}`)
            .join("\n\n")
        },
      },

      "context-budget": {
        description: "Show token budget usage and recommendations",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const totalTokens = database.getTotalTokens(sessionID)
          const fileCount = database.getEntryCount(sessionID, "file")
          const toolCount = database.getEntryCount(sessionID, "tool_output")
          const budgetPercent = Math.round((totalTokens / DEFAULT_CONFIG.maxSessionMemoryTokens) * 100)

          const recommendations: string[] = []
          if (budgetPercent > 80) {
            recommendations.push("Consider using /context-clear to free up space")
          }
          if (fileCount > 30) {
            recommendations.push(`${fileCount} files tracked - old files will be automatically pruned`)
          }
          if (toolCount > 20) {
            recommendations.push(`${toolCount} tool outputs stored - consider if all are needed`)
          }

          return [
            `Token Budget: ${totalTokens}/${DEFAULT_CONFIG.maxSessionMemoryTokens} (${budgetPercent}%)`,
            `Files: ${fileCount}, Tool outputs: ${toolCount}`,
            `Loop: ${getCurrentLoopID(sessionID)}`,
            recommendations.length > 0 ? `\nRecommendations:\n- ${recommendations.join("\n- ")}` : "",
          ].join("\n")
        },
      },

      "context-graph": {
        description: "Show file relationships and dependencies graph",
        args: {
          file: z.string().optional().describe("Optional file path to show relationships for"),
        },
        async execute(args: { file?: string }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID

          if (args.file) {
            // Show relationships for specific file
            const relations = database.getRelatedFiles(sessionID, args.file)
            if (relations.length === 0) {
              return `No relationships found for: ${args.file}`
            }
            const incoming = relations.filter((r) => r.direction === "incoming")
            const outgoing = relations.filter((r) => r.direction === "outgoing")

            const result: string[] = [`Relationships for: ${args.file}`]
            if (outgoing.length > 0) {
              result.push(`\nImports (${outgoing.length}):`)
              result.push(...outgoing.map((r) => `  → ${r.file} (${r.relationship})`))
            }
            if (incoming.length > 0) {
              result.push(`\nImported by (${incoming.length}):`)
              result.push(...incoming.map((r) => `  ← ${r.file} (${r.relationship})`))
            }
            return result.join("\n")
          }

          // Show full graph summary
          const graph = database.getFileGraph(sessionID)
          if (graph.length === 0) {
            return "No file relationships tracked yet"
          }

          // Count unique files and relationships
          const files = new Set<string>()
          const byType: Record<string, number> = {}
          for (const edge of graph) {
            files.add(edge.source)
            files.add(edge.target)
            byType[edge.type] = (byType[edge.type] || 0) + 1
          }

          return [
            `File Relationship Graph`,
            `Files: ${files.size}, Relationships: ${graph.length}`,
            `\nBy type:`,
            ...Object.entries(byType).map(([type, count]) => `  ${type}: ${count}`),
            `\nRecent relationships:`,
            ...graph.slice(-10).map((e) => `  ${e.source} --${e.type}--> ${e.target}`),
          ].join("\n")
        },
      },

      "context-search": {
        description: "Search context memory for files or summaries matching a query",
        args: {
          query: z.string().describe("Search query to find in file paths or summaries"),
          type: z
            .enum(["all", "file", "tool_output", "decision"])
            .optional()
            .describe("Filter by entry type (default: all)"),
          limit: z.number().optional().describe("Max results (default: 15)"),
        },
        async execute(
          args: { query: string; type?: "all" | "file" | "tool_output" | "decision"; limit?: number },
          ctx: { sessionID: string },
        ) {
          const sessionID = ctx.sessionID
          const limit = args.limit || 15
          let results = database.search(sessionID, args.query, limit * 2) // Get more to filter

          // Filter by type if specified
          if (args.type && args.type !== "all") {
            results = results.filter((r) => r.type === args.type)
          }

          results = results.slice(0, limit)

          if (results.length === 0) {
            const typeNote = args.type && args.type !== "all" ? ` (type: ${args.type})` : ""
            return `No results found for: ${args.query}${typeNote}`
          }

          return [
            `Search results for "${args.query}" (${results.length}):`,
            "",
            ...results.map((r) => {
              const effectivePriority = Math.round(r.priority * r.decayFactor * 10) / 10
              return `[${r.type}] ${r.key} (p:${effectivePriority})\n  ${r.summary.slice(0, 150)}${r.summary.length > 150 ? "..." : ""}`
            }),
          ].join("\n")
        },
      },

      "context-stats": {
        description: "Show comprehensive database statistics",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const sessionStats = database.getStatistics(sessionID)
          const globalStats = database.getStatistics()

          const formatDuration = (ms: number) => {
            const mins = Math.floor(ms / 60000)
            const hours = Math.floor(mins / 60)
            if (hours > 0) return `${hours}h ${mins % 60}m ago`
            return `${mins}m ago`
          }

          return [
            "=== Session Statistics ===",
            `Entries: ${sessionStats.totalMemoryEntries}`,
            `Tokens: ${sessionStats.totalTokens}`,
            `Avg Priority: ${sessionStats.avgPriority.toFixed(2)}`,
            `Avg Decay: ${sessionStats.avgDecayFactor.toFixed(2)}`,
            `Relationships: ${sessionStats.totalRelationships}`,
            `Decisions: ${sessionStats.totalDecisions}`,
            "",
            "By Type:",
            ...Object.entries(sessionStats.entriesByType).map(
              ([type, count]) => `  ${type}: ${count} entries, ${sessionStats.tokensByType[type] || 0} tokens`,
            ),
            "",
            "=== Global Statistics ===",
            `Total Sessions: ${globalStats.sessionsCount}`,
            `Total Entries: ${globalStats.totalMemoryEntries}`,
            `Total Tokens: ${globalStats.totalTokens}`,
            sessionStats.oldestEntry ? `Session Age: ${formatDuration(Date.now() - sessionStats.oldestEntry)}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        },
      },

      "context-export": {
        description: "Export session context to JSON for backup or transfer",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const exportData = database.exportSession(sessionID)
          const stats = database.getStatistics(sessionID)

          return [
            `Exported session context successfully.`,
            `Entries: ${stats.totalMemoryEntries}`,
            `Relationships: ${stats.totalRelationships}`,
            `Decisions: ${stats.totalDecisions}`,
            "",
            "Export data (JSON):",
            exportData.slice(0, 2000) + (exportData.length > 2000 ? "..." : ""),
          ].join("\n")
        },
      },

      "context-import": {
        description: "Import context from previously exported JSON data",
        args: {
          data: z.string().describe("JSON data from context-export"),
          mergeWithCurrent: z.boolean().optional().describe("Whether to merge with current session (default: false)"),
        },
        async execute(args: { data: string; mergeWithCurrent?: boolean }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID

          try {
            const result = database.importSession(args.data, args.mergeWithCurrent ? sessionID : undefined)

            const response = [`Import completed: ${result.imported} items imported`]
            if (result.errors.length > 0) {
              response.push(`\nErrors (${result.errors.length}):`)
              response.push(...result.errors.slice(0, 5))
              if (result.errors.length > 5) {
                response.push(`... and ${result.errors.length - 5} more errors`)
              }
            }

            return response.join("\n")
          } catch (e) {
            return `Failed to import: ${e}`
          }
        },
      },

      "context-hot": {
        description: "Show hot files - most frequently accessed files with heat scores",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const hotFiles = database.getHotFiles(sessionID, 15)

          if (hotFiles.length === 0) {
            return "No files tracked yet"
          }

          const formatTime = (ms: number) => {
            const mins = Math.floor((Date.now() - ms) / 60000)
            if (mins < 1) return "just now"
            if (mins < 60) return `${mins}m ago`
            return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
          }

          return [
            "Hot Files (by heat score):",
            "",
            ...hotFiles.map(
              (f, i) =>
                `${i + 1}. ${f.file}\n   Heat: ${f.heatScore} | Accesses: ${f.accessCount} | Priority: ${f.effectivePriority} | Last: ${formatTime(f.lastAccessed)}`,
            ),
          ].join("\n")
        },
      },

      "context-aging": {
        description: "Show memory aging analytics - how stale is the context?",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const analytics = database.getAgingAnalytics(sessionID)

          if (analytics.totalEntries === 0) {
            return "No entries to analyze"
          }

          const formatDuration = (seconds: number) => {
            if (seconds < 60) return `${seconds}s`
            if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
            return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
          }

          return [
            "Memory Aging Analytics",
            "======================",
            "",
            `Total Entries: ${analytics.totalEntries}`,
            `Average Age: ${formatDuration(analytics.avgAge)}`,
            `Average Decay: ${(analytics.avgDecay * 100).toFixed(1)}%`,
            "",
            "Activity:",
            `  Active (< 5m): ${analytics.activeEntries}`,
            `  Stale (> 1h): ${analytics.staleEntries}`,
            "",
            "Decay Distribution:",
            `  Fresh (> 70%): ${analytics.decayDistribution.fresh}`,
            `  Aging (30-70%): ${analytics.decayDistribution.aging}`,
            `  Stale (< 30%): ${analytics.decayDistribution.stale}`,
          ].join("\n")
        },
      },

      "context-compress": {
        description: "Compress large summaries to save token budget",
        args: {
          maxTokens: z.number().optional().describe("Maximum tokens per summary (default: 200)"),
        },
        async execute(args: { maxTokens?: number }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const maxTokens = args.maxTokens || 200

          const beforeStats = database.getStatistics(sessionID)
          const compressed = database.compressSummaries(sessionID, maxTokens)
          const afterStats = database.getStatistics(sessionID)

          const tokensSaved = beforeStats.totalTokens - afterStats.totalTokens

          return [
            `Compression complete`,
            `Summaries compressed: ${compressed}`,
            `Tokens before: ${beforeStats.totalTokens}`,
            `Tokens after: ${afterStats.totalTokens}`,
            `Tokens saved: ${tokensSaved} (${((tokensSaved / beforeStats.totalTokens) * 100).toFixed(1)}%)`,
          ].join("\n")
        },
      },

      "context-clusters": {
        description: "Detect and show file clusters - groups of related files",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const clusters = database.detectClusters(sessionID)

          if (clusters.length === 0) {
            return "No file clusters detected yet. Read more files to build clusters."
          }

          const result: string[] = [`File Clusters (${clusters.length} detected):`, ""]

          for (const cluster of clusters.slice(0, 10)) {
            result.push(`[${cluster.pattern}] ${cluster.name}`)
            result.push(
              `  Files: ${cluster.files.length} | Tokens: ${cluster.totalTokens} | Avg Priority: ${cluster.avgPriority}`,
            )
            result.push(
              `  ${cluster.files
                .slice(0, 3)
                .map((f) => f.split("/").pop())
                .join(", ")}${cluster.files.length > 3 ? "..." : ""}`,
            )
            result.push("")
          }

          return result.join("\n")
        },
      },

      "context-health": {
        description: "Get context health score with detailed factors and recommendations",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const health = database.calculateHealthScore(sessionID)

          const gradeEmoji = {
            A: "Excellent",
            B: "Good",
            C: "Fair",
            D: "Poor",
            F: "Critical",
          }

          const result: string[] = [
            `Context Health: ${health.grade} (${health.score}/100) - ${gradeEmoji[health.grade]}`,
            "",
            "Factors:",
          ]

          for (const [name, factor] of Object.entries(health.factors)) {
            const bar = "█".repeat(Math.floor(factor.score / 10)) + "░".repeat(10 - Math.floor(factor.score / 10))
            result.push(`  ${name}: ${bar} ${factor.score}`)
            result.push(`    ${factor.description}`)
          }

          if (health.recommendations.length > 0) {
            result.push("")
            result.push("Recommendations:")
            for (const rec of health.recommendations) {
              result.push(`  - ${rec}`)
            }
          }

          return result.join("\n")
        },
      },

      "context-prune-suggest": {
        description: "Get smart pruning recommendations to free up token budget",
        args: {
          targetPercent: z.number().optional().describe("Target budget percentage (default: 70%)"),
          apply: z.boolean().optional().describe("Actually apply the pruning (default: false)"),
        },
        async execute(args: { targetPercent?: number; apply?: boolean }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const targetTokens = args.targetPercent ? Math.floor(24000 * (args.targetPercent / 100)) : undefined

          // If apply is true, actually prune
          if (args.apply) {
            const result = database.applyPruning(sessionID, targetTokens)
            if (result.removed === 0) {
              return "No pruning needed - context is within target budget."
            }
            return [
              "Pruning Applied",
              "",
              `Entries removed: ${result.removed}`,
              `Tokens saved: ${result.tokensSaved}`,
            ].join("\n")
          }

          const recs = database.getPruningRecommendations(sessionID, targetTokens)

          if (recs.tokensToFree === 0) {
            return `No pruning needed. Current: ${recs.currentTokens} tokens, Target: ${recs.targetTokens} tokens`
          }

          const result: string[] = [
            `Pruning Recommendations`,
            `Current: ${recs.currentTokens} tokens | Target: ${recs.targetTokens} tokens`,
            `Need to free: ${recs.tokensToFree} tokens`,
            "",
            `Candidates (${recs.candidates.length}):`,
          ]

          let accumulated = 0
          for (const c of recs.candidates.slice(0, 15)) {
            accumulated += c.tokens
            const marker = accumulated <= recs.tokensToFree ? "[x]" : "[ ]"
            result.push(`${marker} ${c.file}`)
            result.push(`    ${c.tokens} tokens | Priority: ${c.priority} | ${c.reason}`)
          }

          if (recs.candidates.length > 15) {
            result.push(`... and ${recs.candidates.length - 15} more candidates`)
          }

          result.push("")
          result.push("Use apply=true to execute this pruning.")

          return result.join("\n")
        },
      },

      "context-timeline": {
        description: "Show session timeline - history of events and actions",
        args: {
          loopId: z.string().optional().describe("Filter by specific loop ID"),
          limit: z.number().optional().describe("Number of events to show (default: 30)"),
        },
        async execute(args: { loopId?: string; limit?: number }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const limit = args.limit || 30

          const formatTime = (ms: number) => {
            const d = new Date(ms)
            return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`
          }

          if (args.loopId) {
            const events = database.getTimelineByLoop(sessionID, args.loopId)
            if (events.length === 0) {
              return `No events found for loop: ${args.loopId}`
            }
            return [
              `Timeline for ${args.loopId} (${events.length} events):`,
              "",
              ...events.map((e) => {
                const data = typeof e.eventData === "object" ? JSON.stringify(e.eventData).slice(0, 60) : e.eventData
                return `[${formatTime(e.createdAt)}] ${e.eventType}: ${data}`
              }),
            ].join("\n")
          }

          const summary = database.getTimelineSummary(sessionID)
          const events = database.getTimeline(sessionID, limit)

          if (events.length === 0) {
            return "No timeline events recorded yet"
          }

          const result: string[] = [
            "Session Timeline",
            `Total Events: ${summary.totalEvents}`,
            `Loops: ${Object.keys(summary.eventsByLoop).length}`,
            "",
            "Events by Type:",
            ...Object.entries(summary.eventsByType).map(([type, count]) => `  ${type}: ${count}`),
            "",
            `Recent Events (${events.length}):`,
            ...events.slice(0, 20).map((e) => {
              const data =
                typeof e.eventData === "object"
                  ? e.eventData.file || e.eventData.tool || JSON.stringify(e.eventData).slice(0, 40)
                  : e.eventData
              return `[${formatTime(e.createdAt)}] [${e.loopID}] ${e.eventType}: ${data}`
            }),
          ]

          return result.join("\n")
        },
      },

      "context-snapshot": {
        description: "Create or manage context snapshots for rollback",
        args: {
          action: z.enum(["create", "list", "restore", "compare"]).describe("Action to perform"),
          snapshotId: z.string().optional().describe("Snapshot ID for restore/compare"),
          compareWith: z.string().optional().describe("Second snapshot ID for comparison"),
        },
        async execute(
          args: { action: "create" | "list" | "restore" | "compare"; snapshotId?: string; compareWith?: string },
          ctx: { sessionID: string },
        ) {
          const sessionID = ctx.sessionID
          const loopID = getCurrentLoopID(sessionID)

          switch (args.action) {
            case "create": {
              const id = database.createSnapshot(sessionID, loopID)
              const stats = database.getStatistics(sessionID)
              return [
                `Snapshot created: ${id}`,
                `Entries: ${stats.totalMemoryEntries}`,
                `Tokens: ${stats.totalTokens}`,
                `Loop: ${loopID}`,
              ].join("\n")
            }

            case "list": {
              const snapshots = database.getSnapshots(sessionID)
              if (snapshots.length === 0) {
                return "No snapshots found. Use 'create' to create one."
              }

              const formatTime = (ms: number) => {
                const mins = Math.floor((Date.now() - ms) / 60000)
                if (mins < 1) return "just now"
                if (mins < 60) return `${mins}m ago`
                return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
              }

              return [
                `Snapshots (${snapshots.length}):`,
                "",
                ...snapshots.map(
                  (s) =>
                    `${s.id}\n  Loop: ${s.loopID} | Entries: ${s.entryCount} | Tokens: ${s.tokenCount} | ${formatTime(s.createdAt)}`,
                ),
              ].join("\n")
            }

            case "restore": {
              if (!args.snapshotId) {
                return "Error: snapshotId required for restore"
              }
              const result = database.restoreSnapshot(sessionID, args.snapshotId)
              if (result.errors.length > 0) {
                return `Restored ${result.restored} entries with ${result.errors.length} errors:\n${result.errors.slice(0, 5).join("\n")}`
              }
              return `Successfully restored ${result.restored} entries from snapshot`
            }

            case "compare": {
              if (!args.snapshotId || !args.compareWith) {
                return "Error: both snapshotId and compareWith required for compare"
              }
              const diff = database.compareSnapshots(args.snapshotId, args.compareWith)

              if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
                return "No differences between snapshots"
              }

              const result: string[] = ["Snapshot Comparison:"]

              if (diff.added.length > 0) {
                result.push(`\nAdded (${diff.added.length}):`)
                result.push(...diff.added.slice(0, 10).map((f) => `  + ${f}`))
              }
              if (diff.removed.length > 0) {
                result.push(`\nRemoved (${diff.removed.length}):`)
                result.push(...diff.removed.slice(0, 10).map((f) => `  - ${f}`))
              }
              if (diff.changed.length > 0) {
                result.push(`\nPriority Changed (${diff.changed.length}):`)
                result.push(
                  ...diff.changed.slice(0, 10).map((c) => `  ~ ${c.key}: ${c.oldPriority} → ${c.newPriority}`),
                )
              }

              return result.join("\n")
            }
          }
        },
      },

      "context-predict": {
        description: "Predict what files you might need next based on access patterns",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const predictions = database.predictNextFiles(sessionID, 10)

          if (predictions.length === 0) {
            return "Not enough data to make predictions. Read more files first."
          }

          return [
            "Predicted Next Files:",
            "",
            ...predictions.map((p, i) => `${i + 1}. ${p.file}\n   Score: ${p.score} | ${p.reason}`),
          ].join("\n")
        },
      },

      "context-analytics": {
        description: "Get comprehensive session analytics",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const analytics = database.getSessionAnalytics(sessionID)
          const dbSize = database.getDatabaseSize()

          const formatDuration = (mins: number) => {
            if (mins < 60) return `${mins}m`
            return `${Math.floor(mins / 60)}h ${mins % 60}m`
          }

          return [
            "Session Analytics",
            "=================",
            "",
            "Duration:",
            `  Session length: ${formatDuration(analytics.duration.totalMinutes)}`,
            "",
            "Activity:",
            `  Total events: ${analytics.activity.totalEvents}`,
            `  Files read: ${analytics.activity.filesRead}`,
            `  Files written: ${analytics.activity.filesWritten}`,
            `  Tool calls: ${analytics.activity.toolCalls}`,
            "",
            "Efficiency:",
            `  Avg accesses per file: ${analytics.efficiency.avgAccessesPerFile}`,
            `  File reuse rate: ${analytics.efficiency.reuseRate}%`,
            `  Compression rate: ${analytics.efficiency.compressionRate}%`,
            "",
            "Focus:",
            `  Primary cluster: ${analytics.focus.primaryCluster || "None"}`,
            `  Focus score: ${analytics.focus.focusScore}/100`,
            "",
            "Database:",
            `  Total rows: ${dbSize.totalRows}`,
            ...Object.entries(dbSize.tables).map(([t, c]) => `    ${t}: ${c}`),
          ].join("\n")
        },
      },

      "context-gc": {
        description: "Run garbage collection to clean up old session data",
        args: {
          maxAgeDays: z.number().optional().describe("Max age in days to keep (default: 7)"),
          dryRun: z.boolean().optional().describe("Preview without deleting (default: true)"),
        },
        async execute(args: { maxAgeDays?: number; dryRun?: boolean }, ctx: { sessionID: string }) {
          const maxAge = args.maxAgeDays || 7
          const dryRun = args.dryRun !== false

          if (dryRun) {
            const cutoff = Date.now() - maxAge * 24 * 60 * 60 * 1000
            const oldSessions = database.db
              .query(`SELECT COUNT(DISTINCT session_id) as count FROM memory WHERE accessed_at < ?`)
              .get(cutoff) as { count: number }

            return [
              `Garbage Collection Preview (dry run)`,
              `Sessions older than ${maxAge} days: ${oldSessions?.count || 0}`,
              "",
              `Run with dryRun=false to actually delete.`,
            ].join("\n")
          }

          const result = database.garbageCollect(maxAge)

          return [
            `Garbage Collection Complete`,
            `Sessions removed: ${result.sessionsRemoved}`,
            `Entries removed: ${result.entriesRemoved}`,
            `Snapshots removed: ${result.snapshotsRemoved}`,
            `Events removed: ${result.eventsRemoved}`,
          ].join("\n")
        },
      },

      "context-focus": {
        description: "Set focus mode to prioritize specific file paths or directories",
        args: {
          paths: z.array(z.string()).optional().describe("Paths to focus on (e.g., ['src/api', 'lib/utils'])"),
          show: z.boolean().optional().describe("Show currently focused files"),
        },
        async execute(args: { paths?: string[]; show?: boolean }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID

          if (args.show) {
            const focused = database.getFocusedFiles(sessionID)
            if (focused.length === 0) {
              return "No files currently in focus (priority >= 7)"
            }
            return [
              `Focused Files (${focused.length}):`,
              "",
              ...focused.map((f) => {
                const effectivePriority = Math.round(f.priority * f.decayFactor * 10) / 10
                return `${f.key} (priority: ${effectivePriority})`
              }),
            ].join("\n")
          }

          if (!args.paths || args.paths.length === 0) {
            return "Provide paths to focus on, or use show=true to see focused files"
          }

          database.setFocusMode(sessionID, args.paths)

          return [
            `Focus mode activated for:`,
            ...args.paths.map((p) => `  - ${p}`),
            "",
            `Files matching these paths will have boosted priority.`,
          ].join("\n")
        },
      },

      "context-patterns": {
        description: "Show detected code patterns across files",
        args: {
          pattern: z
            .string()
            .optional()
            .describe("Filter by specific pattern (e.g., 'react-component', 'api-endpoint')"),
        },
        async execute(args: { pattern?: string }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID

          if (args.pattern) {
            const files = database.getFilesByPattern(sessionID, args.pattern as CodePattern)
            if (files.length === 0) {
              return `No files found with pattern: ${args.pattern}`
            }
            return [
              `Files with pattern "${args.pattern}" (${files.length}):`,
              "",
              ...files.map((f) => `  ${f.key}`),
            ].join("\n")
          }

          // Show pattern distribution
          const allFiles = database.getByType(sessionID, "file", 100)
          const patternCounts = new Map<string, number>()

          for (const file of allFiles) {
            const patterns =
              ((file.metadata as Record<string, unknown>).codePatterns as Array<{ pattern: string }>) || []
            for (const p of patterns) {
              patternCounts.set(p.pattern, (patternCounts.get(p.pattern) || 0) + 1)
            }
          }

          if (patternCounts.size === 0) {
            return "No code patterns detected yet. Read more files to build pattern data."
          }

          const sorted = [...patternCounts.entries()].sort((a, b) => b[1] - a[1])

          return [
            "Detected Code Patterns:",
            "",
            ...sorted.map(([pattern, count]) => `  ${pattern}: ${count} files`),
            "",
            "Use pattern='<name>' to list files with that pattern.",
          ].join("\n")
        },
      },

      "context-similar": {
        description: "Find files similar to a given file",
        args: {
          file: z.string().describe("File path to find similar files for"),
        },
        async execute(args: { file: string }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const similar = database.findSimilarFiles(sessionID, args.file, 10)

          if (similar.length === 0) {
            return `No similar files found for: ${args.file}`
          }

          return [
            `Files similar to ${args.file}:`,
            "",
            ...similar.map((s) => `  ${(s.similarity * 100).toFixed(0)}% - ${s.file}`),
          ].join("\n")
        },
      },

      "context-bookmark": {
        description: "Create and manage context bookmarks",
        args: {
          action: z.enum(["create", "list", "restore"]).describe("Action to perform"),
          name: z.string().optional().describe("Bookmark name (for create)"),
          files: z.array(z.string()).optional().describe("Files to bookmark (for create)"),
          notes: z.string().optional().describe("Optional notes"),
          bookmarkId: z.string().optional().describe("Bookmark ID (for restore)"),
        },
        async execute(
          args: {
            action: "create" | "list" | "restore"
            name?: string
            files?: string[]
            notes?: string
            bookmarkId?: string
          },
          ctx: { sessionID: string },
        ) {
          const sessionID = ctx.sessionID

          switch (args.action) {
            case "create": {
              if (!args.name) {
                return "Error: name required for create"
              }

              // If no files specified, bookmark current hot files
              const filesToBookmark = args.files || database.getHotFiles(sessionID, 5).map((h) => h.file)

              if (filesToBookmark.length === 0) {
                return "No files to bookmark. Specify files or read some files first."
              }

              const id = database.createBookmark(sessionID, args.name, filesToBookmark, args.notes)
              return [
                `Bookmark created: ${args.name}`,
                `ID: ${id}`,
                `Files: ${filesToBookmark.length}`,
                ...filesToBookmark.slice(0, 5).map((f) => `  - ${f}`),
                filesToBookmark.length > 5 ? `  ... and ${filesToBookmark.length - 5} more` : "",
              ]
                .filter(Boolean)
                .join("\n")
            }

            case "list": {
              const bookmarks = database.getBookmarks(sessionID)
              if (bookmarks.length === 0) {
                return "No bookmarks found. Use action='create' to create one."
              }

              const formatTime = (ms: number) => {
                const mins = Math.floor((Date.now() - ms) / 60000)
                if (mins < 60) return `${mins}m ago`
                return `${Math.floor(mins / 60)}h ago`
              }

              return [
                `Bookmarks (${bookmarks.length}):`,
                "",
                ...bookmarks.map(
                  (b) =>
                    `${b.name} (${b.id})\n  Files: ${b.files.length} | ${formatTime(b.createdAt)}${b.notes ? `\n  Notes: ${b.notes}` : ""}`,
                ),
              ].join("\n")
            }

            case "restore": {
              if (!args.bookmarkId) {
                return "Error: bookmarkId required for restore"
              }
              const restored = database.restoreBookmark(sessionID, args.bookmarkId)
              return `Restored bookmark: ${restored} files boosted`
            }
          }
        },
      },

      "context-insights": {
        description: "Generate automatic insights and suggestions about context usage",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const insights = database.generateInsights(sessionID)

          if (insights.observations.length === 0 && insights.suggestions.length === 0) {
            return "Not enough data to generate insights yet. Use more tools and read more files."
          }

          const result: string[] = ["Context Insights", `Score: ${insights.score}/100`, ""]

          if (insights.observations.length > 0) {
            result.push("Observations:")
            for (const obs of insights.observations) {
              const icon = obs.type === "warning" ? "!" : obs.type === "success" ? "+" : "-"
              result.push(`  [${icon}] ${obs.message}`)
            }
          }

          if (insights.suggestions.length > 0) {
            result.push("")
            result.push("Suggestions:")
            for (const sug of insights.suggestions) {
              result.push(`  > ${sug}`)
            }
          }

          return result.join("\n")
        },
      },

      "context-sessions": {
        description: "List and compare sessions",
        args: {
          action: z.enum(["list", "compare"]).describe("Action to perform"),
          session1: z.string().optional().describe("First session ID for comparison"),
          session2: z.string().optional().describe("Second session ID for comparison"),
          limit: z.number().optional().describe("Number of sessions to list (default: 10)"),
        },
        async execute(
          args: { action: "list" | "compare"; session1?: string; session2?: string; limit?: number },
          ctx: { sessionID: string },
        ) {
          switch (args.action) {
            case "list": {
              const sessions = database.listSessions(args.limit || 10)
              if (sessions.length === 0) {
                return "No sessions found."
              }

              const formatTime = (ms: number) => {
                const mins = Math.floor((Date.now() - ms) / 60000)
                if (mins < 60) return `${mins}m ago`
                if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
                return `${Math.floor(mins / 1440)}d ago`
              }

              const result: string[] = [`Sessions (${sessions.length}):`]
              for (const s of sessions) {
                const isCurrent = s.sessionID === ctx.sessionID ? " (current)" : ""
                result.push(`\n${s.sessionID.slice(0, 16)}...${isCurrent}`)
                result.push(`  Entries: ${s.entryCount} | Tokens: ${s.tokenCount} | ${formatTime(s.lastAccessed)}`)
              }

              return result.join("\n")
            }

            case "compare": {
              if (!args.session1 || !args.session2) {
                return "Error: session1 and session2 required for comparison"
              }

              const comparison = database.compareSessions(args.session1, args.session2)

              const result: string[] = ["Session Comparison", "", `Shared files: ${comparison.sharedFiles.length}`]

              if (comparison.sharedFiles.length > 0) {
                result.push(...comparison.sharedFiles.slice(0, 5).map((f) => `  - ${f}`))
                if (comparison.sharedFiles.length > 5) {
                  result.push(`  ... and ${comparison.sharedFiles.length - 5} more`)
                }
              }

              result.push("")
              result.push(`Unique to session1: ${comparison.uniqueToSession1.length}`)
              if (comparison.uniqueToSession1.length > 0) {
                result.push(...comparison.uniqueToSession1.slice(0, 5).map((f: string) => `  - ${f}`))
              }

              result.push("")
              result.push(`Unique to session2: ${comparison.uniqueToSession2.length}`)
              if (comparison.uniqueToSession2.length > 0) {
                result.push(...comparison.uniqueToSession2.slice(0, 5).map((f: string) => `  - ${f}`))
              }

              result.push("")
              const allPatterns = new Set([...comparison.session1.patterns, ...comparison.session2.patterns])
              const sharedPatterns = [...allPatterns].filter(
                (p) => comparison.session1.patterns.includes(p) && comparison.session2.patterns.includes(p),
              )
              result.push(`Shared patterns: ${sharedPatterns.join(", ") || "None"}`)

              return result.join("\n")
            }
          }
        },
      },

      "context-optimize": {
        description: "Run automatic optimization to clean up and compress context",
        args: {
          dryRun: z.boolean().optional().describe("Preview optimization without applying (default: true)"),
        },
        async execute(args: { dryRun?: boolean }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const dryRun = args.dryRun !== false

          if (dryRun) {
            // Preview what would be optimized
            const stats = database.getStatistics(sessionID)
            const aging = database.getAgingAnalytics(sessionID)
            const health = database.calculateHealthScore(sessionID)

            const potentialSavings: string[] = []

            // Check for compressible summaries
            const largeEntries = database.db
              .query(`SELECT COUNT(*) as count FROM memory WHERE session_id = ? AND token_count > 200`)
              .get(sessionID) as { count: number }
            if (largeEntries?.count > 0) {
              potentialSavings.push(`${largeEntries.count} large summaries can be compressed`)
            }

            // Check for heavily decayed entries
            if (aging.decayDistribution.stale > 0) {
              potentialSavings.push(`${aging.decayDistribution.stale} stale entries can be removed`)
            }

            // Check for old tool outputs
            const oldTools = database.db
              .query(
                `SELECT COUNT(*) as count FROM memory WHERE session_id = ? AND type = 'tool_output' AND accessed_at < ?`,
              )
              .get(sessionID, Date.now() - 30 * 60 * 1000) as { count: number }
            if (oldTools?.count > 0) {
              potentialSavings.push(`${oldTools.count} old tool outputs can be removed`)
            }

            return [
              "Optimization Preview (dry run)",
              "",
              `Current state:`,
              `  Entries: ${stats.totalMemoryEntries}`,
              `  Tokens: ${stats.totalTokens}`,
              `  Health: ${health.grade}`,
              "",
              "Potential optimizations:",
              ...potentialSavings.map((s) => `  - ${s}`),
              "",
              potentialSavings.length > 0
                ? "Run with dryRun=false to apply optimizations."
                : "No optimizations needed.",
            ].join("\n")
          }

          // Actually run optimization
          const result = database.autoOptimize(sessionID)
          const health = database.calculateHealthScore(sessionID)

          return [
            "Optimization Complete",
            "",
            `Actions performed:`,
            ...result.actions.map((a) => `  - ${a}`),
            "",
            `Entries removed: ${result.entriesRemoved}`,
            `Tokens saved: ~${result.tokensSaved}`,
            "",
            `New health score: ${health.grade} (${health.score}/100)`,
          ].join("\n")
        },
      },

      "context-project": {
        description: "Access cross-session project memory - files frequently used across sessions",
        args: {
          limit: z.number().optional().describe("Number of entries to show (default: 20)"),
        },
        async execute(args: { limit?: number }, _ctx: { sessionID: string }) {
          const limit = args.limit || 20
          const projectMemory = database.getProjectMemory(projectID, limit)

          if (projectMemory.length === 0) {
            return "No project memory found. Context is tracked per-session; read more files to build project memory."
          }

          const grouped = new Map<string, typeof projectMemory>()
          for (const entry of projectMemory) {
            const list = grouped.get(entry.sessionID) || []
            list.push(entry)
            grouped.set(entry.sessionID, list)
          }

          const result: string[] = [
            `Project Memory (${projectMemory.length} entries across ${grouped.size} sessions)`,
            "",
          ]

          // Show top files by access count
          const topFiles = projectMemory
            .filter((e) => e.type === "file")
            .sort((a, b) => b.accessCount - a.accessCount)
            .slice(0, 10)

          if (topFiles.length > 0) {
            result.push("Most Accessed Files:")
            for (const f of topFiles) {
              result.push(`  [${f.accessCount}x] ${f.key}`)
            }
          }

          // Show recent decisions
          const decisions = projectMemory.filter((e) => e.type === "decision").slice(0, 5)
          if (decisions.length > 0) {
            result.push("")
            result.push("Recent Decisions:")
            for (const d of decisions) {
              result.push(`  - ${d.summary}`)
            }
          }

          return result.join("\n")
        },
      },

      "context-diff": {
        description: "Show what changed in context between loops",
        args: {
          loop1: z.string().optional().describe("First loop ID (default: previous loop)"),
          loop2: z.string().optional().describe("Second loop ID (default: current loop)"),
        },
        async execute(args: { loop1?: string; loop2?: string }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const diff = database.getLoopDiff(sessionID, args.loop1, args.loop2)

          if (diff.added.length === 0 && diff.removed.length === 0 && diff.priorityChanges.length === 0) {
            return `No changes between ${diff.loop1} and ${diff.loop2} (or not enough snapshots)`
          }

          const result: string[] = [
            `Context Diff: ${diff.loop1} → ${diff.loop2}`,
            `Token delta: ${diff.tokenDelta > 0 ? "+" : ""}${diff.tokenDelta}`,
            "",
          ]

          if (diff.added.length > 0) {
            result.push(`Added (${diff.added.length}):`)
            for (const a of diff.added.slice(0, 10)) {
              result.push(`  + ${a.file} (priority: ${a.priority.toFixed(1)})`)
            }
            if (diff.added.length > 10) {
              result.push(`  ... and ${diff.added.length - 10} more`)
            }
          }

          if (diff.removed.length > 0) {
            result.push("")
            result.push(`Removed (${diff.removed.length}):`)
            for (const r of diff.removed.slice(0, 10)) {
              result.push(`  - ${r.file} (was priority: ${r.priority.toFixed(1)})`)
            }
            if (diff.removed.length > 10) {
              result.push(`  ... and ${diff.removed.length - 10} more`)
            }
          }

          if (diff.priorityChanges.length > 0) {
            result.push("")
            result.push(`Priority Changes (${diff.priorityChanges.length}):`)
            for (const c of diff.priorityChanges.slice(0, 10)) {
              const arrow = c.newPriority > c.oldPriority ? "↑" : "↓"
              result.push(`  ${arrow} ${c.file}: ${c.oldPriority.toFixed(1)} → ${c.newPriority.toFixed(1)}`)
            }
          }

          return result.join("\n")
        },
      },

      "context-companions": {
        description: "Find companion files (tests, types, styles) for a given file",
        args: {
          file: z.string().describe("File path to find companions for"),
        },
        async execute(args: { file: string }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const companions = database.getCompanionFiles(sessionID, args.file)

          if (companions.length === 0) {
            return `No companion files identified for: ${args.file}`
          }

          const result: string[] = [`Companion Files for ${args.file}:`, ""]

          const existing = companions.filter((c) => c.exists)
          const suggested = companions.filter((c) => !c.exists)

          if (existing.length > 0) {
            result.push("In Context:")
            for (const c of existing) {
              result.push(`  [+] ${c.path} - ${c.reason}`)
            }
          }

          if (suggested.length > 0) {
            result.push("")
            result.push("Suggested (not yet read):")
            for (const c of suggested) {
              result.push(`  [ ] ${c.path} - ${c.reason}`)
            }
          }

          return result.join("\n")
        },
      },

      "context-history": {
        description: "Show the evolution history of a file's priority in context",
        args: {
          file: z.string().describe("File path to show history for"),
          limit: z.number().optional().describe("Number of events to show (default: 20)"),
        },
        async execute(args: { file: string; limit?: number }, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID
          const limit = args.limit || 20

          const history = database.getFileHistory(sessionID, args.file, limit)

          if (history.length === 0) {
            // Check if file exists in context
            const entry = database.get(sessionID, args.file)
            if (!entry) {
              return `File not found in context: ${args.file}`
            }
            return `No evolution history for: ${args.file}\nCurrent priority: ${entry.priority.toFixed(1)}, Decay: ${entry.decayFactor.toFixed(2)}`
          }

          const result: string[] = [`Evolution History: ${args.file}`, ""]

          for (const h of history) {
            const arrow = h.priorityAfter > h.priorityBefore ? "↑" : h.priorityAfter < h.priorityBefore ? "↓" : "="
            result.push(
              `[${formatTimeAgo(h.createdAt)}] ${arrow} ${h.priorityBefore.toFixed(1)} → ${h.priorityAfter.toFixed(1)}`,
            )
            result.push(`  Decay: ${h.decayBefore.toFixed(2)} → ${h.decayAfter.toFixed(2)} | ${h.reason}`)
          }

          // Show current state
          const current = database.get(sessionID, args.file)
          if (current) {
            result.push("")
            result.push(
              `Current: Priority ${current.priority.toFixed(1)}, Decay ${current.decayFactor.toFixed(2)}, Accesses ${current.accessCount}`,
            )
          }

          return result.join("\n")
        },
      },

      "context-overview": {
        description: "Combined overview of context status, health, and key metrics",
        args: {},
        async execute(_args: Record<string, never>, ctx: { sessionID: string }) {
          const sessionID = ctx.sessionID

          // Gather all key information
          const stats = database.getStatistics(sessionID)
          const health = database.calculateHealthScore(sessionID)
          const hotFiles = database.getHotFiles(sessionID, 5)
          const tracker = database.getSessionTokens(sessionID)
          const analytics = database.getSessionAnalytics(sessionID)
          const budgetUsage = Math.round((stats.totalTokens / DEFAULT_CONFIG.maxSessionMemoryTokens) * 100)

          const result: string[] = [
            "Context Overview",
            "================",
            "",
            `Health: ${health.grade} (${health.score}/100)`,
            `Budget: ${stats.totalTokens}/${DEFAULT_CONFIG.maxSessionMemoryTokens} tokens (${budgetUsage}%)`,
            `Loop: ${tracker?.loopCount || 0} | Duration: ${formatDuration(analytics.duration.totalMinutes)}`,
            "",
            `Entries: ${stats.totalMemoryEntries} total`,
            `  Files: ${stats.entriesByType.file || 0}`,
            `  Tools: ${stats.entriesByType.tool_output || 0}`,
            `  Decisions: ${stats.entriesByType.decision || 0}`,
            "",
            `Activity: ${analytics.activity.filesRead} reads, ${analytics.activity.filesWritten} writes, ${analytics.activity.toolCalls} tool calls`,
          ]

          if (hotFiles.length > 0) {
            result.push("")
            result.push("Hot Files:")
            for (const h of hotFiles.slice(0, 3)) {
              result.push(`  [${h.heatScore}] ${h.file.split("/").slice(-2).join("/")}`)
            }
          }

          // Show any warnings
          const warnings: string[] = []
          if (budgetUsage > 85) warnings.push("Token budget high - consider pruning")
          if (health.grade === "D" || health.grade === "F") warnings.push("Low health - run context-optimize")
          if (stats.avgDecayFactor < 0.5) warnings.push("High decay - context getting stale")

          if (warnings.length > 0) {
            result.push("")
            result.push("Warnings:")
            for (const w of warnings) {
              result.push(`  ! ${w}`)
            }
          }

          return result.join("\n")
        },
      },

      "context-template": {
        description: "Create and manage reusable context templates",
        args: {
          action: z.enum(["create", "list", "apply", "delete"]).describe("Action to perform"),
          name: z.string().optional().describe("Template name"),
          description: z.string().optional().describe("Template description"),
          includeHotFiles: z.boolean().optional().describe("Include current hot files (default: true)"),
          includeFocus: z.boolean().optional().describe("Include current focus paths"),
        },
        async execute(
          args: {
            action: "create" | "list" | "apply" | "delete"
            name?: string
            description?: string
            includeHotFiles?: boolean
            includeFocus?: boolean
          },
          ctx: { sessionID: string },
        ) {
          const sessionID = ctx.sessionID

          switch (args.action) {
            case "create": {
              if (!args.name) {
                return "Error: name required for create"
              }

              // Gather files to include
              const includeHot = args.includeHotFiles !== false
              const files: string[] = []

              if (includeHot) {
                const hotFiles = database.getHotFiles(sessionID, 15)
                files.push(...hotFiles.map((h) => h.file))
              }

              // Get focus paths if requested
              const focusPaths: string[] = []
              if (args.includeFocus) {
                const focused = database.getFocusedFiles(sessionID)
                const dirs = new Set<string>()
                for (const f of focused) {
                  const dir = f.key.split("/").slice(0, -1).join("/")
                  dirs.add(dir)
                }
                focusPaths.push(...dirs)
              }

              // Get patterns from current files
              const patterns: string[] = []
              const allFiles = database.getByType(sessionID, "file", 50)
              const patternCounts = new Map<string, number>()
              for (const f of allFiles) {
                const ps = ((f.metadata as Record<string, unknown>).codePatterns as Array<{ pattern: string }>) || []
                for (const p of ps) {
                  patternCounts.set(p.pattern, (patternCounts.get(p.pattern) || 0) + 1)
                }
              }
              const topPatterns = [...patternCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([p]) => p)
              patterns.push(...topPatterns)

              const id = database.createTemplate(
                projectID,
                args.name,
                files,
                focusPaths.length > 0 ? focusPaths : undefined,
                patterns.length > 0 ? patterns : undefined,
                args.description,
              )

              return [
                `Template created: ${args.name}`,
                `ID: ${id}`,
                `Files: ${files.length}`,
                `Focus paths: ${focusPaths.length}`,
                `Patterns: ${patterns.join(", ") || "none"}`,
              ].join("\n")
            }

            case "list": {
              const templates = database.getTemplates(projectID)
              if (templates.length === 0) {
                return "No templates found. Use action='create' to create one."
              }

              const result: string[] = [`Templates (${templates.length}):`]
              for (const t of templates) {
                result.push(`\n${t.name}`)
                result.push(`  Files: ${t.files.length} | ${formatTimeAgo(t.createdAt)}`)
                if (t.description) result.push(`  ${t.description}`)
              }

              return result.join("\n")
            }

            case "apply": {
              if (!args.name) {
                return "Error: name required for apply"
              }

              const result = database.applyTemplate(sessionID, projectID, args.name)
              if (result.filesApplied === 0 && !result.focusSet) {
                return `Template not found or no matching files: ${args.name}`
              }

              return [
                `Template applied: ${args.name}`,
                `Files boosted: ${result.filesApplied}`,
                `Focus set: ${result.focusSet ? "yes" : "no"}`,
              ].join("\n")
            }

            case "delete": {
              if (!args.name) {
                return "Error: name required for delete"
              }

              const deleted = database.deleteTemplate(projectID, args.name)
              return deleted ? `Template deleted: ${args.name}` : `Template not found: ${args.name}`
            }
          }
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
      const sessionID = hookInput.sessionID
      const tool = hookInput.tool

      // Track file reads
      if (tool === "read" || tool === "Read") {
        database.incrementFileReads(sessionID)

        // Check if we already have this file cached
        const filePath = output.args?.filePath as string | undefined
        if (filePath) {
          const existing = database.get(sessionID, filePath)
          if (existing) {
            // Boost priority since it's being re-read
            database.updatePriority(sessionID, filePath, Math.min(10, existing.priority + 1))

            // Smart context injection: boost related files
            const relatedFiles = database.getRelatedFiles(sessionID, filePath)
            for (const rel of relatedFiles) {
              const relatedEntry = database.get(sessionID, rel.file)
              if (relatedEntry) {
                // Boost related files slightly (they're contextually relevant)
                database.updatePriority(sessionID, rel.file, Math.min(10, relatedEntry.priority + 0.5))
              }
            }
          }
        }
      }

      // Track all tool calls
      database.incrementToolCalls(sessionID)
    },

    /**
     * After tool execution, capture relevant context (optimized)
     */
    async ["tool.execute.after"](
      hookInput: { tool: string; sessionID: string; callID: string },
      result:
        | {
            output?: string
            title?: string
            input?: Record<string, unknown>
            attachments?: unknown[]
          }
        | undefined,
    ): Promise<void> {
      if (!result?.output) return

      const sessionID = hookInput.sessionID
      const tool = hookInput.tool
      const output = result.output
      const loopID = getCurrentLoopID(sessionID)

      // Log timeline event for tool calls
      database.logTimelineEvent(sessionID, loopID, "tool_call", {
        tool,
        callID: hookInput.callID,
        outputLength: output.length,
      })

      // Handle file read tools
      if (tool === "read" || tool === "Read") {
        const filePath = extractFilePath(output, result.input)
        if (filePath) {
          // Log file read event
          database.logTimelineEvent(sessionID, loopID, "file_read", {
            file: filePath,
            size: output.length,
          })

          const metadata = extractFileMetadata(filePath, output)
          const summary = generateFileSummary(filePath, output, metadata)
          const semanticScore = calculateSemanticImportance(filePath, output, metadata)
          const codePatterns = detectCodePatterns(filePath, output, metadata)

          // Enhanced metadata with semantic analysis and patterns
          const enhancedMetadata = {
            ...metadata,
            semanticScore: semanticScore.score,
            semanticReasons: semanticScore.reasons,
            codePatterns: codePatterns.map((p) => ({ pattern: p.pattern, confidence: p.confidence })),
          }

          // Build enhanced summary with patterns
          const patternTags = codePatterns
            .slice(0, 2)
            .map((p) => p.pattern)
            .join(", ")
          const enhancedSummary = patternTags
            ? `${summary} [${patternTags}]`
            : semanticScore.reasons.length > 0
              ? `${summary} [${semanticScore.reasons.slice(0, 2).join(", ")}]`
              : summary

          database.store({
            sessionID,
            projectID,
            type: "file",
            key: filePath,
            summary: enhancedSummary,
            content: undefined, // Don't store full content to save space
            metadata: enhancedMetadata as unknown as Record<string, unknown>,
            tokenCount: estimateTokens(enhancedSummary),
            priority: semanticScore.score, // Use semantic score as priority
            createdAt: Date.now(),
            accessedAt: Date.now(),
            accessCount: 1,
          })

          database.storeWorkingMemory(
            sessionID,
            getCurrentLoopID(sessionID),
            filePath,
            summary,
            enhancedMetadata as unknown as Record<string, unknown>,
            semanticScore.score,
          )

          // Proactive pruning: limit file entries
          const fileCount = database.getEntryCount(sessionID, "file")
          if (fileCount > DEFAULT_CONFIG.maxFileEntriesPerSession) {
            database.proactivePrune(sessionID, DEFAULT_CONFIG.maxSessionMemoryTokens)
          }

          // Track file relationships based on imports
          for (const importPath of metadata.imports) {
            // Normalize relative imports to track relationships
            if (importPath.startsWith(".") || importPath.startsWith("@/") || importPath.startsWith("~/")) {
              database.storeRelationship(sessionID, filePath, importPath, "imports")
            }
          }
        }
      }

      // Handle search/grep results (very minimal storage)
      if (tool === "grep" || tool === "Grep" || tool === "glob" || tool === "Glob") {
        const summary = generateToolOutputSummary(tool, output, hookInput.callID)

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
        })

        // Limit tool outputs
        const toolCount = database.getEntryCount(sessionID, "tool_output")
        if (toolCount > DEFAULT_CONFIG.maxToolOutputsPerSession) {
          // Delete oldest tool outputs
          database.prune(sessionID, DEFAULT_CONFIG.pruneAfterAccesses)
        }
      }

      // Handle write/edit tools - boost priority for modified files
      if (tool === "write" || tool === "Write" || tool === "edit" || tool === "Edit") {
        const filePath = extractFilePath(output, result.input)
        if (filePath) {
          database.updatePriority(sessionID, filePath, 9) // High priority for modified files
          database.logDecision(sessionID, `Modified: ${filePath}`)

          // Log file write event
          database.logTimelineEvent(sessionID, loopID, "file_write", {
            file: filePath,
            tool,
          })
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
      const sessionID = hookInput.sessionID

      // Get current loop before incrementing
      const prevLoopID = getCurrentLoopID(sessionID)

      // Auto-create snapshot before compaction for rollback capability
      const stats = database.getStatistics(sessionID)
      if (stats.totalMemoryEntries > 5) {
        database.createSnapshot(sessionID, prevLoopID)
      }

      // Increment loop counter
      const loopNum = incrementLoop(sessionID)
      const newLoopID = getCurrentLoopID(sessionID)
      database.incrementLoopCount(sessionID)

      // Log compaction event
      database.logTimelineEvent(sessionID, newLoopID, "compaction", {
        prevLoop: prevLoopID,
        entriesBeforeCompaction: stats.totalMemoryEntries,
        tokensBeforeCompaction: stats.totalTokens,
      })

      // Apply decay to all entries
      database.applyDecay(sessionID, DEFAULT_CONFIG.priorityDecayRate)

      // Get context within token budget
      const entries = database.getContextBudget(sessionID, DEFAULT_CONFIG.maxSessionMemoryTokens)

      if (entries.length === 0) return

      // Detect clusters for organized context injection
      const clusters = database.detectClusters(sessionID)
      const hotFiles = database.getHotFiles(sessionID, 5)

      // Build cluster-aware context sections
      const clusterContext: string[] = []
      const unclustered: string[] = []
      const clusteredFiles = new Set<string>()

      // Add cluster summaries first (maintains logical groupings)
      for (const cluster of clusters.slice(0, 5)) {
        const clusterSummary = cluster.files
          .slice(0, 5)
          .map((f) => {
            const entry = entries.find((e) => e.key === f)
            clusteredFiles.add(f)
            return entry ? `  - ${entry.summary}` : null
          })
          .filter(Boolean)
          .join("\n")

        if (clusterSummary) {
          clusterContext.push(`### ${cluster.pattern}: ${cluster.name}\n${clusterSummary}`)
        }
      }

      // Add hot files section
      const hotFileSummaries: string[] = []
      for (const hot of hotFiles) {
        const entry = entries.find((e) => e.key === hot.file)
        if (entry && !clusteredFiles.has(hot.file)) {
          hotFileSummaries.push(`[Heat:${hot.heatScore}] ${entry.summary}`)
          clusteredFiles.add(hot.file)
        }
      }

      // Collect unclustered files
      for (const entry of entries) {
        if (entry.type === "file" && !clusteredFiles.has(entry.key)) {
          unclustered.push(entry.summary)
        }
      }

      // Get recent decisions
      const recentDecisions: string[] = []
      const decisions = database.getRecentDecisions(sessionID, 5)
      for (const d of decisions) {
        recentDecisions.push(d.decision)
      }

      // Inject organized context
      if (hotFileSummaries.length > 0) {
        output.context.push(`## Hot Files (Active Focus)\n${hotFileSummaries.join("\n")}`)
      }

      if (clusterContext.length > 0) {
        output.context.push(`## File Clusters\n${clusterContext.join("\n\n")}`)
      }

      if (unclustered.length > 0) {
        output.context.push(
          `## Other Files (${unclustered.length})\n${unclustered.slice(0, 10).join("\n")}${unclustered.length > 10 ? "\n..." : ""}`,
        )
      }

      if (recentDecisions.length > 0) {
        output.context.push(`## Recent Actions\n${recentDecisions.join("\n")}`)
      }

      // Add persistent project memory if enabled
      if (DEFAULT_CONFIG.enablePersistentMemory) {
        const projectMemory = database.getProjectMemory(projectID, 5)
        const projectContext = projectMemory
          .filter((m) => m.sessionID !== sessionID)
          .map((m) => m.summary)
          .slice(0, 3)

        if (projectContext.length > 0) {
          output.context.push(`## Project Memory\n${projectContext.join("\n")}`)
        }
      }

      // Add health indicator
      const health = database.calculateHealthScore(sessionID)
      output.context.push(`## Context Health: ${health.grade} (${health.score}/100)`)

      // Auto health monitoring - take action on poor health
      if (health.grade === "D" || health.grade === "F") {
        // Auto-compress if recommended
        if (health.recommendations.some((r) => r.includes("compress"))) {
          const compressed = database.compressSummaries(sessionID, 150)
          if (compressed > 0) {
            database.logDecision(sessionID, `Auto-compressed ${compressed} summaries (health: ${health.grade})`)
          }
        }
        // Auto-prune stale entries
        const aging = database.getAgingAnalytics(sessionID)
        if (aging.staleEntries > 5) {
          const pruned = database.proactivePrune(sessionID, DEFAULT_CONFIG.maxSessionMemoryTokens * 0.7)
          if (pruned > 0) {
            database.logDecision(sessionID, `Auto-pruned ${pruned} stale entries (health: ${health.grade})`)
          }
        }
      }

      // Token budget warning
      const budgetUsage = (stats.totalTokens / DEFAULT_CONFIG.maxSessionMemoryTokens) * 100
      if (budgetUsage > 85) {
        output.context.push(
          `## Warning: Token budget at ${Math.round(budgetUsage)}% - consider running context-optimize or context-prune-suggest`,
        )
      } else if (budgetUsage > 70) {
        output.context.push(`## Note: Token budget at ${Math.round(budgetUsage)}%`)
      }

      // Aggressive pruning after compaction
      database.prune(sessionID, DEFAULT_CONFIG.pruneAfterAccesses)

      // Clear old working memory
      const oldLoopID = `loop_${(loopCounterCache.get(sessionID) || 1) - 2}`
      database.clearWorkingMemory(sessionID, oldLoopID)
    },

    /**
     * On session stop, persist important context
     */
    async ["session.stop"](
      hookInput: {
        sessionID: string
        step: number
        lastAssistantText?: string
      },
      output: { stop: boolean; prompt?: string; systemMessage?: string },
    ): Promise<void> {
      // Boost priority for files mentioned in the final response
      if (hookInput.lastAssistantText) {
        const fileMatches = hookInput.lastAssistantText.matchAll(/`([^`]+\.[a-z]{1,5})`/g)
        for (const match of fileMatches) {
          database.updatePriority(hookInput.sessionID, match[1], 7)
        }

        // Log key decisions/completions mentioned
        const donePatterns = [/completed?\s+(.+)/gi, /finished?\s+(.+)/gi, /created?\s+(.+)/gi, /fixed?\s+(.+)/gi]

        for (const pattern of donePatterns) {
          const matches = hookInput.lastAssistantText.matchAll(pattern)
          for (const match of matches) {
            if (match[1] && match[1].length < 100) {
              database.logDecision(hookInput.sessionID, match[0].slice(0, 100))
            }
          }
        }
      }
    },
  }
}
