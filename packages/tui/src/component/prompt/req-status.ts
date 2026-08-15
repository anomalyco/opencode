import { readdir } from "node:fs/promises"
import path from "node:path"
import { runDecision, statusOpen } from "../../util/decision-cli"

export async function readReqTitle(dir: string) {
  const text = await Bun.file(path.join(dir, "HIRING.md"))
    .text()
    .catch(() => undefined)
  const title = text ? firstHeading(text) : undefined
  if (title) return title
  return path.basename(dir)
}

export async function countCards(dir: string) {
  return readdir(path.join(dir, "candidates"), { withFileTypes: true })
    .then(
      (entries) =>
        entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== ".gitkeep").length,
    )
    .catch(() => 0)
}

export async function countUnpushed(dir: string) {
  const result = await runDecision(["status", "--json"], { cwd: dir }).catch(() => undefined)
  if (!result || result.code !== 0) return
  if (!result.json || typeof result.json !== "object") return
  return statusOpen(result.json).length
}

export function formatReqStatus(input: { title: string; cards?: number; unpushed?: number; agent: string }) {
  return [
    input.title,
    input.cards === undefined ? undefined : `${input.cards} ${input.cards === 1 ? "card" : "cards"}`,
    input.unpushed === undefined ? undefined : `${input.unpushed} unpushed`,
    input.agent,
  ]
    .filter((part) => part)
    .join(" · ")
}

function firstHeading(text: string) {
  const match = text.match(/^#\s+(.+)$/m)
  if (!match) return
  return match[1].trim()
}
