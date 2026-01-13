/**
 * ============================================================================
 * 文件名：agent.ts
 * 所属包：packages/opencode/src/agent
 * ============================================================================
 *
 * 文件作用：
 * AI Agent 管理模块。定义和管理各种 AI 代理，每个代理有特定的用途和权限配置。
 *
 * 主要功能：
 * - Info Schema：Agent 配置数据结构
 * - get(agent)：获取指定 Agent
 * - list()：获取所有 Agent（按默认 Agent 排序）
 * - defaultAgent()：获取默认 Agent ID
 * - generate(input)：使用 AI 生成新的 Agent 配置
 *
 * 依赖关系：
 * - ../config/config：配置系统
 * - ../provider/provider：提供商管理
 * - ai：Vercel AI SDK（generateObject, ModelMessage）
 * - ../session/system：系统提示词
 * - ../project/instance：实例管理
 * - ../tool/truncation：截断工具
 * - ./generate.txt：Agent 生成提示词
 * - ./prompt/*.txt：各 Agent 的专用提示词
 * - ../permission/next：权限管理
 *
 * 导出内容：
 * - Agent namespace：AI Agent 管理命名空间
 *   - Info Schema：Agent 配置结构
 *   - get()：获取指定 Agent
 *   - list()：列出所有 Agent
 *   - defaultAgent()：获取默认 Agent
 *   - generate()：生成新 Agent
 *
 * 内置 Agent：
 * - build：主 Agent，用于构建和开发
 * - plan：主 Agent，用于规划和设计
 * - general：子 Agent，用于研究问题和多步骤任务
 * - explore：子 Agent，用于快速探索代码库
 * - compaction：隐藏主 Agent，用于会话压缩
 * - title：隐藏主 Agent，用于生成会话标题
 * - summary：隐藏主 Agent，用于生成会话摘要
 *
 * Agent 类型：
 * - primary：主 Agent，在 UI 中显示供用户选择
 * - subagent：子 Agent，由其他 Agent 调用
 * - all：通用 Agent，可作为主或子 Agent
 *
 * 权限系统：
 * - 每个 Agent 有独立的权限配置
 * - 默认权限 + 用户配置 + Agent 特定权限
 * - external_directory 始终允许 Truncate.DIR 和 Truncate.GLOB
 *
 * 使用示例：
 * ```typescript
 * // 获取所有 Agent
 * const agents = await Agent.list()
 *
 * // 获取特定 Agent
 * const buildAgent = await Agent.get("build")
 *
 * // 生成新 Agent
 * const newAgent = await Agent.generate({
 *   description: "一个专门处理数据库迁移的 Agent"
 * })
 * ```
 *
 * @package opencode
 * @module agent/agent
 */

// 导入配置系统
import { Config } from "../config/config"

// 导入 Zod 用于类型验证
import z from "zod"

// 导入提供商管理
import { Provider } from "../provider/provider"

// 导入 AI SDK
import { generateObject, type ModelMessage } from "ai"

// 导入系统提示词
import { SystemPrompt } from "../session/system"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入截断工具
import { Truncate } from "../tool/truncation"

// 导入内置提示词文件
import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"

// 导入权限管理
import { PermissionNext } from "@/permission/next"

// 导入 remeda 工具函数
import { mergeDeep, pipe, sortBy, values } from "remeda"

/**
 * AI Agent 管理命名空间
 *
 * 定义和管理各种 AI 代理。
 */
