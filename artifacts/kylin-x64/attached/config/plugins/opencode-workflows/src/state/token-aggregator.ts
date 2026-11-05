/**
 * OpenCode Workflows —— Token 聚合器（Token Aggregator，input+output 口径）。
 *
 * 本模块负责 Run Snapshot 的 `totalTokens` 聚合：
 *
 *     totalTokens = Σ(input_tokens + output_tokens)  —— 跨当前 Run 内所有 Agent
 *
 * 该口径用于**成本统计与 UI 展示**（R14.3）：
 *
 * - `token-aggregator`（本模块）：`totalTokens` = Σ(input + output)，喂给
 *   {@link RunSnapshot.totalTokens}，供成本统计 / UI 显示；另提供 `totalInput()` /
 *   `totalOutput()` 供诊断与口径对照。
 *
 * 职责边界：State_Store（src/state/state-store.ts，task 6.1）**存储** `totalTokens` 字段，
 * 但**不计算**聚合；本模块提供聚合能力。编排 / 执行层（task 8.3 / 11.3）在每个 agent()
 * 完成时调用 {@link TokenAggregator.add} 累加用量，并把运行中的 {@link TokenAggregator.totalTokens}
 * 推入 StateStore 的 Snapshot。
 *
 * 输入校验：每笔记录的 input / output 必须为**非负有限整数**（拒绝 NaN / Infinity /
 * 负数 / 小数），以保持算术一致性（Property 13 将对此进行属性测试）。
 *
 * 本模块为纯内存实现，无副作用、无 I/O。
 *
 * @see .kiro/specs/opencode-workflows/design.md — Property 13（Token 聚合一致性）
 * Requirements: 14.1, 14.2, 14.3
 */

import { WorkflowError } from "../errors"

/**
 * 单笔 token 用量记录（来自一次 agent() 完成）。
 *
 * 形状对齐 {@link import("../types").AgentResult.tokens}（`{ input, output }`），
 * 便于执行层直接转发 `result.tokens`。
 */
export interface TokenUsage {
  /** 本次 Agent 调用消耗的 input_tokens（非负有限整数） */
  input: number
  /** 本次 Agent 调用消耗的 output_tokens（非负有限整数） */
  output: number
}

/**
 * Token 聚合器（input+output 口径）。
 *
 * 累加各 Agent 的 input / output 用量，对外暴露 `totalTokens()`（= input+output 之和），
 * 并提供 `totalInput()` / `totalOutput()` 便于诊断与口径对照。
 */
export interface TokenAggregator {
  /**
   * 累加一次 Agent 的 token 用量。
   * @param input 本次的 input_tokens（非负有限整数）
   * @param output 本次的 output_tokens（非负有限整数）
   * @throws {WorkflowError} 当 input / output 非「非负有限整数」时抛出（code 复用 `META_INVALID`）
   */
  add(input: number, output: number): void
  /**
   * 累加一次 Agent 的 token 用量（对象形式，便于直接转发 `AgentResult.tokens`）。
   * @throws {WorkflowError} 当 input / output 非「非负有限整数」时抛出
   */
  addUsage(usage: TokenUsage): void
  /** input + output 之和（成本统计 / UI 口径，喂给 RunSnapshot.totalTokens）。 */
  totalTokens(): number
  /** 已记录的 input_tokens 之和（便于诊断 / 口径对照）。 */
  totalInput(): number
  /** 已记录的 output_tokens 之和（便于诊断 / 口径对照）。 */
  totalOutput(): number
  /** 重置累加器（新 Run 时调用）。 */
  reset(): void
}

/**
 * 校验单个 token 计数为「非负有限整数」，否则抛出 {@link WorkflowError}。
 *
 * 拒绝 NaN / ±Infinity / 负数 / 小数，保证累加结果始终为精确整数（Property 13）。
 */
function assertNonNegativeInteger(value: number, field: "input" | "output"): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new WorkflowError(
      "META_INVALID",
      `token 用量非法：${field} 必须为非负有限整数，收到 ${String(value)}`,
      { [field]: value },
    )
  }
}

/**
 * 创建一个 Token 聚合器（input+output 口径）。
 *
 * @example
 * ```ts
 * const agg = createTokenAggregator()
 * agg.add(100, 40)                 // input=100, output=40
 * agg.addUsage({ input: 10, output: 5 })
 * agg.totalTokens()                // 155 = (100+40) + (10+5)
 * agg.totalInput()                 // 110
 * agg.totalOutput()                // 45
 * ```
 */
export function createTokenAggregator(): TokenAggregator {
  let inputSum = 0
  let outputSum = 0

  const aggregator: TokenAggregator = {
    add(input: number, output: number): void {
      assertNonNegativeInteger(input, "input")
      assertNonNegativeInteger(output, "output")
      inputSum += input
      outputSum += output
    },

    addUsage(usage: TokenUsage): void {
      aggregator.add(usage.input, usage.output)
    },

    totalTokens(): number {
      return inputSum + outputSum
    },

    totalInput(): number {
      return inputSum
    },

    totalOutput(): number {
      return outputSum
    },

    reset(): void {
      inputSum = 0
      outputSum = 0
    },
  }

  return aggregator
}
