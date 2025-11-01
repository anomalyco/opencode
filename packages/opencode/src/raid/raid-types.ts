/**
 * TypeScript type definitions for RAID system
 */

export interface RaidConfig {
  projectRoot: string
  globalKbPath: string
  dbPath: string
  enableAutoIndexing: boolean
  maxConcurrentShards: number
  baseUrl: string
  apiKey: string
  shardModel: string
  orchModel: string
  maxTokensPerShard: number
  numShards: number
  overlapTokens: number
}

export interface RaidDocument {
  id: string
  title: string
  content: string
  filePath?: string
  tags: string[]
  keywords: string[]
  source: "project" | "global"
  createdAt: Date
  updatedAt: Date
  tokenCount: number
  shardIds: string[]
  metadata: RaidDocumentMetadata
}

export interface RaidDocumentMetadata {
  contentType: "markdown" | "code" | "text" | "other"
  extractedKeywords: string[]
  summary: string
  fileSize?: number
  lastModified?: Date
  fileType?: string
}

export interface RaidSearchOptions {
  maxResults?: number
  includeContent?: boolean
  sourceFilter?: "project" | "global" | "both"
  tagsFilter?: string[]
  contentTypeFilter?: ("markdown" | "code" | "text" | "other")[]
}

export interface RaidSearchResult {
  document: RaidDocument
  relevanceScore: number
  snippets: string[]
  highlightedContent?: string
}

export interface RaidIngestionProgress {
  type: "start" | "processing" | "indexing" | "complete" | "error"
  progress?: number
  message: string
  error?: string
}

export interface RaidStats {
  totalDocuments: number
  projectDocuments: number
  globalDocuments: number
  totalTokens: number
  avgTokensPerDocument: number
  topKeywords: Array<{ keyword: string; count: number }>
  lastUpdated: Date
}

export interface RaidShard {
  id: string
  content: string
  startToken: number
  endToken: number
  documentId?: string
}

export interface RaidQueryProgress {
  type: "routing" | "querying" | "fusing" | "complete" | "error"
  message: string
  shardsQueried?: number
  totalShards?: number
  error?: string
}
