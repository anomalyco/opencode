/**
 * OpenCode Workflows —— Control_Signal 受控异常（pause / cancel）。
 *
 * JS 无协程挂起，无法冻结正在执行的 workflow 现场。pause/cancel 因此采用
 * **检查点停止**语义：`WorkflowEngine.pause/cancel` 在 `ActiveRun` 内存中置位
 * Control_Signal，由 Orchestration_API `agent()` 的**同步前导段**（`nextAgentIndex()`
 * 之后、首个 `await` 之前）读取并据此抛出本文件定义的受控异常，在「下一个 agent
 * 边界」短路当前执行体。
 *
 * 这两个异常**不是用户可见错误**（区别于 {@link WorkflowError}），而是引擎内部的
 * 控制流信号，仅用于在 `runWorkflow` 的 catch 分支中被识别与分流：
 * - {@link WorkflowPaused} → `updateRun({ status: "paused", endTime: null, durationMs: null })`
 *   （`paused` 为**非终态**，可经 resume 翻回 running）。
 * - {@link WorkflowCancelled} → `cancelRun(runId)`（终态 `cancelled`，幂等守卫）。
 *
 * 因检查点在 started 事件写入之前短路，被中止的 agent 天然不在 Journal 留下
 * started/成功 result 记录，resume 时据「completed 才复用」判定将其重跑而非复用
 * 半截结果（R4.6）。
 *
 * @see .kiro/specs/workflow-command-control/design.md — pause / resume / cancel 控制流
 * @see .kiro/specs/workflow-command-control/design.md — 3. WorkflowEngine / 4. Control_Signal 检查点
 * Requirements: 4.2, 5.1
 */

/**
 * pause 受控异常：由 `agent()` 准入检查点在读到 `pause` 信号时抛出，
 * 由 `runWorkflow` catch 分支识别并将 run 落为非终态 `paused`。
 *
 * @param runId 被暂停的 Run 标识（不含 `wf_` 前缀）。
 */
export class WorkflowPaused extends Error {
  constructor(public runId: string) {
    super("paused")
    this.name = "WorkflowPaused"
  }
}

/**
 * cancel 受控异常：由 `agent()` 准入检查点在读到 `cancel` 信号时抛出，
 * 由 `runWorkflow` catch 分支识别并将 run 落为终态 `cancelled`。
 *
 * @param runId 被取消的 Run 标识（不含 `wf_` 前缀）。
 */
export class WorkflowCancelled extends Error {
  constructor(public runId: string) {
    super("cancelled")
    this.name = "WorkflowCancelled"
  }
}
