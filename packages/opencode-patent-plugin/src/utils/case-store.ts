/**
 * 案件数据存储（Plugin 自建 SQLite）
 *
 * CONSTITUTION 第二十四条：Plugin 自建数据表管理案件复杂数据。
 * 使用 Bun 原生 SQLite，与 obsidian-index.ts 同模式。
 *
 * 三张表：
 * - patent_cases: 案件元数据（对应 OpenCode Project）
 * - patent_documents: 案件文档（关联文件路径 + 版本）
 * - patent_tasks: 案件任务（关联 OpenCode Session）
 */

import { Database } from "bun:sqlite"
import { join } from "path"
import { randomUUID } from "crypto"

/** SQLite 数据库路径 */
const DB_PATH = join(
  process.env.XDG_DATA_HOME || join(process.env.HOME || "~", ".local/share"),
  "opencode-patent-plugin",
  "cases.sqlite",
)

// ========== 类型定义 ==========

/** 案件状态 */
export type CaseStatus = "active" | "closed" | "archived"

/** 专利类型 */
export type PatentType = "发明" | "实用新型" | "外观设计"

/** 文档类型 */
export type DocType =
  | "disclosure"        // 技术交底书
  | "specification"     // 说明书
  | "claims"            // 权利要求书
  | "abstract"          // 摘要
  | "office_action"     // 审查意见通知书
  | "response"          // 意见陈述书
  | "reexam_request"    // 复审请求书
  | "invalidation_req"  // 无效宣告请求书
  | "invalidation_def"  // 无效答辩意见
  | "search_report"     // 检索报告
  | "analysis_report"   // 分析报告
  | "other"             // 其他

/** 任务类型 */
export type TaskType = "research" | "draft" | "oa" | "reexam" | "invalidation" | "analyze" | "check"

/** 任务状态 */
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed"

/** 案件记录 */
export interface PatentCase {
  id: string
  application_no: string | null
  patent_type: PatentType | null
  title: string | null
  status: CaseStatus
  metadata: Record<string, unknown>
  created_at: number
  updated_at: number
}

/** 文档记录 */
export interface PatentDocument {
  id: string
  case_id: string
  doc_type: DocType
  file_path: string | null
  content_hash: string | null
  version: number
  metadata: Record<string, unknown>
  created_at: number
}

/** 任务记录 */
export interface PatentTask {
  id: string
  case_id: string | null
  session_id: string | null
  task_type: TaskType
  status: TaskStatus
  tool_name: string | null
  action: string | null
  output_summary: string | null
  created_at: number
  completed_at: number | null
}

// ========== 存储类 ==========

/**
 * 案件数据存储
 */
export class CaseStore {
  private db: Database

