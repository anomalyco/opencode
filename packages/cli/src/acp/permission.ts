import type { PermissionOption, ToolCallLocation } from "@agentclientprotocol/sdk"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/effect"
import { FileDiff } from "@opencode/schema/file-diff"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import { Patch } from "@opencode/util/patch"
import { applyPatch } from "diff"
import { Cause, Effect, Option, Schema } from "effect"
import { ACPClient } from "./client"
import type { ACPConnection } from "./connection"
import { ACPTranslate } from "./translate"
import { absolutePath, filePath, patchHunks, pendingToolCall, stringValue, toLocations, type ToolInput } from "./tool"

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
  readonly child?: ACPTranslate.ChildSession
}

const options: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

const decodeFiles = Schema.decodeUnknownOption(Schema.Array(FileDiff.Info))

export const reply = Effect.fn("cli.acp.permission.reply")(function* (input: Input, cancelled: Effect.Effect<void>) {
  yield* Effect.uninterruptibleMask((restore) =>
    // The race starts racers in order and stops once one is done, so an earlier cancel never starts the ask.
    restore(cancelled.pipe(Effect.as("reject" as const), Effect.raceFirst(ask(input)))).pipe(
      Effect.tapCauseIf(Cause.hasDies, (cause) => Effect.logWarning("ACP permission ask failed", cause)),
      Effect.catchCause(() => Effect.succeed("reject" as const)),
      Effect.flatMap((decision) => respond(input, decision)),
    ),
  )
})

const ask = Effect.fnUntraced(function* (input: Input) {
  const toolName = input.tool?.name ?? input.event.data.action
  const toolInput = input.tool?.input ?? input.event.data.metadata ?? {}
  const previews = yield* permissionPreviews(toolName, toolInput, input.event.data.metadata, input.cwd).pipe(
    Effect.orElseSucceed((): Preview[] => []),
  )
  const toolCallID = input.tool?.id ?? input.event.data.id
  const toolCall = pendingToolCall({
    toolCallId: input.child ? `${input.child.id}:${toolCallID}` : toolCallID,
    toolName,
    state: {
      input: toolInput,
      title: prefixedTitle(input.child?.title, permissionTitle(toolName, toolInput, previews)),
    },
    cwd: input.cwd,
  })
  const result = yield* input.connection.requestPermission({
    sessionId: input.clientSessionID,
    toolCall: {
      ...toolCall,
      rawInput: input.tool ? toolCall.rawInput : undefined,
      locations: permissionLocations(toolName, toolInput, input.event.data, input.cwd),
      ...(previews.length > 0 ? { content: previews } : {}),
      ...(input.child ? { _meta: ACPTranslate.childSessionMeta(input.child) } : {}),
    },
    options,
  })
  const selected = result.outcome.outcome === "selected" ? result.outcome.optionId : undefined
  return selected === "once" || selected === "always" ? selected : "reject"
})

function respond(input: Input, decision: Permission.Reply) {
  return input.client.permission
    .reply({ sessionID: input.sessionID, requestID: input.event.data.id, decision })
    .pipe(Effect.catch(ACPClient.classify))
}

function prefixedTitle(prefix: string | undefined, title: string | undefined) {
  if (!prefix) return title
  if (!title) return prefix
  return `${prefix}: ${title}`
}

// Core trims the patch tool's diffs for display, which breaks `applyPatch`, so its previews come from its own hunks.
const permissionPreviews = Effect.fnUntraced(function* (
  toolName: string,
  input: ToolInput,
  metadata: ToolInput | undefined,
  cwd: string,
) {
  const tool = toolName.toLocaleLowerCase()
  if (tool === "patch" || tool === "apply_patch") return yield* patchPreviews(input, cwd)
  const files = Option.getOrElse(decodeFiles(metadata?.files), () => [])
  const previews = yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const path = absolutePath(file.file, cwd)
        const oldText = file.status === "added" ? null : yield* Effect.tryPromise(() => Bun.file(path).text())
        const newText = applyPatch(oldText ?? "", file.patch)
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
  switch (toolName.toLocaleLowerCase()) {
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
    case "apply_patch":
      return filePath(input) ?? previews[0]?.path
    default:
      return undefined
  }
}

function permissionLocations(
  toolName: string,
  input: ToolInput,
  ask: PermissionEvent["data"],
  cwd: string,
): ToolCallLocation[] {
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
