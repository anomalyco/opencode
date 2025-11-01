import { tool } from "@opencode-ai/plugin"
import { pipeline } from "@xenova/transformers"

interface EmbeddedContent {
  id: string
  content: string
  embedding: number[]
  metadata?: Record<string, any>
}

// Global cache for embeddings, query cache, and model
let cachedIndex: EmbeddedContent[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 300000 // 5 minutes

// Query embedding cache (avoids repeated API/model calls for same queries)
const queryEmbeddingCache = new Map<string, number[]>()
const QUERY_CACHE_MAX = 100

// Lazy-loaded local embedding model
let embeddingModel: any = null

async function getEmbeddingModel() {
  if (!embeddingModel) {
    console.log("[FastSearch] Loading local embedding model (first time only)...")
    const startTime = performance.now()
    // Using a smaller, faster model optimized for semantic search
    embeddingModel = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
    console.log(`[FastSearch] Model loaded in ${(performance.now() - startTime).toFixed(0)}ms`)
  }
  return embeddingModel
}

async function generateLocalEmbedding(text: string): Promise<number[]> {
  const model = await getEmbeddingModel()
  const output = await model(text, { pooling: "mean", normalize: true })
  return Array.from(output.data)
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

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

  if (magnitudeA === 0 || magnitudeB === 0) return 0
  return dotProduct / (magnitudeA * magnitudeB)
}

// Re-index with local embeddings (no API key needed!)
export const index_codebase_local = tool({
  description: "Create embeddings index using LOCAL AI (no API key required, fast and free)",
  args: {
    max_files: tool.schema.number().optional().describe("Maximum files to index (default: 200)"),
    chunk_size: tool.schema.number().optional().describe("Characters per chunk (default: 8000)"),
  },
  async execute(args, _ctx) {
    const maxFiles = args.max_files || 200
    const chunkSize = args.chunk_size || 8000

    try {
      // Find all code files
      const proc =
        await Bun.$`rg --files --type-add 'code:*.{ts,tsx,js,jsx,py,go,rs}' -t code`.quiet()
      const allFiles = proc.stdout.toString().trim().split("\n").filter(Boolean)
      const files = allFiles.slice(0, maxFiles)

      console.log(`[IndexLocal] Indexing ${files.length} files with local AI embeddings...`)

      // Read and chunk files
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

          if (content.length === 0) continue

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
          console.error(`[IndexLocal] Failed to read ${filePath}`)
        }
      }

      console.log(`[IndexLocal] Generated ${contents.length} chunks from ${files.length} files`)
      console.log(`[IndexLocal] Generating embeddings with local AI (no API costs!)...`)

      // Load model once (stored in global variable)
      await getEmbeddingModel()
      const embeddedContents: EmbeddedContent[] = []

      // Process in batches for better performance
      const batchSize = 10
      for (let i = 0; i < contents.length; i += batchSize) {
        const batch = contents.slice(i, i + batchSize)
        const batchMeta = metadata.slice(i, i + batchSize)
        const batchNum = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(contents.length / batchSize)

        console.log(`[IndexLocal] Processing batch ${batchNum}/${totalBatches}...`)

        // Generate embeddings for batch
        for (let j = 0; j < batch.length; j++) {
          const embedding = await generateLocalEmbedding(batch[j])
          const meta = batchMeta[j]
          const chunkLabel =
            meta.chunkIndex !== undefined
              ? ` [chunk ${meta.chunkIndex + 1}/${meta.totalChunks}]`
              : ""

          embeddedContents.push({
            id: `${meta.path}${chunkLabel}`,
            content: batch[j].substring(0, 2000),
            embedding,
            metadata: {
              filePath: meta.path,
              size: meta.size,
              chunkIndex: meta.chunkIndex,
              totalChunks: meta.totalChunks,
              timestamp: Date.now(),
              model: "all-MiniLM-L6-v2",
            },
          })
        }
      }

      // Save to file
      const indexDir = ".opencode"
      await Bun.$`mkdir -p ${indexDir}`.quiet()
      const indexPath = `${indexDir}/embeddings-local.json`
      await Bun.write(indexPath, JSON.stringify(embeddedContents, null, 2))

      const avgChunkSize = contents.reduce((sum, c) => sum + c.length, 0) / contents.length

      return `✅ Successfully indexed ${files.length} files into ${embeddedContents.length} chunks

Index saved to: ${indexPath}
Index size: ${(JSON.stringify(embeddedContents).length / 1024 / 1024).toFixed(2)} MB
Average chunk size: ${Math.round(avgChunkSize)} chars
Model: Xenova/all-MiniLM-L6-v2 (384 dimensions)

🎉 100% FREE - No API costs!
⚡ Fast local inference
🔒 Privacy-friendly - no data sent to external APIs

You can now use fast_semantic_search for blazing fast code search!`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `❌ Failed to create index: ${message}`
    }
  },
})

