/**
 * ============================================================================
 * 文件名：system.ts
 * 所属包：packages/opencode/src/session
 * ============================================================================
 *
 * 文件作用：
 * 系统提示词模块。为 LLM 生成系统提示词，包括环境信息、
 * 提供商特定提示词和用户自定义规则。
 *
 * 主要功能：
 * - header(providerID)：获取提供商特定的头部提示词
 * - instructions()：获取 Codex 指令
 * - provider(model)：获取提供商特定的提示词
 * - environment()：获取环境信息提示词
 * - custom()：获取用户自定义规则
 *
 * 依赖关系：
 * - ../file/ripgrep：文件树生成
 * - ../global：全局配置路径
 * - ../util/filesystem：文件系统工具
 * - ../config/config：配置系统
 * - ../project/instance：实例管理
 * - path：路径处理
 * - os：操作系统模块
 * - ./prompt/*.txt：各种提示词模板文件
 * - ../provider/provider：提供商类型
 * - ../flag/flag：功能标志
 *
 * 导出内容：
 * - SystemPrompt namespace：系统提示词命名空间
 *   - header()：获取头部提示词
 *   - instructions()：获取 Codex 指令
 *   - provider()：获取提供商提示词
 *   - environment()：获取环境信息
 *   - custom()：获取自定义规则
 *
 * 提示词来源：
 * 1. 内置提示词文件（针对不同提供商）
 * 2. 环境信息（工作目录、Git 状态、平台等）
 * 3. 本地规则文件（AGENTS.md、CLAUDE.md 等）
 * 4. 全局规则文件
 * 5. 配置中的 instructions
 *
 * @package opencode
 * @module session/system
 */

// 导入 Ripgrep 文件树生成
import { Ripgrep } from "../file/ripgrep"

// 导入全局配置路径
import { Global } from "../global"

// 导入文件系统工具
import { Filesystem } from "../util/filesystem"

// 导入配置系统
import { Config } from "../config/config"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入路径模块
import path from "path"

// 导入操作系统模块
import os from "os"

// 导入内置提示词文件
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_CODEX_INSTRUCTIONS from "./prompt/codex_header.txt"

// 导入提供商类型
import type { Provider } from "@/provider/provider"

// 导入功能标志
import { Flag } from "@/flag/flag"

/**
 * 系统提示词命名空间
 *
 * 生成和管理 LLM 的系统提示词。
 */
export namespace SystemPrompt {
  /**
   * 获取提供商特定的头部提示词
   *
   * 某些提供商需要特殊的头部格式（如 Anthropic 的 XML 标签）。
   *
   * @param providerID - 提供商 ID
   * @returns 头部提示词数组
   */
  export function header(providerID: string) {
    // Anthropic 需要特殊的 XML 标签头部
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }

  /**
   * 获取 Codex 指令
   *
   * 返回 Codex 特定的指令格式。
   *
   * @returns Codex 指令字符串
   */
  export function instructions() {
    return PROMPT_CODEX_INSTRUCTIONS.trim()
  }

  /**
   * 获取提供商特定的提示词
   *
   * 根据模型 ID 返回对应的内置提示词。
   *
   * @param model - 模型配置
   * @returns 提供商提示词数组
   *
   * 提供商映射：
   * - gpt-5 → Codex 提示词
   * - gpt-*, o1, o3 → Beast 提示词
   * - gemini-* → Gemini 提示词
   * - claude* → Anthropic 提示词
   * - 其他 → Qwen 提示词（无 Todo）
   */
  export function provider(model: Provider.Model) {
    // GPT-5 使用 Codex 提示词
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]

