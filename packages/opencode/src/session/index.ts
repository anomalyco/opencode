/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 会话管理核心模块。提供会话的创建、更新、删除和消息管理功能。
 *
 * 主要功能：
 * - Info Schema：会话信息数据结构
 * - ShareInfo Schema：分享信息数据结构
 * - Event：会话相关事件定义
 * - create(input)：创建新会话
 * - fork(input)：从现有会话分叉
 * - touch(sessionID)：更新会话时间戳
 * - createNext(input)：创建下一个会话
 * - get(id)：获取指定会话
 * - getShare(id)：获取分享信息
 * - share(id)：创建会话分享
 * - unshare(id)：取消会话分享
 * - update(id, editor)：更新会话
 * - diff(sessionID)：获取会话差异
 * - messages(input)：获取会话消息
 * - list()：列出所有会话
 * - children(parentID)：获取子会话
 * - remove(sessionID)：删除会话
 * - updateMessage(msg)：更新消息
 * - removeMessage(input)：删除消息
 * - removePart(input)：删除消息部分
 * - updatePart(input)：更新消息部分
 * - getUsage(input)：计算使用量和成本
 * - initialize(input)：初始化会话
 *
 * 依赖关系：
 * - ../bus/bus-event：事件定义工具
 * - ../bus：事件总线
 * - decimal.js：精确的十进制计算
 * - zod：运行时类型验证
 * - ai：Vercel AI SDK 类型
 * - ../config/config：配置系统
 * - ../flag/flag：功能标志
 * - ../id/id：标识符生成
 * - ../installation：安装信息
 * - ../storage/storage：存储层
 * - ../util/log：日志记录
 * - ./message-v2：消息模型
 * - ../project/instance：实例管理
 * - ./prompt：会话提示词
 * - ../util/fn：函数包装工具
 * - ../command：命令处理
 * - ../snapshot：快照管理
 * - ../provider/provider：提供商类型
 * - ../permission/next：权限管理
 *
 * 导出内容：
 * - Session namespace：会话管理命名空间
 *   - Info Schema：会话信息结构
 *   - ShareInfo Schema：分享信息结构
 *   - Event：会话事件集合
 *   - create()：创建会话
 *   - fork()：分叉会话
 *   - touch()：更新时间戳
 *   - get()：获取会话
 *   - getShare()：获取分享信息
 *   - share()：创建分享
 *   - unshare()：取消分享
 *   - update()：更新会话
 *   - diff()：获取差异
 *   - messages()：获取消息
 *   - list()：列出会话
 *   - children()：获取子会话
 *   - remove()：删除会话
 *   - updateMessage()：更新消息
 *   - removeMessage()：删除消息
 *   - removePart()：删除部分
 *   - updatePart()：更新部分
 *   - getUsage()：计算使用量
 *   - BusyError：会话忙错误
 *   - initialize()：初始化会话
 *
 * 会话类型：
 * - 父会话：用户创建的主要会话
 * - 子会话：从父会话分叉的会话，用于实验性操作
 *
 * 会话状态：
 * - created：创建时间
 * - updated：更新时间
 * - compacting：压缩时间（可选）
 * - archived：归档时间（可选）
 *
 * 使用示例：
 * ```typescript
 * // 创建新会话
 * const session = await Session.create()
 *
 * // 获取会话消息
 * const messages = await Session.messages({ sessionID: session.id })
 *
 * // 分叉会话
 * const child = await Session.fork({ sessionID: session.id })
 *
 * // 计算使用量和成本
 * const usage = Session.getUsage({ model, usage: modelUsage })
 * ```
 *
 * @package opencode
 * @module session/index
 */

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入事件总线
import { Bus } from "@/bus"

// 导入精确的十进制计算库
import { Decimal } from "decimal.js"

// 导入 Zod 用于类型验证
import z from "zod"

// 导入 AI SDK 类型
import { type LanguageModelUsage, type ProviderMetadata } from "ai"

