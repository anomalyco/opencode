/**
 * 工作流模板存储
 *
 * 记录用户重复执行的任务流程，抽象为可复用的模板。
 * 核心思路：多次执行相同模式 → 自动识别 → 生成模板 → 下次推荐
 */

import { Database } from "bun:sqlite"
import { join } from "path"
import { randomUUID } from "crypto"
import type { TaskType } from "./case-store.js"

// ========== 类型 ==========

export interface WorkflowStep {
  toolName: string
  action: string
  description: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  taskType: TaskType
  steps: WorkflowStep[]
  usageCount: number
  lastUsed: number
  createdAt: number
}

export interface WorkflowExecution {
  id: string
  templateId: string | null
  sessionId: string
  stepsJson: string
  startedAt: number
  completedAt: number | null
}

// ========== 存储 ==========

const DB_PATH = join(
  process.env.XDG_DATA_HOME || join(process.env.HOME || "~", ".local/share"),
  "opencode-patent-plugin",
  "workflows.sqlite",
)

export class WorkflowStore {
  private db: Database

  constructor(dbPath: string = DB_PATH) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"))
    try { Bun.write(dir + "/.gitkeep", "") } catch { /* exists */ }

    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode=WAL")
    this.db.exec("PRAGMA busy_timeout = 5000")
    this.initSchema()
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        task_type TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        session_id TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_states (
        session_id TEXT PRIMARY KEY,
        workflow_type TEXT NOT NULL,
        case_id TEXT,
        current_step INTEGER NOT NULL,
        total_steps INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        step_outputs_json TEXT NOT NULL DEFAULT '{}',
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tmpl_type ON workflow_templates(task_type)")
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_exec_session ON workflow_executions(session_id)")
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_state_status ON workflow_states(status)")
  }

  // ========== 模板管理 ==========

  /** 保存或更新工作流模板 */
  saveTemplate(data: {
    name: string
    taskType: TaskType
    steps: WorkflowStep[]
  }): WorkflowTemplate {
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    this.db.prepare(`
      INSERT INTO workflow_templates (id, name, task_type, steps_json, usage_count, last_used, created_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(id, data.name, data.taskType, JSON.stringify(data.steps), now, now)

    return { id, name: data.name, taskType: data.taskType, steps: data.steps, usageCount: 0, lastUsed: now, createdAt: now }
  }

  /** 按类型查找模板 */
  findTemplates(taskType: TaskType): WorkflowTemplate[] {
    const rows = this.db.prepare(
      "SELECT * FROM workflow_templates WHERE task_type = ? ORDER BY usage_count DESC, last_used DESC",
    ).all(taskType) as any[]

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      taskType: r.task_type,
      steps: JSON.parse(r.steps_json),
      usageCount: r.usage_count,
      lastUsed: r.last_used,
      createdAt: r.created_at,
    }))
  }

  /** 增加模板使用次数 */
  incrementUsage(templateId: string): void {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(
      "UPDATE workflow_templates SET usage_count = usage_count + 1, last_used = ? WHERE id = ?",
    ).run(now, templateId)
  }

  /** 列出所有模板 */
  listTemplates(): WorkflowTemplate[] {
    const rows = this.db.prepare(
      "SELECT * FROM workflow_templates ORDER BY usage_count DESC",
    ).all() as any[]
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      taskType: r.task_type,
      steps: JSON.parse(r.steps_json),
      usageCount: r.usage_count,
      lastUsed: r.last_used,
      createdAt: r.created_at,
    }))
  }

  // ========== 执行记录 ==========

  /** 记录一次工作流执行 */
  recordExecution(data: {
    templateId?: string
    sessionId: string
    steps: WorkflowStep[]
  }): string {
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    this.db.prepare(`
      INSERT INTO workflow_executions (id, template_id, session_id, steps_json, started_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, data.templateId || null, data.sessionId, JSON.stringify(data.steps), now)

    if (data.templateId) {
      this.incrementUsage(data.templateId)
    }

    return id
  }

  /** 完成执行 */
  completeExecution(executionId: string): void {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(
      "UPDATE workflow_executions SET completed_at = ? WHERE id = ?",
    ).run(now, executionId)
  }

  /** 按 session 获取执行历史 */
  getSessionExecutions(sessionId: string): WorkflowExecution[] {
    return this.db.prepare(
      "SELECT * FROM workflow_executions WHERE session_id = ? ORDER BY started_at DESC",
    ).all(sessionId) as WorkflowExecution[]
  }

  // ========== 工作流状态持久化 ==========

  saveWorkflowState(state: {
    sessionId: string
    workflowType: string
    caseId: string | null
    currentStep: number
    totalSteps: number
    status: string
    stepOutputs: Record<string, string>
    startedAt: number
  }): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT OR REPLACE INTO workflow_states
        (session_id, workflow_type, case_id, current_step, total_steps, status, step_outputs_json, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      state.sessionId,
      state.workflowType,
      state.caseId ?? null,
      state.currentStep,
      state.totalSteps,
      state.status,
      JSON.stringify(state.stepOutputs),
      state.startedAt,
      now,
    )
  }

  loadWorkflowState(sessionId: string): {
    sessionId: string
    workflowType: string
    caseId: string | null
    currentStep: number
    totalSteps: number
    status: string
    stepOutputs: Record<string, string>
    startedAt: number
  } | null {
    const row = this.db.prepare(
      "SELECT * FROM workflow_states WHERE session_id = ?",
    ).get(sessionId) as any
    if (!row) return null
    return {
      sessionId: row.session_id,
      workflowType: row.workflow_type,
      caseId: row.case_id,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      status: row.status,
      stepOutputs: JSON.parse(row.step_outputs_json || "{}"),
      startedAt: row.started_at,
    }
  }

  deleteWorkflowState(sessionId: string): void {
    this.db.prepare("DELETE FROM workflow_states WHERE session_id = ?").run(sessionId)
  }

  /** 恢复所有未完成的工作流状态 */
  loadActiveWorkflowStates(): Array<{
    sessionId: string
    workflowType: string
    caseId: string | null
    currentStep: number
    totalSteps: number
    status: string
    stepOutputs: Record<string, string>
    startedAt: number
  }> {
    const rows = this.db.prepare(
      "SELECT * FROM workflow_states WHERE status IN ('running', 'paused') ORDER BY updated_at DESC",
    ).all() as any[]
    return rows.map(row => ({
      sessionId: row.session_id,
      workflowType: row.workflow_type,
      caseId: row.case_id,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      status: row.status,
      stepOutputs: JSON.parse(row.step_outputs_json || "{}"),
      startedAt: row.started_at,
    }))
  }

  close() {
    this.db.close()
  }
}

// ========== 全局实例 ==========

let globalStore: WorkflowStore | null = null

export function getWorkflowStore(): WorkflowStore {
  if (!globalStore) {
    globalStore = new WorkflowStore()
  }
  return globalStore
}

/**
 * 关闭全局 WorkflowStore 单例（应用退出时调用）
 */
export function closeStore(): void {
  if (globalStore) {
    globalStore.close()
    globalStore = null
  }
}
