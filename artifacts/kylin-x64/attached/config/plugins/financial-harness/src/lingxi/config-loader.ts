// config-loader.ts — 加载、验证、解析 lingxi_harness_config.json

import path from "path"

// ── 类型定义 ──────────────────────────────────────────────

export type PhaseId = "prd" | "design" | "code" | "test"

export interface PhaseConfig {
  template: string | string[]
  rules: string | string[]
  review: string | string[]
  max_review_rounds: number
  output_path?: string          // 每阶段独立的输出路径，如 "docs/<FEATURE>/概要设计文档.md"
}

export interface LingxiHarnessConfig {
  prd: PhaseConfig
  design: PhaseConfig
  code: PhaseConfig
  test: PhaseConfig
}

export interface ResolvedValue {
  type: "builtin" | "local" | "none" | "skip"
  value: string
}

export interface ResolvedPhaseConfig {
  template: ResolvedValue[]
  rules: ResolvedValue[]
  review: ResolvedValue[]
  max_review_rounds: number
  output_path?: string
}

// ── 配置值分类 ────────────────────────────────────────────

function classifyConfigValue(value: string): ResolvedValue {
  if (value === "default") return { type: "builtin", value: "default" }
  if (value === "none") return { type: "none", value: "" }
  if (value === "") return { type: "skip", value: "" }
  return { type: "local", value }
}

/** 将单值或数组统一为数组 */
function normalizeToArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value]
}

// ── 默认配置 ──────────────────────────────────────────────

const DEFAULT_CONFIG: LingxiHarnessConfig = {
  prd:    { template: ["default"], rules: [], review: [], max_review_rounds: 3, output_path: "docs/<FEATURE>/概要设计文档.md" },
  design: { template: ["default"], rules: [], review: [], max_review_rounds: 3, output_path: "docs/<FEATURE>/详细设计与程序设计文档.md" },
  code:   { template: [],          rules: [], review: [], max_review_rounds: 2 },
  test:   { template: ["default"], rules: [], review: [], max_review_rounds: 3, output_path: "docs/<FEATURE>/测试报告文档.md" },
}

const CONFIG_FILENAME = "lingxi_harness_config.json"

// ── ConfigLoader ──────────────────────────────────────────

export class ConfigLoader {
  async load(directory: string): Promise<LingxiHarnessConfig> {
    const configPath = path.join(directory, CONFIG_FILENAME)
    const file = Bun.file(configPath)

    if (!(await file.exists())) {
      return structuredClone(DEFAULT_CONFIG)
    }

    try {
      const raw = await file.json()
      return this.validate(raw)
    } catch (err) {
      throw new ConfigValidationError(`lingxi_harness_config.json 解析失败: ${err}`)
    }
  }

  async loadDefault(): Promise<LingxiHarnessConfig> {
    return structuredClone(DEFAULT_CONFIG)
  }

  resolve(phase: PhaseId, config: LingxiHarnessConfig): ResolvedPhaseConfig {
    const pc = config[phase]
    return {
      template: normalizeToArray(pc.template).map(classifyConfigValue),
      rules: normalizeToArray(pc.rules).map(classifyConfigValue),
      review: normalizeToArray(pc.review).map(classifyConfigValue),
      max_review_rounds: pc.max_review_rounds,
      output_path: pc.output_path,
    }
  }

  private validateField(value: unknown, defaultValue: string | string[]): string | string[] {
    if (typeof value === "string") return value
    if (Array.isArray(value) && value.every(v => typeof v === "string")) return value as string[]
    if (Array.isArray(value) && value.length === 0) return []
    return defaultValue
  }

  private validate(raw: unknown): LingxiHarnessConfig {
    const obj = raw as Record<string, any>
    const phases: PhaseId[] = ["prd", "design", "code", "test"]

    for (const phase of phases) {
      if (!obj[phase] || typeof obj[phase] !== "object") {
        obj[phase] = structuredClone(DEFAULT_CONFIG[phase])
      } else {
        obj[phase].template = this.validateField(obj[phase].template, DEFAULT_CONFIG[phase].template)
        obj[phase].rules    = this.validateField(obj[phase].rules,    DEFAULT_CONFIG[phase].rules)
        obj[phase].review   = this.validateField(obj[phase].review,   DEFAULT_CONFIG[phase].review)
        if (typeof obj[phase].max_review_rounds !== "number" || obj[phase].max_review_rounds < 1) {
          obj[phase].max_review_rounds = DEFAULT_CONFIG[phase].max_review_rounds
        }
        // output_path: 可选字符串
        if (obj[phase].output_path !== undefined && typeof obj[phase].output_path !== "string") {
          delete obj[phase].output_path
        }
      }
    }

    return obj as LingxiHarnessConfig
  }
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigValidationError"
  }
}
