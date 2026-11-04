/**
 * OpenCode Workflows —— `/workflows-create` 动态创建工具（落盘编排核心 + tool 定义）。
 *
 * 设计（对标 Claude Code 的 Workflow 工具）：
 * - **Tool Description**（见 {@link WORKFLOW_CREATE_DESCRIPTION}）承载全部「生成规范」——
 *   模型读得到、**不进对话**（属工具 schema），实现「提示词不暴露」。
 * - **execute** 由模型在多轮对话生成 `.mjs`/`config.json` 后调用，做确定性的
 *   契约校验 + 写盘（TypeScript 保证可靠性，不靠模型自觉）。
 *
 * 本文件的 {@link persistDynamicWorkflow} 是 execute 的**可测核心**：全部副作用经 deps
 * 注入，编排「名称校验 → 契约校验 → 写 .mjs → extractMeta 验 meta(C5) → 写 config.json」，
 * 并保证关键的短路顺序与失败清理语义。
 */

import type { ContractViolation, ValidationResult } from "./workflow-create-validator"

// ============================================================================
// 落盘编排核心（可测，deps 注入）
// ============================================================================

/** `/workflows-create` 工具入参（模型在对话生成产物后传入）。 */
export interface CreateInput {
  /** workflow 名（kebab-case，作为文件名与 meta.name）。 */
  name: string
  /** 生成的 `.mjs` 脚本内容。 */
  script: string
  /** 生成的 `<name>.config.json` 内容（可选；空/空白视为无配置）。 */
  config?: string
}

/** 落盘编排依赖（注入式，便于测试与装配解耦）。 */
export interface CreateDeps {
  /** 名称校验（格式 + 保留前缀 + 重名）；返回 `{ ok, reason? }`。 */
  checkName: (name: string) => { ok: boolean; reason?: string }
  /** 契约校验（C1/C2/C4）。 */
  validateScript: (content: string) => Promise<ValidationResult>
  /** 写文件到全局目录，返回写入的绝对路径。 */
  writeFile: (fileName: string, content: string) => Promise<string>
  /** 提取并校验 meta（C5，纯字面量 + 字段约束）；meta 非法时**抛错**。 */
  extractMeta: (absPath: string) => Promise<unknown>
  /** 删除文件（meta 校验失败时清理已写的 .mjs，避免坏注册）。 */
  deleteFile: (absPath: string) => Promise<void>
}

/** 落盘编排结果。 */
export interface CreateResult {
  ok: boolean
  scriptPath?: string
  configPath?: string
  /** 名称非法原因（短路）。 */
  nameError?: string
  /** 契约违约清单（短路，供模型修正重试）。 */
  violations?: ContractViolation[]
  /** meta(C5) 校验失败信息（已清理 .mjs）。 */
  metaError?: string
}

/** 配置文件名派生（与 ConfigLoader.configFileNameOf 同规则，避免循环依赖在此内联）。 */
function configFileNameOf(name: string): string {
  return name + ".config.json"
}

/**
 * 动态 workflow 落盘编排（execute 核心）。
 *
 * 短路顺序（任一失败立即返回，不进行后续副作用）：
 * 1. 名称校验失败 → `{ ok:false, nameError }`（不校验脚本、不写盘）。
 * 2. 契约校验失败 → `{ ok:false, violations }`（不写盘）。
 * 3. 写 `<name>.mjs` → extractMeta 验 meta：抛错则删除 .mjs，返回 `{ ok:false, metaError }`。
 * 4. 有非空 config → 写 `<name>.config.json`。
 * 5. 全部通过 → `{ ok:true, scriptPath, configPath? }`。
 */
export async function persistDynamicWorkflow(input: CreateInput, deps: CreateDeps): Promise<CreateResult> {
  const name = String(input.name ?? "").trim()
  const script = String(input.script ?? "")
  const config = typeof input.config === "string" ? input.config : ""

  // 1. 名称校验（短路）。
  const nameCheck = deps.checkName(name)
  if (!nameCheck.ok) {
    return { ok: false, nameError: nameCheck.reason ?? "名称非法" }
  }

  // 2. 契约校验（短路，不写盘）。
  const validation = await deps.validateScript(script)
  if (!validation.passed) {
    return { ok: false, violations: validation.violations }
  }

  // 3. 写 .mjs → extractMeta 验 meta(C5)。
  const scriptPath = await deps.writeFile(name + ".mjs", script)
  try {
    await deps.extractMeta(scriptPath)
  } catch (e) {
    // meta 非法：清理已写的 .mjs（避免坏注册），返回 metaError。
    await deps.deleteFile(scriptPath).catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, metaError: msg }
  }

  // 4. 写 config.json（仅当提供了非空内容）。
  let configPath: string | undefined
  if (config.trim().length > 0) {
    configPath = await deps.writeFile(configFileNameOf(name), config)
  }

  // 5. 成功。
  return { ok: true, scriptPath, configPath }
}

// ============================================================================
// 结果格式化（给模型的反馈文本，可测）
// ============================================================================

