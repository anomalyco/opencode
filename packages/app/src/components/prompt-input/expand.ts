import type { AgentPart, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"

type Inline = AgentPart | FileAttachmentPart

const tone = {
  quote: "var(--syntax-comment)",
  list: "var(--syntax-keyword)",
  head: "var(--syntax-type)",
  code: "var(--syntax-string)",
  link: "var(--syntax-property)",
  emph: "var(--syntax-operator)",
  fence: "var(--syntax-keyword)",
} as const

const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const span = (value: string, color: string) => `<span style="color:${color}">${esc(value)}</span>`

const text = (value: string, at: number) => ({
  type: "text" as const,
  content: value,
  start: at,
  end: at + value.length,
})

const inline = (part: Prompt[number]): part is Inline => part.type === "file" || part.type === "agent"

const image = (part: Prompt[number]): part is ImageAttachmentPart => part.type === "image"

const clone = (part: Inline, at: number): Inline => {
  if (part.type === "agent") {
    return { ...part, start: at, end: at + part.content.length }
  }
  return {
    ...part,
    start: at,
    end: at + part.content.length,
    selection: part.selection ? { ...part.selection } : undefined,
  }
}

function row(value: string, code: boolean) {
  const raw = esc(value)
  if (!value) return "&nbsp;"
  if (code) return `<span style="color:${tone.code}">${raw}</span>`

  const head = value.match(/^(\s{0,3}#{1,6})(\s+)(.*)$/)
  if (head) {
    return `${span(head[1], tone.head)}${esc(head[2])}<span style="color:${tone.head}">${esc(head[3])}</span>`
  }

  const quote = value.match(/^(\s*>+\s?)(.*)$/)
  if (quote) {
    return `${span(quote[1], tone.quote)}${mark(quote[2])}`
  }

  const list = value.match(/^(\s*(?:[-+*]|\d+\.)\s+)(.*)$/)
  if (list) {
    return `${span(list[1], tone.list)}${mark(list[2])}`
  }

  return mark(value)
}

function mark(value: string) {
  const rule =
    /(!?\[[^\]]*\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~)|(https?:\/\/[^\s<>()`"]+)/g

  let at = 0
  let out = ""

  for (const match of value.matchAll(rule)) {
    const idx = match.index ?? 0
    if (idx > at) out += esc(value.slice(at, idx))
    const part = match[0]
    const color = match[1] ? tone.link : match[2] ? tone.code : match[3] ? tone.emph : tone.link
    out += span(part, color)
    at = idx + part.length
  }

  if (at < value.length) out += esc(value.slice(at))
  return out || "&nbsp;"
}

export function value(prompt: Prompt) {
  return prompt
    .flatMap((part) => (part.type === "image" ? [] : [part.content]))
    .join("")
}

export function merge(raw: string, prev: Prompt): Prompt {
  const body = raw.replace(/\r\n?/g, "\n")
  const map = new Map<string, Inline[]>()
  const keys = prev
    .filter(inline)
    .flatMap((part) => {
      if (!part.content) return []
      const list = map.get(part.content) ?? []
      list.push(part)
      map.set(part.content, list)
      return [part.content]
    })
    .filter((part, idx, all) => all.indexOf(part) === idx)
    .sort((a, b) => b.length - a.length)

  const out: Prompt = []
  let idx = 0
  let mark = 0
  let at = 0

  const push = (value: string) => {
    if (!value) return
    out.push(text(value, at))
    at += value.length
  }

  while (idx < body.length) {
    const key = keys.find((item) => {
      const list = map.get(item)
      return list?.length && body.startsWith(item, idx)
    })

    if (!key) {
      idx += 1
      continue
    }

    push(body.slice(mark, idx))
    const part = map.get(key)?.shift()
    if (part) {
      out.push(clone(part, at))
      at += key.length
    } else {
      push(key)
    }
    idx += key.length
    mark = idx
  }

  push(body.slice(mark))

  if (out.length === 0) out.push(text("", 0))
  return [...out, ...prev.filter(image).map((part) => ({ ...part }))]
}

export function paint(raw: string) {
  const body = raw.replace(/\r\n?/g, "\n")
  const lines = (body.endsWith("\n") ? body + " " : body || " ").split("\n")
  let code = false

  return lines
    .map((value) => {
      const fence = value.match(/^(\s*)(```|~~~)(.*)$/)
      if (!fence) return row(value, code)
      const html = `${esc(fence[1])}${span(fence[2], tone.fence)}${span(fence[3], tone.code)}`
      code = !code
      return html
    })
    .join("\n")
}
