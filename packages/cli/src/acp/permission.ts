import type { PermissionOption, SessionUpdate } from "@agentclientprotocol/sdk"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/effect"
import { FileDiff } from "@opencode/schema/file-diff"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import { Patch } from "@opencode/util/patch"
import { applyPatch, parsePatch, reversePatch, structuredPatch, type StructuredPatch } from "diff"
import { Effect, Option, Schema } from "effect"
import { ACPChild } from "./child"
import { ACPClient } from "./client"
import type { ACPConnection } from "./connection"
import {
  absolutePath,
  canonicalName,
  filePath,
  patchHunks,
  pendingToolCall,
  stringValue,
  toLocations,
  type DiffSource,
  type ToolInput,
} from "./tool"

type PermissionEvent = Extract<OpenCodeEvent, { type: "permission.asked" }>
type Tool = { readonly id: string; readonly name: string; readonly input: ToolInput }
type Preview = ReturnType<typeof diff>

type Input = {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly event: PermissionEvent
  readonly sessionID: Session.ID
  readonly clientSessionID: string
  readonly cwd: string
  readonly tool?: Tool
  readonly child?: ACPChild.Session
}

const options: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

const decodeFiles = Schema.decodeUnknownOption(Schema.Array(FileDiff.Info))

export const ask = Effect.fnUntraced(function* (input: Input) {
  const toolName = input.tool?.name ?? input.event.data.action
  const toolInput = input.tool?.input ?? input.event.data.metadata ?? {}
  const previews = yield* permissionPreviews(toolName, toolInput, input.event.data.metadata, input.cwd).pipe(
    Effect.orElseSucceed((): Preview[] => []),
  )
  const title = permissionTitle(toolName, toolInput, previews)
  const toolCall = pendingToolCall({
    toolCallId: ACPChild.toolCallID(input.child, input.tool?.id ?? input.event.data.id),
    toolName,
    state: { input: toolInput, title: title ? ACPChild.prefixTitle(input.child, title) : input.child?.title },
    cwd: input.cwd,
  })
  const result = yield* input.connection.requestPermission({
    sessionId: input.clientSessionID,
    toolCall: {
      ...toolCall,
      name: input.tool?.name,
      rawInput: input.tool ? toolCall.rawInput : undefined,
      locations: permissionLocations(toolName, toolInput, input.event.data, input.cwd),
      ...(previews.length > 0 ? { content: previews } : {}),
      ...(input.child ? { _meta: ACPChild.meta(input.child) } : {}),
    },
    options,
  })
  const selected = result.outcome.outcome === "selected" ? result.outcome.optionId : undefined
  return selected === "once" || selected === "always" ? selected : "reject"
})

export function respond(input: Input, decision: Permission.Reply) {
  return input.client.permission.reply({ sessionID: input.sessionID, requestID: input.event.data.id, decision }).pipe(
    Effect.catchTag("PermissionNotFoundError", () => Effect.void),
    Effect.catch(ACPClient.classify),
  )
}

export const withCompletedDiffs = Effect.fnUntraced(function* (
  update: SessionUpdate,
  source: DiffSource | undefined,
  cwd: string,
) {
  if (!source || update.sessionUpdate !== "tool_call_update") return update
  const hunks = canonicalName(source.toolName) === "patch" ? patchHunks(source.input) : []
  const diffs = yield* Effect.forEach(
    Option.getOrElse(decodeFiles(source.metadata?.files), () => []),
    (file) =>
      Effect.gen(function* () {
        const path = absolutePath(file.file, cwd)
        const newText = file.status === "deleted" ? "" : yield* Effect.tryPromise(() => Bun.file(path).text())
        if (file.status === "added") return [diff(path, null, newText)]
        const recorded = parsePatch(file.patch)[0]
        if (!recorded) return []
        const oldText = yield* Effect.try(() => applyPatch(newText, reversePatch(recorded)))
        if (oldText !== false) return [diff(path, oldText, newText)]
        // Core trims indentation from patch-tool diffs, so rebuild those from its hunks and keep them if the ranges agree.
        const hunk = hunks.find(
          (item) => item.type === "update" && absolutePath(item.movePath ?? item.path, cwd) === path,
        )
        if (hunk?.type !== "update" || hunk.chunks.some((chunk) => !chunk.oldLines.length || !chunk.newLines.length))
          return []
        const chunks = hunk.chunks.map((chunk) => ({ ...chunk, oldLines: chunk.newLines, newLines: chunk.oldLines }))
        const rebuilt = (yield* Effect.try(() => Patch.derive(hunk.path, chunks, newText))).content
        return ranges(structuredPatch(path, path, rebuilt, newText)) === ranges(recorded)
          ? [diff(path, rebuilt, newText)]
          : []
      }).pipe(Effect.orElseSucceed((): Preview[] => [])),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((items) => items.flat()))
  return diffs.length === 0 ? update : { ...update, content: [...(update.content ?? []), ...diffs] }
})

