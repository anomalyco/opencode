/**
 * ============================================================================
 * 文件名：bootstrap.ts
 * 所属包：packages/opencode/src/cli
 * ============================================================================
 *
 * 文件作用：
 * CLI 引导程序模块。为 CLI 命令提供实例引导功能。
 *
 * 主要功能：
 * - bootstrap()：引导并执行 CLI 命令
 * - 创建临时实例
 * - 执行命令后自动清理
 *
 * 依赖关系：
 * - ../project/bootstrap：实例引导配置
 * - ../project/instance：实例管理
 *
 * 导出内容：
 * - bootstrap()：引导函数
 *
 * 参数：
 * - directory：工作目录路径
 * - cb：要执行的异步回调函数
 *
 * 返回：
 * - Promise，解析为回调函数的返回值
 *
 * 行为：
 * 1. 使用 Instance.provide 创建实例上下文
 * 2. 使用 InstanceBootstrap 初始化实例
 * 3. 执行回调函数
 * 4. 无论成功或失败，最后都会调用 Instance.dispose 清理
 *
 * 使用场景：
 * - CLI 命令需要访问实例状态
 * - 命令执行完成后自动清理资源
 *
 * @package opencode
 * @module cli/bootstrap
 */

// 导入实例引导配置
import { InstanceBootstrap } from "../project/bootstrap"

// 导入实例管理
import { Instance } from "../project/instance"

/**
 * 引导并执行 CLI 命令
 *
 * 创建临时实例，执行回调，然后自动清理资源。
 *
 * @param directory - 工作目录路径
 * @param cb - 要执行的异步回调函数
 * @returns Promise，解析为回调函数的返回值
 *
 * 执行流程：
 * 1. 使用 Instance.provide 创建实例上下文
 * 2. 设置 init 为 InstanceBootstrap
 * 3. 在 try 块中执行回调函数
 * 4. 在 finally 块中调用 Instance.dispose 清理资源
 */
export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        // 无论成功或失败，都清理实例
        await Instance.dispose()
      }
    },
  })
}
