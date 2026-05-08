/**
 * 向量检索服务
 *
 * 封装 PostgreSQL (pgvector) 的语义搜索能力。
 * 底层实现来自 utils/db.ts。
 */

export {
  searchPatentsSemantic,
  searchRulesSemantic,
  searchKnowledgeGraphNodes,
  searchLegalArticlesSemantic,
  getKGNodeNeighbors,
} from "../utils/db.js"
