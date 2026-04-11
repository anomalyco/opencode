export type PendingPermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}

export type PermissionCardSection = {
  label: string
  text: string
  mono?: boolean
}

export type PermissionCardModel = {
  eyebrow: string
  title: string
  body: string
  sections: PermissionCardSection[]
}

function record(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null
  return input as Record<string, unknown>
}

function maybeString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input : undefined
}

function stringList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is string => typeof item === "string" && item.length > 0)
}

function previewText(input: string, options?: { maxLines?: number; maxChars?: number }): string {
  const maxLines = options?.maxLines ?? 18
  const maxChars = options?.maxChars ?? 1200
  const normalized = input.replace(/\r\n/g, "\n").trim()
  if (!normalized) return ""

  const lines = normalized.split("\n")
  const sliced = lines.slice(0, maxLines)
  let text = sliced.join("\n")

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trimEnd()}\n…`
  } else if (lines.length > maxLines) {
    text = `${text}\n…`
  }

  return text
}

function formatPath(input: string): string {
  return input.replace(/\\/g, "/")
}

function permissionTool(input: unknown): PendingPermissionRequest["tool"] | undefined {
  const value = record(input)
  if (!value) return

  const messageID = maybeString(value.messageID)
  const callID = maybeString(value.callID)
  if (!messageID || !callID) return

  return {
    messageID,
    callID,
  }
}

function parsePendingPermissionRequest(input: unknown): PendingPermissionRequest | null {
  const value = record(input)
  if (!value) return null

  const id = maybeString(value.id)
  const sessionID = maybeString(value.sessionID)
  const permission = maybeString(value.permission)
  if (!id || !sessionID || !permission) return null

  return {
    id,
    sessionID,
    permission,
    patterns: stringList(value.patterns),
    metadata: record(value.metadata) ?? {},
    always: stringList(value.always),
    tool: permissionTool(value.tool),
  }
}

export { parsePendingPermissionRequest }

export function parsePendingPermissionRequests(payload: unknown): PendingPermissionRequest[] {
  if (!Array.isArray(payload)) return []

  return payload
    .map((item) => parsePendingPermissionRequest(item))
    .filter((item): item is PendingPermissionRequest => item !== null)
}

function firstPattern(request: PendingPermissionRequest): string | undefined {
  return request.patterns.find((item) => item.trim().length > 0)
}

function externalDirectory(request: PendingPermissionRequest): string | undefined {
  const fromMetadata = maybeString(request.metadata.parentDir) ?? maybeString(request.metadata.filepath)
  if (fromMetadata) return fromMetadata

  const pattern = firstPattern(request)
  if (!pattern) return
  return pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern
}

function allowScopeSection(request: PendingPermissionRequest): PermissionCardSection | null {
  if (request.always.length === 0) return null
  if (
    request.always.length === request.patterns.length &&
    request.always.every((item, index) => item === request.patterns[index])
  ) {
    return null
  }
  if (request.always.length === 1 && request.always[0] === "*") {
    return {
      label: "Always allow",
      text: "Applies to all future requests of this permission until OpenCode restarts.",
    }
  }

  return {
    label: "Always allow scope",
    text: previewText(request.always.join("\n"), { maxLines: 8, maxChars: 600 }),
    mono: true,
  }
}

export function buildPermissionCardModel(request: PendingPermissionRequest): PermissionCardModel {
  const filepath = maybeString(request.metadata.filepath)
  const diff = maybeString(request.metadata.diff)
  const commandText = previewText(request.patterns.join("\n"), { maxLines: 6, maxChars: 700 })
  const scope = allowScopeSection(request)

  if (request.permission === "edit") {
    const sections: PermissionCardSection[] = []
    if (filepath) {
      sections.push({ label: "File", text: formatPath(filepath), mono: true })
    }
    if (diff) {
      sections.push({ label: "Diff preview", text: previewText(diff), mono: true })
    }
    if (scope) sections.push(scope)

    return {
      eyebrow: "EDIT",
      title: "Allow file edit?",
      body: "OpenCode wants to change a file in this session.",
      sections,
    }
  }

  if (request.permission === "bash") {
    const sections: PermissionCardSection[] = []
    if (commandText) {
      sections.push({ label: "Command", text: commandText, mono: true })
    }
    if (scope) sections.push(scope)

    return {
      eyebrow: "BASH",
      title: "Allow shell command?",
      body: "OpenCode wants to run a shell command for this session.",
      sections,
    }
  }

  if (request.permission === "read") {
    const sections: PermissionCardSection[] = []
    const path = firstPattern(request)
    if (path) {
      sections.push({ label: "Path", text: formatPath(path), mono: true })
    }
    if (scope) sections.push(scope)

    return {
      eyebrow: "READ",
      title: "Allow file read?",
      body: "OpenCode wants to read a path from your machine.",
      sections,
    }
  }

  if (request.permission === "external_directory") {
    const sections: PermissionCardSection[] = []
    const dir = externalDirectory(request)
    if (dir) {
      sections.push({ label: "Directory", text: formatPath(dir), mono: true })
    }
    if (request.patterns.length > 0) {
      sections.push({
        label: "Patterns",
        text: previewText(request.patterns.join("\n"), { maxLines: 8, maxChars: 600 }),
        mono: true,
      })
    }
    if (scope) sections.push(scope)

    return {
      eyebrow: "DIRECTORY",
      title: "Allow external access?",
      body: "OpenCode wants to work with files outside the current project directory.",
      sections,
    }
  }

  if (request.permission === "task") {
    const sections: PermissionCardSection[] = []
    if (request.patterns.length > 0) {
      sections.push({
        label: "Patterns",
        text: previewText(request.patterns.join("\n"), { maxLines: 8, maxChars: 600 }),
        mono: true,
      })
    }
    if (scope) sections.push(scope)

    return {
      eyebrow: "TASK",
      title: "Allow delegated task?",
      body: "OpenCode wants to launch another task as part of this session.",
      sections,
    }
  }

  const sections: PermissionCardSection[] = []
  if (request.patterns.length > 0) {
    sections.push({
      label: "Patterns",
      text: previewText(request.patterns.join("\n"), { maxLines: 8, maxChars: 600 }),
      mono: true,
    })
  }
  if (scope) sections.push(scope)

  return {
    eyebrow: request.permission.toUpperCase(),
    title: `Allow ${request.permission}?`,
    body: "OpenCode needs your permission before it can continue this session.",
    sections,
  }
}
