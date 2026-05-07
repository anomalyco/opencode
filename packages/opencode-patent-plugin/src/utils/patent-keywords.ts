/**
 * 专利关键词提取工具
 *
 * 共享工具函数，供 OA、复审、无效宣告等工具统一使用。
 */

/** 专利审查常见术语 */
const PATENT_EXAMINATION_TERMS = [
  "创造性", "新颖性", "实用性", "公开不充分", "不清楚", "超范围",
  "独立权利要求", "从属权利要求", "技术特征", "区别特征",
  "技术启示", "显而易见", "惯用手段",
] as const

/**
 * 从专利文件/审查意见中提取审查相关关键词
 *
 * 扫描预定义术语列表，返回文本中出现的术语（去重、截断）。
 */
export function extractPatentKeywords(text: string, maxKeywords: number = 5): string[] {
  const keywords: string[] = []
  for (const term of PATENT_EXAMINATION_TERMS) {
    if (text.includes(term)) keywords.push(term)
  }
  return [...new Set(keywords)].slice(0, maxKeywords)
}
