/**
 * 种子工作流模板
 *
 * 从 YunPat 已知工作流中提取的常用模板，初始化时自动导入 WorkflowStore。
 * 来源：YunPat tests/e2e/draft-workflow.test.ts, respond-workflow.test.ts
 */

import type { TaskType } from "./case-store.js"
import type { WorkflowStep } from "./workflow-store.js"

export interface SeedTemplate {
  name: string
  taskType: TaskType
  steps: WorkflowStep[]
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  // ---- 发明专利撰写 ----
  {
    name: "发明专利撰写（完整流程）",
    taskType: "draft",
    steps: [
      { toolName: "document_read", action: "read", description: "读取技术交底书文档" },
      { toolName: "patent_draft", action: "understand", description: "理解发明技术方案" },
      { toolName: "patent_search", action: "keyword", description: "现有技术检索（CNIPA）" },
      { toolName: "patent_search_google", action: "search", description: "全球专利检索" },
      { toolName: "academic_search", action: "search", description: "学术论文检索" },
      { toolName: "patent_draft", action: "claims", description: "生成权利要求书" },
      { toolName: "patent_draft", action: "specification", description: "撰写说明书" },
      { toolName: "patent_draft", action: "abstract", description: "撰写摘要" },
      { toolName: "patent_check", action: "quality", description: "质量检查" },
      { toolName: "file_write", action: "write", description: "保存撰写稿到文件" },
    ],
  },
  {
    name: "实用新型撰写",
    taskType: "draft",
    steps: [
      { toolName: "document_read", action: "read", description: "读取技术交底书" },
      { toolName: "patent_draft", action: "understand", description: "理解技术方案" },
      { toolName: "patent_search", action: "keyword", description: "现有技术检索" },
      { toolName: "patent_draft", action: "claims", description: "生成权利要求" },
      { toolName: "patent_draft", action: "specification", description: "撰写说明书" },
      { toolName: "patent_check", action: "quality", description: "质量检查" },
    ],
  },

  // ---- 审查意见答辩 ----
  {
    name: "审查意见答辩（完整流程）",
    taskType: "oa",
    steps: [
      { toolName: "document_read", action: "read", description: "读取审查意见通知书（PDF）" },
      { toolName: "oa_response", action: "parse", description: "解析审查意见要点" },
      { toolName: "oa_response", action: "analyze", description: "分析驳回理由和对比文件" },
      { toolName: "document_read", action: "read", description: "读取对比文件（如有PDF）" },
      { toolName: "patent_analyze", action: "compare", description: "与对比文件进行比对分析" },
      { toolName: "oa_response", action: "respond", description: "撰写意见陈述书" },
      { toolName: "oa_response", action: "revise_claims", description: "修改权利要求（如需要）" },
      { toolName: "file_write", action: "write", description: "保存答辩稿到文件" },
    ],
  },

  // ---- 复审 ----
  {
    name: "驳回复审",
    taskType: "reexam",
    steps: [
      { toolName: "document_read", action: "read", description: "读取驳回决定书" },
      { toolName: "reexam_response", action: "parse", description: "解析驳回决定要点" },
      { toolName: "reexam_response", action: "analyze", description: "分析复审策略" },
      { toolName: "reexam_response", action: "draft", description: "撰写复审请求书" },
      { toolName: "file_write", action: "write", description: "保存复审请求书" },
    ],
  },

  // ---- 无效宣告 ----
  {
    name: "无效宣告（攻方）",
    taskType: "invalidation",
    steps: [
      { toolName: "document_read", action: "read", description: "读取目标专利文件" },
      { toolName: "invalidation_response", action: "parse", description: "解析目标专利权利要求" },
      { toolName: "patent_search", action: "keyword", description: "检索现有技术证据" },
      { toolName: "patent_analyze", action: "compare", description: "对比分析新颖性/创造性" },
      { toolName: "invalidation_response", action: "attack", description: "撰写无效宣告请求书" },
      { toolName: "file_write", action: "write", description: "保存无效宣告请求书" },
    ],
  },
  {
    name: "无效宣告答辩（守方）",
    taskType: "invalidation",
    steps: [
      { toolName: "document_read", action: "read", description: "读取无效宣告请求书" },
      { toolName: "invalidation_response", action: "parse", description: "解析无效理由" },
      { toolName: "invalidation_response", action: "defend", description: "撰写答辩意见" },
      { toolName: "file_write", action: "write", description: "保存答辩意见" },
    ],
  },

  // ---- 专利分析 ----
  {
    name: "专利性分析（新颖性+创造性）",
    taskType: "analyze",
    steps: [
      { toolName: "document_read", action: "read", description: "读取技术交底书/专利文件" },
      { toolName: "patent_search", action: "keyword", description: "现有技术检索" },
      { toolName: "patent_analyze", action: "novelty", description: "新颖性分析" },
      { toolName: "patent_analyze", action: "creativity", description: "创造性分析" },
      { toolName: "file_write", action: "write", description: "保存分析报告" },
    ],
  },

  // ---- 商标申请 ----
  {
    name: "商标注册申请",
    taskType: "trademark",
    steps: [
      { toolName: "trademark_draft", action: "understand", description: "理解商标特征" },
      { toolName: "trademark_search", action: "文字", description: "近似商标检索" },
      { toolName: "trademark_analyze", action: "显著性", description: "显著性分析" },
      { toolName: "trademark_draft", action: "specification", description: "撰写商标说明" },
      { toolName: "trademark_draft", action: "goods", description: "选择商品分类" },
      { toolName: "trademark_draft", action: "integrate", description: "整合申请文件" },
    ],
  },
  {
    name: "商标异议",
    taskType: "trademark",
    steps: [
      { toolName: "trademark_analyze", action: "近似", description: "商标近似比对" },
      { toolName: "trademark_opposition", action: "analyze", description: "分析异议理由" },
      { toolName: "trademark_opposition", action: "oppose", description: "撰写异议申请书" },
      { toolName: "trademark_opposition", action: "evidence", description: "整理证据清单" },
    ],
  },
]

/**
 * 初始化种子模板（幂等操作，已有模板不会重复导入）
 */
export function seedTemplates(workflowStore: import("./workflow-store.js").WorkflowStore): void {
  const existing = new Set(workflowStore.listTemplates().map(t => t.name))

  for (const template of SEED_TEMPLATES) {
    if (!existing.has(template.name)) {
      workflowStore.saveTemplate({
        name: template.name,
        taskType: template.taskType,
        steps: template.steps,
      })
      console.log(`[YunPat] 📋 导入工作流模板: ${template.name}`)
    }
  }
}
