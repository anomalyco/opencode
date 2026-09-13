import { LocalVectorDB } from './vector-db';
import { LocalEmbedder } from './embedder';
import type { RetrievalResult, SearchOptions } from './types';

export class LocalRetriever {
  private db: LocalVectorDB;
  private embedder: LocalEmbedder;

  constructor(db?: LocalVectorDB, embedder?: LocalEmbedder) {
    this.db = db || new LocalVectorDB();
    this.embedder = embedder || new LocalEmbedder();
  }

  /**
   * Main hybrid retrieval function
   */
  public async retrieveRelevant(
    query: string,
    topK: number = 5,
    options: Omit<SearchOptions, 'topK'> = {}
  ): Promise<RetrievalResult[]> {
    const queryVector = this.embedder.embed(query);
    return this.db.hybridSearch(query, queryVector, { ...options, topK });
  }

  /**
   * Unified search interface with flexible options
   */
  public async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<RetrievalResult[]> {
    if (options.agentType) {
      return this.advancedSearch(query, options);
    }
    const topK = options.topK ?? 5;
    const { topK: _, ...rest } = options;
    return this.retrieveRelevant(query, topK, rest);
  }

  /**
   * Advanced search tailored to Agent roles (Build / Plan)
   */
  public async advancedSearch(
    query: string,
    options: SearchOptions = {}
  ): Promise<RetrievalResult[]> {
    const { agentType, tags = [] } = options;
    const searchTags = [...tags];

    if (agentType === 'build') {
      searchTags.push('coding', 'build');
    } else if (agentType === 'plan') {
      searchTags.push('plan', 'strategy');
    }

    return this.retrieveRelevant(query, options.topK || 5, {
      ...options,
      tags: searchTags.length > 0 ? searchTags : undefined,
    });
  }

  /**
   * Find solutions for specific errors / bugs
   */
  public async findTroubleshootingSolution(issue: string): Promise<RetrievalResult[]> {
    return this.retrieveRelevant(issue, 3, {
      type: 'troubleshooting',
      minSimilarity: 0.25,
    });
  }

  /**
   * Retrieve prompt templates
   */
  public async getPromptTemplate(task: string): Promise<RetrievalResult[]> {
    return this.retrieveRelevant(task, 2, {
      type: 'prompt',
      minSimilarity: 0.2,
    });
  }

  /**
   * Retrieve best practices and lessons
   */
  public async getBestPractice(topic: string): Promise<RetrievalResult[]> {
    return this.retrieveRelevant(topic, 3, {
      type: 'lesson',
      minSimilarity: 0.25,
    });
  }

  /**
   * Multi-aspect overview for comprehensive guidance
   */
  public async getDetailedContent(topic: string): Promise<{
    overview: RetrievalResult[];
    practices: RetrievalResult[];
    troubleshooting: RetrievalResult[];
  }> {
    const [overview, practices, troubleshooting] = await Promise.all([
      this.retrieveRelevant(topic, 3),
      this.getBestPractice(topic),
      this.findTroubleshootingSolution(topic),
    ]);

    return { overview, practices, troubleshooting };
  }
}

export default new LocalRetriever();
