import type { AgentSideConnection, PermissionOption, ToolCallLocation } from "@agentclientprotocol/sdk"
import type { EventSubscribeOutput, OpenCodeClient } from "@opencode-ai/client/promise"
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
  const toolCallID = input.event.data.source?.id ?? input.event.data.id
  const title = permissionTitle(toolName, toolInput, input.event.data.resources)
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
        locations: permissionLocations(toolName, toolInput, input.event.data.resources, input.cwd),
      },
      options,
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

function permissionTitle(toolName: string, input: ToolInput, resources: ReadonlyArray<string>) {
  if (toToolKind(toolName) === "edit" && resources.length > 1) return `${resources.length} files`
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
      return filePath(input)
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
  return resources.filter((resource) => resource !== "*").map((path) => ({ path }))
}

function filePath(input: ToolInput) {
  return stringValue(input.path) ?? stringValue(input.filePath) ?? stringValue(input.filepath)
}

function resolvePath(path: string, cwd: string) {
  return isAbsolute(path) ? path : resolve(cwd, path)
}

export * as ACPPermission from "./permission"
