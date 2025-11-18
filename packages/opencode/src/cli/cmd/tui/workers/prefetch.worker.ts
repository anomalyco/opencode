// Prefetch Worker - preloads likely next files based on context patterns in isolated thread
import { Rpc } from "@/util/rpc"
import { appendFile } from "fs/promises"
import path from "path"

interface PrefetchTask {
  id: string
  filePath: string
  strategy: "import" | "test" | "component" | "related"
  timestamp: number
  status: "pending" | "loading" | "cached" | "error"
  size?: number
  duration?: number
}

interface PrefetchState {
  cache: Map<string, { content: string; timestamp: number; size: number }>
  queue: PrefetchTask[]
  running: PrefetchTask | null
  stats: {
    cacheHits: number
    cacheMisses: number
    totalPrefetched: number
    cacheSize: number
  }
  recentAccess: Array<{ file: string; timestamp: number }>
}

let config: {
  serverUrl: string
  sessionID: string
  maxConcurrent: number
  maxCacheSize: number
  strategies: string[]
  workingDirectory: string
}

let state: PrefetchState = {
  cache: new Map(),
  queue: [],
  running: null,
  stats: {
    cacheHits: 0,
    cacheMisses: 0,
    totalPrefetched: 0,
    cacheSize: 0,
  },
  recentAccess: [],
}

// Log to file since console.log won't show in TUI
async function logWorker(msg: string) {
  const timestamp = new Date().toISOString()
  await appendFile("/tmp/opencode-prefetch-worker.log", `[${timestamp}] ${msg}\n`)
}

function broadcastState() {
  postMessage(
    JSON.stringify({
      type: "prefetch.state.update",
      state: {
        ...state,
        cache: Array.from(state.cache.entries()).map(([path, data]) => ({
          path,
          size: data.size,
          timestamp: data.timestamp,
        })),
      },
    }),
  )
}

async function loadFileContent(filePath: string): Promise<string> {
  try {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(config.workingDirectory, filePath)
    const file = Bun.file(absolutePath)

    if (!(await file.exists())) {
      throw new Error(`File does not exist: ${absolutePath}`)
    }

    const content = await file.text()
    return content
  } catch (error) {
    throw new Error(`Failed to load ${filePath}: ${error}`)
  }
}

function findRelatedFiles(filePath: string, content: string): string[] {
  const related: string[] = []
  const dir = path.dirname(filePath)
  const basename = path.basename(filePath, path.extname(filePath))

  // Strategy 1: Import statements
  const importRegex = /import.*from\s+['"]([^'"]+)['"]/g
  let match
  while ((match = importRegex.exec(content)) !== null) {
    let importPath = match[1]

    // Handle relative imports
    if (importPath.startsWith(".")) {
      importPath = path.resolve(dir, importPath)
    }

    // Add common extensions if not present
    if (!path.extname(importPath)) {
      for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
        related.push(importPath + ext)
      }
      related.push(path.join(importPath, "index.ts"))
      related.push(path.join(importPath, "index.tsx"))
    } else {
      related.push(importPath)
    }
  }

  // Strategy 2: Test files
  const testPatterns = [
    `${basename}.test.ts`,
    `${basename}.test.tsx`,
    `${basename}.spec.ts`,
    `${basename}.spec.tsx`,
    path.join(dir, "__tests__", `${basename}.test.ts`),
    path.join(dir, "__tests__", `${basename}.test.tsx`),
  ]
  related.push(...testPatterns)

  // Strategy 3: Component patterns
  if (filePath.includes("component") || content.includes("export default") || content.includes("export const")) {
    // Look for related CSS/style files
    related.push(
      path.join(dir, `${basename}.css`),
      path.join(dir, `${basename}.module.css`),
      path.join(dir, `${basename}.scss`),
      path.join(dir, `${basename}.module.scss`),
    )

    // Look for story files
    related.push(path.join(dir, `${basename}.stories.ts`), path.join(dir, `${basename}.stories.tsx`))
  }

  // Strategy 4: Login form -> dashboard pattern
  if (filePath.toLowerCase().includes("login") || content.includes("login") || content.includes("auth")) {
    related.push(
      path.join(dir, "../dashboard/index.tsx"),
      path.join(dir, "../home/index.tsx"),
      path.join(dir, "../profile/index.tsx"),
    )
  }

  // Strategy 5: API files -> related routes
  if (filePath.includes("api/") || filePath.includes("routes/")) {
    const routeName = basename.replace(/\.(get|post|put|delete)$/, "")
    related.push(
      path.join(dir, `${routeName}.get.ts`),
      path.join(dir, `${routeName}.post.ts`),
      path.join(dir, `${routeName}.put.ts`),
      path.join(dir, `${routeName}.delete.ts`),
    )
  }

  return [...new Set(related)]
}

