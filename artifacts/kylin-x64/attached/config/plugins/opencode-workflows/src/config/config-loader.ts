/**
 * OpenCode Workflows —— ConfigLoader（单文件配置模型 + 开放资源字典，框架层）。
 *
 * workflow-create-studio（能力域 B/C）：从「`workflows.config.json` 多块 + 项目/全局
 * 两层合并」重设计为「**一个 workflow 一个独立配置文件**」——
 * `~/.opencode-workflows/<name>.config.json`，按 workflow 名索引，内置 `default-*`
 * 与自定义 workflow 统一规则。**放弃全局/项目两层合并**，改为读单一文件；相对路径在
 * 运行时按 `projectRoot` 绝对化（缓解「同一 wf 在不同项目用不同文件」）。
 *
 * 资源建模为**开放命名字典**：配置顶层 `resources: Record<string, ConfigValue>`
 * （任意类别名 → 路径或路径数组），并保留 `template`/`rules`/`review` 作为**知名类别
 * 别名**（向后兼容，供内置 `default-*` 继续使用）。解析后每个类别经
 * `ctx.config.resources[<类别>]` 暴露绝对路径数组；知名三类**同时**镜像到顶层别名
 * `ctx.config.template`/`rules`/`review`（R16.4 等价性关键）。
 *
 * 迁移/兼容（R9）：采用「兼容读取（懒迁移，不落盘）」为主。首次加载某 wf 配置时，
 * 若新单文件不存在但旧 `workflows.config.json` 存在且含该 name 块，则就地把旧块映射为
 * 等价 `RawConfigBlock` 再解析；非法块仅自身降级、严格隔离。放弃旧两层合并（仅读全局）。
 *
 * 全程**只解析路径与类型标注，不读取所指向文件的内容**——资源内容由子 Agent 在执行时
 * 用 `read` 工具读取。任一缺失/非法按空配置降级（不抛，R8）。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Components and Interfaces / 3 + 迁移策略
 * Requirements: 7.1–7.6, 8.1–8.6, 9.1–9.5, 10.1–10.7, 16.4
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, normalize, resolve } from "node:path"

import type { ConfigValue, RawConfigBlock, ResolvedConfigBlock } from "../types"

// ============================================================================
// 全局目录解析（跨平台）
// ============================================================================

/**
 * 全局用户 workflow 目录名（单独目录，**不在** `.opencode` 下）。
 *
 * 用户全局自定义 workflow 的 `<name>.mjs` 与所有 workflow 的 `<name>.config.json`
 * 均放在 `~/.opencode-workflows/` 下，便于跨项目复用并收敛脚本加载攻击面。
 */
export const GLOBAL_DIR_NAME = ".opencode-workflows"

/** 知名资源类别（向后兼容别名，与顶层 template/rules/review 双暴露）。 */
export const KNOWN_RESOURCE_KINDS = ["template", "rules", "review"] as const
export type KnownResourceKind = (typeof KNOWN_RESOURCE_KINDS)[number]

/** 旧模型多块配置文件名（迁移兼容读取用）。 */
export const LEGACY_CONFIG_FILE_NAME = "workflows.config.json"

/** 审查门控最大轮次默认值（与历史硬编码一致）。 */
export const DEFAULT_MAX_REVIEW_ROUNDS = 3
/** 审查门控最大轮次钳制下界。 */
export const MIN_REVIEW_ROUNDS = 1
/** 审查门控最大轮次钳制上界（与 scaffold maxRounds 钳制一致）。 */
export const MAX_REVIEW_ROUNDS = 10

/**
 * 归一并钳制审查门控最大轮次：缺省/非数字/NaN/非有限 → 默认 3；小数向下取整；
 * 钳制到 [1,10]。解析后**恒为有效正整数**，脚本可直接用、无需再守卫。
 */
