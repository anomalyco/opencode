import type { AssistantMessage, Message, Part, TextPart } from "@opencode-ai/sdk/v2"
import { getFilename } from "@opencode-ai/util/path"
import type { Platform } from "@/context/platform"
import { extractPromptFromParts } from "@/utils/prompt"
import logo from "../../../../console/app/src/asset/logo.svg"

const W = 788
const SIDE = 18
const TOP = 18
const GAP = 18
const USER_W = 288
const ASSIST_W = 520
const USER_LINE = 20
const ASSIST_LINE = 22
const USER_FONT = '400 16px "SF Pro Text", "Inter", "Segoe UI", sans-serif'
const ASSIST_FONT = '400 18px "SF Pro Text", "Inter", "Segoe UI", sans-serif'
const TITLE_FONT = '400 15px "SF Pro Text", "Inter", "Segoe UI", sans-serif'
const BOTTOM = 28
const LOGO_W = 120

type Turn = {
  role: "user" | "assistant"
  text: string
}

type ShotInput = {
  sessionID: string
  title?: string
  messages: Message[]
  parts: (id: string) => Part[]
  revert?: string
  dir?: string
}

type Block = Turn & {
  lines: string[]
  h: number
}

const bubble = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim()

const shrink = (text: string, max: number) => {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`
}

const load = async (src: string) => {
  const img = new Image()
  img.decoding = "sync"
  img.src = src
  await img.decode()
  return img
}

const wrap = (ctx: CanvasRenderingContext2D, text: string, max: number, rows: number) => {
  const list: string[] = []
  const words = clean(text).split(" ").filter(Boolean)
  let line = ""

  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= max) {
      line = next
      continue
    }

    if (line) list.push(line)
    line = word
    if (list.length === rows) return list
  }

  if (line) list.push(line)
  if (list.length <= rows) return list
  return [...list.slice(0, rows - 1), shrink(list[rows - 1], Math.max(12, Math.floor(max / 14)))]
}

const assistantText = (parts: Part[], msg: AssistantMessage) => {
  const text = clean(
    parts
      .filter((part): part is TextPart => part.type === "text" && !part.synthetic && !part.ignored)
      .map((part) => part.text)
      .join(" "),
  )
  if (text) return text
  const err = msg.error?.data
  if (!err || typeof err !== "object" || !("message" in err) || typeof err.message !== "string") return ""
  return clean(err.message)
}

const blocks = (ctx: CanvasRenderingContext2D, turns: Turn[]) =>
  turns.map((turn) => {
    const user = turn.role === "user"
    ctx.font = user ? USER_FONT : ASSIST_FONT
    const lines = wrap(ctx, turn.text, (user ? USER_W : ASSIST_W) - (user ? 40 : 0), user ? 4 : 8)
    const text_h = lines.length * (user ? USER_LINE : ASSIST_LINE)
    const h = user ? Math.max(40, text_h + 24) : text_h
    return { ...turn, lines, h }
  })

export function screenshotText(parts: Part[], dir?: string) {
  return clean(
    extractPromptFromParts(parts, { directory: dir, attachmentName: "image" })
      .map((part) => {
        if (part.type === "text") return part.content
        if (part.type === "file") return part.content
        if (part.type === "agent") return part.content
        return `[image: ${part.filename}]`
      })
      .join(""),
  )
}

export function screenshotTurns(input: ShotInput) {
  return input.messages.flatMap<Turn>((msg) => {
    if (msg.sessionID !== input.sessionID) return []
    if (msg.role === "user") {
      if (input.revert && msg.id >= input.revert) return []
      const text = screenshotText(input.parts(msg.id), input.dir)
      if (!text) return []
      return [{ role: "user", text }]
    }

    if (input.revert && msg.parentID >= input.revert) return []
    const text = assistantText(input.parts(msg.id), msg)
    if (!text) return []
    return [{ role: "assistant", text }]
  })
}

export function screenshotName(title?: string, now = new Date()) {
  const date = now.toISOString().slice(0, 10)
  const base = (title ?? "session")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 48)
  return `${base || "session"}-screenshot-${date}.png`
}

export function downloadScreenshot(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function saveScreenshot(blob: Blob, name: string, platform?: Platform) {
  if (!platform?.getDownloadsPath || !platform.writeFile) {
    downloadScreenshot(blob, name)
    return null
  }

  const path = await platform.getDownloadsPath(name).catch(() => null)
  if (!path) return null
  await platform.writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  return path
}

export async function createSessionScreenshot(input: ShotInput) {
  return renderSessionScreenshot({
    title: input.title?.trim() || getFilename(input.dir ?? "") || "Session",
    turns: screenshotTurns(input),
  })
}

export async function renderSessionScreenshot(input: { title?: string; turns: Turn[] }) {
  const turns = input.turns.filter((turn) => !!turn.text)
  if (!turns.length) throw new Error("Missing message")

  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready.catch(() => undefined)
  }

  const scale = 2
  const probe = document.createElement("canvas")
  const probe_ctx = probe.getContext("2d")
  if (!probe_ctx) throw new Error("Missing canvas")
  const list = blocks(probe_ctx, turns)
  const header = input.title ? 34 : 0
  const H = Math.max(
    240,
    TOP + header + list.reduce((sum, item) => sum + item.h, 0) + GAP * (list.length - 1) + BOTTOM + 34,
  )

  const canvas = document.createElement("canvas")
  canvas.width = W * scale
  canvas.height = H * scale
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Missing canvas")
  ctx.scale(scale, scale)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, W, H)

  let y = TOP

  if (input.title) {
    ctx.fillStyle = "#191919"
    ctx.font = TITLE_FONT
    ctx.fillText(input.title, SIDE, y + 16)
    y += header
  }

  list.forEach((item) => {
    if (item.role === "user") {
      ctx.font = USER_FONT
      const w = Math.min(USER_W, Math.max(...item.lines.map((line) => ctx.measureText(line).width), 76) + 40)
      const x = W - SIDE - w
      bubble(ctx, x, y, w, item.h, 8)
      ctx.fillStyle = "#f7f5f2"
      ctx.fill()
      ctx.strokeStyle = "rgba(208, 203, 198, 0.95)"
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = "#2c2c2c"
      item.lines.forEach((line, i) => {
        ctx.fillText(line, x + 20, y + 26 + i * USER_LINE)
      })
      y += item.h + GAP
      return
    }

    ctx.fillStyle = "#222222"
    ctx.font = ASSIST_FONT
    item.lines.forEach((line, i) => {
      ctx.fillText(line, SIDE, y + 18 + i * ASSIST_LINE)
    })
    y += item.h + GAP
  })

  const mark = await load(logo)
  const logoH = LOGO_W * (mark.height / mark.width)
  ctx.drawImage(mark, Math.round((W - LOGO_W) / 2), H - logoH - 14, LOGO_W, logoH)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((item) => resolve(item), "image/png"))
  if (!blob) throw new Error("Missing blob")
  return blob
}
