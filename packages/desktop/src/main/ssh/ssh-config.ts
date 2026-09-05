import { readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

export type SshConfigIo = {
  readFile: (path: string) => string | null
  listDir: (path: string) => string[]
  home: () => string
}

const MAX_INCLUDE_DEPTH = 3

const defaultIo: SshConfigIo = {
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return null
    }
  },
  listDir: (path) => {
    try {
      return readdirSync(path)
    } catch {
      return []
    }
  },
  home: () => homedir(),
}

/**
 * Collects `Host` aliases from the user's ssh config so the add dialog can
 * suggest them. Wildcard/negated patterns are skipped — they are matching
 * rules, not connectable destinations. Follows `Include` directives a few
 * levels deep with basic `*` glob support.
 */
export function listSshConfigHosts(io: SshConfigIo = defaultIo) {
  const root = join(io.home(), ".ssh", "config")
  const hosts: string[] = []
  const seen = new Set<string>()
  const visited = new Set<string>()

  const visit = (path: string, depth: number) => {
    if (depth > MAX_INCLUDE_DEPTH || visited.has(path)) return
    visited.add(path)
    const content = io.readFile(path)
    if (content === null) return
    for (const entry of parseSshConfig(content)) {
      if (entry.kind === "host") {
        for (const host of entry.hosts) {
          if (seen.has(host)) continue
          seen.add(host)
          hosts.push(host)
        }
        continue
      }
      for (const pattern of entry.paths) {
        for (const resolved of resolveIncludePattern(pattern, dirname(path), io)) {
          visit(resolved, depth + 1)
        }
      }
    }
  }

  visit(root, 0)
  return hosts
}

type SshConfigEntry = { kind: "host"; hosts: string[] } | { kind: "include"; paths: string[] }

export function parseSshConfig(content: string): SshConfigEntry[] {
  const entries: SshConfigEntry[] = []
  for (const raw of content.split(/\r?\n/g)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^(\S+)\s*[=\s]\s*(.*)$/)
    if (!match) continue
    const keyword = match[1].toLowerCase()
    const values = tokenize(match[2])
    if (!values.length) continue
    if (keyword === "host") {
      const hosts = values.filter((value) => !/[*?!]/.test(value))
      if (hosts.length) entries.push({ kind: "host", hosts })
      continue
    }
    if (keyword === "include") entries.push({ kind: "include", paths: values })
  }
  return entries
}

function tokenize(value: string) {
  const tokens: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  for (let match = re.exec(value); match; match = re.exec(value)) {
    const token = match[1] ?? match[2]
    if (token) tokens.push(token)
  }
  return tokens
}

function resolveIncludePattern(pattern: string, baseDir: string, io: SshConfigIo) {
  const expanded = pattern.startsWith("~/") ? join(io.home(), pattern.slice(2)) : pattern
  // Relative include paths resolve against ~/.ssh per ssh_config(5).
  const absolute = isAbsolute(expanded) ? expanded : resolve(join(io.home(), ".ssh"), expanded)
  if (!absolute.includes("*")) return [absolute]
  const dir = dirname(absolute)
  const name = basename(absolute)
  if (dir.includes("*")) return []
  const re = new RegExp(`^${name.split("*").map(escapeRegExp).join(".*")}$`)
  return io
    .listDir(dir)
    .filter((file) => re.test(file))
    .sort()
    .map((file) => join(dir, file))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