export function normalizeMaxReviewRounds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_REVIEW_ROUNDS
  const floored = Math.floor(value)
  if (floored < MIN_REVIEW_ROUNDS) return MIN_REVIEW_ROUNDS
  if (floored > MAX_REVIEW_ROUNDS) return MAX_REVIEW_ROUNDS
  return floored
}

/**
 * 内置 `default-*` workflow 的脚本默认配置（纯 per-phase 格式）——**单一事实源**。
 *
 * 三方消费同一函数，保证「studio 表单所见 = 引擎运行所得」：
 * 1. {@link createConfigLoader} 兜底（单文件/旧多块都缺失时）——引擎运行时真值；
 * 2. studio「改配置」种子化（tui.tsx 经 props 注入）——表单初始值；
 * 3. README 文档表格的权威出处。
 *
 * 当用户**全新安装**、`~/.opencode-workflows/<name>.config.json` 与旧 `workflows.config.json`
 * 均不存在时，由 {@link createConfigLoader} 的 `scriptDefaults` 兜底返回，作为四个内置
 * workflow 的开箱默认（R8 第 3 层兜底）。用户一旦经 `/workflows-studio` 改配置并落盘，
 * 单文件命中（第 1 层）即覆盖此默认。
 *
 * 设计取值（与产品默认对齐）：
 * - 资源三类 `template`/`rules`/`review` 均为占位 `"none"`（解析为空数组），并配占位引导语，
 *   提示用户去 studio 填本地路径；未配置时各审查维度【无对照基准 → 直接判定通过】。
 * - 落盘路径：`default-prd` → `docs/prd.md`、`default-design` → `docs/design.md`、
 *   `default-test` → `docs/test.md`；`default-code` 不预设落盘（产出为代码，由子 Agent 自行写文件）。
 * - 审查轮次：四者均为默认 3。
 *
 * 返回 `undefined` 表示该 workflow 无内置默认（非 default-*），交由空配置降级。
 */
export function defaultScriptDefaults(workflowName: string): RawConfigBlock | undefined {
  const placeholderLabels = (phase: string): Record<string, Record<string, string>> => ({
    [phase]: {
      review: `请把审查标准文件的本地路径填到 resources.${phase}.review（当前为占位 none）`,
      rules: `请把工程规约文件的本地路径填到 resources.${phase}.rules（当前为占位 none）`,
      template: `请把模板文件的本地路径填到 resources.${phase}.template（当前为占位 none）`,
    },
  })
  const noneResources = (phase: string): Record<string, Record<string, ConfigValue>> => ({
    [phase]: { review: "none", rules: "none", template: "none" },
  })

  const build = (
    phase: string,
    outputPath: string | null,
  ): RawConfigBlock => {
    const block: RawConfigBlock = {
      resources: noneResources(phase),
      resourceLabels: placeholderLabels(phase),
      max_review_rounds: { [phase]: DEFAULT_MAX_REVIEW_ROUNDS },
    }
    if (outputPath) block.output_path = { [phase]: outputPath }
    return block
  }

  switch (workflowName) {
    case "default-prd":
      return build("PRD", "docs/prd.md")
    case "default-design":
      return build("Design", "docs/design.md")
    case "default-code":
      return build("Code", null)
    case "default-test":
      return build("Test", "docs/test.md")
    default:
      return undefined
  }
}


