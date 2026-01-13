/**
 * ============================================================================
 * 文件名：revert.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 会话回滚模块。实现会话状态的回滚功能，允许用户撤销到之前的某个状态。
 *
 * 主要功能：
 * - RevertInput：回滚输入参数类型
 * - revert(input)：回滚到指定消息/part
 * - unrevert(input)：取消回滚
 * - cleanup(session)：清理回滚后的旧消息
 *
 * 依赖关系：
 * - zod：类型验证
 * - ../id/id：标识符生成
 * - ../snapshot：快照管理
 * - ./message-v2：消息模型
 * - .：会话管理
 * - ../util/log：日志记录
 * - remeda：工具函数（splitWhen）
 * - ../storage/storage：持久化存储
 * - ../bus：事件总线
 * - ./prompt：会话提示词
 *
 * 导出内容：
 * - SessionRevert namespace：会话回滚命名空间
 *   - RevertInput：回滚输入类型
 *   - revert()：执行回滚
 *   - unrevert()：取消回滚
 *   - cleanup()：清理回滚
 *
 * 回滚流程：
 * 1. 记录当前快照
 * 2. 收集要回滚的消息之前的所有 patch
 * 3. 撤销这些 patch
 * 4. 保存回滚状态到会话
 * 5. 用户下次 prompt 时清理回滚后的消息
 *
 * @package opencode
 * @module session/revert
 */

// 导入 Zod 类型验证
import z from "zod"

// 导入标识符生成器
import { Identifier } from "../id/id"

// 导入快照管理
import { Snapshot } from "../snapshot"

// 导入消息模型
import { MessageV2 } from "./message-v2"

// 导入会话管理
import { Session } from "."

// 导入日志工具
import { Log } from "../util/log"

// 导入 remeda 工具函数
import { splitWhen } from "remeda"

// 导入存储模块
import { Storage } from "../storage/storage"

// 导入事件总线
import { Bus } from "../bus"

// 导入会话提示词
import { SessionPrompt } from "./prompt"

/**
 * 会话回滚命名空间
 *
 * 实现会话状态的回滚功能。
 */
export namespace SessionRevert {
  // 创建日志记录器
  const log = Log.create({ service: "session.revert" })

  /**
   * 回滚输入参数
   *
   * 定义回滚操作所需的参数。
   */
  export const RevertInput = z.object({
    // 会话 ID
    sessionID: Identifier.schema("session"),
    // 要回滚到的消息 ID
    messageID: Identifier.schema("message"),
    // 可选：要回滚到的 part ID
    partID: Identifier.schema("part").optional(),
  })
  export type RevertInput = z.infer<typeof RevertInput>

  /**
   * 执行回滚
   *
   * 将会话回滚到指定消息或 part 的状态。
   * 这不会立即删除消息，而是记录回滚状态，
   * 在下次 prompt 时清理。
   *
   * @param input - 回滚参数
   * @returns Promise，解析为更新后的会话
   *
   * 回滚逻辑：
   * 1. 遍历所有消息，找到要回滚的位置
   * 2. 收集回滚位置之后的所有 patch
   * 3. 撤销这些 patch（恢复文件）
   * 4. 保存当前快照和回滚状态到会话
   */
  export async function revert(input: RevertInput) {
    // 确保会话不在忙碌状态
    SessionPrompt.assertNotBusy(input.sessionID)

    // 获取所有消息
    const all = await Session.messages({ sessionID: input.sessionID })

    // 最后一个用户消息
    let lastUser: MessageV2.User | undefined

    // 获取会话信息
    const session = await Session.get(input.sessionID)

    // 回滚状态
    let revert: Session.Info["revert"]

    // 要撤销的 patch 列表
    const patches: Snapshot.Patch[] = []

    // 遍历消息，找到回滚位置并收集 patches
    for (const msg of all) {
      // 记录最后的用户消息
      if (msg.info.role === "user") lastUser = msg.info

      const remaining = []

      // 遍历消息的 parts
      for (const part of msg.parts) {
        // 如果已经开始回滚，收集所有 patches
        if (revert) {
          if (part.type === "patch") {
            patches.push(part)
          }
          continue
        }

        // 如果还没开始回滚，检查是否到达回滚点
        if (!revert) {
          // 匹配消息 ID 或 part ID
          if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
            // 如果消息中没有有用的 parts，等同于回滚整条消息
            const partID = remaining.some((item) => ["text", "tool"].includes(item.type))
              ? input.partID
              : undefined

            // 设置回滚状态
            revert = {
              // 如果有 lastUser 且不是回滚整条消息，回滚到 lastUser
              messageID: !partID && lastUser ? lastUser.id : msg.info.id,
              partID,
            }
          }
          remaining.push(part)
        }
      }
    }

