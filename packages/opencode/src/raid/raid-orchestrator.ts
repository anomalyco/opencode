/**
 * RAID Orchestrator - AI-powered document sharding and query orchestration
 * Handles intelligent document routing, parallel shard processing, and answer fusion
 */

import OpenAI from "openai"
import { get_encoding } from "@dqbd/tiktoken"
import type { RaidConfig, RaidShard, RaidQueryProgress } from "./raid-types"
import type { RaidKnowledgeBase } from "./raid-kb"

const encoding = get_encoding("cl100k_base")

interface ShardWithScore {
  shard: RaidShard
  score: number
  reasoning: string
}

interface ShardAnswer {
  shardId: string
  answer: string
  confidence: number
  sources: string[]
}

/**
 * RAID Orchestrator - manages document sharding and query orchestration
 */
export class RaidOrchestrator {
  private client: OpenAI
  private config: RaidConfig
  private kb: RaidKnowledgeBase

  constructor(config: RaidConfig, kb: RaidKnowledgeBase) {
    this.config = config
    this.kb = kb
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    })
  }

  /**
   * Shard a document into overlapping chunks
   */
  async shardDocument(documentId: string, content: string): Promise<RaidShard[]> {
    const tokens = encoding.encode(content)
    const totalTokens = tokens.length
    const shardSize = this.config.maxTokensPerShard
    const overlap = this.config.overlapTokens
    const shards: RaidShard[] = []

    let startToken = 0
    let shardIndex = 0

    while (startToken < totalTokens) {
      const endToken = Math.min(startToken + shardSize, totalTokens)
      const shardTokens = tokens.slice(startToken, endToken)
      const shardContent = new TextDecoder().decode(encoding.decode(shardTokens))

      shards.push({
        id: `${documentId}-shard-${shardIndex}`,
        content: shardContent,
        startToken,
        endToken,
        documentId,
      })

      shardIndex++
      startToken = endToken - overlap

      // Prevent infinite loop for very small documents
      if (endToken >= totalTokens) break
    }

    return shards
  }

  /**
   * Route query to relevant shards using AI
   */
  async routeQuery(
    query: string,
    shards: RaidShard[],
    maxShards: number = 5,
  ): Promise<ShardWithScore[]> {
    // For small shard counts, just return all
    if (shards.length <= maxShards) {
      return shards.map((shard) => ({
        shard,
        score: 1.0,
        reasoning: "All shards included due to small document size",
      }))
    }

    // Create shard summaries for routing
    const shardSummaries = shards.map((shard, idx) => ({
      id: shard.id,
      index: idx,
      preview: shard.content.slice(0, 200) + "...",
      tokenRange: `${shard.startToken}-${shard.endToken}`,
    }))

    const routingPrompt = `You are a document routing expert. Given a user query and document shard previews, identify which shards are most likely to contain relevant information.

Query: "${query}"

Available shards:
${shardSummaries.map((s) => `- Shard ${s.index} (${s.id}): ${s.preview}`).join("\n")}

Return a JSON array of the top ${maxShards} most relevant shard indices with scores (0-1) and reasoning. Format:
[{"index": 0, "score": 0.95, "reasoning": "Contains information about X"}]

Only return the JSON array, nothing else.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.orchModel,
        messages: [{ role: "user", content: routingPrompt }],
        temperature: 0.1,
        max_tokens: 500,
      })

      const content = response.choices[0]?.message?.content ?? "[]"
      const routing = JSON.parse(content.trim()) as Array<{
        index: number
        score: number
        reasoning: string
      }>

      return routing
        .slice(0, maxShards)
        .map((r) => ({
          shard: shards[r.index],
          score: r.score,
          reasoning: r.reasoning,
        }))
        .filter((r) => r.shard) // Filter out invalid indices
    } catch (error) {
      // Fallback: return first N shards
      return shards.slice(0, maxShards).map((shard) => ({
        shard,
        score: 1.0,
        reasoning: "Fallback routing due to error",
      }))
    }
  }

  /**
   * Query a single shard
   */
  async queryShard(shard: RaidShard, query: string): Promise<ShardAnswer> {
    const prompt = `You are an expert at answering questions based on document content.

Document content:
${shard.content}

Question: ${query}

Provide a concise, accurate answer based ONLY on the content above. If the content doesn't contain relevant information, say "No relevant information found in this section."

Also indicate your confidence level (0-1) and cite specific parts of the content.

Respond in JSON format:
{
  "answer": "your answer here",
  "confidence": 0.9,
  "sources": ["quote from content", "another quote"]
}

Only return the JSON, nothing else.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.shardModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 800,
      })

      const content = response.choices[0]?.message?.content ?? "{}"
      const parsed = JSON.parse(content.trim()) as {
        answer: string
        confidence: number
        sources: string[]
      }

      return {
        shardId: shard.id,
        answer: parsed.answer || "No answer generated",
        confidence: parsed.confidence ?? 0.5,
        sources: parsed.sources ?? [],
      }
    } catch (error) {
      return {
        shardId: shard.id,
        answer: `Error querying shard: ${error}`,
        confidence: 0,
        sources: [],
      }
    }
  }

  /**
   * Query multiple shards in parallel
   */
  async queryShards(
    shards: RaidShard[],
    query: string,
    onProgress?: (progress: RaidQueryProgress) => void,
  ): Promise<ShardAnswer[]> {
    const answers: ShardAnswer[] = []
    const batchSize = this.config.maxConcurrentShards

    for (let i = 0; i < shards.length; i += batchSize) {
      const batch = shards.slice(i, i + batchSize)

      onProgress?.({
        type: "querying",
        message: `Querying shards ${i + 1}-${Math.min(i + batchSize, shards.length)} of ${shards.length}`,
        shardsQueried: i,
        totalShards: shards.length,
      })

      const batchPromises = batch.map((shard) => this.queryShard(shard, query))
      const batchAnswers = await Promise.all(batchPromises)
      answers.push(...batchAnswers)
    }

    return answers
  }

  /**
   * Fuse multiple shard answers into a coherent response
   */
  async fuseAnswers(query: string, shardAnswers: ShardAnswer[]): Promise<string> {
    // Filter out low-confidence answers
    const relevantAnswers = shardAnswers
      .filter(
        (a) => a.confidence > 0.3 && !a.answer.toLowerCase().includes("no relevant information"),
      )
      .sort((a, b) => b.confidence - a.confidence)

    if (relevantAnswers.length === 0) {
      return "I couldn't find relevant information to answer your question in the knowledge base."
    }

    // If only one good answer, return it
    if (relevantAnswers.length === 1) {
      return relevantAnswers[0].answer
    }

    // Fuse multiple answers
    const fusionPrompt = `You are an expert at synthesizing information from multiple sources.

Question: ${query}

I have ${relevantAnswers.length} answers from different sections of a document:

${relevantAnswers
  .map(
    (a, i) => `Answer ${i + 1} (confidence: ${a.confidence}):
${a.answer}
${a.sources.length > 0 ? `Sources: ${a.sources.join("; ")}` : ""}
`,
  )
  .join("\n")}

Synthesize these answers into a single, coherent, comprehensive response. Combine complementary information and resolve any contradictions by favoring higher-confidence answers. Be concise but complete.

Provide only the final synthesized answer, no preamble.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.orchModel,
        messages: [{ role: "user", content: fusionPrompt }],
        temperature: 0.3,
        max_tokens: 1000,
      })

      return response.choices[0]?.message?.content?.trim() ?? relevantAnswers[0].answer
    } catch (error) {
      // Fallback: return highest confidence answer
      return relevantAnswers[0].answer
    }
  }

  /**
   * Complete end-to-end query orchestration
   */
  async orchestrateQuery(
    query: string,
    documentIds?: string[],
    onProgress?: (progress: RaidQueryProgress) => void,
  ): Promise<string> {
    try {
      onProgress?.({
        type: "routing",
        message: "Finding relevant documents...",
      })

      // Get relevant documents
      let documents
      if (documentIds && documentIds.length > 0) {
        documents = documentIds
          .map((id) => this.kb.getDocument(id))
          .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
      } else {
        // Search for relevant documents
        const searchResults = this.kb.search(query, { maxResults: 5 })
        documents = searchResults.map((r) => r.document)
      }

      if (documents.length === 0) {
        return "No relevant documents found in the knowledge base."
      }

      onProgress?.({
        type: "routing",
        message: `Found ${documents.length} relevant document(s), preparing shards...`,
      })

      // Shard all documents and collect shards
      const allShards: RaidShard[] = []
      for (const doc of documents) {
        const docShards = await this.shardDocument(doc.id, doc.content)
        allShards.push(...docShards)
      }

      onProgress?.({
        type: "routing",
        message: `Created ${allShards.length} shards, routing query...`,
      })

      // Route query to best shards
      const routedShards = await this.routeQuery(query, allShards, this.config.maxConcurrentShards)

      onProgress?.({
        type: "querying",
        message: `Querying ${routedShards.length} most relevant shards...`,
        totalShards: routedShards.length,
      })

      // Query selected shards
      const shardAnswers = await this.queryShards(
        routedShards.map((rs) => rs.shard),
        query,
        onProgress,
      )

      onProgress?.({
        type: "fusing",
        message: "Synthesizing answers...",
      })

      // Fuse answers
      const finalAnswer = await this.fuseAnswers(query, shardAnswers)

      onProgress?.({
        type: "complete",
        message: "Query complete",
      })

      return finalAnswer
    } catch (error) {
      onProgress?.({
        type: "error",
        message: "Query orchestration failed",
        error: String(error),
      })
      throw error
    }
  }

  /**
   * Ingest document with sharding
   */
  async ingestDocument(
    documentId: string,
    content: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<string[]> {
    const shards = await this.shardDocument(documentId, content)

    onProgress?.(shards.length, shards.length)

    // Store shard IDs in document
    const shardIds = shards.map((s) => s.id)
    this.kb.updateShardIds(documentId, shardIds)

    return shardIds
  }

  /**
   * Generate document summary using AI
   */
  async generateSummary(content: string, maxLength: number = 200): Promise<string> {
    const prompt = `Summarize the following document in ${maxLength} characters or less. Be concise and capture the key points:

${content.slice(0, 4000)}

Provide only the summary, no preamble.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.shardModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 100,
      })

      return response.choices[0]?.message?.content?.trim() ?? ""
    } catch {
      return content.slice(0, maxLength) + "..."
    }
  }

  /**
   * Extract keywords from document using AI
   */
  async extractKeywords(content: string, maxKeywords: number = 10): Promise<string[]> {
    const prompt = `Extract the ${maxKeywords} most important keywords or key phrases from this document:

${content.slice(0, 4000)}

Return only a JSON array of keywords, nothing else. Format: ["keyword1", "keyword2", ...]`

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.shardModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      })

      const content_text = response.choices[0]?.message?.content?.trim() ?? "[]"
      return JSON.parse(content_text) as string[]
    } catch {
      return []
    }
  }
}