async function prefetchFile(task: PrefetchTask): Promise<void> {
  await logWorker(`Prefetching ${task.filePath} using ${task.strategy} strategy`)

  const startTime = Date.now()
  try {
    const content = await loadFileContent(task.filePath)
    const size = content.length

    // Store in cache
    state.cache.set(task.filePath, {
      content,
      timestamp: Date.now(),
      size,
    })

    task.size = size
    task.duration = Date.now() - startTime
    task.status = "cached"

    state.stats.totalPrefetched++
    state.stats.cacheSize += size

    // Trigger related file prefetch
    if (config.strategies.includes("import") || config.strategies.includes("related")) {
      const relatedFiles = findRelatedFiles(task.filePath, content)
      await logWorker(`Found ${relatedFiles.length} related files for ${task.filePath}`)

      for (const relatedFile of relatedFiles.slice(0, 5)) {
        // Limit to prevent explosion
        if (!state.cache.has(relatedFile) && !state.queue.some((t) => t.filePath === relatedFile)) {
          const relatedTask: PrefetchTask = {
            id: `prefetch_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            filePath: relatedFile,
            strategy: "related",
            timestamp: Date.now(),
            status: "pending",
          }
          state.queue.push(relatedTask)
        }
      }
    }

    await logWorker(`Prefetched ${task.filePath}: ${size} bytes in ${task.duration}ms`)
  } catch (error) {
    task.status = "error"
    task.duration = Date.now() - startTime
    await logWorker(`Failed to prefetch ${task.filePath}: ${error}`)
  }
}

async function processQueue() {
  if (state.running || state.queue.length === 0) return

  const task = state.queue.shift()!
  state.running = task
  task.status = "loading"
  broadcastState()

  try {
    await prefetchFile(task)
  } catch (error) {
    task.status = "error"
    await logWorker(`Queue processing error for ${task.filePath}: ${error}`)
  } finally {
    state.running = null

    // Clean cache if too large
    if (state.stats.cacheSize > config.maxCacheSize) {
      await cleanCache()
    }

    broadcastState()

    // Continue processing queue
    setTimeout(processQueue, 50)
  }
}

async function cleanCache() {
  const entries = Array.from(state.cache.entries())
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp) // Oldest first

  while (state.stats.cacheSize > config.maxCacheSize * 0.8 && entries.length > 0) {
    const [path, data] = entries.shift()!
    state.cache.delete(path)
    state.stats.cacheSize -= data.size
    await logWorker(`Evicted from cache: ${path} (${data.size} bytes)`)
  }
}

function enqueuePrefetch(filePath: string, strategy: PrefetchTask["strategy"] = "import") {
  // Skip if already cached or queued
  if (state.cache.has(filePath) || state.queue.some((t) => t.filePath === filePath)) {
    return
  }

  const task: PrefetchTask = {
    id: `prefetch_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    filePath,
    strategy,
    timestamp: Date.now(),
    status: "pending",
  }

  state.queue.push(task)
  broadcastState()
  processQueue()
}

// RPC handlers
export const rpc = {
  async init(cfg: typeof config) {
    config = cfg
    await logWorker(`Prefetch worker initialized for session: ${cfg.sessionID}`)
    await logWorker(`Max cache size: ${cfg.maxCacheSize} bytes`)
    await logWorker(`Strategies: ${cfg.strategies.join(", ")}`)
    return { ready: true, state }
  },

  async getState() {
    return {
      ...state,
      cache: Array.from(state.cache.entries()).map(([path, data]) => ({
        path,
        size: data.size,
        timestamp: data.timestamp,
      })),
    }
  },

  async onFileAccess(filePath: string) {
    await logWorker(`File accessed: ${filePath}`)

    // Record access
    state.recentAccess.push({ file: filePath, timestamp: Date.now() })
    state.recentAccess = state.recentAccess.slice(-20) // Keep last 20

    // Check cache hit/miss
    if (state.cache.has(filePath)) {
      state.stats.cacheHits++
      await logWorker(`Cache hit: ${filePath}`)
    } else {
      state.stats.cacheMisses++
      await logWorker(`Cache miss: ${filePath}`)

      // Trigger prefetch for related files
      enqueuePrefetch(filePath, "import")
    }

    broadcastState()
    return { cached: state.cache.has(filePath) }
  },

  async prefetch(filePaths: string[]) {
    await logWorker(`Manual prefetch requested for ${filePaths.length} files`)
    for (const filePath of filePaths) {
      enqueuePrefetch(filePath, "import")
    }
    return { queued: filePaths.length }
  },

  async getCache(filePath: string) {
    const cached = state.cache.get(filePath)
    if (cached) {
      await logWorker(`Cache retrieved: ${filePath}`)
      return { content: cached.content, timestamp: cached.timestamp }
    }
    return null
  },

  async clearCache() {
    const size = state.cache.size
    state.cache.clear()
    state.stats.cacheSize = 0
    state.queue = []
    await logWorker(`Cache cleared: ${size} items`)
    broadcastState()
    return { cleared: size }
  },

  async shutdown() {
    await logWorker("Prefetch worker shutting down")
    await this.clearCache()
  },
}

Rpc.listen(rpc)
