import { type ModelMessage } from "ai"
import z from "zod"
import { translateJson } from "./translate-json"

const Block = z.object({
  id: z.string(),
  key: z.string(),
  index: z.number().int().nonnegative(),
  text: z.string(),
})

const Output = z.object({
  blocks: z.array(Block),
})

const block_limit = 2600
const block_floor = 1200
const group_limit = 9000
const group_count = 10
const cut = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "]

export type TranslateItem = {
  id: string
  fields: Record<string, string | undefined>
}

type Piece = z.infer<typeof Block>
type Models = Parameters<typeof translateJson>[0]["model"]

export type TranslatePlan = {
  items: TranslateItem[]
  groups: Piece[][]
  total: Map<string, number>
}

function find(text: string, size: number) {
  for (const item of cut) {
    const at = text.lastIndexOf(item, size)
    if (at >= block_floor) return at + item.length
  }
  return size
}

function split(text: string) {
  if (text.length <= block_limit) return [text]
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    const rest = text.length - at
    if (rest <= block_limit) {
      out.push(text.slice(at))
      break
    }
    const end = at + find(text.slice(at, at + block_limit), block_limit)
    out.push(text.slice(at, end))
    at = end
  }
  return out.filter(Boolean)
}

function body(input: { locale: string; title: string; blocks: Piece[] }) {
  return [
    `${input.title} from English to ${input.locale}.`,
    "Return only a valid JSON object that matches the required schema.",
    "Translate each block literally.",
    "Keep every id, key, and index unchanged.",
    "Do not merge, drop, or reorder blocks.",
    JSON.stringify(
      {
        locale: input.locale,
        blocks: input.blocks,
      },
      null,
      2,
    ),
  ].join("\n\n")
}

export function plan(items: TranslateItem[]) {
  const blocks: Piece[] = []
  const total = new Map<string, number>()
  for (const item of items) {
    let count = 0
    for (const [key, value] of Object.entries(item.fields)) {
      if (!value) continue
      const list = split(value)
      list.forEach((text, index) => {
        blocks.push({ id: item.id, key, index, text })
      })
      count += list.length
    }
    total.set(item.id, count)
  }
  const groups: Piece[][] = []
  let group: Piece[] = []
  let size = 0
  for (const item of blocks) {
    if (group.length > 0 && (group.length >= group_count || size + item.text.length > group_limit)) {
      groups.push(group)
      group = []
      size = 0
    }
    group.push(item)
    size += item.text.length
  }
  if (group.length > 0) groups.push(group)
  return { items, groups, total } satisfies TranslatePlan
}

export async function translateBlocks(input: {
  locale: string
  title: string
  model: Models
  plan: TranslatePlan
  onProgress?: (input: { id: string; done: number; total: number }) => void | Promise<void>
}) {
  const done = new Map<string, number>()
  const out = new Map<string, Map<string, string[]>>()
  input.plan.total.forEach((_, id) => {
    done.set(id, 0)
  })

  for (const group of input.plan.groups) {
    const res = await translateJson({
      model: input.model,
      messages: [
        {
          role: "user",
          content: body({
            locale: input.locale,
            title: input.title,
            blocks: group,
          }),
        },
      ] satisfies ModelMessage[],
      schema: Output,
    })

    const seen = new Set<string>()
    for (const item of res.blocks) {
      const key = `${item.id}:${item.key}:${item.index}`
      seen.add(key)
      const entry = out.get(item.id) ?? new Map<string, string[]>()
      const list = entry.get(item.key) ?? []
      list[item.index] = item.text
      entry.set(item.key, list)
      out.set(item.id, entry)
    }

    for (const item of group) {
      const key = `${item.id}:${item.key}:${item.index}`
      if (!seen.has(key)) throw new Error(`translation missing block: ${key}`)
    }

    const hit = new Set(group.map((item) => item.id))
    for (const id of hit) {
      const next = (done.get(id) ?? 0) + group.filter((item) => item.id === id).length
      done.set(id, next)
      await input.onProgress?.({ id, done: next, total: input.plan.total.get(id) ?? next })
    }
  }

  const fields = new Map<string, Record<string, string>>()
  for (const item of input.plan.items) {
    const entry = out.get(item.id) ?? new Map<string, string[]>()
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(item.fields)) {
      if (!value) continue
      const list = entry.get(key)
      if (!list?.length) throw new Error(`translation missing field: ${item.id}:${key}`)
      next[key] = list.join("")
    }
    fields.set(item.id, next)
  }

  return {
    fields,
    total: input.plan.total,
  }
}