    // GPT、O1、O3 使用 Beast 提示词
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]

    // Gemini 使用 Gemini 提示词
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]

    // Claude 使用 Anthropic 提示词
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]

    // 其他使用 Qwen 提示词（无 Todo）
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  /**
   * 获取环境信息提示词
   *
   * 生成包含工作目录、Git 状态、平台等环境信息的提示词。
   *
   * @returns Promise，解析为环境信息提示词数组
   *
   * 环境信息包括：
   * - 工作目录
   * - Git 仓库状态
   * - 操作系统平台
   * - 当前日期
   * - 文件树（可选）
   */
  export async function environment() {
    const project = Instance.project
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<files>`,
        // 如果是 Git 仓库，生成文件树（当前禁用）
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 200,
              })
            : ""
        }`,
        `</files>`,
      ].join("\n"),
    ]
  }

  /**
   * 本地规则文件列表
   *
   * 在工作树中向上查找的规则文件。
   */
  const LOCAL_RULE_FILES = [
    "AGENTS.md",    // Agent 规则
    "CLAUDE.md",    // Claude 规则
    "CONTEXT.md",   // 上下文规则（已废弃）
  ]

  /**
   * 全局规则文件列表
   *
   * 从全局配置目录读取的规则文件。
   */
  const GLOBAL_RULE_FILES = [path.join(Global.Path.config, "AGENTS.md")]

  // 如果未禁用 Claude Code 提示词，添加 Claude 默认配置
  if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT) {
    GLOBAL_RULE_FILES.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }

  // 如果指定了自定义配置目录，添加其中的规则文件
  if (Flag.OPENCODE_CONFIG_DIR) {
    GLOBAL_RULE_FILES.push(path.join(Flag.OPENCODE_CONFIG_DIR, "AGENTS.md"))
  }

  /**
   * 获取用户自定义规则
   *
   * 从本地和全局规则文件、配置中读取自定义规则。
   *
   * @returns Promise，解析为规则字符串数组
   *
   * 规则来源：
   * 1. 本地规则文件（在工作树中向上查找）
   * 2. 全局规则文件
   * 3. 配置中的 instructions（文件路径或 URL）
   *
   * 文件路径支持：
   * - 绝对路径
   * - 相对路径（相对于工作树）
   * - ~/ 开头的路径（相对于用户主目录）
   * - Glob 模式
   * - HTTP/HTTPS URL
   */
  export async function custom() {
    // 获取配置
    const config = await Config.get()

    // 收集所有规则文件路径
    const paths = new Set<string>()

    // 查找本地规则文件（向上查找）
    for (const localRuleFile of LOCAL_RULE_FILES) {
      const matches = await Filesystem.findUp(localRuleFile, Instance.directory, Instance.worktree)
      if (matches.length > 0) {
        matches.forEach((path) => paths.add(path))
        break
      }
    }

    // 查找全局规则文件
    for (const globalRuleFile of GLOBAL_RULE_FILES) {
      if (await Bun.file(globalRuleFile).exists()) {
        paths.add(globalRuleFile)
        break
      }
    }

    // 处理配置中的 instructions
    const urls: string[] = []
    if (config.instructions) {
      for (let instruction of config.instructions) {
        // 处理 URL
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
          urls.push(instruction)
          continue
        }

        // 处理 ~/ 开头的路径
        if (instruction.startsWith("~/")) {
          instruction = path.join(os.homedir(), instruction.slice(2))
        }

        let matches: string[] = []

        // 绝对路径：使用 Glob 扫描
        if (path.isAbsolute(instruction)) {
          matches = await Array.fromAsync(
            new Bun.Glob(path.basename(instruction)).scan({
              cwd: path.dirname(instruction),
              absolute: true,
              onlyFiles: true,
            }),
          ).catch(() => [])
        } else {
          // 相对路径：向上查找并 Glob
          matches = await Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
        }

        matches.forEach((path) => paths.add(path))
      }
    }

    // 读取所有文件
    const foundFiles = Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => "")
        .then((x) => "Instructions from: " + p + "\n" + x),
    )

    // 获取所有 URL
    const foundUrls = urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((res) => (res.ok ? res.text() : ""))
        .catch(() => "")
        .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
    )

    // 返回非空规则
    return Promise.all([...foundFiles, ...foundUrls]).then((result) => result.filter(Boolean))
  }
}
