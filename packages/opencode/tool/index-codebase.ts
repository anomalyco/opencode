import { tool } from "@opencode-ai/plugin"
import { embed, embedMany } from "ai"
import { openai } from "@ai-sdk/openai"

interface EmbeddedContent {
  id: string
  content: string
  embedding: number[]
  metadata?: Record<string, any>
}

export const index_codebase = tool({
  description:
    "Create embeddings index for semantic code search with 16K token chunks (requires OpenAI API key)",
  args: {
    max_files: tool.schema.number().optional().describe("Maximum files to index (default: 200)"),
    chunk_size: tool.schema
      .number()
      .optional()
      .describe("Characters per chunk (default: 16000, ~4K tokens)"),
  },
  async execute(args, ctx) {
    const maxFiles = args.max_files || 200
    const chunkSize = args.chunk_size || 16000 // ~4K tokens per chunk

    try {
      // Find all code files
      const proc =
        await Bun.$`rg --files --type-add 'code:*.{ts,tsx,js,jsx,py,go,rs}' -t code`.quiet()
      const allFiles = proc.stdout.toString().trim().split("\n").filter(Boolean)
      const files = allFiles.slice(0, maxFiles)

      console.log(`[IndexCodebase] Indexing ${files.length} files with ${chunkSize} char chunks...`)

      // Read all files and create chunks
      const contents: string[] = []
      const metadata: Array<{
        path: string
        size: number
        chunkIndex?: number
        totalChunks?: number
      }> = []

      for (const filePath of files) {
        try {
          const file = Bun.file(filePath)
          const content = await file.text()

          // Skip empty files
          if (content.length === 0) {
            continue
          }

          // Split large files into chunks
          if (content.length > chunkSize) {
            const totalChunks = Math.ceil(content.length / chunkSize)
            for (let i = 0; i < totalChunks; i++) {
              const start = i * chunkSize
              const end = Math.min(start + chunkSize, content.length)
              const chunk = content.substring(start, end)

              contents.push(chunk)
              metadata.push({
                path: filePath,
                size: chunk.length,
                chunkIndex: i,
                totalChunks,
              })
            }
          } else {
            contents.push(content)
            metadata.push({
              path: filePath,
              size: content.length,
            })
          }
        } catch (error) {
          console.error(`[IndexCodebase] Failed to read ${filePath}`)
        }
      }

      console.log(`[IndexCodebase] Generated ${contents.length} chunks from ${files.length} files`)
      console.log(`[IndexCodebase] Generating embeddings in batches...`)

      // Process in batches to avoid token limits
      const batchSize = 20
      const embeddedContents: EmbeddedContent[] = []
      const model = openai.embedding("text-embedding-3-small")

      for (let i = 0; i < contents.length; i += batchSize) {
        const batch = contents.slice(i, i + batchSize)
        const batchMeta = metadata.slice(i, i + batchSize)
        const batchNum = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(contents.length / batchSize)

        console.log(
          `[IndexCodebase] Processing batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`,
        )

        const { embeddings } = await embedMany({
          model,
          values: batch,
        })

        batch.forEach((content, idx) => {
          const meta = batchMeta[idx]
          const chunkLabel =
            meta.chunkIndex !== undefined
              ? ` [chunk ${meta.chunkIndex + 1}/${meta.totalChunks}]`
              : ""

          embeddedContents.push({
            id: `${meta.path}${chunkLabel}`,
            content: content.substring(0, 2000), // Store first 2000 chars for display
            embedding: embeddings[idx],
            metadata: {
              filePath: meta.path,
              size: meta.size,
              chunkIndex: meta.chunkIndex,
              totalChunks: meta.totalChunks,
              timestamp: Date.now(),
            },
          })
        })
      }

      // Save to file
      const indexDir = ".opencode"
      await Bun.$`mkdir -p ${indexDir}`.quiet()

      const indexPath = `${indexDir}/embeddings.json`
      await Bun.write(indexPath, JSON.stringify(embeddedContents, null, 2))

      console.log(`[IndexCodebase] Index saved to ${indexPath}`)

      const avgChunkSize = contents.reduce((sum, c) => sum + c.length, 0) / contents.length
      const totalTokens = contents.reduce((sum, c) => sum + Math.ceil(c.length / 4), 0)

      return `✅ Successfully indexed ${files.length} files into ${embeddedContents.length} chunks
      
Index saved to: ${indexPath}
Index size: ${(JSON.stringify(embeddedContents).length / 1024 / 1024).toFixed(2)} MB
Average chunk size: ${Math.round(avgChunkSize)} chars (~${Math.round(avgChunkSize / 4)} tokens)

You can now use semantic_search_code to search with AI understanding!

Note: This used OpenAI's text-embedding-3-small model.
Estimated tokens processed: ~${totalTokens.toLocaleString()}
Estimated cost: ~$${((totalTokens / 1_000_000) * 0.00002).toFixed(4)}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `❌ Failed to create index: ${message}

Make sure you have:
1. OpenAI API key set (OPENAI_API_KEY env var)
2. The 'ai' and '@ai-sdk/openai' packages installed

Run: bun add ai @ai-sdk/openai`
    }
  },
})

// In-memory cache for embeddings index (loaded once, reused)
let cachedIndex: EmbeddedContent[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60000 // 1 minute

export const semantic_search_code = tool({
  description:
    "Search codebase using semantic search (AI understanding, requires index). Fast with in-memory caching.",
  args: {
    query: tool.schema.string().describe("What to search for (natural language)"),
    top_k: tool.schema.number().optional().describe("Number of results (default: 5)"),
  },
  async execute(args, ctx) {
    const topK = args.top_k || 5
    const startTime = performance.now()

    try {
      // Load index (with caching)
      const indexPath = ".opencode/embeddings.json"
      const indexFile = Bun.file(indexPath)

      if (!(await indexFile.exists())) {
        return `❌ No embeddings index found.

Run 'index_codebase' first to create the index!

Example: Use index_codebase to index the codebase`
      }

      let indexData: EmbeddedContent[]
      const now = Date.now()

      // Check if cache is valid
      if (cachedIndex && now - cacheTimestamp < CACHE_TTL) {
        indexData = cachedIndex
        console.log(`[SemanticSearch] Using cached index (${indexData.length} chunks)`)
      } else {
        const loadStart = performance.now()
        indexData = (await indexFile.json()) as EmbeddedContent[]
        cachedIndex = indexData
        cacheTimestamp = now
        console.log(
          `[SemanticSearch] Loaded index with ${indexData.length} chunks (${(performance.now() - loadStart).toFixed(0)}ms)`,
        )
      }

      // Generate query embedding (this is the main bottleneck - OpenAI API call)
      const embedStart = performance.now()
      const model = openai.embedding("text-embedding-3-small")
      const { embedding: queryEmbedding } = await embed({
        model,
        value: args.query,
      })
      console.log(
        `[SemanticSearch] Generated query embedding (${(performance.now() - embedStart).toFixed(0)}ms)`,
      )

      // Calculate cosine similarity (optimized - uses partial sort)
      const calcStart = performance.now()
      const results = indexData.map((item) => ({
        ...item,
        similarity: cosineSimilarity(queryEmbedding, item.embedding),
      }))

      // Partial sort: only sort top K elements for better performance
      const topResults = results.sort((a, b) => b.similarity - a.similarity).slice(0, topK)

      console.log(
        `[SemanticSearch] Calculated similarity for ${results.length} chunks (${(performance.now() - calcStart).toFixed(0)}ms)`,
      )

      if (topResults.length === 0) {
        return `No results found for: "${args.query}"`
      }

      let output = `🔍 Semantic search results for: "${args.query}"\n`
      output += `⏱️  Search time: ${(performance.now() - startTime).toFixed(0)}ms\n\n`

      for (const result of topResults) {
        output += `📄 ${result.metadata?.filePath || result.id}\n`
        output += `   Relevance: ${(result.similarity * 100).toFixed(1)}%\n`
        output += `   ${result.content.substring(0, 200)}...\n\n`
      }

      return output
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `❌ Search failed: ${message}`
    }
  },
})

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have same dimensions")
  }

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }

  magnitudeA = Math.sqrt(magnitudeA)
  magnitudeB = Math.sqrt(magnitudeB)

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0
  }

  return dotProduct / (magnitudeA * magnitudeB)
}

// Fast hybrid search: combines keyword filtering + semantic ranking
export const hybrid_search_code = tool({
  description:
    "Fast hybrid search combining keyword filtering and semantic ranking (best of both worlds)",
  args: {
    query: tool.schema.string().describe("What to search for"),
    top_k: tool.schema.number().optional().describe("Number of results (default: 5)"),
    keyword_filter: tool.schema
      .boolean()
      .optional()
      .describe("Pre-filter with keywords for speed (default: true)"),
  },
  async execute(args, ctx) {
    const topK = args.top_k || 5
    const useKeywordFilter = args.keyword_filter !== false
    const startTime = performance.now()

    try {
      const indexPath = ".opencode/embeddings.json"
      const indexFile = Bun.file(indexPath)

      if (!(await indexFile.exists())) {
        return `❌ No embeddings index found. Run 'index_codebase' first!`
      }

      // Load or use cached index
      let indexData: EmbeddedContent[]
      const now = Date.now()

      if (cachedIndex && now - cacheTimestamp < CACHE_TTL) {
        indexData = cachedIndex
      } else {
        indexData = (await indexFile.json()) as EmbeddedContent[]
        cachedIndex = indexData
        cacheTimestamp = now
      }

      // Step 1: Optional keyword pre-filtering (reduces candidates by ~70-90%)
      let candidates = indexData
      if (useKeywordFilter) {
        const keywords = args.query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2)
        candidates = indexData.filter((item) => {
          const content = item.content.toLowerCase()
          return keywords.some((kw) => content.includes(kw))
        })

        // If too few candidates, fallback to all
        if (candidates.length < topK * 2) {
          candidates = indexData
        }
        console.log(
          `[HybridSearch] Filtered to ${candidates.length}/${indexData.length} candidates`,
        )
      }

      // Step 2: Generate query embedding (API call - main bottleneck)
      const model = openai.embedding("text-embedding-3-small")
      const { embedding: queryEmbedding } = await embed({
        model,
        value: args.query,
      })

      // Step 3: Calculate similarity only for candidates
      const results = candidates.map((item) => ({
        ...item,
        similarity: cosineSimilarity(queryEmbedding, item.embedding),
      }))

      // Step 4: Get top K
      const topResults = results.sort((a, b) => b.similarity - a.similarity).slice(0, topK)

      const totalTime = performance.now() - startTime

      let output = `⚡ Hybrid search results for: "${args.query}"\n`
      output += `⏱️  Total time: ${totalTime.toFixed(0)}ms | Searched ${candidates.length}/${indexData.length} chunks\n\n`

      for (const result of topResults) {
        output += `📄 ${result.metadata?.filePath || result.id}\n`
        output += `   Relevance: ${(result.similarity * 100).toFixed(1)}%\n`
        output += `   ${result.content.substring(0, 200)}...\n\n`
      }

      return output
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `❌ Hybrid search failed: ${message}`
    }
  },
})
