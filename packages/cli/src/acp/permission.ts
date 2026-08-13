import type { AgentSideConnection, PermissionOption, ToolCallContent, ToolCallLocation } from "@agentclientprotocol/sdk"
import type { EventSubscribeOutput, OpenCodeClient } from "@opencode-ai/client/promise"
import { Patch } from "@opencode-ai/util/patch"
import { Result } from "effect"
import { isAbsolute, resolve } from "node:path"
import { pendingToolCall, stringValue, toLocations, toToolKind, type ToolInput } from "./tool"

type PermissionEvent = Extract<EventSubscribeOutput, { type: "permission.asked" }>
type Connection = Pick<AgentSideConnection, "requestPermission"> & Partial<Pick<AgentSideConnection, "writeTextFile">>
type Tool = { readonly name: string; readonly input: ToolInput }

const options: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

export async function replyPermission(input: {
  readonly client: OpenCodeClient
  readonly connection: Connection
  readonly event: PermissionEvent
  readonly sessionID: string
  readonly clientSessionID?: string
  readonly cwd: string
  readonly tool?: Tool
  readonly toolCallPrefix?: string
  readonly titlePrefix?: string
}) {
  const toolName = input.tool?.name ?? input.event.data.action
  const toolInput = { ...input.event.data.metadata, ...input.tool?.input }
  const previews = await permissionPreviews(toolName, toolInput, input.cwd)
  const toolCallID = input.event.data.source?.id ?? input.event.data.id
  const title = permissionTitle(toolName, toolInput, previews)
  const result = await input.connection
    .requestPermission({
      sessionId: input.clientSessionID ?? input.sessionID,
      toolCall: {
        ...pendingToolCall({
          toolCallId: input.toolCallPrefix ? `${input.toolCallPrefix}:${toolCallID}` : toolCallID,
          toolName,
          state: {
            input: toolInput,
            title: prefixedTitle(input.titlePrefix, title),
          },
          cwd: input.cwd,
        }),
        locations: permissionLocations(toolName, toolInput, input.event.data.resources, input.cwd, previews),
        ...(previews.length > 0 ? { content: previews } : {}),
      },
      options: input.event.data.save?.length ? options : options.filter((option) => option.optionId !== "always"),
    })
    .catch(() => undefined)
  const selected = result?.outcome.outcome === "selected" ? result.outcome.optionId : undefined
  const reply = selected === "once" || selected === "always" ? selected : "reject"
  await input.client.permission.reply({
    sessionID: input.sessionID,
    requestID: input.event.data.id,
    reply,
  })
}

function prefixedTitle(prefix: string | undefined, title: string | undefined) {
  if (!prefix) return title
  if (!title) return prefix
  return `${prefix}: ${title}`
}

export async function syncEditedFiles(input: {
  readonly connection: Partial<Pick<AgentSideConnection, "writeTextFile">>
  readonly writeTextFile: boolean
  readonly sessionID: string
  readonly cwd: string
  readonly toolName: string
  readonly toolInput: ToolInput
  readonly metadata: Readonly<Record<string, unknown>>
}) {
  if (!input.writeTextFile || !input.connection.writeTextFile || toToolKind(input.toolName) !== "edit") return
  const files = Array.isArray(input.metadata.files)
    ? input.metadata.files.flatMap((file): string[] => {
        if (!file || typeof file !== "object") return []
        const path = Reflect.get(file, "file")
        return typeof path === "string" ? [path] : []
      })
    : []
  const path = filePath(input.toolInput)
  const paths = [...new Set([...files, ...(path ? [path] : [])])]
  await Promise.all(
    paths.map(async (path) => {
      const target = resolvePath(path, input.cwd)
      const file = Bun.file(target)
      if (!(await file.exists())) return
      await input.connection.writeTextFile?.({ sessionId: input.sessionID, path: target, content: await file.text() })
    }),
  )
}

async function permissionPreviews(toolName: string, input: ToolInput, cwd: string): Promise<ToolCallContent[]> {
  const tool = toolName.toLocaleLowerCase()
  if (tool === "patch" || tool === "apply_patch") return patchPreviews(input, cwd)
  const path = filePath(input)
  if (!path) return []
  const oldText = await readText(path, cwd)
  if (tool === "write") {
    const content = stringValue(input.content)
    return content === undefined ? [] : [{ type: "diff", path, oldText, newText: content }]
  }
  if (tool !== "edit") return []
  const oldString = stringValue(input.oldString)
  const newString = stringValue(input.newString)
  if (oldString === undefined || newString === undefined) return []
  const newText =
    input.replaceAll === true ? oldText.replaceAll(oldString, newString) : oldText.replace(oldString, newString)
  return [{ type: "diff", path, oldText, newText }]
}

async function patchPreviews(input: ToolInput, cwd: string): Promise<ToolCallContent[]> {
  const patchText = stringValue(input.patchText)
  if (!patchText) return []
  try {
    const parsed = Patch.parse(patchText)
    if (Result.isFailure(parsed)) return []
    return await Promise.all(
      parsed.success.map(async (hunk): Promise<ToolCallContent> => {
        const oldText = hunk.type === "add" ? "" : await readText(hunk.path, cwd)
        if (hunk.type === "add") {
          const newText = hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`
          return { type: "diff", path: hunk.path, oldText, newText }
        }
        if (hunk.type === "delete") return { type: "diff", path: hunk.path, oldText, newText: "" }
        return {
          type: "diff",
          path: hunk.movePath ?? hunk.path,
          oldText,
          newText: Patch.derive(hunk.path, hunk.chunks, oldText).content,
        }
      }),
    )
  } catch {
    return []
  }
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
  previews: ReadonlyArray<ToolCallContent>,
): ToolCallLocation[] {
  const paths = previews.flatMap((preview) => (preview.type === "diff" ? [preview.path] : []))
  if (paths.length > 0) return [...new Set(paths)].map((path) => ({ path }))
  const locations = toLocations(toolName, input, cwd)
  if (locations.length > 0) return locations
  return resources.filter((resource) => resource !== "*").map((path) => ({ path }))
}

function readText(path: string, cwd: string) {
  return Bun.file(resolvePath(path, cwd))
    .text()
    .catch(() => "")
}

function filePath(input: ToolInput) {
  return stringValue(input.path) ?? stringValue(input.filePath) ?? stringValue(input.filepath)
}

function resolvePath(path: string, cwd: string) {
  return isAbsolute(path) ? path : resolve(cwd, path)
}

export * as ACPPermission from "./permission"
