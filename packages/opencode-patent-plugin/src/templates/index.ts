/**
 * 专利文件模板系统
 *
 * 基于审查指南的标准化文档结构模板。
 * 模板驱动原则（CONSTITUTION 第二十条）：专利文件生成基于经过验证的模板，不凭空生成。
 */

/** 模板参数 */
export interface TemplateParams {
  /** 发明名称 */
  inventionTitle: string
  /** 专利类型 */
  patentType: "发明" | "实用新型"
  /** 发明类型 */
  inventionType: "装置" | "方法" | "系统" | "组合物"
  /** 技术领域 */
  technicalField?: string
  /** 技术问题 */
  technicalProblem?: string
  /** 技术方案 */
  technicalSolution?: string
  /** 技术效果 */
  technicalEffect?: string
  /** 背景技术 */
  backgroundArt?: string
  /** 具体实施方式 */
  detailedDescription?: string
  /** 附图说明 */
  drawingDescription?: string
  /** 独立权利要求 */
  independentClaims?: string
  /** 从属权利要求 */
  dependentClaims?: string
  /** 摘要 */
  abstract?: string
  /** 申请人 */
  applicant?: string
  /** 发明人 */
  inventor?: string
}

/**
 * 简单模板渲染：替换 {{key}} 占位符
 */
export function renderTemplate(template: string, params: TemplateParams): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = (params as unknown as Record<string, string | undefined>)[key]
    return value || `[${key}]`
  })
}
