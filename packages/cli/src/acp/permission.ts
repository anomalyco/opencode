import type { PermissionOption, ToolCallContent, ToolCallLocation } from "@agentclientprotocol/sdk"
import type { EventSubscribeOutput, OpenCodeClient } from "@opencode/client/promise"
import { Patch } from "@opencode/util/patch"
import { Effect, Exit } from "effect"
import type { ACPConnection } from "./connection"
import { ACPPromise } from "./promise"
import { absolutePath, filePath, patchHunks, pendingToolCall, stringValue, toLocations, type ToolInput } from "./tool"

type PermissionEvent = Extract<EventSubscribeOutput, { type: "permission.asked" }>
type Tool = { readonly name: string; readonly input: ToolInput }
type Decision = "once" | "always" | "reject"

type Input = {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly event: PermissionEvent
  readonly sessionID: string
  readonly clientSessionID?: string
  readonly cwd: string
  readonly tool?: Tool
  readonly toolCallPrefix?: string
  readonly titlePrefix?: string
}

const options: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

/**
 * Asks the client, then replies to the server. Interruption cancels the client's request, and the server still
 * gets `reject`.
 */
export const reply = Effect.fn("cli.acp.permission.reply")(function* (input: Input) {
  const asked = yield* Effect.exit(Effect.interruptible(ask(input)))
  yield* respond(input, Exit.isSuccess(asked) ? asked.value : "reject")
}, Effect.uninterruptible)

/** Rejects without asking the client. */
export const reject = Effect.fn("cli.acp.permission.reject")(function* (input: Input) {
  yield* respond(input, "reject")
})

const ask = Effect.fnUntraced(function* (input: Input) {
  const toolName = input.tool?.name ?? input.event.data.action
  const toolInput = { ...input.event.data.metadata, ...input.tool?.input }
  const previews = yield* permissionPreviews(toolName, toolInput, input.cwd)
  const toolCallID = input.event.data.source?.id ?? input.event.data.id
  const result = yield* input.connection.requestPermission({
    sessionId: input.clientSessionID ?? input.sessionID,
    toolCall: {
      ...pendingToolCall({
        toolCallId: input.toolCallPrefix ? `${input.toolCallPrefix}:${toolCallID}` : toolCallID,
        toolName,
        state: {
          input: toolInput,
          title: prefixedTitle(input.titlePrefix, permissionTitle(toolName, toolInput, previews)),
        },
        cwd: input.cwd,
      }),
      locations: permissionLocations(toolName, toolInput, input.event.data.resources, input.cwd),
      ...(previews.length > 0 ? { content: previews } : {}),
    },
    options,
  })
  const selected = result.outcome.outcome === "selected" ? result.outcome.optionId : undefined
  return selected === "once" || selected === "always" ? selected : "reject"
})

function respond(input: Input, decision: Decision) {
  return ACPPromise.promise(() =>
    input.client.permission.reply({ sessionID: input.sessionID, requestID: input.event.data.id, decision }),
  )
}

function prefixedTitle(prefix: string | undefined, title: string | undefined) {
  if (!prefix) return title
  if (!title) return prefix
  return `${prefix}: ${title}`
}

const permissionPreviews = Effect.fnUntraced(function* (toolName: string, input: ToolInput, cwd: string) {
  const tool = toolName.toLocaleLowerCase()
  if (tool === "patch" || tool === "apply_patch") return yield* patchPreviews(input, cwd)
  const file = filePath(input)
  if (!file) return []
  const path = absolutePath(file, cwd)
  if (tool === "write") {
    const content = stringValue(input.content)
    return content === undefined ? [] : [diff(path, yield* readText(path), content)]
  }
  if (tool !== "edit") return []
  const oldString = stringValue(input.oldString)
  const newString = stringValue(input.newString)
  if (oldString === undefined || newString === undefined) return []
  const oldText = yield* readText(path)
  const newText =
    input.replaceAll === true ? oldText.replaceAll(oldString, newString) : oldText.replace(oldString, newString)
  return [diff(path, oldText, newText)]
})

// Patch.derive throws when a hunk does not match the current file; the patch then gets no previews.
function patchPreviews(input: ToolInput, cwd: string) {
  return Effect.forEach(
    patchHunks(input),
    (hunk) =>
      Effect.gen(function* () {
        const path = absolutePath(hunk.path, cwd)
        if (hunk.type === "add")
          return diff(
            path,
            "",
            hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`,
          )
        const oldText = yield* readText(path)
        if (hunk.type === "delete") return diff(path, oldText, "")
        const derived = yield* Effect.try(() => Patch.derive(hunk.path, hunk.chunks, oldText))
        return diff(hunk.movePath ? absolutePath(hunk.movePath, cwd) : path, oldText, derived.content)
      }),
    { concurrency: "unbounded" },
  ).pipe(Effect.orElseSucceed((): ToolCallContent[] => []))
}

function diff(path: string, oldText: string, newText: string): ToolCallContent {
  return { type: "diff", path, oldText, newText }
}

function permissionTitle(toolName: string, input: ToolInput, previews: ReadonlyArray<ToolCallContent>) {
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
      return filePath(input) ?? (previews[0]?.type === "diff" ? previews[0].path : undefined)
    default:
      return undefined
  }
}

function permissionLocations(
  toolName: string,
  input: ToolInput,
  resources: ReadonlyArray<string>,
  cwd: string,
): ToolCallLocation[] {
  const locations = toLocations(toolName, input, cwd)
  if (locations.length > 0) return locations
  return resources.filter((resource) => resource !== "*").map((path) => ({ path: absolutePath(path, cwd) }))
}

// A missing file previews as empty.
function readText(path: string) {
  return Effect.tryPromise(() => Bun.file(path).text()).pipe(Effect.orElseSucceed(() => ""))
}

export * as ACPPermission from "./permission"
