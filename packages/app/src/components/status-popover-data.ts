import type { Config, McpStatus, Project } from "@opencode-ai/sdk/v2/client"
import { getFilename } from "@opencode-ai/util/path"

const stem = (value: string) => value.replace(/\.(?:ts|js|mjs|cjs|mts|cts)$/i, "")

const file = (value: string) => {
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

const base = (value: string) => file(value).split(/[\\/]/).at(-1) ?? value
const norm = (value: string) => file(value).replace(/\\/g, "/").replace(/\/+$/, "")

const inside = (value: string, root?: string) => {
  const a = norm(value)
  const b = norm(root ?? "")
  if (!b) return false
  return a === b || a.startsWith(b + "/")
}

const owner = (value: string, list: Project[]) =>
  list
    .flatMap((item) =>
      [item.worktree, ...(item.sandboxes ?? [])].filter((root) => inside(value, root)).map((root) => ({ item, root })),
    )
    .sort((a, b) => b.root.length - a.root.length)[0]

export const project = (value: string) => {
  const list = file(value).split(/[\\/]/).filter(Boolean)
  const low = list.map((part) => part.toLowerCase())
  const i = list.lastIndexOf(".opencode")
  if (i > 0 && (low[i + 1] === "plugin" || low[i + 1] === "plugins")) return list[i - 1]

  const config = low.lastIndexOf(".config")
  if (config >= 0 && low[config + 1] === "opencode" && (low[config + 2] === "plugin" || low[config + 2] === "plugins"))
    return "global"

  const roam = low.lastIndexOf("roaming")
  if (roam > 0 && low[roam - 1] === "appdata" && low[roam + 1] === "opencode" && (low[roam + 2] === "plugin" || low[roam + 2] === "plugins"))
    return "global"

  const local = low.lastIndexOf("local")
  if (local > 0 && low[local - 1] === "appdata" && low[local + 1] === "opencode" && (low[local + 2] === "plugin" || low[local + 2] === "plugins"))
    return "global"

  return undefined
}

const plug = (value: string) => {
  const next = file(value)
  if (value.startsWith("file://") || next !== value || value.includes("/") || value.includes("\\")) return stem(base(next))
  const at = value.lastIndexOf("@")
  if (at > 0) return value.slice(0, at)
  return value
}

export const item = (value: string) => {
  const name = plug(value)
  const group = project(value)
  return {
    name,
    project: group && group !== name ? group : undefined,
    value,
  }
}

const skillSource = (value: string) => {
  const next = norm(value)
  if (next.includes("/.claude/skills/")) return ".claude"
  if (next.includes("/.agents/skills/")) return ".agents"
}

export const skill = (value: { name: string; location: string }, list: Project[]) => {
  const hit = owner(value.location, list)
  return {
    name: value.name,
    scope: hit ? "project" : "global",
    source: hit?.item.name || (hit ? getFilename(hit.item.worktree) : skillSource(value.location)),
    value: value.location,
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export const label = (dir: string | undefined, list: Project[]) => {
  if (!dir) return undefined
  const hit = list.find((item) => item.worktree === dir) ?? list.find((item) => item.sandboxes?.includes(dir))
  if (hit) return hit.name || getFilename(hit.worktree)
  return getFilename(dir)
}

export const parse = (text: string | null | undefined) => {
  if (!text) return undefined
  try {
    return JSON.parse(text) as Config
  } catch {}
  try {
    const next = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1")
    return JSON.parse(next) as Config
  } catch {
    return undefined
  }
}

const keys = (config: Config | undefined) => new Set(Object.keys(config?.mcp ?? {}))

export const claude = (text: string | null | undefined, dir: string | undefined) => {
  if (!text || !dir) return new Set<string>()
  try {
    const data = JSON.parse(text) as {
      projects?: Record<string, { mcpServers?: Record<string, unknown> }>
    }
    return new Set(Object.keys(data.projects?.[dir]?.mcpServers ?? {}))
  } catch {
    return new Set<string>()
  }
}

export const source = (input: {
  name: string
  config: Config["mcp"] | undefined
  global: Config["mcp"] | undefined
  project: Config | undefined
  projectDir: Config | undefined
  claude: Set<string>
  omo: boolean
  group: string | undefined
}) => {
  const next = input.config?.[input.name]
  const prev = input.global?.[input.name]
  const local = keys(input.project).has(input.name) || keys(input.projectDir).has(input.name) || input.claude.has(input.name)
  if (local) return input.group
  if (prev && same(next, prev)) return "global"
  if (input.omo && !prev) return "oh-my-openagent"
  if (next) return input.group
  if (prev) return "global"
  return undefined
}

export const mcp = (
  name: string,
  status: McpStatus | undefined,
  config: Config["mcp"] | undefined,
  global: Config["mcp"] | undefined,
  project: Config | undefined,
  projectDir: Config | undefined,
  claudeProject: Set<string>,
  omo: boolean,
  group: string | undefined,
) => {
  const next = source({ name, config, global, project, projectDir, claude: claudeProject, omo, group })
  return {
    name,
    project: next && next !== name ? next : undefined,
    status,
  }
}