export function detectLegacyFormat(block: RawConfigBlock): {
  isLegacy: boolean
  issues: string[]
} {
  const issues: string[] = []

  // 检测 resources 是否为扁平字典（旧格式）
  if (block.resources && typeof block.resources === "object") {
    for (const [key, value] of Object.entries(block.resources)) {
      // 如果 value 是 string 或 string[]，则是旧格式（扁平字典）
      if (typeof value === "string" || Array.isArray(value)) {
        issues.push(`resources.${key} 使用旧格式（扁平字典），需迁移为嵌套字典（按阶段配置）`)
        break
      }
    }
  }

  // 检测知名类别别名（已废弃，但需检测旧数据）
  const hasTemplate = "template" in block && block.template !== undefined
  const hasRules = "rules" in block && block.rules !== undefined
  const hasReview = "review" in block && block.review !== undefined
  
  if (hasTemplate) {
    issues.push("template 顶层别名已废弃，需迁移到 resources 嵌套字典")
  }
  if (hasRules) {
    issues.push("rules 顶层别名已废弃，需迁移到 resources 嵌套字典")
  }
  if (hasReview) {
    issues.push("review 顶层别名已废弃，需迁移到 resources 嵌套字典")
  }

  // 检测 output_path 是否为字符串（旧格式）
  if (typeof block.output_path === "string") {
    issues.push("output_path 使用旧格式（字符串），需迁移为 per-phase 字典")
  }

  // 检测 max_review_rounds 是否为数字（旧格式）
  if (typeof block.max_review_rounds === "number") {
    issues.push("max_review_rounds 使用旧格式（数字），需迁移为 per-phase 字典")
  }

  return {
    isLegacy: issues.length > 0,
    issues,
  }
}

/**
 * 解析纯 per-phase 资源配置（嵌套字典）。
 *
 * 从 `RawConfigBlock.resources`（`Record<string, Record<string, ConfigValue>>`）
 * 解析为 `ResolvedConfigBlock.resourcesByPhase`（各阶段各类别的绝对路径数组）。
 *
 * 规则：
 * - 逐阶段逐类别处理，非法项跳过不抛
 * - 阶段名/类别名须为非空字符串
 * - 每个类别的值经 resolveResources 解析为绝对路径数组
 * - 未配置/非法 → 空数组
 *
 * Requirements: 1.1, 6.1
 */
function resolvePerPhaseResources(
  resources: Record<string, Record<string, ConfigValue>> | undefined,
  projectRoot: string,
): Record<string, Record<string, string[]>> {
  const result: Record<string, Record<string, string[]>> = {}

  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    return result
  }

  for (const [phase, categories] of Object.entries(resources)) {
    // 跳过非法阶段名
    if (typeof phase !== "string" || phase.length === 0) continue
    // 跳过非对象的类别字典
    if (!categories || typeof categories !== "object" || Array.isArray(categories)) continue

    result[phase] = {}
    for (const [category, value] of Object.entries(categories)) {
      // 跳过非法类别名
      if (typeof category !== "string" || category.length === 0) continue

      const paths = resolveResources(value as ConfigValue, projectRoot)
      // 保留空数组（R12.3: "none" 解析为 []，需要在 resourcesByPhase 中体现）
      result[phase][category] = paths
    }
  }

  return result
}

/**
 * 解析纯 per-phase 资源引导语（嵌套字典）。
 *
 * 从 `RawConfigBlock.resourceLabels`（`Record<string, Record<string, string>>`）
 * 解析为 `ResolvedConfigBlock.resourceLabelsByPhase`。
 *
 * Requirements: 1.5, 6.5
 */
function resolvePerPhaseResourceLabels(
  resourceLabels: Record<string, Record<string, string>> | undefined,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}

  if (!resourceLabels || typeof resourceLabels !== "object" || Array.isArray(resourceLabels)) {
    return result
  }

  for (const [phase, labels] of Object.entries(resourceLabels)) {
    // 跳过非法阶段名
    if (typeof phase !== "string" || phase.length === 0) continue
    // 跳过非对象的标签字典
    if (!labels || typeof labels !== "object" || Array.isArray(labels)) continue

    result[phase] = {}
    for (const [category, label] of Object.entries(labels)) {
      // 跳过非法类别名
      if (typeof category !== "string" || category.length === 0) continue
      // 跳过非字符串的标签值
      if (typeof label !== "string" || label.length === 0) continue

      result[phase][category] = label
    }
  }

  return result
}

