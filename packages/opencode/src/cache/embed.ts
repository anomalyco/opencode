import { embedMany } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { Config } from "@/config/config"

export namespace Embed {
  const DIM = 512

  function tokens(input: string) {
    return input
      .toLowerCase()
      .split(/[^a-z0-9_]+/g)
      .filter(Boolean)
  }

  function hashToken(input: string) {
    const hashed = Bun.hash(input)
    if (typeof hashed === "bigint") {
      return Number(hashed % BigInt(DIM))
    }
    return hashed % DIM
  }

  function normalize(vec: Float32Array) {
    const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0))
    if (norm === 0) return vec
    return Float32Array.from(vec.map((x) => x / norm))
  }

  async function model() {
    const cfg = await Config.get().catch(() => undefined)
    if (!cfg) return
    const id = cfg.experimental?.cache?.embedModel
    if (!id) return

    const [provider, modelID] = id.split("/")
    if (!provider || !modelID) return
    if (provider !== "openai") return

    const sdk = createOpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as Record<string, any>
    const get = sdk.textEmbeddingModel ?? sdk.embeddingModel ?? sdk.embedding
    if (!(get instanceof Function)) return
    return {
      model: get.call(sdk, modelID),
      id,
    }
  }

  export function tfidf(texts: string[]) {
    return texts.map((text) => {
      const vec = new Float32Array(DIM)
      const seen = new Map<number, number>()
      for (const token of tokens(text)) {
        const idx = hashToken(token)
        seen.set(idx, (seen.get(idx) ?? 0) + 1)
      }
      for (const [idx, value] of seen) {
        vec[idx] = value
      }
      return normalize(vec)
    })
  }

  export async function generate(texts: string[]) {
    const local = tfidf(texts)
    const loaded = await model()
    if (!loaded) return local

    const embedded = await embedMany({ model: loaded.model, values: texts }).catch(() => undefined)
    if (!embedded) return local
    return embedded.embeddings.map((item) => Float32Array.from(item))
  }

  export function similarity(a: Float32Array, b: Float32Array) {
    if (a.length === 0 || b.length === 0) return 0
    const len = Math.min(a.length, b.length)
    let dot = 0
    let na = 0
    let nb = 0
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    if (na === 0 || nb === 0) return 0
    return dot / (Math.sqrt(na) * Math.sqrt(nb))
  }

  export function hash(text: string) {
    return Bun.hash(text).toString(16)
  }

  export function forTool(input: { name: string; description: string; schema_json: string }) {
    return `${input.name}: ${input.description}\nSchema: ${input.schema_json}`
  }

  export function forSkill(input: { name: string; description: string }) {
    return `${input.name}: ${input.description}`
  }
}
