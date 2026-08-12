import fs from "fs/promises"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import type { Receipt } from "./receipt"

const HEADER = `# Decision ledger

Local receipts only. Push does not write to an ATS.

`

export async function appendLedger(receipt: Receipt, cwd: string) {
  const root = path.join(cwd, ".moks")
  if (!Filesystem.stat(root)?.isDirectory()) return
  const file = path.join(root, "ledger.md")
  const row = formatRow(receipt) + "\n"
  if (!Filesystem.stat(file)) {
    await fs.writeFile(file, HEADER + row, "utf-8")
    return
  }
  await fs.appendFile(file, row, "utf-8")
}

function formatRow(receipt: Receipt) {
  const score = typeof receipt.meta?.score === "string" ? receipt.meta.score : ""
  return [
    receipt.ts,
    receipt.verb,
    receipt.state,
    receipt.action,
    receipt.target?.id ? `target=${receipt.target.id}` : "",
    `receipt=${receipt.id}`,
    receipt.commit_id ? `commit_id=${receipt.commit_id}` : "",
    score ? `score=${score}` : "",
    `dry_run=${receipt.dry_run}`,
  ]
    .filter((part) => part.length > 0)
    .join("  ")
}

export * as DecisionLedger from "./ledger"
