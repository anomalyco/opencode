import { Filesystem } from "@/util/filesystem"
import { SecurityControl, type RetrievedControl } from "./schema"

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