/**
 * 解析纯 per-phase 产出路径（字典）。
 *
 * 从 `RawConfigBlock.output_path`（`Record<string, string>`）
 * 解析为 `ResolvedConfigBlock.outputPathByPhase`。
 *
 * 规则：
 * - 阶段名须为非空字符串
 * - 路径值须为非空字符串（经 stripSurroundingQuotes 清洗）
 * - 非法项跳过不抛
 * - 占位符 `<FEATURE>`/`<RUNID>` 保留，由引擎侧替换
 *
 * Requirements: 6.7
 */
function resolvePerPhaseOutputPath(
  outputPath: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {}

  if (!outputPath || typeof outputPath !== "object" || Array.isArray(outputPath)) {
    return result
  }

  for (const [phase, path] of Object.entries(outputPath)) {
    // 跳过非法阶段名
    if (typeof phase !== "string" || phase.length === 0) continue
    // 跳过非字符串路径
    if (typeof path !== "string") continue

    const cleaned = stripSurroundingQuotes(path)
    if (cleaned.length === 0 || cleaned === "none") continue

    result[phase] = cleaned
  }

  return result
}

/**
 * 解析纯 per-phase 审查轮次（字典）。
 *
 * 从 `RawConfigBlock.max_review_rounds`（`Record<string, number>`）
 * 解析为 `ResolvedConfigBlock.maxReviewRoundsByPhase`。
 *
 * 规则：
 * - 阶段名须为非空字符串
 * - 轮次值须为有限数字，钳制到 [1,10]
 * - 非法项跳过不抛
 *
 * Requirements: 6.7
 */
function resolvePerPhaseMaxReviewRounds(
  maxReviewRounds: Record<string, number> | undefined,
): Record<string, number> {
  const result: Record<string, number> = {}

  if (!maxReviewRounds || typeof maxReviewRounds !== "object" || Array.isArray(maxReviewRounds)) {
    return result
  }

  for (const [phase, rounds] of Object.entries(maxReviewRounds)) {
    // 跳过非法阶段名
    if (typeof phase !== "string" || phase.length === 0) continue
    // 跳过非有限数字
    if (typeof rounds !== "number" || !Number.isFinite(rounds)) continue

    result[phase] = normalizeMaxReviewRounds(rounds)
  }

  return result
}

/**
 * 跨平台解析全局目录的规范化绝对路径。
 *
 * `os.homedir()` 已封装平台差异（Windows `%USERPROFILE%` / POSIX `$HOME`）：
 * - 返回非空字符串时以 home 为基准拼接 {@link GLOBAL_DIR_NAME}；
 * - 返回空字符串或抛错（极端降级）时以 `process.cwd()` 为基准。
 *
 * 用 `path.resolve` 完成「拼接 + 规范化 + 绝对化」。无副作用、不创建目录、不访问 FS。
 *
 * Requirements: 7.1
 */
export function resolveGlobalDir(): string {
  let home = ""
  try {
    home = homedir()
  } catch {
    home = ""
  }
  const base = home && home.length > 0 ? home : process.cwd()
  return resolve(base, GLOBAL_DIR_NAME)
}

/** 单 workflow 配置文件名：`<name>.config.json`。 */
export function configFileNameOf(workflowName: string): string {
  return `${workflowName}.config.json`
}

// ============================================================================
// 资源值解析与路径绝对化
// ============================================================================

/**
 * 把单个资源值（已是字符串）绝对化为规范化绝对路径。
 *
 * - **相对路径**：以 `projectRoot` 为基准经 {@link resolve} 绝对化（R7.5）。
 * - **绝对路径**：经 {@link normalize} 规范化保留，**不被 `projectRoot` 改写**（R7.6）。
 *
 * 全程不访问文件系统、不解引用符号链接。
 *
 * Requirements: 7.5, 7.6
 */
export function toAbsolute(v: string, projectRoot: string): string {
  return isAbsolute(v) ? normalize(v) : resolve(projectRoot, v)
}

