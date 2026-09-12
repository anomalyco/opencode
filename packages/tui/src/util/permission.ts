import { Locale } from "./locale"
import { canonicalToolName, finiteNumber, webSearchProviderName } from "./tool-display"
import { createLanguage } from "../i18n/translate"

type Translate = ReturnType<typeof createLanguage>["t"]
const english = createLanguage(() => "en")

type Dict = Record<string, unknown>

export type PermissionPresentation = {
  icon: string
  title: string
  lines: string[]
  diff?: string
  patch?: string
  file?: string
}

export type PermissionPresentationInput = {
  action: string
  resources: ReadonlyArray<unknown>
  metadata?: unknown
  input?: unknown
  toolMetadata?: unknown
}

export function permissionPresentation(
  source: PermissionPresentationInput,
  formatPath: (value: string) => string = (value) => value,
  t: Translate = english.t,
): PermissionPresentation {
  const action = canonicalToolName(source.action)
  const input = normalizeInput(action, source.input)
  const metadata = { ...dict(source.toolMetadata), ...dict(source.metadata) }
  const resources = source.resources.filter((item): item is string => typeof item === "string")

  if (action === "edit") {
    const file = text(input.path) || resources[0] || ""
    const first = dict(Array.isArray(metadata.files) ? metadata.files[0] : undefined)
    const diff = text(first.patch) || text(first.diff) || text(metadata.diff) || undefined
    return {
      icon: "→",
      title: t("tui.permissionDisplay.edit", { path: formatPath(file) }),
      lines: [],
      diff,
      patch: diff ? undefined : text(input.patchText) || undefined,
      file,
    }
  }

  if (action === "read" || action === "list") {
    const value = text(input.path) || resources[0] || ""
    return {
      icon: "→",
      title: t(action === "read" ? "tui.permissionDisplay.read" : "tui.permissionDisplay.list", {
        path: formatPath(value),
      }),
      lines: value ? [t("tui.permissionDisplay.path", { path: formatPath(value) })] : [],
    }
  }

  if (action === "glob" || action === "grep") {
    const pattern = text(input.pattern) || resources[0] || ""
    return {
      icon: "✱",
      title: t(action === "glob" ? "tui.permissionDisplay.glob" : "tui.permissionDisplay.grep", { pattern }),
      lines: pattern ? [t("tui.permissionDisplay.pattern", { pattern })] : [],
    }
  }

  if (action === "shell") {
    const command = text(input.command)
    return {
      icon: "#",
      title: t("tui.permissionDisplay.shell"),
      lines: command ? [`$ ${command}`] : resources.map((item) => `- ${item}`),
    }
  }

  if (action === "subagent") {
    const agent = text(input.agent)
    const description = text(input.description)
    return {
      icon: "#",
      title: t("tui.permissionDisplay.subagent", {
        agent: agent ? Locale.titlecase(agent) : t("tui.permissionDisplay.general"),
      }),
      lines: description ? [`◉ ${description}`] : [],
    }
  }

  if (action === "webfetch") {
    const url = text(input.url) || text(metadata.url)
    return {
      icon: "%",
      title: t("tui.permissionDisplay.webfetch", { url }),
      lines: url ? [t("tui.permissionDisplay.url", { url })] : [],
    }
  }

  if (action === "websearch") {
    const query = text(input.query) || text(metadata.query)
    const provider = webSearchProviderName(metadata.provider)
    const title = provider
      ? t("tui.permissionDisplay.websearchProvider", { provider })
      : t("tui.permissionDisplay.websearch")
    return {
      icon: "◈",
      title: query ? t("tui.permissionDisplay.websearchQuery", { provider: title, query }) : title,
      lines: query ? [t("tui.permissionDisplay.query", { query })] : [],
    }
  }

  if (action === "lsp") {
    const file = text(input.path)
    const operation = text(input.operation) || t("tui.permissionDisplay.request")
    const line = finiteNumber(input.line)
    const character = finiteNumber(input.character)
    const position = line !== undefined && character !== undefined ? `${line}:${character}` : undefined
    return {
      icon: "→",
      title: t("tui.permissionDisplay.lsp", {
        operation,
        path: file ? ` ${formatPath(file)}${position ? `:${position}` : ""}` : "",
      }),
      lines: [
        ...(input.operation ? [t("tui.permissionDisplay.operation", { operation })] : []),
        ...(file ? [t("tui.permissionDisplay.path", { path: formatPath(file) })] : []),
        ...(position ? [t("tui.permissionDisplay.position", { position })] : []),
      ],
    }
  }

  if (action === "external_directory") {
    const raw = text(metadata.parentDir) || text(metadata.filepath) || resources[0] || ""
    const directory = wildcardDirectory(raw)
    return {
      icon: "←",
      title: t("tui.permissionDisplay.externalDirectory", { path: formatPath(directory) }),
      lines: resources.map((item) => `- ${item}`),
    }
  }

  if (action === "doom_loop") {
    return {
      icon: "⟳",
      title: t("tui.permissionDisplay.doomLoop"),
      lines: [t("tui.permissionDisplay.doomLoopDescription")],
    }
  }

  return {
    icon: "⚙",
    title: t("tui.permissionDisplay.callTool", { tool: source.action }),
    lines: [t("tui.permissionDisplay.tool", { tool: source.action })],
  }
}

function wildcardDirectory(value: string) {
  const wildcard = value.indexOf("*")
  if (wildcard === -1) return value
  const prefix = value.slice(0, wildcard)
  if (/^[\\/]+$/.test(prefix) || /^[A-Za-z]:[\\/]$/.test(prefix)) return prefix
  return prefix.replace(/[\\/]+$/, "")
}

export function permissionAlwaysLines(
  input: { action: string; save?: ReadonlyArray<string> },
  t: Translate = english.t,
): string[] {
  const save = input.save ?? []
  if (save.length === 1 && save[0] === "*") {
    return [t("tui.permissionDisplay.alwaysAction", { action: input.action })]
  }
  return [t("tui.permissionDisplay.alwaysPatterns"), ...save.map((item) => `- ${item}`)]
}

export function permissionOptionLabel(
  option: "once" | "always" | "reject" | "confirm" | "cancel",
  t: Translate = english.t,
) {
  return t(`tui.permissionDisplay.${option}`)
}

function normalizeInput(action: string, value: unknown): Dict {
  const input = dict(value)
  const path = text(input.path) || text(input.filePath) || text(input.filepath)
  const agent = text(input.agent) || text(input.subagent_type)
  return {
    ...input,
    ...(["read", "edit", "list", "lsp"].includes(action) && path ? { path } : {}),
    ...(action === "subagent" && agent ? { agent } : {}),
  }
}

function dict(value: unknown): Dict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Dict
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}