export namespace Agent {
  /**
   * Agent 配置 Schema
   *
   * 定义单个 Agent 的完整配置。
   */
  export const Info = z
    .object({
      // Agent 名称（唯一标识符）
      name: z.string(),
      // Agent 描述
      description: z.string().optional(),
      // Agent 类型：subagent（子代理）、primary（主代理）、all（通用）
      mode: z.enum(["subagent", "primary", "all"]),
      // 是否为内置 Agent
      native: z.boolean().optional(),
      // 是否在 UI 中隐藏
      hidden: z.boolean().optional(),
      // Top P 采样参数
      topP: z.number().optional(),
      // 温度参数
      temperature: z.number().optional(),
      // UI 显示颜色
      color: z.string().optional(),
      // 权限规则集
      permission: PermissionNext.Ruleset,
      // 使用的模型（可选，默认使用全局模型）
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      // 自定义系统提示词（可选）
      prompt: z.string().optional(),
      // 额外选项
      options: z.record(z.string(), z.any()),
      // 最大步骤数（用于限制子 Agent 的操作次数）
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  /**
   * Agent 状态
   *
   * 实例级状态，包含所有已配置的 Agent。
   */
  const state = Instance.state(async () => {
    // 获取用户配置
    const cfg = await Config.get()

    // 默认权限配置
    const defaults = PermissionNext.fromConfig({
      // 默认允许所有操作
      "*": "allow",
      // 死循环检测需要询问
      doom_loop: "ask",
      // 外部目录需要询问（除了截断工具目录）
      external_directory: {
        "*": "ask",
        [Truncate.DIR]: "allow",
        [Truncate.GLOB]: "allow",
      },
      // 拒绝直接回答用户问题
      question: "deny",
      // 镜像 GitHub 的 .gitignore 模式，.env 文件需要询问
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })

    // 用户配置的权限
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    // 内置 Agent 配置
    const result: Record<string, Info> = {
      // build Agent：用于构建和开发
      build: {
        name: "build",
        options: {},
        // 合并默认权限、Agent 特定权限和用户权限
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            // 允许回答问题
            question: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },

      // plan Agent：用于规划和设计
      plan: {
        name: "plan",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            // 只允许编辑计划文件
            edit: {
              "*": "deny",
              ".opencode/plan/*.md": "allow",
            },
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },

      // general Agent：用于研究和多步骤任务
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            // 禁止读写待办事项
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },

      // explore Agent：用于快速探索代码库
      explore: {
        name: "explore",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            // 只允许只读操作
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },

      // compaction Agent：用于会话压缩（隐藏）
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            // 禁止所有操作
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },

      // title Agent：用于生成会话标题（隐藏）
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },

      // summary Agent：用于生成会话摘要（隐藏）
      summary: {
        name: "summary",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_SUMMARY,
      },
    }

    // 处理用户配置的自定义 Agent
    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      // 如果禁用，删除该 Agent
      if (value.disable) {
        delete result[key]
        continue
      }

      // 获取或创建 Agent
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }

      // 应用用户配置
      if (value.model) item.model = Provider.parseModel(value.model)
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    // 确保所有 Agent 都允许访问 Truncate.DIR（除非明确拒绝）
    for (const name in result) {
      const agent = result[name]
      // 检查是否明确拒绝
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.DIR || r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      // 添加允许规则
      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  /**
   * 获取指定 Agent
   *
   * @param agent - Agent 名称
   * @returns Promise，解析为 Agent 配置，如果不存在返回 undefined
   */
  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  /**
   * 获取所有 Agent
   *
   * 返回按默认 Agent 排序的 Agent 列表。
   *
   * @returns Promise，解析为 Agent 配置数组
   *
   * 排序规则：
   * - 默认 Agent 排在最前
   * - 其余按名称排序
   */
  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      // 默认 Agent 排在最前
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }

  /**
   * 获取默认 Agent
   *
   * @returns Promise，解析为默认 Agent 的名称
   */
  export async function defaultAgent() {
    return state().then((x) => Object.keys(x)[0])
  }

  /**
   * 使用 AI 生成新的 Agent 配置
   *
   * 根据用户的描述生成 Agent 配置。
   *
   * @param input - 生成参数
   *   - description：Agent 描述
   *   - model：可选的模型配置
   * @returns Promise，解析为生成的 Agent 配置
   *
   * 生成流程：
   * 1. 获取默认模型
   * 2. 构造系统提示词
   * 3. 使用 generateObject 生成配置
   * 4. 返回 identifier、whenToUse 和 systemPrompt
   */
  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    // 获取默认模型或使用指定的模型
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    // 构造系统提示词
    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)

    // 获取现有的 Agent 列表（避免重复）
    const existing = await list()

    // 生成 Agent 配置
    const result = await generateObject({
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        // 系统消息
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    })
    return result.object
  }
}
