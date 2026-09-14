import type { LLMRequest } from "../../schema/index.js"

export const valid = /^[A-Za-z0-9]{9}$/

export const hash = (value: string) => {
  const hash = (seed: number) => {
    let result = seed
    for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619)
    return (result >>> 0).toString(36)
  }
  return `${hash(2166136261).padStart(7, "0")}${hash(2246822519).padStart(7, "0")}`.slice(-9)
}

export const normalizer = (request: LLMRequest) => {
  const ids = request.messages.flatMap((message) =>
    message.content.flatMap((part) => (part.type === "tool-call" || part.type === "tool-result" ? [part.id] : [])),
  )
  // Reserve valid IDs before projecting any history, including IDs encountered later.
  const used = new Set(ids.filter((id) => valid.test(id)))
  const normalized = new Map<string, string>()
  return (id: string) => {
    if (valid.test(id)) return id
    const previous = normalized.get(id)
    if (previous) return previous
    let attempt = 0
    let candidate = hash(id)
    while (used.has(candidate)) candidate = hash(`${id}:${++attempt}`)
    used.add(candidate)
    normalized.set(id, candidate)
    return candidate
  }
}

export * as MistralToolID from "./mistral-tool-id.js"
