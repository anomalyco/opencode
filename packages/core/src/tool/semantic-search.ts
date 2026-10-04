export * as SemanticSearchTool from "./semantic-search"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { SemanticEmbedder } from "../semantic/embedder"
import { SemanticCache } from "../semantic/cache"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "semantic_search"

export const DEFAULT_LIMIT = 5
export const MAX_LIMIT = 20
export const CHUNK_SIZE_LINES = 35
export const CHUNK_OVERLAP_LINES = 10
export const MAX_CHUNKS_TO_EMBED = 35

export const Input = Schema.Struct({
  query: Schema.String.annotate({
    description: "Natural language query describing what you are searching for conceptually in the codebase",
  }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory or file to search within. Defaults to the active Location.",
  }),
  include: Schema.String.pipe(Schema.optional).annotate({
    description: 'File glob pattern to filter candidate files (e.g., "*.ts" or "*.py")',
  }),
  limit: Schema.Number.pipe(Schema.optional).annotate({
    description: "Maximum number of semantically relevant snippets to return (default: 5, max: 20)",
  }),
})

export const MatchItem = Schema.Struct({
  path: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  score: Schema.Number,
  snippet: Schema.String,
  fallback: Schema.optional(Schema.Boolean),
})

export const Output = Schema.Array(MatchItem)
export type SemanticMatch = typeof MatchItem.Type

export const toModelOutput = (matches: readonly SemanticMatch[]): string => {
  if (matches.length === 0) {
    return "No semantically relevant code snippets found."
  }
  const isFallback = matches.some((m) => m.fallback === true)
  const lines: string[] = []
  if (isFallback) {
    lines.push(`Found ${matches.length} matches (Local Ollama embedder offline; keyword fallback used):`)
  } else {
    lines.push(`Found ${matches.length} semantically relevant code snippet(s):`)
  }

  for (const match of matches) {
    lines.push("")
    const scorePct = Math.round(match.score * 100)
    lines.push(`📄 ${match.path}:${match.startLine}-${match.endLine} [Similarity: ${scorePct}%]`)
    lines.push("```")
    lines.push(match.snippet)
    lines.push("```")
  }
  return lines.join("\n")
}

interface CodeChunk {
  readonly relativePath: string
  readonly startLine: number
  readonly endLine: number
  readonly text: string
}

