import type { ContentBlock } from "@agentclientprotocol/sdk"
import type { Command } from "@opencode/schema/command"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { access, constants } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { builtinCommands, type Catalog } from "./catalog"
import { linkReference, promptContentToParts, type PromptPart } from "./content"
import { ACPError } from "./error"
import type { ACPTranslate } from "./translate"

export type Prepared = {
  readonly start: ACPTranslate.TurnStart
  readonly text: string
  readonly files: Array<{ readonly uri: string; readonly name?: string }>
  readonly synthetic: ReadonlyArray<string>
  readonly slash?: { readonly name: string; readonly args: string }
  readonly command?: Command.Info
}

export const prepare = Effect.fnUntraced(function* (catalog: Catalog, content: readonly ContentBlock[]) {
  if (content.some((block) => block.type === "image" && !block.data && !block.uri)) {
    return yield* new ACPError.InvalidRequestError({ message: "image content has no data or uri", field: "prompt" })
  }
  const parts = yield* Effect.forEach(promptContentToParts(content), referenceUnreadableFile, {
    concurrency: "unbounded",
  })
  const visible = parts.filter((part) => part.type !== "text" || (!part.synthetic && !part.ignored))
  const text = visible.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  const slash = detectSlashCommand(text)
  const id = SessionMessage.ID.create()
  return {
    start:
      slash && builtinCommands.get(slash.name)?.start === "compaction"
        ? { type: "compaction", id }
        : { type: "input", id },
    text,
    files: visible.flatMap((part) => (part.type === "file" ? [{ uri: part.url, name: part.filename }] : [])),
    synthetic: parts.flatMap((part) => (part.type === "text" && part.synthetic ? [part.text] : [])),
    slash,
    command: slash ? catalog.commands.find((item) => item.name === slash.name) : undefined,
  } satisfies Prepared
})

function referenceUnreadableFile(part: PromptPart) {
  if (part.type !== "file" || !part.url.startsWith("file://")) return Effect.succeed(part)
  return Effect.tryPromise(() => access(fileURLToPath(part.url), constants.R_OK)).pipe(
    Effect.as(part),
    Effect.orElseSucceed(() => linkReference(part.filename, part.url)),
  )
}

function detectSlashCommand(text: string) {
  const value = text.trim()
  if (!value.startsWith("/")) return undefined
  const [name, ...rest] = value.slice(1).split(/\s+/)
  if (!name) return undefined
  return { name, args: rest.join(" ").trim() }
}

export * as ACPPrompt from "./prompt"
