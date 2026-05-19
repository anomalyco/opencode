/**
 * 知识库查询服务
 *
 * Facade 模块：统一暴露知识库相关 API。
 * 底层实现来自 utils/obsidian-kb.ts 和 utils/obsidian-index.ts，
 * 消费方从此处导入即可，无需关心内部模块划分。
 */

export {
  queryLawFromKB,
  queryGuidelinesFromKB,
  queryInvalidationFromKB,
  queryJudgmentFromKB,
  searchKnowledgeBase,
  scanMarkdownFiles,
  getKnowledgeBaseStats,
  type MarkdownFile,
} from "../utils/obsidian-kb.js"

export {
  getSearchIndex,
  ObsidianSearchIndex,
  type DocChunk,
  type IndexSearchResult,
} from "../utils/obsidian-index.js"
