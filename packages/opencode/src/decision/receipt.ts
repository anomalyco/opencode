import fs from "fs/promises"
import path from "path"
import { randomBytes } from "crypto"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"

export type Verb = "commit" | "push"
export type State = "committed" | "pushed" | "blocked" | "needs_confirm" | "rejected"

export type Target = {
  kind: string
  id?: string
}

export type Receipt = {
  id: string
  ts: string
  verb: Verb
  action: string
  target?: Target
  commit_id?: string
  dry_run: boolean
  state: State
  adverse: boolean
  reason?: string
  meta?: Record<string, unknown>
  source?: string
}

export const ADVERSE_ACTIONS = new Set(["reject", "offer", "hire"])

const SECRET_KEY =
  /^(?:.*(?:token|secret|password|api[_-]?key|authorization|cookie|credential|private[_-]?key|access[_-]?key).*)$/i

export function isAdverse(action: string): boolean {
  return ADVERSE_ACTIONS.has(action.trim().toLowerCase())
}

export function scrubMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY.test(k)) continue
        nested[k] = v
      }
      out[key] = nested
      continue
    }
    out[key] = value
  }
  if (Object.keys(out).length === 0) return undefined
  return out
}

export function resolveReceiptDir(cwd: string): string {
  const local = path.join(cwd, ".moks")
  if (Filesystem.stat(local)?.isDirectory()) return path.join(local, "receipts")
  return path.join(Global.Path.data, "receipts")
}

export function receiptFile(dir: string): string {
  return path.join(dir, "decisions.jsonl")
}

export function createId(): string {
  return `dec_${randomBytes(12).toString("hex")}`
}

export async function appendReceipt(receipt: Receipt, cwd = process.cwd()): Promise<Receipt> {
  const dir = resolveReceiptDir(cwd)
  await fs.mkdir(dir, { recursive: true })
  await fs.appendFile(receiptFile(dir), JSON.stringify(receipt) + "\n", "utf-8")
  return receipt
}

export async function readReceipts(cwd = process.cwd()): Promise<Receipt[]> {
  const file = receiptFile(resolveReceiptDir(cwd))
  const text = await Bun.file(file)
    .text()
    .catch(() => "")
  if (!text.trim()) return []
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Receipt]
      } catch {
        return []
      }
    })
}

export * as DecisionReceipt from "./receipt"
