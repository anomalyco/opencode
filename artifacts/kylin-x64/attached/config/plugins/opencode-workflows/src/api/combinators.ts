/**
 * OpenCode Workflows —— 编排组合子 parallel() 与 pipeline()。
 *
 * 本模块实现两个**纯控制流**组合子，不耦合 agentIndex 分配、Agent_Executor
 * 或 StateStore——这些接线由 Orchestration_API 装配阶段（任务 11.3）完成。
 * 组合子对外保持泛型，仅以 {@link Thunk}（延迟异步函数）与 {@link PipelineStage}
 * （流水线阶段回调）为输入单元，使上层可自由组合。
 *
 * 语义严格对应技术设计文档 design.md「Orchestration_API」与「Correctness
 * Properties」中的 Property 3 / Property 4：
 *
 * - `parallel(thunks)`：barrier 语义——并发执行所有 thunk 并**等待全部完成**；
 *   某 thunk 抛出/reject 时其对应位置的结果置为 `null`，`parallel()` 本身永不
 *   reject；结果数组与输入 thunks 数组**索引一一对应**（R4.6、R4.7、R4.8、R13.4）。
 * - `pipeline(items, ...stages)`：每个 item **独立**依次通过所有 stage（无 barrier，
 *   各 item 可处于不同 stage）；某 item 在某 stage 抛出异常时其最终结果置为 `null`
 *   并**跳过其剩余 stage**，其他 item 不受影响；每个 stage 回调接收
 *   `(prevResult, originalItem, index)` 三参；结果数组与输入 items 数组**索引一一对应**
 *   （R4.9、R4.10、R4.11、R4.12、R13.4）。
 *
 * @see .kiro/specs/opencode-workflows/design.md — Orchestration_API / Correctness Properties
 * Requirements: 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 13.4
 */

import { WorkflowError } from "../errors"

/** 单次 parallel/pipeline 接受的最大输入项数（对齐 CC「单次扇出 ≤4096」）。 */
export const FANOUT_LIMIT = 4096

/** 入口长度守卫：超限同步抛错（落实 No silent caps，不静默截断）。 */
function assertFanout(kind: "parallel" | "pipeline", len: number): void {
  if (len > FANOUT_LIMIT) {
    throw new WorkflowError(
      "FANOUT_LIMIT_EXCEEDED",
      `${kind}() 单次入参 ${len} 超过上限 ${FANOUT_LIMIT}；请分批处理或经 pipeline 流式分摊（不静默截断）`,
      { kind, length: len, limit: FANOUT_LIMIT },
    )
  }
}

/**
 * 延迟执行的异步函数——`parallel()` 的并行调度单元（design.md「Glossary: Thunk」）。
 *
 * thunk 在被调用时才发起其异步工作；`parallel()` 通过同步遍历 thunks 数组依次
 * 调用各 thunk 来并发启动它们。
 */
export type Thunk<T = unknown> = () => Promise<T>

/**
 * 流水线阶段回调——`pipeline()` 的处理单元。
 *
 * @param prevResult 上一 stage 的返回值；对**首个 stage** 而言为该 item 的原始输入项。
 * @param originalItem 该 item 的原始输入项（贯穿所有 stage 始终不变）。
 * @param index 该 item 在 items 数组中的位置（用于对齐结果索引与 agentIndex 分配）。
 */
export type PipelineStage<TIn = unknown, TOut = unknown> = (
  prevResult: TIn,
  originalItem: unknown,
  index: number,
) => Promise<TOut>

/**
 * 并行执行所有 thunk（barrier 语义），等待全部完成后返回结果数组。
 *
 * 每个 thunk 被包裹在独立的错误隔离边界内：thunk **同步抛出**或**返回 reject 的
 * Promise** 时，其对应位置解析为 `null`，且不会影响其他 thunk 的执行或结果
 * （无共享状态污染，R13.4）。由于每个被包裹的 promise 永不 reject，
 * `Promise.all` 因此永不 reject——`parallel()` 整体永不 reject（R4.7）。
 *
 * 结果数组通过 `thunks.map(...)` 保序构造，因此与输入 thunks 数组**索引一一对应**
 * （R4.8）：成功 thunk 的返回值落在其对应索引位置，失败 thunk 的位置为 `null`。
 *
 * @typeParam T thunk 成功时解析的结果类型。
 * @param thunks 延迟异步函数数组（barrier 语义下全部并发启动并等待）。
 * @returns 与输入等长的结果数组；元素为对应 thunk 的返回值，或失败时为 `null`。
 *
 * @example
 * ```ts
 * const results = await parallel([
 *   async () => "a",
 *   async () => { throw new Error("boom") },
 *   async () => "c",
 * ])
 * // results === ["a", null, "c"]
 * ```
 */
export function parallel<T>(thunks: Thunk<T>[]): Promise<(T | null)[]> {
  assertFanout("parallel", thunks.length)
  return Promise.all(
    thunks.map(async (thunk): Promise<T | null> => {
      try {
        // await 同时覆盖「thunk 同步抛出」与「返回 reject 的 Promise」两种失败路径。
        return await thunk()
      } catch {
        // 异常隔离：该位置置 null，不向上传播、不影响其他 thunk（R4.7、R13.4）。
        return null
      }
    }),
  )
}

/**
 * 流水线执行：让每个 item **独立**依次通过所有 stage（无 barrier）。
 *
 * 每个 item 拥有自己的串行 stage 链：首个 stage 以 item 原始值作为 `prevResult`，
 * 其后每个 stage 接收上一 stage 的返回值；`originalItem` 与 `index` 在该 item 的
 * 整条链中保持不变（R4.11）。各 item 的链彼此独立并发推进——不同 item 可同时
 * 处于不同 stage（无 barrier，R4.9）。
 *
 * 错误隔离（R4.10、R13.4）：某 item 在某 stage 抛出异常（或该 stage 返回 reject 的
 * Promise）时，该 item 的最终结果置为 `null` 并**跳过其剩余 stage**；其他 item 的
 * 链不受影响、继续执行。
 *
 * 结果数组通过 `items.map(...)` 保序构造，与输入 items 数组**索引一一对应**（R4.12）。
 *
 * 边界：`stages` 为空时，每个 item 的结果即其原始值；`items` 为空时返回空数组。
 *
 * @typeParam T items 元素类型。
 * @param items 待处理的输入项数组。
 * @param stages 顺序执行的流水线阶段回调（可变参数）。
 * @returns 与输入 items 等长的结果数组；元素为该 item 末个 stage 的返回值，或失败时为 `null`。
 *
 * @example
 * ```ts
 * const results = await pipeline(
 *   [1, 2, 3],
 *   async (prev) => (prev as number) + 1,        // stage 0：prev 为原始 item
 *   async (prev) => (prev as number) * 10,        // stage 1
 * )
 * // results === [20, 30, 40]
 * ```
 */
export function pipeline<T>(
  items: T[],
  ...stages: PipelineStage[]
): Promise<(unknown | null)[]> {
  assertFanout("pipeline", items.length)
  return Promise.all(
    items.map(async (item, index): Promise<unknown | null> => {
      try {
        // 首个 stage 的 prevResult 即 item 原始值；其后逐 stage 串联传递返回值。
        let prevResult: unknown = item
        for (const stage of stages) {
          prevResult = await stage(prevResult, item, index)
        }
        return prevResult
      } catch {
        // 该 item 在某 stage 失败：最终结果置 null 并跳过剩余 stage（R4.10）。
        // 其他 item 的独立链不受影响（R13.4）。
        return null
      }
    }),
  )
}