    // 如果找到了回滚位置
    if (revert) {
      const session = await Session.get(input.sessionID)

      // 记录当前快照（如果已有则复用）
      revert.snapshot = session.revert?.snapshot ?? (await Snapshot.track())

      // 撤销所有 patches
      await Snapshot.revert(patches)

      // 计算与回滚前快照的差异
      if (revert.snapshot) revert.diff = await Snapshot.diff(revert.snapshot)

      // 更新会话状态
      return Session.update(input.sessionID, (draft) => {
        draft.revert = revert
      })
    }

    // 没有找到回滚位置，返回原会话
    return session
  }

  /**
   * 取消回滚
   *
   * 恢复到回滚前的状态。
   *
   * @param input - 输入参数
   *   - sessionID：会话 ID
   * @returns Promise，解析为更新后的会话
   *
   * 恢复逻辑：
   * 1. 读取回滚时保存的快照
   * 2. 恢复到该快照
   * 3. 清除回滚状态
   */
  export async function unrevert(input: { sessionID: string }) {
    log.info("unreverting", input)

    // 确保会话不在忙碌状态
    SessionPrompt.assertNotBusy(input.sessionID)

    // 获取会话
    const session = await Session.get(input.sessionID)

    // 如果没有回滚状态，直接返回
    if (!session.revert) return session

    // 恢复到回滚前的快照
    if (session.revert.snapshot) await Snapshot.restore(session.revert.snapshot)

    // 清除回滚状态
    const next = await Session.update(input.sessionID, (draft) => {
      draft.revert = undefined
    })

    return next
  }

  /**
   * 清理回滚后的消息
   *
   * 删除回滚点之后的所有消息和 parts。
   * 通常在用户发送新 prompt 时调用。
   *
   * @param session - 会话信息
   * @returns Promise
   *
   * 清理逻辑：
   * 1. 找到回滚点
   * 2. 删除回滚点之后的所有消息
   * 3. 如果指定了 partID，删除该 part 之后的所有 parts
   * 4. 清除回滚状态
   */
  export async function cleanup(session: Session.Info) {
    // 如果没有回滚状态，直接返回
    if (!session.revert) return

    const sessionID = session.id

    // 获取所有消息
    let msgs = await Session.messages({ sessionID })

    // 回滚到的消息 ID
    const messageID = session.revert.messageID

    // 分割消息列表：保留的 vs 要删除的
    const [preserve, remove] = splitWhen(msgs, (x) => x.info.id === messageID)
    msgs = preserve

    // 删除回滚点之后的消息
    for (const msg of remove) {
      await Storage.remove(["message", sessionID, msg.info.id])
      await Bus.publish(MessageV2.Event.Removed, { sessionID: sessionID, messageID: msg.info.id })
    }

    // 获取保留的最后一条消息
    const last = preserve.at(-1)

    // 如果指定了 partID，删除该 part 之后的所有 parts
    if (session.revert.partID && last) {
      const partID = session.revert.partID

      // 分割 parts：保留的 vs 要删除的
      const [preserveParts, removeParts] = splitWhen(last.parts, (x) => x.id === partID)
      last.parts = preserveParts

      // 删除 parts
      for (const part of removeParts) {
        await Storage.remove(["part", last.info.id, part.id])
        await Bus.publish(MessageV2.Event.PartRemoved, {
          sessionID: sessionID,
          messageID: last.info.id,
          partID: part.id,
        })
      }
    }

    // 清除回滚状态
    await Session.update(sessionID, (draft) => {
      draft.revert = undefined
    })
  }
}
