/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/env
 * ============================================================================
 *
 * 文件作用：
 * 环境变量访问模块。提供基于实例状态的线程安全环境变量读写功能。
 *
 * 主要功能：
 * - 读取环境变量
 * - 设置环境变量
 * - 删除环境变量
 * - 获取所有环境变量
 * - 基于实例状态的作用域隔离
 *
 * 依赖关系：
 * - ../project/instance：实例状态管理
 *
 * 导出内容：
 * - Env namespace：环境变量管理命名空间
 *   - get(key)：获取单个环境变量
 *   - all()：获取所有环境变量
 *   - set(key, value)：设置环境变量
 *   - remove(key)：删除环境变量
 *
 * 使用场景：
 * - 跨项目环境变量隔离
 * - 测试中的环境变量模拟
 * - 动态配置管理
 * - 进程级配置共享
 *
 * 使用示例：
 * ```typescript
 * // 读取环境变量
 * const home = Env.get("HOME")
 * const path = Env.get("PATH")
 *
 * // 设置环境变量
 * Env.set("MY_VAR", "my_value")
 *
 * // 删除环境变量
 * Env.remove("MY_VAR")
 *
 * // 获取所有环境变量
 * const allEnv = Env.all()
 * console.log(allEnv.HOME)
 *
 * // 在测试中使用
 * import { mockInstance } from "../project/instance"
 *
 * test("isolated env", async () => {
 *   await using _ = mockInstance()
 *   Env.set("TEST_VAR", "test_value")
 *   expect(Env.get("TEST_VAR")).toBe("test_value")
 * })
 * // 测试结束后，环境变量自动恢复
 * ```
 *
 * 实现细节：
 * - 使用 Instance.state() 创建响应式状态
 * - 持有对 process.env 的引用
 * - 修改会影响实际进程环境变量
 * - 支持实例作用域隔离（在测试中）
 *
 * @package opencode
 * @module env
 */

// 导入实例状态管理
// 用于支持测试中的实例隔离
import { Instance } from "../project/instance"

/**
 * 环境变量管理命名空间
 *
 * 提供环境变量的读写访问接口。
 */
export namespace Env {
  /**
   * 环境变量状态
   *
   * 使用 Instance.state() 创建响应式状态对象。
   * 持有对 process.env 的引用，支持测试隔离。
   *
   * 在测试中，mockInstance() 会创建新的状态副本，
   * 确保测试之间的环境变量互不影响。
   */
  const state = Instance.state(() => {
    return process.env as Record<string, string | undefined>
  })

  /**
   * 获取环境变量值
   *
   * 读取指定键的环境变量值。
   *
   * @param key - 环境变量键名
   * @returns 环境变量值，如果不存在返回 undefined
   *
   * @example
   * ```typescript
   * const home = Env.get("HOME")  // "/home/user"
   * const missing = Env.get("NON_EXISTENT")  // undefined
   * ```
   */
  export function get(key: string) {
    // 获取当前环境变量状态
    const env = state()
    // 返回指定键的值（可能为 undefined）
    return env[key]
  }

  /**
   * 获取所有环境变量
   *
   * 返回完整的环境变量对象。
   *
   * @returns 环境变量对象
   *
   * 注意：返回的是对 process.env 的引用，
   * 修改会影响实际进程环境变量。
   *
   * @example
   * ```typescript
   * const allEnv = Env.all()
   * console.log(allEnv.PATH)
   * console.log(allEnv.HOME)
   * ```
   */
  export function all() {
    // 返回当前环境变量状态对象
    return state()
  }

  /**
   * 设置环境变量
   *
   * 设置指定键的环境变量值。
   * 会影响实际进程的环境变量。
   *
   * @param key - 环境变量键名
   * @param value - 要设置的值
   *
   * @example
   * ```typescript
   * Env.set("NODE_ENV", "production")
   * Env.set("MY_APP_PORT", "3000")
   * ```
   */
  export function set(key: string, value: string) {
    // 获取当前环境变量状态
    const env = state()
    // 设置环境变量（影响 process.env）
    env[key] = value
  }

  /**
   * 删除环境变量
   *
   * 移除指定键的环境变量。
   * 会影响实际进程的环境变量。
   *
   * @param key - 要删除的环境变量键名
   *
   * @example
   * ```typescript
   * Env.remove("TEMP_VAR")
   * ```
   */
  export function remove(key: string) {
    // 获取当前环境变量状态
    const env = state()
    // 删除环境变量（影响 process.env）
    delete env[key]
  }
}
