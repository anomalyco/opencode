/**
 * ============================================================================
 * 文件名：auth.withActor.ts
 * 所属包：packages/console/app/src/context
 * ============================================================================
 *
 * 文件作用：
 * Actor 上下文包装器。在指定 Actor 上下文中执行函数。
 *
 * 主要功能：
 * - 获取 Actor 信息
 * - 在 Actor 上下文中执行函数
 *
 * 依赖关系：
 * - @opencode-ai/console-core/actor：Actor 权限上下文
 * - ./auth：Actor 信息获取
 *
 * 导出内容：
 * - withActor：在 Actor 上下文中执行函数
 *
 * @package console.app
 * @module auth.withActor
 */

// 导入 Actor 权限上下文
import { Actor } from "@opencode-ai/console-core/actor.js"

// 导入 Actor 信息获取函数
import { getActor } from "./auth"

/**
 * 在 Actor 上下文中执行函数
 *
 * 获取指定工作区的 Actor 信息，并在该上下文中执行函数。
 * 这确保函数执行时具有正确的权限和上下文信息。
 *
 * @param fn - 要执行的函数
 * @param workspace - 可选的工作区 ID
 * @returns 函数执行结果
 *
 * @example
 * ```typescript
 * // 在账户上下文中执行
 * await withActor(() => {
 *   console.log("当前账户:", Actor.account())
 * })
 *
 * // 在工作区上下文中执行
 * await withActor(() => {
 *   console.log("当前工作区:", Actor.workspace())
 * }, "wrk_123")
 * ```
 */
export async function withActor<T>(fn: () => T, workspace?: string) {
  // 获取 Actor 信息
  const actor = await getActor(workspace)
  // 在 Actor 上下文中执行函数
  return Actor.provide(actor.type, actor.properties, fn)
}
