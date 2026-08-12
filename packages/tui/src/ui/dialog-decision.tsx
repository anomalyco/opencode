import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import type { DialogContext } from "./dialog"
import { DialogAlert } from "./dialog-alert"
import { DialogConfirm } from "./dialog-confirm"
import { DialogPrompt } from "./dialog-prompt"
import { DialogSelect } from "./dialog-select"
import {
  confirmMessage,
  formatDecisionResult,
  formatReceiptLine,
  needsConfirm,
  receiptId,
  runDecision,
  statusOpen,
  type DecisionCliResult,
  type ReceiptRow,
} from "../util/decision-cli"

type Toast = {
  show(input: { message: string; variant?: "info" | "success" | "error" | "warning"; duration?: number }): void
  error(error: unknown): void
}

export async function runCommitFlow(input: { dialog: DialogContext; toast: Toast; cwd?: string }) {
  const action = await DialogPrompt.show(input.dialog, "Commit decision", {
    placeholder: "action (e.g. note, reject, offer, hire)",
  })
  if (action === null) return
  const trimmedAction = action.trim()
  if (!trimmedAction) {
    input.toast.show({ message: "Action is required", variant: "error" })
    input.dialog.clear()
    return
  }

  const reasonRaw = await DialogPrompt.show(input.dialog, "Reason (optional)", {
    placeholder: "optional reason — leave empty to skip",
  })
  if (reasonRaw === null) return

  const inferred = input.cwd ? await newestScoreInSingleReq(input.cwd) : undefined
  const args = ["commit", "--json", "--action", trimmedAction]
  const reason = reasonRaw.trim()
  if (reason) args.push("--reason", reason)
  if (inferred) {
    args.push("--target-kind", "candidate", "--target-id", inferred.slug)
    args.push("--meta", JSON.stringify({ score: inferred.score }))
  }

  const result = await call(args, input)
  const id = receiptId(result.json)
  const ok = result.code === 0
  input.toast.show({
    message: ok
      ? id
        ? inferred
          ? `Committed ${id} (${inferred.slug})`
          : `Committed ${id}`
        : inferred
          ? `Committed ${inferred.slug}`
          : "Commit complete"
      : "Commit failed",
    variant: ok ? "success" : "error",
  })
  await showResult(input.dialog, "Commit result", result)
}

export async function runPushFlow(input: { dialog: DialogContext; toast: Toast; cwd?: string }) {
  const listed = await call(["status", "--json"], input)
  if (listed.code !== 0) {
    input.toast.show({ message: "Failed to list open decisions", variant: "error" })
    await showResult(input.dialog, "Push decision", listed)
    return
  }

  const open = statusOpen(listed.json)
  const commitID = await pickOpenCommit(input.dialog, open)
  if (commitID === null) return
  if (!commitID) {
    input.toast.show({ message: "No open commit to push", variant: "info" })
    input.dialog.clear()
    return
  }

  let result = await call(["push", "--json", "--commit-id", commitID], input)
  if (needsConfirm(result.json)) {
    const ok = await DialogConfirm.show(input.dialog, "Confirm push", confirmMessage(result.json))
    if (!ok) {
      input.toast.show({ message: "Push cancelled", variant: "info" })
      input.dialog.clear()
      return
    }
    result = await call(["push", "--json", "--commit-id", commitID, "--confirm"], input)
  }

  input.toast.show({
    message: result.code === 0 ? "Recorded local push receipt (no ATS write)" : "Push failed",
    variant: result.code === 0 ? "success" : "error",
  })
  await showResult(input.dialog, "Push result", result)
}

export async function runDecisionsFlow(input: { dialog: DialogContext; toast: Toast; cwd?: string }) {
  const result = await call(["status", "--json"], input)
  if (result.code !== 0) {
    input.toast.show({ message: "Failed to list decisions", variant: "error" })
  }
  await showResult(input.dialog, "Decision receipts", result)
}

async function call(args: string[], input: { toast: Toast; cwd?: string }) {
  try {
    return await runDecision(args, { cwd: input.cwd })
  } catch (error) {
    input.toast.error(error)
    return {
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      json: undefined,
    } satisfies DecisionCliResult
  }
}

async function showResult(dialog: DialogContext, title: string, result: DecisionCliResult) {
  const message = formatDecisionResult(result)
  await DialogAlert.show(dialog, title, message.length > 4000 ? `${message.slice(0, 4000)}\n…` : message)
}

async function pickOpenCommit(dialog: DialogContext, open: ReceiptRow[]) {
  if (open.length === 0) return ""
  if (open.length === 1 && open[0].id) return open[0].id
  return DialogSelect.show(
    dialog,
    "Push decision",
    open.flatMap((row) => {
      if (!row.id) return []
      return [
        {
          title: row.id,
          value: row.id,
          description: formatReceiptLine(row),
        },
      ]
    }),
  )
}

async function newestScoreInSingleReq(cwd: string) {
  const book = path.join(cwd, ".moks", "reqs")
  const slugs = await readdir(book, { withFileTypes: true })
    .then((entries) => entries.flatMap((entry) => (entry.isDirectory() ? [entry.name] : [])))
    .catch(() => [] as string[])
  const dirs =
    slugs.length === 1
      ? [{ abs: path.join(book, slugs[0], "scores"), rel: `.moks/reqs/${slugs[0]}/scores` }]
      : slugs.length === 0
        ? [{ abs: path.join(cwd, ".moks", "req", "scores"), rel: ".moks/req/scores" }]
        : []
  const rows = await Promise.all(
    dirs.map(async ({ abs, rel }) => {
      const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
      return Promise.all(
        entries.flatMap((entry) => {
          if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === ".gitkeep") return []
          return [
            stat(path.join(abs, entry.name))
              .then((info) => ({
                name: entry.name,
                score: `${rel}/${entry.name}`,
                mtime: info.mtimeMs,
              }))
              .catch(() => undefined),
          ]
        }),
      )
    }),
  )
  const newest = rows
    .flat()
    .filter((row) => row !== undefined)
    .reduce<(typeof rows)[number][number] | undefined>(
      (best, row) => (!best || row.mtime > best.mtime ? row : best),
      undefined,
    )
  if (!newest) return
  return {
    slug: path.basename(newest.name, ".md"),
    score: newest.score,
  }
}
