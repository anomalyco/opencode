/**
 * OpenCode Workflows —— 统一错误类型体系。
 *
 * 所有用户可见错误均通过 {@link WorkflowError} 抛出，错误信息遵循
 * `[CODE] message` 格式并携带可选 context（文件路径、runId、agentIndex 等），
 * 不暴露内部堆栈（除非 debug 模式）。
 *
 * 错误码与触发条件对应 design.md 「Error Handling」一节的错误分类表。
 *
 * @see .kiro/specs/opencode-workflows/design.md — Error Handling
 * Requirements: 7.2
 */

/**
 * Workflow 错误码联合类型。
 *
 * 每个错误码对应一类触发条件（见 design.md 错误分类表）：
 * - `SCRIPT_NOT_FOUND`：.mjs 文件不存在或不可读
 * - `SCRIPT_SYNTAX_ERROR`：脚本语法错误或 import() 加载失败
 * - `META_INVALID`：meta 含非字面量、字段缺失/超长、phases 元素无效
 * - `AGENT_TIMEOUT`：单 Agent 执行超时（默认 300s）
 * - `AGENT_LIMIT_EXCEEDED`：单 Workflow Agent 调用总数达上限（默认 1000）
 * - `WORKFLOW_TIMEOUT`：Workflow 整体执行超时（默认开启时为 30 分钟，可配置或关闭）
 * - `SCHEMA_VALIDATION_ERROR`：结构化输出重试达上限后抛出，含字段路径+原因
 * - `NESTING_DEPTH_EXCEEDED`：workflow() 在子 workflow 内调用（超过一层嵌套）
 * - `WORKFLOW_NOT_FOUND`：workflow() 指定的 nameOrRef 无法解析
 * - `RESUME_INVALID`：resume 的 runId 无效或 Journal 缺失
 * - `HOOK_ERROR`：Hook 执行异常
 * - `RUN_NOT_CANCELLABLE`：cancel 非 running 状态的 run
 * - `RUN_NOT_DELETABLE`：delete 一个 running 状态的 run（D3：禁止删除 running）
 * - `PATH_NOT_ALLOWED`：run-workflow path 不在受控目录内
 * - `OPT_IN_REQUIRED`：（已停用）原用于缺少用户显式 opt-in 的场景；opt-in 门控移除后不再触发，
 *   定义保留仅为避免破坏导出与向后兼容
 * - `RUN_ID_AMBIGUOUS`：status/resume/cancel 给出的 runId 短前缀匹配到多个 run
 * - `REQUIRED_STEP_FAILED`：关键步在重试耗尽后仍无结果，受控终止 run
 */
export type WorkflowErrorCode =
  | "SCRIPT_NOT_FOUND"
  | "SCRIPT_SYNTAX_ERROR"
  | "META_INVALID" // 含非字面量、字段缺失/超长、phases 元素无效
  | "AGENT_TIMEOUT"
  | "AGENT_LIMIT_EXCEEDED" // 默认上限 1000
  | "WORKFLOW_TIMEOUT"
  | "SCHEMA_VALIDATION_ERROR" // 重试达上限后抛出，含字段路径
  | "NESTING_DEPTH_EXCEEDED"
  | "WORKFLOW_NOT_FOUND"
  | "RESUME_INVALID"
  | "HOOK_ERROR"
  | "RUN_NOT_CANCELLABLE" // cancel 非 running 状态的 run
  | "RUN_NOT_DELETABLE" // delete 一个 running 状态的 run（D3：禁止删除 running）
  | "PATH_NOT_ALLOWED" // run-workflow path 不在受控目录内
  | "OPT_IN_REQUIRED" // （已停用）opt-in 门控移除后不再触发，定义保留以避免破坏导出
  | "RUN_ID_AMBIGUOUS" // runId 短前缀匹配到多个 run，需补全
  | "REQUIRED_STEP_FAILED" // 关键步在重试耗尽后仍无结果，受控终止 run
  | "FANOUT_LIMIT_EXCEEDED" // parallel/pipeline 单次入参超过上限 4096

/**
 * 错误上下文。所有字段可选，用于携带定位错误所需的关键信息。
 *
 * 显式声明常用字段（filePath、runId、agentIndex）以获得类型提示，
 * 同时保留索引签名以容纳特定错误的额外上下文（如 fieldPath、reason、phaseIndex 等）。
 */
export interface WorkflowErrorContext {
  /** 相关脚本/文件路径 */
  filePath?: string
  /** 相关 Run 标识（不含 wf_ 前缀） */
  runId?: string
  /** 相关 Agent 调用序号 */
  agentIndex?: number
  /** 允许携带特定错误的额外上下文 */
  [key: string]: unknown
}

/**
 * Workflow 统一错误类。
 *
 * 构造时将错误码与消息组合为 `[CODE] message` 形式作为 Error.message，
 * 并保留原始 `code` 与可选 `context` 供调用方按结构化方式处理。
 *
 * @example
 * ```ts
 * throw new WorkflowError(
 *   "SCRIPT_NOT_FOUND",
 *   "脚本文件不存在或不可读",
 *   { filePath: "/path/to/workflow.mjs" },
 * )
 * // error.message === "[SCRIPT_NOT_FOUND] 脚本文件不存在或不可读"
 * // error.code === "SCRIPT_NOT_FOUND"
 * // error.context === { filePath: "/path/to/workflow.mjs" }
 * ```
 */
export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    message: string,
    public readonly context?: WorkflowErrorContext,
  ) {
    super(`[${code}] ${message}`)
    this.name = "WorkflowError"
    // 维持 instanceof 在向下编译到 ES5 目标时的正确性
    Object.setPrototypeOf(this, WorkflowError.prototype)
  }
}

/**
 * 类型守卫：判断任意值是否为 {@link WorkflowError} 实例。
 */
export function isWorkflowError(value: unknown): value is WorkflowError {
  return value instanceof WorkflowError
}