/**
 * 把 {@link CreateResult} 格式化为工具返回文本（模型据此继续：成功告知用户 / 失败修正重试）。
 *
 * - 成功：列出落盘路径 + 运行指引。
 * - 名称非法 / meta 非法：单行错误 + 修正提示。
 * - 契约违约：逐条列出 contract/detail/fix，并明确指示「修正 script 后重新调用本工具」。
 */
export function formatCreateResult(name: string, r: CreateResult): string {
  if (r.ok) {
    const lines = [
      `✅ workflow "${name}" 已创建并通过契约校验。`,
      `脚本：${r.scriptPath}`,
    ]
    if (r.configPath) lines.push(`配置：${r.configPath}`)
    lines.push("", "请告知用户：输入 /workflows-run 选择该 workflow 即可运行；可用 /workflows-studio 改配置。")
    return lines.join("\n")
  }
  if (r.nameError) {
    return `❌ 名称不合法：${r.nameError}\n请与用户确认一个合法的 kebab-case 名称（不得以 default- 开头），然后重新调用本工具。`
  }
  if (r.metaError) {
    return (
      `❌ meta 校验未通过（契约 5：meta 必须为纯字面量）：${r.metaError}\n` +
      `请将 export const meta 改为纯对象字面量（无变量引用/函数调用/模板插值），然后重新调用本工具。`
    )
  }
  if (r.violations && r.violations.length > 0) {
    const items = r.violations
      .map((v, i) => `${i + 1}. [契约${v.contract} ${v.name}] ${v.detail}\n   正确写法：${v.fix}`)
      .join("\n")
    return (
      `❌ 契约校验未通过（${r.violations.length} 项），脚本未写盘：\n${items}\n\n` +
      `请据上修正 script 后**重新调用本工具**（最多 3 轮）。`
    )
  }
  return "❌ 创建失败（未知原因）。"
}

// ============================================================================
// tool() 定义工厂（装配真实 deps，注册到 server plugin 的 Hooks.tool）
// ============================================================================

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { mkdir, rename, unlink, writeFile as fsWriteFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

import { validateWorkflowScript } from "./workflow-create-validator"
import { extractMeta } from "../engine/script-loader"
import { validateName } from "../tui/scaffold"
import { resolveGlobalDir } from "../config/config-loader"
import { WORKFLOW_CREATE_DESCRIPTION } from "./workflow-create-description"

/** {@link createWorkflowCreateTool} 选项（注入式，便于装配与测试）。 */
export interface WorkflowCreateToolOptions {
  /** 已注册 workflow 名集合（用于重名校验）；缺省为空集（不查重）。 */
  getRegisteredNames?: () => ReadonlySet<string>
  /** 全局目录（落盘根）；缺省 {@link resolveGlobalDir}。 */
  globalDir?: string
  /** 覆盖落盘编排 deps（测试用）；缺省用真实 FS/校验实现。 */
  deps?: Partial<CreateDeps>
}

/** 原子写入全局目录：mkdir -p + 写临时文件 + rename，返回绝对路径。 */
async function atomicWriteToDir(dir: string, fileName: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const finalPath = join(dir, fileName)
  const tmpPath = finalPath + "." + randomUUID() + ".tmp"
  await fsWriteFile(tmpPath, content, "utf8")
  try {
    await rename(tmpPath, finalPath)
  } catch (e) {
    await unlink(tmpPath).catch(() => {})
    throw e
  }
  return finalPath
}

/**
 * 构造 `workflow-create` 工具定义（{@link ToolDefinition}），供 server plugin 经
 * `Hooks.tool["workflow-create"]` 注册。description 即隐藏的生成规范。
 */
export function createWorkflowCreateTool(options: WorkflowCreateToolOptions = {}): ToolDefinition {
  const globalDir = options.globalDir ?? resolveGlobalDir()
  const getNames = options.getRegisteredNames ?? (() => new Set<string>())

  const realDeps: CreateDeps = {
    checkName: (name) => {
      const v = validateName(name, getNames())
      return v.ok ? { ok: true } : { ok: false, reason: v.reason }
    },
    validateScript: (content) => validateWorkflowScript(content),
    writeFile: (fileName, content) => atomicWriteToDir(globalDir, fileName, content),
    extractMeta: (absPath) => extractMeta(absPath),
    deleteFile: (absPath) => unlink(absPath).then(() => {}),
    ...options.deps,
  }

  return tool({
    description: WORKFLOW_CREATE_DESCRIPTION,
    args: {
      name: tool.schema.string().describe("workflow 名（kebab-case，作为文件名与 meta.name）"),
      script: tool.schema.string().describe("完整的 .mjs 脚本内容（遵守 5 条契约）"),
      config: tool.schema
        .string()
        .optional()
        .describe("<name>.config.json 内容（含 per-phase resources / max_review_rounds / output_path）；无则省略"),
    },
    async execute(args) {
      const result = await persistDynamicWorkflow(
        { name: args.name, script: args.script, config: args.config },
        realDeps,
      )
      return formatCreateResult(args.name, result)
    },
  })
}
