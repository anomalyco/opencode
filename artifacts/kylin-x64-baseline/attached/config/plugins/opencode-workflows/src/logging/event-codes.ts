/**
 * OpenCode Workflows —— WF 日志 / 可观测性：关键后台事件分类码（Event_Code）。
 *
 * 后台 fire-and-forget 执行体（`runWorkflow`）生命周期中今天被静默吞掉的关键事件
 * （Run_Background_Event）—— 脚本加载失败、agent 创建失败、SDK 调用异常、agent 超时、
 * cancel/pause 级联、整体超时、孤儿回收、持久化失败、Hook 跳过/超时/安全默认 reject ——
 * 每一类事件都被赋予一个**稳定且一一对应**的 `eventCode`：同一类事件每次均产生相同的码，
 * 不同类事件的码互不相同。该码随对应 Log_Entry 一并记录，使后台运行可按事件类别分类追溯。
 *
 * 设计取向：尽量复用既有 {@link WorkflowErrorCode} 的语义。其中
 * - `AGENT_TIMEOUT`（单 Agent 执行超时）与
 * - `WORKFLOW_TIMEOUT`（Workflow 整体执行超时）
 * 两个码与 `WorkflowErrorCode` 中的同名码取相同字面量、语义对齐；
 * 其余事件（脚本加载失败、session 创建失败、SDK 异常、cancel/pause 级联、孤儿回收、
 * 持久化失败、Hook 三态）为本日志能力定义的专用事件码。
 *
 * @see .kiro/specs/workflow-logging/design.md — Data Models / Event_Code 枚举
 * @see ./errors.ts — WorkflowErrorCode（AGENT_TIMEOUT / WORKFLOW_TIMEOUT 语义来源）
 * Requirements: 4.10
 */

/**
 * Run_Background_Event 事件分类码常量映射。
 *
 * 每一类后台关键事件对应一个稳定字面量码（键名与值相等，便于直接以码字符串检索）：
 * - `SCRIPT_LOAD_FAILED`：脚本加载（`load`）在后台执行体中失败（R4.1）
 * - `AGENT_SESSION_CREATE_FAILED`：Agent_Executor 创建子 session 失败（R4.2）
 * - `AGENT_SDK_ERROR`：Agent_Executor 的 SDK 调用抛出未知异常被吞为 `null`（R4.3）
 * - `AGENT_RETRY`：Agent_Executor 遇 Transient_Error 进行指数退避重试（WARN，P5-A / R5.1）
 * - `AGENT_TIMEOUT`：单 Agent 执行超时触发 `session.abort()`（R4.4，复用
 *   {@link WorkflowErrorCode} 中同名码的语义）
 * - `RUN_CANCELLED`：某 Run 被 cancel 并级联 abort 子 session（R4.5）
 * - `RUN_PAUSED`：某 Run 被 pause 并级联 abort 子 session（R4.6）
 * - `WORKFLOW_TIMEOUT`：某 Run 因整体超时（`workflowTimeout`）被置为 `failed`（R4.7，复用
 *   {@link WorkflowErrorCode} 中同名码的语义）
 * - `ORPHAN_RECOVERED`：孤儿回收（`recoverOrphans`）将某 Run 标记为 `failed`（R4.8）
 * - `PERSIST_FAILED`：State_Store 持久化写入（Snapshot/Journal/Script）失败（R4.9 / R7.1）
 * - `HOOK_SKIPPED`：Hook 跳过（R7.2）
 * - `HOOK_TIMEOUT`：Hook 超时（R7.3）
 * - `HOOK_SAFE_DEFAULT_REJECT`：Hook 出错并触发安全默认 reject（R7.4）
 */
export const WORKFLOW_EVENT_CODES = {
  SCRIPT_LOAD_FAILED: "SCRIPT_LOAD_FAILED",
  AGENT_SESSION_CREATE_FAILED: "AGENT_SESSION_CREATE_FAILED",
  AGENT_SDK_ERROR: "AGENT_SDK_ERROR",
  AGENT_RETRY: "AGENT_RETRY",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  RUN_CANCELLED: "RUN_CANCELLED",
  RUN_PAUSED: "RUN_PAUSED",
  WORKFLOW_TIMEOUT: "WORKFLOW_TIMEOUT",
  ORPHAN_RECOVERED: "ORPHAN_RECOVERED",
  PERSIST_FAILED: "PERSIST_FAILED",
  HOOK_SKIPPED: "HOOK_SKIPPED",
  HOOK_TIMEOUT: "HOOK_TIMEOUT",
  HOOK_SAFE_DEFAULT_REJECT: "HOOK_SAFE_DEFAULT_REJECT",
} as const

/**
 * Run_Background_Event 事件分类码联合类型。
 *
 * 取值恒为 {@link WORKFLOW_EVENT_CODES} 中某个键对应的字面量字符串，
 * 供 Log_Entry 的 `eventCode` 字段与各核心模块记录日志时使用。
 */
export type WorkflowEventCode =
  (typeof WORKFLOW_EVENT_CODES)[keyof typeof WORKFLOW_EVENT_CODES]
