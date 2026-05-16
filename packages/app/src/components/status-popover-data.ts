import type { Config, McpStatus, Project } from "@opencode-ai/sdk/v2/client"
import { getFilename } from "@opencode-ai/util/path"
import { classifyPluginSource, classifySkillSource, localPath } from "@/utils/config-source"

const stem = (value: string) => value.replace(/\.(?:ts|js|mjs|cjs|mts|cts)$/i, "")

const file = localPath

const base = (value: string) => file(value).split(/[\\/]/).at(-1) ?? value
const norm = (value: string) => file(value).replace(/\\/g, "/").replace(/\/+$/, "")

const plug = (value: string) => {
  const next = file(value)
  if (value.startsWith("file://") || next !== value || value.includes("/") || value.includes("\\")) return stem(base(next))
  const at = value.lastIndexOf("@")
  if (at > 0) return value.slice(0, at)
  return value
}

export const item = (value: string, projects: Project[] = []) => {
  const name = plug(value)
  const source = classifyPluginSource(value, projects)
  return {
    name,
    project: source.project && source.project !== name ? source.project : undefined,
    value,
  }
}

export const skill = (value: { name: string; location: string }, list: Project[]) => {
  const source = classifySkillSource(value.location, list)
  return {
    name: value.name,
    scope: source.scope === "project" ? "project" : "global",
    source: source.project ?? (source.scope === "project" ? getFilename(source.root ?? "") : source.origin),
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