/**
 * 容错：剥离路径值首尾**成对**的引号（英文双引号 `"` / 单引号 `'`）与空白。
 *
 * 主要应对 Windows 资源管理器「复制为路径」会把路径包成 `"D:\\a\\b.md"`——带引号的值
 * 以 `"` 开头会被 {@link isAbsolute} 判为**非绝对路径**，进而被错误地拼到 projectRoot 后
 * （产生 `D:\\root\\"D:\\a\\b.md"` 这类坏路径，子 Agent 据此 read 必失败）。本函数反复
 * 剥离成对包裹（应对偶发的多层包裹），保证后续绝对/相对判定基于干净路径。
 *
 * 仅剥离**首尾字符相同**的成对引号，避免误伤含单侧引号的合法文件名。纯函数、无副作用。
 */
export function stripSurroundingQuotes(value: string): string {
  let v = value.trim()
  while (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      v = v.slice(1, -1).trim()
    } else {
      break
    }
  }
  return v
}

/**
 * 解析单个资源类别的值（`ConfigValue | undefined`）为绝对路径数组。
 *
 * 值解析分类规则（仅本地路径，无 `default`、无 MCP 分支）：
 * - `undefined`（未配置）→ `[]`；
 * - `"none"`、空字符串、空数组 → `[]`（视为「不额外提供资源」，脚本回退自带默认）；
 * - 任意非空字符串 → 含其绝对化路径的**单元素**数组；
 * - 数组 → 逐元素解析后按**原顺序** `concat` 叠加；
 * - 非字符串元素（类型降级场景）→ 跳过，不抛异常（R8.4）。
 *
 * Requirements: 8.4, 8.5, 10.5, 10.6, 10.7
 */
export function resolveResources(value: ConfigValue | undefined, projectRoot: string): string[] {
  if (value === undefined) return []
  const items = Array.isArray(value) ? value : [value]
  const result: string[] = []
  for (const raw of items) {
    if (typeof raw !== "string") continue
    const v = stripSurroundingQuotes(raw)
    if (v.length === 0 || v === "none") continue
    result.push(toAbsolute(v, projectRoot))
  }
  return result
}

// ============================================================================
// 配置块解析（resolveConfigBlock / createConfigLoader）
// ============================================================================

/**
 * ConfigLoader 公开接口。
 *
 * 把单 workflow 配置文件 `<name>.config.json` 解析为可注入 `ctx.config` 的
 * {@link ResolvedConfigBlock}。缺失/非法/迁移失败按空配置降级（不抛，R8）。
 */
export interface ConfigLoader {
  /**
   * 解析某 workflow 全名对应的、已绝对化的配置块。
   *
   * @param workflowName workflow 全名（如 "default-prd"、用户自定义名）。
   * @param projectRoot  相对路径绝对化的基准；默认构造时注入值或 process.cwd()。
   */
  resolveConfigBlock(workflowName: string, projectRoot?: string): Promise<ResolvedConfigBlock>
}

/**
 * ConfigLoader 工厂选项（依赖注入，便于属性测试用内存 FS）。
 */
export interface ConfigLoaderOptions {
  /** 全局目录（含 `<name>.config.json` 与旧 workflows.config.json），默认 {@link resolveGlobalDir}。 */
  globalDir?: string
  /** 项目根（相对路径绝对化基准），默认 process.cwd()。 */
  projectRoot?: string
  /** 读取并解析某 JSON 文件；缺失/非法/顶层非对象返回 undefined。注入式便于测试。 */
  readJsonFile?: (path: string) => Promise<Record<string, unknown> | undefined>
  /** 内置 default-* 的脚本默认块（迁移/降级兜底）；非 default-* 返回 undefined，缺省整体返回空块。 */
  scriptDefaults?: (workflowName: string) => RawConfigBlock | undefined
  /** 配置缺失时记一条警告（R8.2）；缺省 no-op。 */
  warn?: (message: string) => void
  /**
   * 旧模型兼容读取器（注入式，便于测试）：读 `workflows.config.json` 顶层对象。
   * 缺省用默认实现读 `<globalDir>/workflows.config.json`。
   */
  readLegacyConfig?: () => Promise<Record<string, unknown> | undefined>
}

