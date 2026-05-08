/**
 * 知识库查询服务
 *
 * 封装 Obsidian 知识库的读取和搜索能力。
 * 底层实现来自 utils/obsidian-kb.ts 和 utils/obsidian-index.ts。
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
