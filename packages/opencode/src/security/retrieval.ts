import { Filesystem } from "@/util/filesystem"
import { Pinecone } from "@pinecone-database/pinecone"
import { QdrantClient } from "@qdrant/js-client-rest"
import { SecurityControl, type RetrievedControl, type SecurityVector } from "./schema"

function tokens(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length > 1)
}

function score(query: string[], item: { title: string; text: string; tags?: string[] }) {
  const set = new Set(tokens([item.title, item.text, (item.tags ?? []).join(" ")].join(" ")))
  const hit = query.filter((q) => set.has(q)).length
  if (hit === 0) return 0
  const density = hit / Math.max(set.size, 1)
  return hit + density
}

export async function loadControls(file: string) {
  const json = await Filesystem.readJson<unknown>(file)
  return SecurityControl.array().parse(json)
}

export function retrieveRelevantControls(inputText: string, topk: number, controls: SecurityControl[]): RetrievedControl[] {
  const query = tokens(inputText)
  return controls
    .map((item) => ({
      id: item.id,
      title: item.title,
      text: item.text,
      tags: item.tags,
      score: score(query, item),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.id.localeCompare(b.id)
    })
    .slice(0, topk)
}

const DIM = 256

function embed(text: string) {
  const vec = Array.from({ length: DIM }, () => 0)
  for (const token of tokens(text)) {
    let hash = 2166136261
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    const idx = Math.abs(hash) % DIM
    vec[idx] += 1
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1
  return vec.map((x) => x / norm)
}

function text(item: SecurityControl) {
  return [item.title, item.text, (item.tags ?? []).join(" ")].join("\n")
}

export async function retrieveVector(input: {
  backend: SecurityVector
  controls: SecurityControl[]
  text: string
  topk: number
  collection: string
  namespace?: string
  pineconeIndex?: string
  qdrantUrl?: string
  qdrantKey?: string
}) {
  if (input.backend === "pinecone") {
    const key = process.env.PINECONE_API_KEY
    const idx = input.pineconeIndex ?? process.env.PINECONE_INDEX
    if (!key || !idx) {
      throw new Error("Pinecone requires PINECONE_API_KEY and PINECONE_INDEX.")
    }
    const pc = new Pinecone({ apiKey: key })
    const index = pc.index(idx)
    const ns = input.namespace ? index.namespace(input.namespace) : index
    await ns.upsertRecords({
      records: input.controls.map((item) => ({
        id: item.id,
        text: text(item),
        title: item.title,
        body: item.text,
        tags: (item.tags ?? []).join(","),
      })),
    })
    const hit = await ns.searchRecords({
      query: { topK: input.topk, inputs: { text: input.text } },
      fields: ["title", "body", "tags", "text"],
    })
    return (hit.result?.hits ?? []).map((item) => {
      const f = (item.fields ?? {}) as Record<string, unknown>
      return {
        id: String(item._id ?? ""),
        title: String(f["title"] ?? ""),
        text: String(f["body"] ?? f["text"] ?? ""),
        tags: String(f["tags"] ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        score: Number(item._score ?? 0),
      }
    })
  }

  const url = input.qdrantUrl ?? process.env.QDRANT_URL
  if (!url) throw new Error("Qdrant requires QDRANT_URL or config.experimental.security_audit.qdrant_url.")
  const key = input.qdrantKey ?? process.env.QDRANT_API_KEY
  const client = new QdrantClient({ url, apiKey: key })
  await client.createCollection(input.collection, {
    vectors: {
      size: DIM,
      distance: "Cosine",
    },
  }).catch(() => {})
  await client.upsert(input.collection, {
    wait: true,
    points: input.controls.map((item) => ({
      id: item.id,
      vector: embed(text(item)),
      payload: {
        title: item.title,
        text: item.text,
        tags: item.tags ?? [],
      },
    })),
  })
  const hit = await client.search(input.collection, {
    vector: embed(input.text),
    limit: input.topk,
    with_payload: true,
  })
  return hit.map((item) => ({
    id: String(item.id),
    title: String(item.payload?.["title"] ?? ""),
    text: String(item.payload?.["text"] ?? ""),
    tags: Array.isArray(item.payload?.["tags"]) ? item.payload?.["tags"].map(String) : [],
    score: item.score ?? 0,
  }))
}
