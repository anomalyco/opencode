import { randomBytes } from "crypto"

function generateId(prefix: string): string {
  const time = Date.now()
  const rand = randomBytes(8).toString("hex")
  return `${prefix}_${time.toString(36)}_${rand}`
}

export namespace Memory {
  export type Entry = {
    id: string
    content: string
    tags: string[]
    projectID: string
    source: { sessionID?: string; agent?: string; manual?: boolean }
    time: { created: number; accessed: number }
    accessCount: number
  }

  export type CreateInput = {
    content: string
    tags: string[]
    projectID: string
    source?: { sessionID?: string; agent?: string; manual?: boolean }
  }

  const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds

  export function create(input: CreateInput): Entry {
    return {
      id: generateId("mem"),
      content: input.content,
      tags: input.tags,
      projectID: input.projectID,
      source: input.source || {},
      time: {
        created: Date.now(),
        accessed: Date.now(),
      },
      accessCount: 0,
    }
  }

  function calculateScore(memory: Entry, query: string): number {
    const now = Date.now()
    const ageMs = now - memory.time.created

    // Age score (30%): 0.5 ^ (age_ms / HALF_LIFE_MS)
    const ageScore = Math.pow(0.5, ageMs / HALF_LIFE_MS)

    // Tag match (40%): how many query words match tags
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0)
    const tagMatches = memory.tags.filter((tag) => queryWords.some((word) => tag.toLowerCase().includes(word))).length
    const tagScore = queryWords.length > 0 ? tagMatches / queryWords.length : 0

    // Content match (20%): how many query words appear in content
    const contentLower = memory.content.toLowerCase()
    const contentMatches = queryWords.filter((word) => contentLower.includes(word)).length
    const contentScore = queryWords.length > 0 ? contentMatches / queryWords.length : 0

    // Access frequency (10%): min(accessCount / 10, 1)
    const accessScore = Math.min(memory.accessCount / 10, 1)

    // Weighted sum
    return ageScore * 0.3 + tagScore * 0.4 + contentScore * 0.2 + accessScore * 0.1
  }

  export function scoreRelevance(memories: Entry[], query: string): Entry[] {
    return [...memories]
      .map((memory) => ({
        memory,
        score: calculateScore(memory, query),
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.memory)
  }

  export function search(memories: Entry[], query: string, limit: number = 10): Entry[] {
    const queryLower = query.toLowerCase()
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0)

    // Filter memories where content or tags match query
    const filtered = memories.filter((memory) => {
      const contentMatch = memory.content.toLowerCase().includes(queryLower)
      const tagMatch = memory.tags.some((tag) => queryWords.some((word) => tag.toLowerCase().includes(word)))
      const contentWordMatch = queryWords.some((word) => memory.content.toLowerCase().includes(word))
      return contentMatch || tagMatch || contentWordMatch
    })

    // Sort by relevance and return top limit
    return scoreRelevance(filtered, query).slice(0, limit)
  }
}