export const chunkFile = (filePath: string, content: string): CodeChunk[] => {
  const lines = content.split("\n")
  if (lines.length <= CHUNK_SIZE_LINES) {
    return [
      {
        relativePath: filePath,
        startLine: 1,
        endLine: lines.length,
        text: content,
      },
    ]
  }

  const chunks: CodeChunk[] = []
  const step = CHUNK_SIZE_LINES - CHUNK_OVERLAP_LINES
  for (let i = 0; i < lines.length; i += step) {
    const chunkLines = lines.slice(i, i + CHUNK_SIZE_LINES)
    if (chunkLines.length === 0) break
    chunks.push({
      relativePath: filePath,
      startLine: i + 1,
      endLine: i + chunkLines.length,
      text: chunkLines.join("\n"),
    })
    if (i + CHUNK_SIZE_LINES >= lines.length) break
  }
  return chunks
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service
    const embedder = yield* SemanticEmbedder.Service
    const cache = yield* SemanticCache.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Search codebase by semantic intent and meaning using local embedding models ($0 remote tokens, <15 ms dot-product in RAM). Finds conceptually relevant code snippets even when exact keywords differ. Gracefully falls back to keyword matching if local model is offline.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: toModelOutput(output),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.query],
                save: ["*"],
                metadata: {
                  root: ".",
                  path: input.path,
                  include: input.include,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
              const target = path.resolve(location.directory, input.path ?? ".")
              const targetInfo = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
              const searchDir = targetInfo?.type === "Directory" ? target : location.directory

              const isOllamaUp = yield* embedder.isAvailable()

              if (!isOllamaUp) {
                // Fallback to keyword grep
                const words = input.query
                  .split(/\s+/)
                  .map((w) => w.replace(/[^\w-]/g, ""))
                  .filter((w) => w.length >= 3)
                const fallbackPattern = words.length > 0 ? words.slice(0, 3).join("|") : input.query

                const matches = yield* ripgrep
                  .grep({
                    cwd: searchDir,
                    pattern: fallbackPattern,
                    include: input.include,
                    limit: limit,
                  })
                  .pipe(
                    Effect.catch(() =>
                      Effect.succeed([] as readonly FileSystem.Match[]),
                    ),
                  )

                return matches.map((m) => {
                  const relPath = path.relative(location.directory, path.resolve(searchDir, m.entry.path))
                  return {
                    path: relPath,
                    startLine: m.line,
                    endLine: m.line,
                    score: 0.5,
                    snippet: m.text,
                    fallback: true,
                  }
                })
              }

              // Embedder is active: discover files
              const globPattern = input.include ?? "**/*.{ts,tsx,js,jsx,py,go,rs,md}"
              const candidateEntries = yield* ripgrep
                .glob({
                  cwd: searchDir,
                  pattern: globPattern,
                  limit: 40,
                })
                .pipe(
                  Effect.catch(() => Effect.succeed([] as readonly FileSystem.Entry[])),
                )

              // Collect chunks across candidate files
              const allChunks: CodeChunk[] = []
              for (const entry of candidateEntries) {
                if (allChunks.length >= MAX_CHUNKS_TO_EMBED) break
                const fullPath = path.resolve(searchDir, entry.path)
                const content = yield* fs.readFileStringSafe(fullPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (!content || content.length > 100_000) continue
                const rel = path.relative(location.directory, fullPath)
                const fileChunks = chunkFile(rel, content)
                for (const chunk of fileChunks) {
                  allChunks.push(chunk)
                  if (allChunks.length >= MAX_CHUNKS_TO_EMBED) break
                }
              }

              if (allChunks.length === 0) {
                return []
              }

              const embedModel = process.env.OPENCODE_EMBED_MODEL || "nomic-embed-text"

              // Query embedding: check cache first, embed if missing
              const queryHash = cache.hashText(input.query)
              let queryVector = yield* cache.get(queryHash, embedModel).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!queryVector) {
                queryVector = yield* embedder.embedOne(input.query)
                yield* cache.set(queryHash, embedModel, queryVector).pipe(Effect.catch(() => Effect.void))
              }

              // Chunk embeddings: check batch cache for hits
              const chunkHashes = allChunks.map((c) => cache.hashText(c.text))
              const cachedMap = yield* cache.getBatch(chunkHashes, embedModel).pipe(
                Effect.catch(() => Effect.succeed(new Map<string, readonly number[]>())),
              )

              // Identify missing chunks that need embedding
              const missingChunks: { index: number; text: string; hash: string }[] = []
              for (let i = 0; i < allChunks.length; i++) {
                const hash = chunkHashes[i]!
                if (!cachedMap.has(hash)) {
                  missingChunks.push({ index: i, text: allChunks[i]!.text, hash })
                }
              }

              // Embed only missing chunks via local embedder
              if (missingChunks.length > 0) {
                const newEmbeddings = yield* embedder.embed(missingChunks.map((m) => m.text))
                const newEntries = missingChunks.map((m, idx) => ({
                  hash: m.hash,
                  vector: newEmbeddings[idx]!,
                }))
                for (const entry of newEntries) {
                  cachedMap.set(entry.hash, entry.vector)
                }
                yield* cache.setBatch(newEntries, embedModel).pipe(Effect.catch(() => Effect.void))
              }

              const scoredChunks = allChunks.map((chunk, index) => {
                const hash = chunkHashes[index]!
                const vec = cachedMap.get(hash)
                const score = vec ? SemanticEmbedder.cosineSimilarity(queryVector, vec) : 0
                return {
                  path: chunk.relativePath,
                  startLine: chunk.startLine,
                  endLine: chunk.endLine,
                  score,
                  snippet: chunk.text,
                }
              })

              // Sort by descending similarity score
              scoredChunks.sort((a, b) => b.score - a.score)
              return scoredChunks.slice(0, limit)
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Semantic search failed for: ${input.query}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/semantic-search",
  layer,
  deps: [ToolRegistry.node, FSUtil.node, Ripgrep.node, Location.node, PermissionV2.node, SemanticEmbedder.node, SemanticCache.node],
})
