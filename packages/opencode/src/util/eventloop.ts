/**
 * ============================================================================
 * 文件名：eventloop.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * Node.js 事件循环等待工具模块。提供等待事件循环空闲的功能。
 *
 * 主要功能：
 * - wait()：等待所有异步操作完成
 * - 检测活跃的 handles 和 requests
 * - 用于测试和调试异步代码
 *
 * 依赖关系：
 * - ./log：日志模块用于记录调试信息
 *
 * 导出内容：
 * - EventLoop namespace：事件循环命名空间
 *   - wait()：等待事件循环空闲
 *
 * 使用场景：
 * - 单元测试中等待异步操作完成
 * - 调试异步代码的执行顺序
 * - 确保所有定时器和回调已执行
 * - 清理资源的等待逻辑
 *
 * 使用示例：
 * ```typescript
 * // 基本使用：等待所有异步操作完成
 * await EventLoop.wait()
 *
 * // 在测试中使用
 * test('异步操作测试', async () => {
 *   someAsyncOperation()
 *   await EventLoop.wait()  // 等待所有操作完成
 *   expect(result).toBe(expected)
 * })
 *
 * // 调试事件循环状态
 * await EventLoop.wait()
 * // 会输出日志显示活跃的 handles 和 requests
 * ```
 *
 * 工作原理：
 * 1. 使用 setImmediate 轮询检查
 * 2. 通过内部 API _getActiveHandles() 和 _getActiveRequests() 检查状态
 * 3. 当两者都为 0 时，表示事件循环空闲
 * 4. 每次检查都输出日志，便于调试
 *
 * 注意事项：
 * - 使用了 Node.js 内部 API（_ 前缀），不稳定
 * - 仅用于测试和调试，生产环境不适用
 * - 如果有未清理的定时器，会永远等待
 *
 * @package opencode
 * @module util/eventloop
 */

// 导入日志模块用于记录调试信息
import { Log } from "./log"

/**
 * 事件循环命名空间
 *
 * 提供等待事件循环空闲的工具函数。
 */
export namespace EventLoop {
  /**
   * 等待事件循环空闲
   *
   * 轮询检查 Node.js 事件循环，直到没有活跃的 handles 和 requests。
   * 这通常意味着所有异步操作已完成。
   *
   * @returns Promise，当事件循环空闲时 resolve
   *
   * 检测方式：
   * - 使用 process._getActiveHandles() 获取活跃的 handles（如定时器、服务器等）
   * - 使用 process._getActiveRequests() 获取活跃的 I/O 请求
   * - 当两者都为空数组时，表示事件循环已空闲
   *
   * 轮询机制：
   * - 使用 setImmediate 安排下一次检查
   * - setImmediate 在当前事件循环迭代后执行
   * - 比 setTimeout(fn, 0) 更高效
   *
   * @example
   * ```typescript
   * // 等待所有异步操作完成
   * async function cleanup() {
   *   await Promise.all([task1(), task2()])
   *   await EventLoop.wait()  // 确保所有回调已完成
   *   process.exit(0)
   * }
   * ```
   */
  export async function wait() {
    // 创建 Promise 用于等待
    return new Promise<void>((resolve) => {
      // 定义检查函数
      const check = () => {
        // 获取所有活跃的 handles 和 requests
        // process._getActiveHandles()：返回活跃的 handle 对象数组（如 Timer、TCP、Pipe 等）
        // process._getActiveRequests()：返回活跃的 I/O 请求对象数组
        const active = [
          ...(process as any)._getActiveHandles(),
          ...(process as any)._getActiveRequests(),
        ]

        // 记录当前活跃的 handles 和 requests（用于调试）
        Log.Default.info("eventloop", {
          active,
        })

        // 检查是否所有 handles 和 requests 都已完成
        // 当两者长度都为 0 时，表示事件循环已空闲
        if (
          (process as any)._getActiveHandles().length === 0 &&
          (process as any)._getActiveRequests().length === 0
        ) {
          // 事件循环空闲，resolve Promise
          resolve()
        } else {
          // 还有活跃的 handles 或 requests，继续等待
          // setImmediate 在当前事件循环迭代完成后立即执行
          setImmediate(check)
        }
      }

      // 开始第一次检查
      check()
    })
  }
}
