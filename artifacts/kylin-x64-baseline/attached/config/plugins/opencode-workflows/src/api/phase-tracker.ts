/**
 * OpenCode Workflows —— 阶段归属追踪器（Phase Tracker）。
 *
 * 实现编排 API 的 `phase()` 阶段管理语义（R5.1）：
 * - `phase(title)` 声明「当前阶段」，title 必须与 `meta.phases[].title`
 *   **大小写精确匹配**（case-sensitive exact equality）；不匹配任何已声明阶段时
 *   抛出描述性 {@link WorkflowError}（`META_INVALID`）。
 * - 后续未显式指定 `opts.phase` 的 `agent()` 调用归入「最近一次声明的阶段」（当前阶段）。
 * - `agent()` 的显式 `opts.phase` 对**该次调用**覆盖当前阶段；此覆盖是**逐调用（per-call）**的，
 *   **不改变**追踪器的当前阶段（这正是 parallel()/pipeline() 内部必须使用 opts.phase
 *   以避免竞争全局 phase 状态的原因，R4.2）。
 *
 * 设计取舍（在 design.md / 任务说明基础上明确的实现选择）：
 *
 * 1. **不匹配即抛错**：R5.1 要求 title 与 `meta.phases[].title` 大小写精确匹配，
 *    故对不匹配的 `phase(title)` 采取「抛出 `META_INVALID`」的安全解释——
 *    阶段归属只能指向已声明阶段，避免静默归入未声明阶段导致 TUI 分组错乱。
 *
 * 2. **首个 phase() 之前的行为**：在任何 `phase()` 调用之前，当前阶段为
 *    `undefined`（`current()` 返回 `undefined`，`resolve()` 在无显式 phase 时返回
 *    `undefined`）。本模块保持纯内存、不臆造默认阶段标题；如何把「无阶段」的
 *    agent() 映射为 TUI 上的默认分组（如 `(default)`）由装配层（task 11.3）决定，
 *    此处不内联该策略，保持单一职责。
 *
 * 3. **显式覆盖也校验**：`resolve(explicitPhase)` 在 explicitPhase 非空时同样要求其
 *    与已声明阶段大小写精确匹配，不匹配则抛 `META_INVALID`。这保证「任何阶段归属
 *    （无论来自 phase() 还是 opts.phase）都必须指向已声明阶段」这一不变量的一致性。
 *
 * 本模块为纯内存、无副作用的同步实现；与 Agent_Executor / StateStore 的接线
 * 由 Orchestration_API 装配阶段（task 11.3）完成。
 *
 * @see .kiro/specs/opencode-workflows/design.md — Orchestration_API / Property 8（Phase 归属分配）
 * Requirements: 5.1
 */

import type { PhaseDefinition } from "../types"
import { WorkflowError } from "../errors"

/**
 * 阶段归属追踪器的公开形状。
 *
 * 由 Orchestration_API 在每个 Run 内创建一个实例：`phase()` 写入当前阶段，
 * `agent()` 通过 `resolve(opts?.phase)` 求出该次调用应归属的阶段标题。
 */
export interface PhaseTracker {
  /**
   * 声明新的当前阶段。
   *
   * @param title 阶段标题，必须与某个 `meta.phases[].title` **大小写精确匹配**。
   * @throws {WorkflowError} `META_INVALID` —— title 不匹配任何已声明阶段标题时抛出。
   */
  phase(title: string): void
  /**
   * 返回当前阶段标题；在首个 `phase()` 调用之前为 `undefined`。
   */
  current(): string | undefined
  /**
   * 求出某次 `agent()` 调用应归属的阶段标题。
   *
   * - 传入非空 `explicitPhase`（即 `opts.phase`）：作为**逐调用覆盖**返回该值，
   *   且同样要求其与已声明阶段大小写精确匹配（不匹配抛 `META_INVALID`）；
   *   此覆盖**不改变**当前阶段。
   * - 未传 `explicitPhase`（或为 `undefined`）：返回当前阶段（可能为 `undefined`）。
   *
   * @throws {WorkflowError} `META_INVALID` —— explicitPhase 非空且不匹配任何已声明阶段标题时抛出。
   */
  resolve(explicitPhase?: string): string | undefined
}

/**
 * 创建一个阶段归属追踪器。
 *
 * @param declaredPhases 来自 `meta.phases` 的阶段定义数组（可为空或省略，
 *        表示该 workflow 未声明任何阶段——此时任何 `phase()` / 显式 `opts.phase`
 *        都将因无可匹配项而抛 `META_INVALID`，而无显式 phase 的 agent() 归属为
 *        `undefined`）。
 */
export function createPhaseTracker(declaredPhases: PhaseDefinition[] = []): PhaseTracker {
  // 预构建已声明阶段标题集合，供 O(1) 大小写精确匹配校验。
  const declaredTitles = new Set<string>(declaredPhases.map((p) => p.title))

  let currentPhase: string | undefined = undefined

  /**
   * 校验给定标题是否与某个已声明阶段标题大小写精确匹配，不匹配则抛出描述性错误。
   * Set.has 本身即大小写敏感的精确比较，满足 R5.1「大小写精确匹配」。
   */
  function assertDeclared(title: string): void {
    if (!declaredTitles.has(title)) {
      const known = declaredTitles.size > 0 ? Array.from(declaredTitles).join(", ") : "（meta.phases 未声明任何阶段）"
      throw new WorkflowError(
        "META_INVALID",
        `阶段标题 "${title}" 与 meta.phases[].title 不匹配（要求大小写精确匹配）。已声明阶段：${known}`,
        { phaseTitle: title, declaredPhases: Array.from(declaredTitles) },
      )
    }
  }

  return {
    phase(title: string): void {
      assertDeclared(title)
      currentPhase = title
    },

    current(): string | undefined {
      return currentPhase
    },

    resolve(explicitPhase?: string): string | undefined {
      if (explicitPhase !== undefined) {
        assertDeclared(explicitPhase)
        return explicitPhase
      }
      return currentPhase
    },
  }
}
