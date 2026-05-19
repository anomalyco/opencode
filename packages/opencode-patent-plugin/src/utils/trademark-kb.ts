/**
 * 商标工具共享知识库查询
 *
 * 从 trademark-analyze / trademark-opposition / trademark-review 中提取的
 * 重复 getKBData / getKBReference 函数，统一为一处。
 */

import { queryTrademarkLaw, queryTrademarkExamGuide } from "./obsidian-kb.js"

/**
 * 查询商标知识库（商标法 + 审查指南）
 *
 * @param keyword - 查询关键词
 * @returns 合并后的参考资料字符串（无结果时返回空字符串）
 */
export async function getTrademarkKBData(keyword: string): Promise<string> {
  let data = ""
  try {
    const [lawResult, examResult] = await Promise.all([
      queryTrademarkLaw(keyword).catch(() => ""),
      queryTrademarkExamGuide(keyword).catch(() => ""),
    ])
    if (lawResult && !lawResult.includes("未在商标知识库中找到")) data += lawResult
    if (examResult && !examResult.includes("未在商标审查指南中找到")) data += "\n\n" + examResult
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn("[trademark-kb] KB query failed for keyword=%s: %s", keyword, message)
  }
  return data
}