/**
 * 构造一个降级空 {@link ResolvedConfigBlock}（纯 per-phase 格式）。
 *
 * 每次调用返回**新对象**，避免脚本意外共享/改写同一引用。
 *
 * Requirements: 8.5, 13.4, 13.5
 */
export function emptyConfigBlock(): ResolvedConfigBlock {
  return {
    resourcesByPhase: {},
    resourceLabelsByPhase: {},
    outputPathByPhase: {},
    maxReviewRoundsByPhase: {},
    // 旧版兼容字段（已废弃，保留空值）
    resources: {},
    resourceLabels: {},
    template: [],
    rules: [],
    review: [],
    outputPath: null,
    maxReviewRounds: DEFAULT_MAX_REVIEW_ROUNDS,
  }
}

/**
 * 默认 JSON 文件读取器：读取并解析某 JSON 文件，缺失/非法/顶层非对象一律返回 `undefined`。
 *
 * 降级语义（全程不抛，对齐 R8.1/R8.3）：文件不存在/不可读、非法 JSON、顶层 null/非对象/数组 → undefined。
 */
async function defaultReadJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

/**
 * 取某 workflow 名对应的原始配置块（迁移兼容读取用）。
 *
 * 降级语义（均不抛）：配置对象缺失/非对象 → 空块 `{}`；索引值缺失/null/非对象/数组 → 空块 `{}`。
 */
function pickLegacyBlock(cfg: Record<string, unknown> | undefined, name: string): RawConfigBlock {
  if (!cfg || typeof cfg !== "object") return {}
  const block = cfg[name]
  if (!block || typeof block !== "object" || Array.isArray(block)) return {}
  return block as RawConfigBlock
}

/**
 * 把一个 {@link RawConfigBlock}（新单文件解析出 或 旧块映射出）解析为
 * {@link ResolvedConfigBlock}（纯 per-phase 格式）。
 *
 * 纯 per-phase 设计：
 * 1. 检测旧格式，记录警告并拒绝解析（返回空配置块）
 * 2. 解析 resources 为嵌套字典（阶段 → 类别 → 绝对路径数组）
 * 3. 解析 resourceLabels 为嵌套字典（阶段 → 类别 → 引导语）
 * 4. 解析 output_path 为字典（阶段 → 路径模板）
 * 5. 解析 max_review_rounds 为字典（阶段 → 钳制后轮次）
 *
 * 单块解析以 try/catch 兜底：任意子字段异常不影响整体（块隔离）。
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5, 6.1, 6.5, 6.7, 8.5
 */
export function resolveBlock(block: RawConfigBlock, projectRoot: string): ResolvedConfigBlock {
  const out = emptyConfigBlock()
  
  try {
    // 0. 检测旧格式（扁平 resources、知名别名、全局 output_path/max_review_rounds）
    const { isLegacy, issues } = detectLegacyFormat(block)
    if (isLegacy) {
      console.warn("[ConfigLoader] 检测到旧配置格式，拒绝解析：")
      issues.forEach((issue) => console.warn(`  - ${issue}`))
      console.warn("  请参考迁移文档将配置转换为纯 per-phase 格式。")
      return emptyConfigBlock()
    }

    // 1. 解析纯 per-phase resources（嵌套字典：阶段 → 类别 → 绝对路径数组）
    out.resourcesByPhase = resolvePerPhaseResources(block.resources, projectRoot)

    // 2. 解析纯 per-phase resourceLabels（嵌套字典：阶段 → 类别 → 引导语）
    out.resourceLabelsByPhase = resolvePerPhaseResourceLabels(block.resourceLabels)

    // 3. 解析纯 per-phase output_path（字典：阶段 → 路径模板）
    out.outputPathByPhase = resolvePerPhaseOutputPath(block.output_path)

    // 4. 解析纯 per-phase max_review_rounds（字典：阶段 → 钳制后轮次）
    out.maxReviewRoundsByPhase = resolvePerPhaseMaxReviewRounds(block.max_review_rounds)
  } catch (err) {
    // 块内任意异常 → 该块降级为空块（块隔离）
    console.error("[ConfigLoader] 解析配置块时出错，降级为空配置：", err)
    return emptyConfigBlock()
  }
  
  return out
}