// 导入配置系统
import { Config } from "../config/config"

// 导入功能标志
import { Flag } from "../flag/flag"

// 导入标识符生成
import { Identifier } from "../id/id"

// 导入安装信息
import { Installation } from "../installation"

// 导入存储层
import { Storage } from "../storage/storage"

// 导入日志工具
import { Log } from "../util/log"

// 导入消息模型
import { MessageV2 } from "./message-v2"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入会话提示词
import { SessionPrompt } from "./prompt"

// 导入函数包装工具
import { fn } from "@/util/fn"

// 导入命令处理
import { Command } from "../command"

// 导入快照管理
import { Snapshot } from "@/snapshot"

// 导入提供商类型
import type { Provider } from "@/provider/provider"

// 导入权限管理
import { PermissionNext } from "@/permission/next"

/**
 * 会话管理命名空间
 *
 * 提供会话的完整生命周期管理。
 */
export namespace Session {
  // 创建日志记录器
  const log = Log.create({ service: "session" })

  // 父会话标题前缀
  const parentTitlePrefix = "New session - "

  // 子会话标题前缀
  const childTitlePrefix = "Child session - "

  /**
   * 创建默认标题
   *
   * @param isChild - 是否为子会话
   * @returns 格式化的标题字符串
   */
  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  /**
   * 检查是否为默认标题
   *
   * @param title - 标题字符串
   * @returns 如果是默认标题返回 true
   */
  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  /**
   * 会话信息 Schema
   *
   * 定义单个会话的完整信息。
   */
  export const Info = z
    .object({
      // 会话唯一标识符
      id: Identifier.schema("session"),
      // 项目 ID
      projectID: z.string(),
      // 工作目录路径
      directory: z.string(),
      // 父会话 ID（可选）
      parentID: Identifier.schema("session").optional(),
      // 会话摘要统计
      summary: z
        .object({
          // 新增行数
          additions: z.number(),
          // 删除行数
          deletions: z.number(),
          // 修改文件数
          files: z.number(),
          // 文件差异列表（可选）
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      // 分享信息
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      // 会话标题
      title: z.string(),
      // OpenCode 版本
      version: z.string(),
      // 时间信息
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      // 权限规则
      permission: PermissionNext.Ruleset.optional(),
      // 回退信息
      revert: z
        .object({
          messageID: z.string(),
          partID: z.string().optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  /**
   * 分享信息 Schema
   *
   * 定义会话分享的完整信息。
   */
  export const ShareInfo = z
    .object({
      // 分享密钥
      secret: z.string(),
      // 分享 URL
      url: z.string(),
    })
    .meta({
      ref: "SessionShare",
    })
  export type ShareInfo = z.output<typeof ShareInfo>

  /**
   * 会话事件定义
   *
   * 定义会话相关的所有事件类型。
   */
  export const Event = {
    // 会话创建事件
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    // 会话更新事件
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    // 会话删除事件
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    // 会话差异事件
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: z.string(),
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    // 会话错误事件
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: z.string().optional(),
        error: MessageV2.Assistant.shape.error,
      }),
    ),
  }

  /**
   * 创建新会话
   *
   * 在当前实例目录下创建一个新会话。
   *
   * @param input - 创建参数
   *   - parentID：父会话 ID
   *   - title：会话标题
   *   - permission：权限规则
   * @returns Promise，解析为创建的会话信息
   */
  export const create = fn(
    z
      .object({
        parentID: Identifier.schema("session").optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
      })
    },
  )

  /**
   * 分叉会话
   *
   * 从现有会话创建一个子会话，复制指定消息之前的所有内容。
   *
   * @param input - 分叉参数
   *   - sessionID：源会话 ID
   *   - messageID：停止复制的消息 ID（可选）
   * @returns Promise，解析为新创建的会话
   *
   * 分叉流程：
   * 1. 创建新会话
   * 2. 复制源会话的消息（直到指定的 messageID）
   * 3. 为每个消息生成新的 ID
   * 4. 保持父子关系
   */
  export const fork = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      // 创建新会话
      const session = await createNext({
        directory: Instance.directory,
      })
      // 获取源会话的所有消息
      const msgs = await messages({ sessionID: input.sessionID })
      // ID 映射表：旧 ID -> 新 ID
      const idMap = new Map<string, string>()

      // 复制每条消息
      for (const msg of msgs) {
        // 如果指定了停止点，到达时停止
        if (input.messageID && msg.info.id >= input.messageID) break

        // 生成新的消息 ID
        const newID = Identifier.ascending("message")
        idMap.set(msg.info.id, newID)

        // 确定新的父 ID（仅 assistant 消息有父 ID）
        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined

        // 复制消息
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        // 复制消息的所有部分
        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: Identifier.ascending("part"),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  /**
   * 更新会话时间戳
   *
   * 将会话的 updated 时间设置为当前时间。
   *
   * @param sessionID - 会话 ID
   * @returns Promise，完成时时间戳已更新
   */
  export const touch = fn(Identifier.schema("session"), async (sessionID) => {
    await update(sessionID, (draft) => {
      draft.time.updated = Date.now()
    })
  })

  /**
   * 创建下一个会话
   *
   * 内部方法，创建新会话的核心逻辑。
   *
   * @param input - 创建参数
   *   - id：会话 ID（可选）
   *   - title：会话标题
   *   - parentID：父会话 ID
   *   - directory：工作目录
   *   - permission：权限规则
   * @returns Promise，解析为创建的会话信息
   */
  export async function createNext(input: {
    id?: string
    title?: string
    parentID?: string
    directory: string
    permission?: PermissionNext.Ruleset
  }) {
    // 构造会话信息
    const result: Info = {
      // 生成降序 ID（新的在前面）
      id: Identifier.descending("session", input.id),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    // 写入存储
    await Storage.write(["session", Instance.project.id, result.id], result)
    // 发布创建事件
    Bus.publish(Event.Created, {
      info: result,
    })
    // 获取配置
    const cfg = await Config.get()
    // 如果是父会话且启用自动分享，创建分享
    if (!result.parentID && (Flag.OPENCODE_AUTO_SHARE || cfg.share === "auto"))
      share(result.id)
        .then((share) => {
          update(result.id, (draft) => {
            draft.share = share
          })
        })
        .catch(() => {
          // 静默忽略分享错误
        })
    // 发布更新事件
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  /**
   * 获取指定会话
   *
   * @param id - 会话 ID
   * @returns Promise，解析为会话信息
   */
  export const get = fn(Identifier.schema("session"), async (id) => {
    const read = await Storage.read<Info>(["session", Instance.project.id, id])
    return read as Info
  })

  /**
   * 获取分享信息
   *
   * @param id - 会话 ID
   * @returns Promise，解析为分享信息
   */
  export const getShare = fn(Identifier.schema("session"), async (id) => {
    return Storage.read<ShareInfo>(["share", id])
  })

  /**
   * 创建会话分享
   *
   * 为指定会话创建分享链接。
   *
   * @param id - 会话 ID
   * @returns Promise，解析为分享信息
   * @throws Error 如果分享被禁用
   */
  export const share = fn(Identifier.schema("session"), async (id) => {
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    // 动态导入分享模块
    const { ShareNext } = await import("@/share/share-next")
    const share = await ShareNext.create(id)
    // 更新会话信息
    await update(id, (draft) => {
      draft.share = {
        url: share.url,
      }
    })
    return share
  })

  /**
   * 取消会话分享
   *
   * @param id - 会话 ID
   * @returns Promise，完成时分享已取消
   */
  export const unshare = fn(Identifier.schema("session"), async (id) => {
    // 使用 ShareNext 移除分享
    const { ShareNext } = await import("@/share/share-next")
    await ShareNext.remove(id)
    // 更新会话信息
    await update(id, (draft) => {
      draft.share = undefined
    })
  })

  /**
   * 更新会话
   *
   * 使用编辑函数更新会话信息。
   *
   * @param id - 会话 ID
   * @param editor - 编辑函数，接收会话草稿并修改
   * @returns Promise，解析为更新后的会话信息
   */
  export async function update(id: string, editor: (session: Info) => void) {
    const project = Instance.project
    const result = await Storage.update<Info>(["session", project.id, id], (draft) => {
      editor(draft)
      draft.time.updated = Date.now()
    })
    // 发布更新事件
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  /**
   * 获取会话差异
   *
   * @param sessionID - 会话 ID
   * @returns Promise，解析为文件差异列表
   */
  export const diff = fn(Identifier.schema("session"), async (sessionID) => {
    const diffs = await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
    return diffs ?? []
  })

  /**
   * 获取会话消息
   *
   * 获取指定会话的所有消息。
   *
   * @param input - 查询参数
   *   - sessionID：会话 ID
   *   - limit：可选的消息数量限制
   * @returns Promise，解析为消息列表（按时间倒序）
   */
  export const messages = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as MessageV2.WithParts[]
      // 流式读取消息
      for await (const msg of MessageV2.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      // 反转顺序（最新的在前）
      result.reverse()
      return result
    },
  )

  /**
   * 列出所有会话
   *
   * @returns 异步生成器，产生项目中的所有会话
   */
  export async function* list() {
    const project = Instance.project
    // 遍历所有会话键
    for (const item of await Storage.list(["session", project.id])) {
      yield Storage.read<Info>(item)
    }
  }

  /**
   * 获取子会话列表
   *
   * @param parentID - 父会话 ID
   * @returns Promise，解析为子会话列表
   */
  export const children = fn(Identifier.schema("session"), async (parentID) => {
    const project = Instance.project
    const result = [] as Session.Info[]
    // 遍历所有会话，筛选出子会话
    for (const item of await Storage.list(["session", project.id])) {
      const session = await Storage.read<Info>(item)
      if (session.parentID !== parentID) continue
      result.push(session)
    }
    return result
  })

  /**
   * 删除会话
   *
   * 删除指定会话及其所有子会话、消息和部分。
   *
   * @param sessionID - 会话 ID
   * @returns Promise，完成时会话已删除
   */
  export const remove = fn(Identifier.schema("session"), async (sessionID) => {
    const project = Instance.project
    try {
      const session = await get(sessionID)
      // 递归删除所有子会话
      for (const child of await children(sessionID)) {
        await remove(child.id)
      }
      // 取消分享
      await unshare(sessionID).catch(() => {})
      // 删除所有消息和部分
      for (const msg of await Storage.list(["message", sessionID])) {
        for (const part of await Storage.list(["part", msg.at(-1)!])) {
          await Storage.remove(part)
        }
        await Storage.remove(msg)
      }
      // 删除会话
      await Storage.remove(["session", project.id, sessionID])
      // 发布删除事件
      Bus.publish(Event.Deleted, {
        info: session,
      })
    } catch (e) {
      log.error(e)
    }
  })

  /**
   * 更新消息
   *
   * @param msg - 消息信息
   * @returns Promise，解析为更新后的消息
   */
  export const updateMessage = fn(MessageV2.Info, async (msg) => {
    await Storage.write(["message", msg.sessionID, msg.id], msg)
    Bus.publish(MessageV2.Event.Updated, {
      info: msg,
    })
    return msg
  })

  /**
   * 删除消息
   *
   * @param input - 删除参数
   *   - sessionID：会话 ID
   *   - messageID：消息 ID
   * @returns Promise，解析为被删除的消息 ID
   */
  export const removeMessage = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      await Storage.remove(["message", input.sessionID, input.messageID])
      Bus.publish(MessageV2.Event.Removed, {
        sessionID: input.sessionID,
        messageID: input.messageID,
      })
      return input.messageID
    },
  )

  /**
   * 删除消息部分
   *
   * @param input - 删除参数
   *   - sessionID：会话 ID
   *   - messageID：消息 ID
   *   - partID：部分 ID
   * @returns Promise，解析为被删除的部分 ID
   */
  export const removePart = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
      partID: Identifier.schema("part"),
    }),
    async (input) => {
      await Storage.remove(["part", input.messageID, input.partID])
      Bus.publish(MessageV2.Event.PartRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: input.partID,
      })
      return input.partID
    },
  )

  // 更新部分的输入类型（支持增量更新）
  const UpdatePartInput = z.union([
    MessageV2.Part,
    z.object({
      part: MessageV2.TextPart,
      delta: z.string(),
    }),
    z.object({
      part: MessageV2.ReasoningPart,
      delta: z.string(),
    }),
  ])

  /**
   * 更新消息部分
   *
   * @param input - 更新参数（完整部分或增量）
   * @returns Promise，解析为更新后的部分
   */
  export const updatePart = fn(UpdatePartInput, async (input) => {
    // 确定是否为增量更新
    const part = "delta" in input ? input.part : input
    const delta = "delta" in input ? input.delta : undefined
    await Storage.write(["part", part.messageID, part.id], part)
    Bus.publish(MessageV2.Event.PartUpdated, {
      part,
      delta,
    })
    return part
  })

  /**
   * 计算使用量和成本
   *
   * 根据模型和使用情况计算详细的 token 使用量和成本。
   *
   * @param input - 计算参数
   *   - model：模型信息
   *   - usage：使用量数据
   *   - metadata：提供商元数据（可选）
   * @returns 使用量和成本对象
   *
   * 计算细节：
   * - 某些提供商（Anthropic、Bedrock）的 cachedInputTokens 需要特殊处理
   * - 200K+ tokens 使用实验性定价
   * - 推理 tokens 按输出 tokens 计费
   */
  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelUsage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      // 获取缓存的输入 tokens
      const cachedInputTokens = input.usage.cachedInputTokens ?? 0
      // 检查是否排除缓存 tokens（Anthropic、Bedrock）
      const excludesCachedTokens = !!(input.metadata?.["anthropic"] || input.metadata?.["bedrock"])
      // 调整后的输入 tokens
      const adjustedInputTokens = excludesCachedTokens
        ? input.usage.inputTokens ?? 0
        : (input.usage.inputTokens ?? 0) - cachedInputTokens

      // 安全处理非有限数字
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }

      // 计算 tokens 使用量
      const tokens = {
        input: safe(adjustedInputTokens),
        output: safe(input.usage.outputTokens ?? 0),
        reasoning: safe(input.usage?.reasoningTokens ?? 0),
        cache: {
          write: safe(
            (input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
              // Bedrock 的缓存写入 tokens
              // @ts-expect-error
              input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
              0) as number,
          ),
          read: safe(cachedInputTokens),
        },
      }

      // 根据输入量选择定价（200K+ 使用实验性定价）
      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost

      // 计算总成本
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // 推理 tokens 按输出 tokens 计费
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  /**
   * 会话忙错误
   *
   * 当会话正在处理时尝试执行操作抛出此错误。
   */
  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  /**
   * 初始化会话
   *
   * 为会话发送初始化命令。
   *
   * @param input - 初始化参数
   *   - sessionID：会话 ID
   *   - modelID：模型 ID
   *   - providerID：提供商 ID
   *   - messageID：消息 ID
   * @returns Promise，完成时初始化命令已发送
   */
  export const initialize = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      modelID: z.string(),
      providerID: z.string(),
      messageID: Identifier.schema("message"),
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + "/" + input.modelID,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
