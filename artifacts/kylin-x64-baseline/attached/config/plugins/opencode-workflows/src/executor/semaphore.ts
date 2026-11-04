/**
 * OpenCode Workflows —— 并发信号量（Semaphore）。
 *
 * Agent_Executor 通过本信号量将同时活跃的子 Agent 数限制在 maxConcurrency 以内：
 * 每次发起 agent() 前 `acquire()` 获取许可（无空闲许可时按 FIFO 排队等待），
 * 子 session 完成/失败后 `release()` 释放许可并唤醒队首等待者。
 *
 * 设计要点（对应 design.md「Semaphore 内部状态」与 Property 6）：
 * - `permits`：当前可用许可数；
 * - `queue`：FIFO 等待队列，元素为待 resolve 的 acquire Promise 回调。
 *
 * 不变量（Property 6 将以属性测试验证，Validates: R6.2、R6.3、R6.10）：
 * - 任意时刻活跃许可数（in-use）不超过 maxConcurrency；
 * - 等待者严格按 FIFO 顺序获得许可；
 * - 每次 release 后若有等待者，则恰好唤醒队首一个（许可在唤醒时直接转交该等待者）；
 * - 所有 acquire 最终都能获得许可（无死锁）；
 * - 无等待者时：available() + in-use == maxConcurrency。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 5. Semaphore（并发信号量）/ Property 6
 * Requirements: 6.2, 6.3
 */

/**
 * 并发信号量公开接口。
 */
export interface Semaphore {
  /** 获取一个许可：有空闲许可时立即 resolve；否则按 FIFO 入队等待，直到 release 唤醒 */
  acquire(): Promise<void>
  /** 释放一个许可：有等待者则唤醒队首一个（许可直接转交），否则归还到可用许可池 */
  release(): void
  /** 当前可用许可数 */
  available(): number
  /** 当前等待队列长度 */
  waiting(): number
}

/**
 * 创建一个最大并发为 maxConcurrency 的信号量。
 *
 * `maxConcurrency` 会被规整为不小于 1 的整数（对应需求「最小值为 1」，R6.2）：
 * 非有限数或小于 1 的取值将被钳制为 1，小数将向下取整。
 *
 * @param maxConcurrency 最大并发许可数（最小 1）
 */
export function createSemaphore(maxConcurrency: number): Semaphore {
  // 规整为不小于 1 的整数；防御非法入参（NaN/0/负数/小数）破坏不变量。
  const max =
    Number.isFinite(maxConcurrency) && maxConcurrency >= 1
      ? Math.floor(maxConcurrency)
      : 1

  /** 当前可用许可数；初始等于上限。 */
  let permits = max
  /** FIFO 等待队列：每个元素是某个挂起 acquire() 的 resolve 回调。 */
  const queue: Array<() => void> = []

  function acquire(): Promise<void> {
    // 有空闲许可：立即占用并放行。
    if (permits > 0) {
      permits -= 1
      return Promise.resolve()
    }
    // 无空闲许可：入队等待，返回挂起的 Promise，待 release 唤醒后 resolve。
    return new Promise<void>((resolve) => {
      queue.push(resolve)
    })
  }

  function release(): void {
    // 有等待者：唤醒队首一个，许可直接转交该等待者（不归还到 permits）。
    if (queue.length > 0) {
      const next = queue.shift()!
      next()
      return
    }
    // 无等待者：将许可归还可用池；钳制上界，防御过度 release（无对应 acquire）破坏不变量。
    if (permits < max) {
      permits += 1
    }
  }

  function available(): number {
    return permits
  }

  function waiting(): number {
    return queue.length
  }

  return { acquire, release, available, waiting }
}