/**
 * 创建 ConfigLoader（单文件配置模型 + 资源字典 + 迁移兼容读取）。
 *
 * 依赖注入便于测试：可注入内存 `readJsonFile`/`readLegacyConfig`、固定
 * `globalDir`/`projectRoot` 与 `scriptDefaults`。缺省时用跨平台默认实现。
 *
 * 解析流程 `resolveConfigBlock(name, projectRoot)`：
 *   1. 读 `<globalDir>/<name>.config.json` → 命中则 {@link resolveBlock} 返回（新模型优先）。
 *   2. 未命中 → 兼容读取旧 `workflows.config.json` 顶层对象，取该 name 块：
 *      - 有该块 → 映射为 RawConfigBlock 解析返回（懒迁移，不落盘，R9.2）。
 *      - 块缺失/非法 → 仅该块降级空块（块隔离，R9.3/R9.4）+ warn。
 *   3. 旧文件也无 → scriptDefaults 兜底（注意：scriptDefaults 必须返回纯 per-phase 格式）；
 *      仍空 → emptyConfigBlock + warn（R8.1/R8.2）。
 *
 * Requirements: 7.1, 7.2, 7.4, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 9.5
 */
export function createConfigLoader(options: ConfigLoaderOptions = {}): ConfigLoader {
  const globalDir = options.globalDir ?? resolveGlobalDir()
  const defaultProjectRoot = options.projectRoot ?? process.cwd()
  const readJsonFile = options.readJsonFile ?? defaultReadJsonFile
  const scriptDefaults = options.scriptDefaults ?? (() => ({}))
  const warn = options.warn ?? (() => {})
  const readLegacyConfig =
    options.readLegacyConfig ?? (() => readJsonFile(join(globalDir, LEGACY_CONFIG_FILE_NAME)))

  async function resolveConfigBlock(
    workflowName: string,
    projectRoot: string = defaultProjectRoot,
  ): Promise<ResolvedConfigBlock> {
    // 1. 新模型：读单文件 <name>.config.json。
    const singleFilePath = join(globalDir, configFileNameOf(workflowName))
    const single = await readJsonFile(singleFilePath)
    if (single) {
      return resolveBlock(single as RawConfigBlock, projectRoot)
    }

    // 2. 兼容读取旧 workflows.config.json（懒迁移，不落盘）。
    const legacy = await readLegacyConfig()
    if (legacy) {
      const block = pickLegacyBlock(legacy, workflowName)
      if (Object.keys(block).length > 0) {
        return resolveBlock(block, projectRoot)
      }
    }

    // 3. 脚本默认兜底（内置 default-*）。
    // 注意：scriptDefaults 必须返回纯 per-phase 格式，否则会被 resolveBlock 拒绝。
    const defaults = scriptDefaults(workflowName) ?? {}
    if (Object.keys(defaults).length > 0) {
      return resolveBlock(defaults, projectRoot)
    }

    // 4. 全缺失 → 空块降级 + 警告（R8.1/R8.2）。
    warn(`workflow "${workflowName}" 无配置文件（${singleFilePath}），按空配置降级`)
    return emptyConfigBlock()
  }

  return { resolveConfigBlock }
}
