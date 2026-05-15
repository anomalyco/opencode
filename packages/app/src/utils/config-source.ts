import type { Project } from "@opencode-ai/sdk/v2/client"

export type ConfigSourceScope = "global" | "project" | "external"
export type ConfigSourceKind = "skill" | "plugin"
export type ConfigSourceOrigin = ".agents" | ".opencode" | ".claude" | "skill" | "plugin"

export type ProjectOwner = {
  item: Project
  root: string
  label: string
}

export type ConfigSource = {
  scope: ConfigSourceScope
  group: ConfigSourceScope | "opencode" | "claude"
  project?: string
  root?: string
  origin?: ConfigSourceOrigin
  owner?: ProjectOwner
}

export function basename(value: string) {
  return value.split(/[\\/]/).at(-1) ?? value
}

export function localPath(value: string) {
  if (!value.startsWith("file://")) return value
  try {
    const url = new URL(value)
    const path = decodeURIComponent(url.pathname)
    if (!url.hostname) return path
    return `//${url.hostname}${path}`
  } catch {
    return value
  }
}

export function normalizePath(value: string) {
  return localPath(value).replace(/\\/g, "/").replace(/\/+$/, "")
}

export function isFilePath(value: string) {
  const next = localPath(value)
  if (!next) return false
  if (next.startsWith("/") || next.startsWith("//")) return true
  return /^[A-Za-z]:\//.test(next)
}

export function isInsidePath(value: string, root?: string) {
  const current = normalizePath(value)
  const base = normalizePath(root ?? "")
  if (!base) return false
  return current === base || current.startsWith(base + "/")
}

export function findProjectOwner(value: string, projects: Project[]): ProjectOwner | undefined {
  return projects
    .flatMap((item) =>
      [item.worktree, ...(item.sandboxes ?? [])]
        .filter((root) => isInsidePath(value, root))
        .map((root) => ({ item, root, label: item.name ?? basename(item.worktree) })),
    )
    .sort((a, b) => b.root.length - a.root.length)[0]
}

export function sourceOrigin(value: string, kind?: ConfigSourceKind): ConfigSourceOrigin | undefined {
  const next = normalizePath(value)
  if (next.includes("/.agents/plugin/") || next.includes("/.agents/plugins/")) return ".agents"
  if (next.includes("/.opencode/plugin/") || next.includes("/.opencode/plugins/")) return ".opencode"
  if (next.includes("/.agents/agent/") || next.includes("/.agents/agents/")) return ".agents"
  if (next.includes("/.opencode/agent/") || next.includes("/.opencode/agents/")) return ".opencode"
  if (next.includes("/.claude/skills/")) return ".claude"
  if (next.includes("/.agents/skill/") || next.includes("/.agents/skills/")) return ".agents"
  if (
    next.includes("/.opencode/skill/") ||
    next.includes("/.opencode/skills/") ||
    next.includes("/.config/opencode/skill/") ||
    next.includes("/.config/opencode/skills/")
  ) {
    return ".opencode"
  }
  return kind
}

function sourceByPath(value: string, dirs: string[]) {
  const list = normalizePath(value).split("/").filter(Boolean)
  const low = list.map((part) => part.toLowerCase())
  const index = low.findIndex((part, i) => {
    if (part !== ".opencode" && part !== ".agents" && part !== ".claude") return false
    return dirs.includes(low[i + 1] ?? "")
  })
  if (index <= 0) return
  const prefix = normalizePath(value).startsWith("/") ? "/" : ""
  return {
    project: list[index - 1],
    root: prefix + list.slice(0, index).join("/"),
    origin: list[index] as ConfigSourceOrigin,
  }
}

function isGlobalOpenCodePlugin(value: string) {
  const list = normalizePath(value).split("/").filter(Boolean)
  const low = list.map((part) => part.toLowerCase())
  const config = low.lastIndexOf(".config")
  if (config >= 0 && low[config + 1] === "opencode" && ["plugin", "plugins"].includes(low[config + 2] ?? "")) {
    return true
  }
  const roam = low.lastIndexOf("roaming")
  if (roam > 0 && low[roam - 1] === "appdata" && low[roam + 1] === "opencode" && ["plugin", "plugins"].includes(low[roam + 2] ?? "")) {
    return true
  }
  const local = low.lastIndexOf("local")
  return local > 0 && low[local - 1] === "appdata" && low[local + 1] === "opencode" && ["plugin", "plugins"].includes(low[local + 2] ?? "")
}

export function classifySkillSource(
  value: string,
  projects: Project[],
  input: { opencodeRoot?: string; claudeRoot?: string } = {},
): ConfigSource {
  if (isInsidePath(value, input.opencodeRoot)) return { scope: "global", group: "opencode", origin: ".opencode" }
  if (isInsidePath(value, input.claudeRoot)) return { scope: "global", group: "claude", origin: ".claude" }
  const owner = findProjectOwner(value, projects)
  if (owner) {
    return { scope: "project", group: "project", project: owner.label, root: owner.item.worktree, origin: sourceOrigin(value, "skill"), owner }
  }
  const fallback = sourceByPath(value, ["skill", "skills"])
  if (fallback && fallback.origin !== ".claude") {
    return { scope: "project", group: "project", project: fallback.project, root: fallback.root, origin: fallback.origin }
  }
  const origin = sourceOrigin(value, "skill")
  return { scope: "global", group: origin === ".claude" ? "claude" : "external", origin }
}

export function classifyPluginSource(value: string, projects: Project[]): ConfigSource {
  const owner = findProjectOwner(value, projects)
  if (owner) {
    return { scope: "project", group: "project", project: owner.label, root: owner.item.worktree, origin: sourceOrigin(value, "plugin"), owner }
  }
  const fallback = sourceByPath(value, ["plugin", "plugins"])
  if (fallback && !isGlobalOpenCodePlugin(value)) {
    return { scope: "project", group: "project", project: fallback.project, root: fallback.root, origin: fallback.origin }
  }
  return { scope: "global", group: "global", project: isGlobalOpenCodePlugin(value) ? "global" : undefined, origin: sourceOrigin(value, "plugin") }
}
