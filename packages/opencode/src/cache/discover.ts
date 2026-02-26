import { Embed } from "./embed"
import type { Cache } from "./cache"

function score<T extends { embedding?: Float32Array }>(query: Float32Array, rows: T[]) {
  return rows
    .map((row) => {
      const similarity = row.embedding ? Embed.similarity(query, row.embedding) : 0
      return { row, similarity }
    })
    .sort((a, b) => b.similarity - a.similarity)
}

export namespace Discover {
  export async function tools(query: string, topK: number, rows: Cache.ToolRow[]) {
    if (rows.length === 0) return []
    const embedded = await Embed.generate([query])
    const queryEmbedding = embedded[0]
    return score(queryEmbedding, rows)
      .slice(0, topK)
      .map((item) => item.row)
  }

  export async function skills(query: string, topK: number, rows: Cache.SkillRow[]) {
    if (rows.length === 0) return []
    const embedded = await Embed.generate([query])
    const queryEmbedding = embedded[0]
    return score(queryEmbedding, rows)
      .slice(0, topK)
      .map((item) => item.row)
  }
}
