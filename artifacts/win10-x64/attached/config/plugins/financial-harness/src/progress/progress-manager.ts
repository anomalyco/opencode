// progress-manager.ts — 进度管理器（纯 TS，替代 Python progress/manager.py）

/** 单个 Feature 的进度数据 */
export interface FeatureProgress {
  id: string
  name: string
  status: string  // "in_progress" | "completed" | "prd_done" | "design_done" | ...
  passes: Record<string, boolean>  // { prd: false, design: false, code: false, test: false }
  last_updated: string  // ISO 8601
}

/** progress.json 的顶层结构 */
export interface ProgressData {
  features: FeatureProgress[]
}

const MODULES = ["prd", "design", "code", "test"] as const
type Module = typeof MODULES[number]

export class ProgressManager {
  private progressFile: string

  constructor(progressFile?: string) {
    this.progressFile = progressFile ?? "progress.json"
  }

  /** 读取 progress.json，不存在时创建，损坏时备份并重建 */
  private async readData(): Promise<ProgressData> {
    const file = Bun.file(this.progressFile)
    
    if (!(await file.exists())) {
      const empty: ProgressData = { features: [] }
      await Bun.write(this.progressFile, JSON.stringify(empty, null, 2))
      return empty
    }

    try {
      const text = await file.text()
      const data = JSON.parse(text) as ProgressData
      if (!Array.isArray(data.features)) {
        throw new Error("features 字段不是数组")
      }
      return data
    } catch {
      // 备份损坏文件
      const backupPath = `${this.progressFile}.bak${Date.now()}`
      try {
        const content = await file.text()
        await Bun.write(backupPath, content)
      } catch {}
      // 重建空文件
      const empty: ProgressData = { features: [] }
      await Bun.write(this.progressFile, JSON.stringify(empty, null, 2))
      return empty
    }
  }

  /** 写入 progress.json */
  private async writeData(data: ProgressData): Promise<void> {
    await Bun.write(this.progressFile, JSON.stringify(data, null, 2))
  }

  /** 计算 feature 整体状态 */
  private computeStatus(passes: Record<string, boolean>): string {
    const allModules: Module[] = ["prd", "design", "code", "test"]
    const allDone = allModules.every(m => passes[m] === true)
    if (allDone) return "completed"
    
    // 找到最后一个完成的阶段
    for (let i = allModules.length - 1; i >= 0; i--) {
      if (passes[allModules[i]]) {
        return `${allModules[i]}_done`
      }
    }
    return "in_progress"
  }

  /** 更新进度 */
  async updateProgress(
    feature: string,
    featureName: string,
    module: string,
    status: string,
  ): Promise<void> {
    const data = await this.readData()
    
    let featureRecord = data.features.find(f => f.id === feature)
    if (!featureRecord) {
      featureRecord = {
        id: feature,
        name: featureName,
        status: "in_progress",
        passes: { prd: false, design: false, code: false, test: false },
        last_updated: new Date().toISOString(),
      }
      data.features.push(featureRecord)
    }

    // 更新名称（如果提供）
    if (featureName) {
      featureRecord.name = featureName
    }

    // 更新 passes
    featureRecord.passes[module] = status === "done"
    
    // 重新计算整体状态
    featureRecord.status = this.computeStatus(featureRecord.passes)
    featureRecord.last_updated = new Date().toISOString()

    await this.writeData(data)
  }

  /** 查询进度 */
  async queryProgress(featureId?: string): Promise<ProgressData> {
    const data = await this.readData()
    
    if (!featureId) {
      return data
    }

    const feature = data.features.find(f => f.id === featureId)
    return {
      features: feature ? [feature] : [],
    }
  }

  /** 格式化摘要 */
  async formatSummary(featureId?: string): Promise<string> {
    const data = await this.queryProgress(featureId)
    
    if (data.features.length === 0) {
      return featureId
        ? `Feature "${featureId}" 暂无进度记录`
        : "暂无进度记录"
    }

    const lines: string[] = ["## 项目进度摘要\n"]
    
    for (const feature of data.features) {
      lines.push(`### ${feature.id}: ${feature.name}`)
      lines.push(`状态: ${feature.status}`)
      lines.push(`最后更新: ${feature.last_updated}`)
      lines.push("阶段进度:")
      
      const modules: Module[] = ["prd", "design", "code", "test"]
      const moduleLabels: Record<Module, string> = {
        prd: "概要设计",
        design: "详细设计",
        code: "代码编写",
        test: "单元测试",
      }
      
      for (const mod of modules) {
        const done = feature.passes[mod] === true
        lines.push(`  - ${moduleLabels[mod]}: ${done ? "✅ 完成" : "⏳ 未完成"}`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }
}