function ranges(patch: StructuredPatch) {
  return patch.hunks.map((hunk) => `${hunk.oldStart},${hunk.oldLines},${hunk.newStart},${hunk.newLines}`).join(" ")
}

// Core trims the patch tool's diffs for display, which breaks `applyPatch`, so its previews come from its own hunks.
const permissionPreviews = Effect.fnUntraced(function* (
  toolName: string,
  input: ToolInput,
  metadata: ToolInput | undefined,
  cwd: string,
) {
  if (canonicalName(toolName) === "patch") return yield* patchPreviews(input, cwd)
  const files = Option.getOrElse(decodeFiles(metadata?.files), () => [])
  const previews = yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const path = absolutePath(file.file, cwd)
        const oldText = file.status === "added" ? null : yield* Effect.tryPromise(() => Bun.file(path).text())
        const newText = yield* Effect.try(() => applyPatch(oldText ?? "", file.patch))
        return newText === false ? [] : [diff(path, oldText, newText)]
      }),
    { concurrency: "unbounded" },
  )
  return previews.flat()
})

function patchPreviews(input: ToolInput, cwd: string) {
  return Effect.forEach(
    patchHunks(input),
    (hunk) =>
      Effect.gen(function* () {
        const path = absolutePath(hunk.path, cwd)
        if (hunk.type === "add") {
          const newText = hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`
          return diff(path, null, newText)
        }
        const oldText = yield* Effect.tryPromise(() => Bun.file(path).text())
        if (hunk.type === "delete") return diff(path, oldText, "")
        const derived = yield* Effect.try(() => Patch.derive(hunk.path, hunk.chunks, oldText))
        return diff(hunk.movePath ? absolutePath(hunk.movePath, cwd) : path, oldText, derived.content)
      }),
    { concurrency: "unbounded" },
  )
}

function diff(path: string, oldText: string | null, newText: string) {
  return { type: "diff" as const, path, oldText, newText }
}

function permissionTitle(toolName: string, input: ToolInput, previews: ReadonlyArray<Preview>) {
  if (previews.length > 1) return `${previews.length} files`
  switch (canonicalName(toolName)) {
    case "external_directory":
      return stringValue(input.description) ?? stringValue(input.command) ?? stringValue(input.parentDir)
    case "webfetch":
      return stringValue(input.url)
    case "websearch":
      return stringValue(input.query)
    case "grep":
    case "glob":
      return stringValue(input.pattern)
    case "read":
    case "edit":
    case "write":
    case "patch":
      return filePath(input) ?? previews[0]?.path
    default:
      return undefined
  }
}

function permissionLocations(toolName: string, input: ToolInput, ask: PermissionEvent["data"], cwd: string) {
  const locations = toLocations(toolName, input, cwd)
  if (locations.length > 0 || !PathActions.has(ask.action)) return locations
  const paths = ask.resources.flatMap((resource) => {
    const path = resource.endsWith("/*") ? resource.slice(0, -2) : resource
    return path && !/[*?]/.test(path) ? [absolutePath(path, cwd)] : []
  })
  return Array.from(new Set(paths), (path) => ({ path }))
}

const PathActions = new Set(["read", "edit", "external_directory"])

export * as ACPPermission from "./permission"