// Ultra-fast semantic search with local embeddings
export const fast_semantic_search = tool({
  description: "Lightning-fast semantic search using local AI (10-50ms, no API calls!)",
  args: {
    query: tool.schema.string().describe("What to search for (natural language)"),
    top_k: tool.schema.number().optional().describe("Number of results (default: 5)"),
    use_hybrid: tool.schema
      .boolean()
      .optional()
      .describe("Use keyword pre-filtering (default: true)"),
  },
  async execute(args, _ctx) {
    const topK = args.top_k || 5
    const useHybrid = args.use_hybrid !== false
    const startTime = performance.now()

    try {
      const indexPath = ".opencode/embeddings-local.json"
      const indexFile = Bun.file(indexPath)

      if (!(await indexFile.exists())) {
        return `❌ No local embeddings index found.

Run 'index_codebase_local' first to create the index!

This will use local AI (no API key needed, 100% free!)`
      }

      // Load or use cached index
      let indexData: EmbeddedContent[]
      const now = Date.now()

      if (cachedIndex && now - cacheTimestamp < CACHE_TTL) {
        indexData = cachedIndex
        console.log(`[FastSearch] Using cached index (${indexData.length} chunks)`)
      } else {
        const loadStart = performance.now()
        indexData = (await indexFile.json()) as EmbeddedContent[]
        cachedIndex = indexData
        cacheTimestamp = now
        console.log(
          `[FastSearch] Loaded index (${indexData.length} chunks, ${(performance.now() - loadStart).toFixed(0)}ms)`,
        )
      }

      // Step 1: Hybrid pre-filtering (optional but recommended)
      let candidates = indexData
      if (useHybrid) {
        const keywords = args.query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2)
        candidates = indexData.filter((item) => {
          const content = item.content.toLowerCase()
          return keywords.some((kw) => content.includes(kw))
        })

        if (candidates.length < topK * 2) {
          candidates = indexData
        }
        console.log(`[FastSearch] Filtered to ${candidates.length}/${indexData.length} candidates`)
      }

      // Step 2: Generate query embedding (check cache first!)
      let queryEmbedding: number[]
      const embedStart = performance.now()

      const cachedEmbedding = queryEmbeddingCache.get(args.query)
      if (cachedEmbedding) {
        queryEmbedding = cachedEmbedding
        console.log(
          `[FastSearch] Using cached query embedding (${(performance.now() - embedStart).toFixed(0)}ms)`,
        )
      } else {
        queryEmbedding = await generateLocalEmbedding(args.query)

        // Add to cache (with size limit)
        if (queryEmbeddingCache.size >= QUERY_CACHE_MAX) {
          const firstKey = queryEmbeddingCache.keys().next().value
          if (firstKey) {
            queryEmbeddingCache.delete(firstKey)
          }
        }
        queryEmbeddingCache.set(args.query, queryEmbedding)
        console.log(
          `[FastSearch] Generated query embedding (${(performance.now() - embedStart).toFixed(0)}ms)`,
        )
      }

      // Step 3: Calculate similarity and get top K
      const calcStart = performance.now()
      const results = candidates.map((item) => ({
        ...item,
        similarity: cosineSimilarity(queryEmbedding, item.embedding),
      }))

      const topResults = results.sort((a, b) => b.similarity - a.similarity).slice(0, topK)

      console.log(
        `[FastSearch] Similarity calculated (${(performance.now() - calcStart).toFixed(0)}ms)`,
      )

      const totalTime = performance.now() - startTime

      let output = `⚡ Fast semantic search results for: "${args.query}"\n`
      output += `⏱️  Total time: ${totalTime.toFixed(0)}ms | Searched ${candidates.length}/${indexData.length} chunks\n`
      output += `🎯 Model: Local AI (all-MiniLM-L6-v2) - 100% FREE!\n\n`

      for (const result of topResults) {
        output += `📄 ${result.metadata?.filePath || result.id}\n`
        output += `   Relevance: ${(result.similarity * 100).toFixed(1)}%\n`
        output += `   ${result.content.substring(0, 200)}...\n\n`
      }

      output += `💡 Speedup Features:\n`
      output += `   ✓ In-memory index caching\n`
      output += `   ✓ Query embedding cache (${queryEmbeddingCache.size}/${QUERY_CACHE_MAX} cached)\n`
      output += `   ✓ Hybrid keyword pre-filtering\n`
      output += `   ✓ Local AI inference (no API calls!)\n`

      return output
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `❌ Search failed: ${message}`
    }
  },
})
