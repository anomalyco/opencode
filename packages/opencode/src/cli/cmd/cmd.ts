/**
 * ============================================================================
 * 文件名：cmd.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * CLI 命令类型包装模块。提供 yargs 命令模块的类型包装功能。
 *
 * 主要功能：
 * - cmd()：命令模块包装函数
 * - WithDoubleDash 类型：支持双横线参数（--）的类型
 *
 * 依赖关系：
 * - yargs：命令行参数解析库
 *
 * 导出内容：
 * - cmd()：命令包装函数
 * - WithDoubleDash<T>：双横线参数类型
 *
 * 类型说明：
 * - WithDoubleDash：允许命令接受额外的参数（通过 -- 传递）
 *
 * 使用场景：
 * - CLI 命令定义
 * - 支持命令后传递额外参数
 *
 * @package opencode
 * @module cli/cmd/cmd
 */

// 导入 yargs 命令模块类型
import type { CommandModule } from "yargs"

/**
 * 双横线参数类型
 *
 * 允许命令接受额外的参数（通过 -- 分隔符传递）。
 * 例如：command arg1 arg2 -- extra1 extra2
 *
 * @template T - 命令的基本参数类型
 */
type WithDoubleDash<T> = T & { "--"?: string[] }

/**
 * 命令包装函数
 *
 * 这是一个类型恒等函数，用于提供更好的类型推断。
 * 它接受一个命令模块并原样返回，但会正确处理双横线参数类型。
 *
 * @template T - 命令的参数类型
 * @template U - 双横线参数后的额外参数类型
 * @param input - yargs 命令模块定义
 * @returns 原样返回输入的命令模块
 *
 * 使用示例：
 * ```typescript
 * export const myCommand = cmd({
 *   command: "my-command <arg>",
 *   handler: async (argv) => {
 *     // argv 类型包含命令参数和可能的 -- 后参数
 *   }
 * })
 * ```
 */
export function cmd<T, U>(input: CommandModule<T, WithDoubleDash<U>>) {
  // 原样返回输入的命令模块
  return input
}
