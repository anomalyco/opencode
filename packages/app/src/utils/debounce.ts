// FORK: debounce + flush helper for auto-save [feat: auto-save-debounce-flush] 2026-05-21
//
// 设计要点:
// - trigger() 调用一次重置计时器,delayMs 静默后执行 fn
// - flush() 立即同步执行待执行的 fn(切 tab / 关窗口前用),清掉计时器
// - cancel() 清计时器,不执行(editing 退出 / unmount 时用)
// - pending() 查询是否有挂起的调用
//
// 跟传统 lodash.debounce 的差异:
// - 简化版,只暴露 4 个方法
// - fn 可以是 async,但不 await(fire-and-forget) — 调用方负责处理 Promise

export type DebouncedFn = {
  /** 调用一次 — 重置计时器,delay 毫秒后执行 fn */
  trigger: () => void
  /** 立即执行待执行的 fn(同步触发),清掉计时器。无挂起任务时 noop */
  flush: () => void
  /** 清掉计时器,不执行。重复 cancel 安全 */
  cancel: () => void
  /** 当前有挂起的 fn 调用?*/
  pending: () => boolean
}

export function createDebounced(fn: () => void | Promise<void>, delayMs: number): DebouncedFn {
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    trigger: () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void fn()
      }, delayMs)
    },
    flush: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
        void fn()
      }
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    pending: () => timer !== null,
  }
}