  constructor(dbPath: string = DB_PATH) {
    // 确保目录存在
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"))
    try {
      Bun.write(dir + "/.gitkeep", "")
    } catch {
      // 目录可能已存在
    }

    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode=WAL")
    this.db.exec("PRAGMA busy_timeout = 5000")
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS patent_cases (
        id TEXT PRIMARY KEY,
        application_no TEXT,
        patent_type TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS patent_documents (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES patent_cases(id),
        doc_type TEXT NOT NULL,
        file_path TEXT,
        content_hash TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS patent_tasks (
        id TEXT PRIMARY KEY,
        case_id TEXT REFERENCES patent_cases(id),
        session_id TEXT,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        tool_name TEXT,
        action TEXT,
        output_summary TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER
      )
    `)

    // 索引
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_cases_status ON patent_cases(status)")
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_docs_case ON patent_documents(case_id)")
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_case ON patent_tasks(case_id)")
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_session ON patent_tasks(session_id)")
  }

  // ========== 案件 CRUD ==========

  createCase(data: {
    applicationNo?: string
    patentType?: PatentType
    title?: string
    metadata?: Record<string, unknown>
  }): PatentCase {
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(`
      INSERT INTO patent_cases (id, application_no, patent_type, title, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.applicationNo || null, data.patentType || null, data.title || null, JSON.stringify(data.metadata || {}), now, now)

    return this.getCase(id)!
  }

  getCase(id: string): PatentCase | null {
    const row = this.db.prepare("SELECT * FROM patent_cases WHERE id = ?").get(id) as any
    if (!row) return null
    return { ...row, metadata: JSON.parse(row.metadata) }
  }

  listCases(status?: CaseStatus): PatentCase[] {
    const sql = status
      ? "SELECT * FROM patent_cases WHERE status = ? ORDER BY updated_at DESC"
      : "SELECT * FROM patent_cases ORDER BY updated_at DESC"
    const rows = status
      ? this.db.prepare(sql).all(status) as any[]
      : this.db.prepare(sql).all() as any[]
    return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata) }))
  }

  updateCase(id: string, data: Partial<Pick<PatentCase, "application_no" | "patent_type" | "title" | "status" | "metadata">>): PatentCase | null {
    const existing = this.getCase(id)
    if (!existing) return null

    const now = Math.floor(Date.now() / 1000)
    const fields: string[] = []
    const values: any[] = []

    for (const [key, value] of Object.entries(data)) {
      fields.push(`${key} = ?`)
      values.push(key === "metadata" ? JSON.stringify(value) : value)
    }

    fields.push("updated_at = ?")
    values.push(now)
    values.push(id)

    this.db.prepare(`UPDATE patent_cases SET ${fields.join(", ")} WHERE id = ?`).run(...values)
    return this.getCase(id)
  }

  // ========== 文档管理 ==========

  addDocument(data: {
    caseId: string
    docType: DocType
    filePath?: string
    contentHash?: string
    metadata?: Record<string, unknown>
  }): PatentDocument {
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    // 自动计算版本号
    const existing = this.db.prepare(
      "SELECT MAX(version) as max_ver FROM patent_documents WHERE case_id = ? AND doc_type = ?"
    ).get(data.caseId, data.docType) as any
    const version = (existing?.max_ver || 0) + 1

    this.db.prepare(`
      INSERT INTO patent_documents (id, case_id, doc_type, file_path, content_hash, version, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.caseId, data.docType, data.filePath || null, data.contentHash || null, version, JSON.stringify(data.metadata || {}), now)

    return { id, case_id: data.caseId, doc_type: data.docType, file_path: data.filePath || null, content_hash: data.contentHash || null, version, metadata: data.metadata || {}, created_at: now }
  }

  listDocuments(caseId: string, docType?: DocType): PatentDocument[] {
    const sql = docType
      ? "SELECT * FROM patent_documents WHERE case_id = ? AND doc_type = ? ORDER BY version DESC"
      : "SELECT * FROM patent_documents WHERE case_id = ? ORDER BY doc_type, version DESC"
    const rows = docType
      ? this.db.prepare(sql).all(caseId, docType) as any[]
      : this.db.prepare(sql).all(caseId) as any[]
    return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata) }))
  }

  // ========== 任务管理 ==========

  createTask(data: {
    caseId?: string
    sessionId?: string
    taskType: TaskType
    toolName?: string
    action?: string
  }): PatentTask {
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    this.db.prepare(`
      INSERT INTO patent_tasks (id, case_id, session_id, task_type, status, tool_name, action, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, data.caseId || null, data.sessionId || null, data.taskType, data.toolName || null, data.action || null, now)

    return { id, case_id: data.caseId || null, session_id: data.sessionId || null, task_type: data.taskType, status: "pending", tool_name: data.toolName || null, action: data.action || null, output_summary: null, created_at: now, completed_at: null }
  }

  completeTask(id: string, outputSummary?: string): PatentTask | null {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(`
      UPDATE patent_tasks SET status = 'completed', output_summary = ?, completed_at = ? WHERE id = ?
    `).run(outputSummary || null, now, id)
    return this.getTask(id)
  }

  failTask(id: string, error: string): PatentTask | null {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(`
      UPDATE patent_tasks SET status = 'failed', output_summary = ?, completed_at = ? WHERE id = ?
    `).run(error, now, id)
    return this.getTask(id)
  }

  getTask(id: string): PatentTask | null {
    return this.db.prepare("SELECT * FROM patent_tasks WHERE id = ?").get(id) as PatentTask | null
  }

  listTasks(caseId?: string, limit: number = 50): PatentTask[] {
    const sql = caseId
      ? "SELECT * FROM patent_tasks WHERE case_id = ? ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM patent_tasks ORDER BY created_at DESC LIMIT ?"
    return (caseId
      ? this.db.prepare(sql).all(caseId, limit)
      : this.db.prepare(sql).all(limit)) as PatentTask[]
  }

  // ========== 工具方法 ==========

  /** 获取统计信息 */
  getStats(): { cases: number; documents: number; tasks: number } {
    const cases = (this.db.prepare("SELECT COUNT(*) as c FROM patent_cases").get() as any).c
    const documents = (this.db.prepare("SELECT COUNT(*) as c FROM patent_documents").get() as any).c
    const tasks = (this.db.prepare("SELECT COUNT(*) as c FROM patent_tasks").get() as any).c
    return { cases, documents, tasks }
  }

  close() {
    this.db.close()
  }
}

// ========== 全局实例 ==========

let globalStore: CaseStore | null = null

export function getCaseStore(): CaseStore {
  if (!globalStore) {
    globalStore = new CaseStore()
  }
  return globalStore
}
