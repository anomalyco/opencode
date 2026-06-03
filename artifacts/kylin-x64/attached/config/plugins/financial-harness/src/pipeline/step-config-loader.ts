// step-config-loader.ts — Pipeline Step 定制化配置加载器
// 加载优先级：项目 .harness/pipeline_config/{mod}_pipeline_config.md > 插件 pipeline_config/{mod}_pipeline_config.md

import path from "path"

export interface StepConfig {
  name: string                                    // "Step_0"
  description: string                             // "上下文恢复"
  customizable: "true" | "false" | "caution"     // 定制化适合度
  instructions: string                            // 完整指令文本（已替换变量）
}

export interface StepVars {
  MOD: string
  MOD_LABEL: string
  CTX_FILE: string
  PLAN_FILE: string
  INDEX_FILE: string
  DOC_FILE: string
  DOC_NAME: string
  UPSTREAM: string
  MAX_REVIEW_ROUNDS: string
  REVIEW_REPORT: string
  LANG_HINT: string
}

export class StepConfigLoader {
  constructor(
    private pluginDir: string,    // 插件目录（import.meta.dir 的上级）
    private projectDir: string,   // 项目工作目录（pluginDirectory）
  ) {}

  /**
   * 加载指定模块的所有 Step 配置
   * 合并逻辑：插件默认配置 + 用户覆盖（用户只需定义想覆盖的 Step）
   */
  async loadModuleConfig(mod: string, vars: StepVars): Promise<StepConfig[]> {
    const filename = `${mod}_pipeline_config.md`

    // 1. 加载插件默认配置
    const defaultPath = path.join(this.pluginDir, "pipeline_config", filename)
    const defaultContent = await this.readFile(defaultPath)
    if (!defaultContent) {
      throw new Error(`插件默认配置文件不存在: ${defaultPath}`)
    }
    const defaultSteps = this.parseConfigFile(defaultContent, vars)

    // 2. 尝试加载用户自定义配置
    const userPath = path.join(this.projectDir, ".harness", "pipeline_config", filename)
    const userContent = await this.readFile(userPath)

    if (!userContent) {
      // 无用户配置，直接返回默认配置
      return Array.from(defaultSteps.values())
    }

    // 3. 合并：用户配置覆盖默认配置
    const userSteps = this.parseConfigFile(userContent, vars)
    const merged = new Map(defaultSteps)

    for (const [stepName, userStep] of userSteps) {
      const defaultStep = defaultSteps.get(stepName)
      if (defaultStep?.customizable === "false") {
        console.warn(
          `[financial-harness] 警告：${mod}/${stepName} 标记为不建议定制（框架级逻辑），` +
          `用户覆盖可能破坏状态管理。已应用用户配置。`
        )
      }
      merged.set(stepName, userStep)
    }

    // 4. 按 Step 编号排序
    return Array.from(merged.values()).sort((a, b) => {
      const numA = parseInt(a.name.replace("Step_", ""), 10)
      const numB = parseInt(b.name.replace("Step_", ""), 10)
      return numA - numB
    })
  }

  /**
   * 解析 pipeline_config.md 文件
   * 按 "## Step_N:" 标题分割，提取元数据和 instruction 文本
   */
  parseConfigFile(content: string, vars: StepVars): Map<string, StepConfig> {
    const result = new Map<string, StepConfig>()

    // 按 ## Step_N: 标题分割（保留标题行）
    const sections = content.split(/(?=^## Step_\d+:)/m).filter(s => s.trim())

    for (const section of sections) {
      const lines = section.split("\n")
      const titleLine = lines[0]?.trim() ?? ""

      // 提取 Step 名称和描述
      const titleMatch = titleLine.match(/^## (Step_\d+):\s*(.+)$/)
      if (!titleMatch) continue

      const stepName = titleMatch[1]  // "Step_3"

      // 提取 HTML 注释中的元数据
      let customizable: StepConfig["customizable"] = "true"
      let description = titleMatch[2].trim()

      for (const line of lines.slice(1, 6)) {
        const custMatch = line.match(/<!--\s*customizable:\s*(true|false|caution)\s*-->/)
        if (custMatch) customizable = custMatch[1] as StepConfig["customizable"]

        const descMatch = line.match(/<!--\s*description:\s*(.+?)\s*-->/)
        if (descMatch) description = descMatch[1].trim()
      }

      // 提取 instruction 文本（标题行和注释行之后的内容）
      let instructionStart = 1
      while (instructionStart < lines.length) {
        const line = lines[instructionStart].trim()
        if (line.startsWith("<!--") || line === "") {
          instructionStart++
        } else {
          break
        }
      }
      const rawInstructions = lines.slice(instructionStart).join("\n").trim()
      const instructions = this.replaceVars(rawInstructions, vars)

      result.set(stepName, { name: stepName, description, customizable, instructions })
    }

    return result
  }

  /**
   * 替换 instruction 文本中的 {{变量}} 占位符
   */
  replaceVars(text: string, vars: StepVars): string {
    let result = text
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{{${key}}}`, value)
    }
    return result
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      const file = Bun.file(filePath)
      if (!(await file.exists())) return null
      return await file.text()
    } catch {
      return null
    }
  }
}
