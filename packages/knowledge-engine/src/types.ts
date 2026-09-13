export interface KnowledgeMetadata {
  source: string;
  type: 'lesson' | 'prompt' | 'practice' | 'troubleshooting';
  tags: string[];
  language: string;
  difficulty: number;
  [key: string]: any;
}

export interface KnowledgeChunk {
  id: string;
  title: string;
  stage: number;
  section: string;
  content: string;
  metadata: KnowledgeMetadata;
}

export interface RetrievalResult {
  rank: number;
  id: string;
  title: string;
  section: string;
  content: string;
  similarity: number;
  stage: number;
  type: string;
  tags: string[];
  source: string;
}

export interface SearchOptions {
  topK?: number;
  stage?: number;
  type?: 'lesson' | 'prompt' | 'practice' | 'troubleshooting';
  tags?: string[];
  minSimilarity?: number;
  agentType?: 'build' | 'plan';
}

export interface IndexStats {
  totalChunks: number;
  totalSections: number;
  dbSizeBytes: number;
  stagesCount: Record<number, number>;
  typesCount: Record<string, number>;
}
