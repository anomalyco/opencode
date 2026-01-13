/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/command
 * ============================================================================
 *
 * 文件作用：
 * 命令系统模块。管理斜杠命令（如 /init、/review）的定义和执行，
 * 包括内置命令和用户自定义命令，以及从 MCP 服务器导入的命令。
 *
 * 主要功能：
 * - Info：命令信息类型定义
 * - Event.Executed：命令执行事件
 * - hints(template)：从模板提取提示信息
 * - Default：内置命令名称常量
 * - state：命令状态管理
 * - get(name)：获取指定命令
 * - list()：列出所有命令
 *
 * 依赖关系：
 * - ../bus/bus-event：事件定义
 * - zod：类型验证
 * - ../config/config：配置系统
 * - ../project/instance：实例管理
 * - ../id/id：标识符生成和验证
 * - ./template/initialize.txt：init 命令模板
 * - ./template/review.txt：review 命令模板
 * - ../mcp：MCP 服务器管理
 *
 * 导出内容：
 * - Command namespace：命令管理命名空间
 *   - Event：命令事件
 *   - Info：命令信息类型
 *   - hints()：提取提示信息
 *   - Default：内置命令常量
 *   - get()：获取命令
 *   - list()：列出所有命令
 *
 * 命令类型：
 * - 内置命令：init（创建 AGENTS.md）、review（审查更改）
 * - 用户配置命令：从 config.command 加载
 * - MCP 命令：从 MCP 服务器导入
 *
 * @package opencode
 * @module command/index
 */

// 导入事件定义
import { BusEvent } from "@/bus/bus-event"

// 导入 Zod
import z from "zod"

// 导入配置系统
import { Config } from "../config/config"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入标识符管理
import { Identifier } from "../id/id"

// 导入命令模板
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

// 导入 MCP 管理
import { MCP } from "../mcp"

/**
 * 命令管理命名空间
 *
 * 管理斜杠命令的定义和执行。
 */
export namespace Command {
  /**
   * 命令事件
   *
   * 定义与命令相关的事件。
   */
  export const Event = {
    /**
     * 命令执行事件
     *
     * 当命令被执行时发布。
     */
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: Identifier.schema("session"),
        arguments: z.string(),
        messageID: Identifier.schema("message"),
      }),
    ),
  }

  /**
   * 命令信息类型
   *
   * 定义单个命令的完整配置。
   */
  export const Info = z
    .object({
      // 命令名称
      name: z.string(),
      // 命令描述
      description: z.string().optional(),
      // 指定使用的 Agent
      agent: z.string().optional(),
      // 指定使用的模型
      model: z.string().optional(),
      // 是否为 MCP 命令
      mcp: z.boolean().optional(),
      // 命令模板（可以是 Promise 或字符串）
      // zod 不原生支持 async 函数，所以使用 getter
      template: z.promise(z.string()).or(z.string()),
      // 是否为子任务命令
      subtask: z.boolean().optional(),
      // 模板中的占位符提示
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // 手动覆盖类型，因为 zod 将 z.promise(z.string()).or(z.string()) 推断为 string
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  /**
   * 从模板提取提示信息
   *
   * 扫描模板中的占位符（如 $1、$2、$ARGUMENTS）。
   *
   * @param template - 命令模板字符串
   * @returns 占位符列表
   */
  export function hints(template: string): string[] {
    const result: string[] = []
    // 查找编号占位符（$1、$2 等）
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    // 查找 $ARGUMENTS 占位符
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  /**
   * 内置命令名称常量
   */
  export const Default = {
    INIT: "init",
    REVIEW: "review",
  } as const

  /**
   * 命令状态
   *
   * 实例级状态，包含所有可用命令。
   */
  const state = Instance.state(async () => {
    // 获取用户配置
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      // init 命令：创建/更新 AGENTS.md
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        // 使用 getter 动态替换路径
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },

      // review 命令：审查更改
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
    }

    // 添加用户配置的命令
    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }

    // 添加从 MCP 服务器导入的命令
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        mcp: true,
        description: prompt.description,
        // 异步模板：从 MCP 服务器获取
        get template() {
          // getter 不能是 async，所以返回 Promise
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? // 将参数名替换为 $1, $2 等
                  Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    return result
  })

  /**
   * 获取指定命令
   *
   * @param name - 命令名称
   * @returns Promise，解析为命令信息
   */
  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  /**
   * 列出所有命令
   *
   * @returns Promise，解析为命令信息数组
   */
  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
