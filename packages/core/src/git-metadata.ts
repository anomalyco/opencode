export * as GitMetadata from "./git-metadata.js"

import fs from "fs/promises"
import os from "os"
import path from "path"

/**
 * Reads repository metadata (discovery, config, HEAD and refs) from `.git` files without starting Git.
 * Every reader returns `undefined` for a layout it does not model exactly, such as reftable refs,
 * `core.worktree`, `hasconfig:` includes or `GIT_DIR` overrides, and callers then ask Git itself.
 */

export interface Layout {
  readonly worktree: string
  readonly gitDirectory: string
  readonly commonDirectory: string
}

export interface Entry {
  readonly section: string
  readonly subsection?: string
  readonly key: string
  /** Undefined for a bare key, which Git reads as boolean true. */
  readonly value?: string
}

export interface ConfigFiles {
  /** Undefined when GIT_CONFIG_NOSYSTEM disables the system file. */
  readonly system?: string
  readonly global: readonly string[]
}

export interface Repository {
  readonly layout: Layout
  readonly config: readonly Entry[]
  readonly head: Head
}

export type Head = { readonly ref: string } | { readonly oid: string }

// Each changes what Git reads, so in-process answers would no longer match it.
const overrides = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_NAMESPACE",
]

const extensions = new Set([
  "noop",
  "noop-v1",
  "preciousobjects",
  "partialclone",
  "worktreeconfig",
  "objectformat",
  "compatobjectformat",
  "refstorage",
])

// Windows paths, ownership checks and config locations are not modelled; Git answers there.
export function supported() {
  return process.platform !== "win32" && overrides.every((name) => process.env[name] === undefined)
}

/** Config file paths from `git var -l`, which knows the build's system path and the global fallbacks. */
export function parseConfigFiles(output: string): ConfigFiles | undefined {
  const lines = output.split("\n")
  const global = lines.filter((line) => line.startsWith("GIT_CONFIG_GLOBAL=")).map((line) => line.slice(18))
  // Git before 2.42 does not report config paths.
  if (!global.length) return undefined
  // `git var` still names the system file when GIT_CONFIG_NOSYSTEM disables it.
  const system = bool(process.env.GIT_CONFIG_NOSYSTEM)
    ? undefined
    : lines.findLast((line) => line.startsWith("GIT_CONFIG_SYSTEM="))?.slice(18)
  return { system: system || undefined, global }
}

/** Mirrors `git rev-parse --git-dir --git-common-dir --show-toplevel` run beside `dotGit`. */
export async function discover(dotGit: string): Promise<Layout | undefined> {
  if (!supported()) return undefined
  const cwd = path.dirname(dotGit)
  const info = await fs.stat(dotGit).catch(() => undefined)
  if (!info) return undefined
  const gitDirectory = info.isDirectory() ? dotGit : await gitFile(dotGit)
  if (!gitDirectory) return undefined
  const commondir = await text(path.join(gitDirectory, "commondir"))
  // Only linked worktrees carry `commondir`; Git also honours it elsewhere, which is not modelled.
  if (commondir !== undefined && info.isDirectory()) return undefined
  const commonDirectory = commondir
    ? await fs.realpath(path.resolve(gitDirectory, commondir.trim())).catch(() => undefined)
    : gitDirectory
  if (!commonDirectory) return undefined
  const head = await valid(gitDirectory, commonDirectory)
  if (!head) return undefined
  if (!(await owned([cwd, gitDirectory]))) return undefined
  const context = { layout: { worktree: cwd, gitDirectory, commonDirectory }, head, depth: 0 }
  const common = await layoutConfig(path.join(commonDirectory, "config"), context)
  if (!common || !repositoryFormat(common)) return undefined
  const perWorktreeConfig = bool(get(common, "extensions", "worktreeconfig"))
    ? await layoutConfig(path.join(gitDirectory, "config.worktree"), context)
    : []
  if (!perWorktreeConfig) return undefined
  const config = [...common, ...perWorktreeConfig]
  const bare = get(config, "core", "bare")
  if (bare !== undefined && bool(bare) !== false) return undefined
  const worktree = await fs.realpath(cwd).catch(() => undefined)
  if (!worktree) return undefined
  // Submodules name their own checkout in `core.worktree`; any other work tree changes what Git reports.
  const configured = get(config, "core", "worktree")
  if (configured === undefined) return { worktree, gitDirectory, commonDirectory }
  const target = await fs.realpath(path.resolve(gitDirectory, configured)).catch(() => undefined)
  return target === worktree ? { worktree, gitDirectory, commonDirectory } : undefined
}

/** Loads config in Git's order (system, global, local, worktree), following includes. */
export async function open(layout: Layout, files: ConfigFiles): Promise<Repository | undefined> {
  if (!supported()) return undefined
  const head = await readHead(layout.gitDirectory)
  if (!head || (await legacyRemotes(layout))) return undefined
  const local = await load(path.join(layout.commonDirectory, "config"), { layout, head, depth: 0 })
  if (!local || !repositoryFormat(local)) return undefined
  if ((get(local, "extensions", "refstorage") ?? "files").toLowerCase() !== "files") return undefined
  const worktreeConfig = bool(get(local, "extensions", "worktreeconfig"))
  const sources = [
    ...(files.system ? [files.system] : []),
    ...files.global,
    undefined,
    ...(worktreeConfig ? [path.join(layout.gitDirectory, "config.worktree")] : []),
  ]
  const loaded = await Promise.all(
    sources.map((file) => (file === undefined ? local : load(file, { layout, head, depth: 0 }))),
  )
  if (loaded.some((entries) => entries === undefined)) return undefined
  return { layout, config: loaded.flatMap((entries) => entries ?? []), head }
}

/** The last value of a single-valued key, like `git config <key>`. */
export function get(config: readonly Entry[], section: string, key: string, subsection?: string) {
  return (
    config.findLast((entry) => entry.section === section && entry.key === key && entry.subsection === subsection)
      ?.value ?? (has(config, section, key, subsection) ? "true" : undefined)
  )
}

export function all(config: readonly Entry[], section: string, key: string, subsection?: string) {
  return config
    .filter((entry) => entry.section === section && entry.key === key && entry.subsection === subsection)
    .map((entry) => entry.value ?? "true")
}

function has(config: readonly Entry[], section: string, key: string, subsection?: string) {
  return config.some((entry) => entry.section === section && entry.key === key && entry.subsection === subsection)
}

export function bool(value: string | undefined) {
  if (value === undefined) return undefined
  const normalized = value.toLowerCase()
  if (["true", "yes", "on", "1"].includes(normalized)) return true
  if (["false", "no", "off", "0", ""].includes(normalized)) return false
  if (/^-?\d+$/.test(normalized)) return Number(normalized) !== 0
  return undefined
}

/** The excludes file Git reads: `core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore`. */
export function excludesFile(repository: Repository) {
  const configured = get(repository.config, "core", "excludesfile")
  if (configured !== undefined)
    return configured ? path.resolve(repository.layout.worktree, expandHome(configured)) : undefined
  const home = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || os.homedir(), ".config")
  return path.join(home, "git", "ignore")
}

/** Remote names as `git remote` lists them. */
export function remotes(repository: Repository) {
  return [
    ...new Set(
      repository.config.flatMap((entry) =>
        entry.section === "remote" && entry.subsection !== undefined ? [entry.subsection] : [],
      ),
    ),
  ].toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
}

/** Like `git remote get-url <name>`: undefined when the remote doesn't exist. */
export function remoteUrl(repository: Repository, name: string) {
  if (!remotes(repository).includes(name)) return undefined
  const url = all(repository.config, "remote", "url", name)[0] ?? name
  const rewrite = repository.config
    .filter((entry) => entry.section === "url" && entry.key === "insteadof" && entry.subsection !== undefined)
    .filter((entry) => entry.value !== undefined && url.startsWith(entry.value))
    .reduce<Entry | undefined>(
      (best, entry) => (best && best.value!.length >= entry.value!.length ? best : entry),
      undefined,
    )
  return rewrite ? rewrite.subsection + url.slice(rewrite.value!.length) : url
}

export async function readHead(gitDirectory: string): Promise<Head | undefined> {
  const content = (await text(path.join(gitDirectory, "HEAD")))?.trim()
  if (!content) return undefined
  if (content.startsWith("ref:")) {
    const ref = content.slice(4).trim()
    return ref.startsWith("refs/") && validRef(ref) ? { ref } : undefined
  }
  return isObjectID(content) ? { oid: content } : undefined
}

/** Raw value of one ref, loose then packed: `ref: <target>` for a symbolic ref, or an object ID. */
export async function readRef(layout: Layout, name: string) {
  // Git only reads top-level refs such as HEAD or FETCH_HEAD, never `.git/main`.
  if (!validRef(name) || (!name.includes("/") && !/^[A-Z_]+$/.test(name))) return undefined
  const loose = (await text(path.join(perWorktree(name) ? layout.gitDirectory : layout.commonDirectory, name)))?.trim()
  if (loose !== undefined) return loose.startsWith("ref:") || isObjectID(loose) ? loose : undefined
  if (perWorktree(name)) return undefined
  return (await packedRefs(layout.commonDirectory)).get(name)
}

/** Like Git's `ref_exists`: the ref resolves to an object ID. */
export async function refExists(layout: Layout, name: string) {
  return (await resolveRef(layout, name)) !== undefined
}

/** Object ID a ref resolves to, following symbolic refs. */
export async function resolveRef(layout: Layout, name: string, depth = 0): Promise<string | undefined> {
  if (depth > 5) return undefined
  const value = await readRef(layout, name)
  if (!value) return undefined
  if (!value.startsWith("ref:")) return value
  return resolveRef(layout, value.slice(4).trim(), depth + 1)
}

// `refs_shorten_unambiguous_ref` rules, most specific last.
const shortRules = ["%s", "refs/%s", "refs/tags/%s", "refs/heads/%s", "refs/remotes/%s", "refs/remotes/%s/HEAD"]

/** Like `refs_shorten_unambiguous_ref`: the shortest name no other rule resolves differently. */
export async function shorten(repository: Repository, refname: string, strict: boolean) {
  for (let index = shortRules.length - 1; index > 0; index--) {
    const [prefix, suffix] = shortRules[index]!.split("%s") as [string, string]
    if (!refname.startsWith(prefix) || !refname.endsWith(suffix)) continue
    const short = refname.slice(prefix.length, refname.length - suffix.length)
    if (!short) continue
    const rivals = shortRules.filter((_, rule) => rule !== index && (strict || rule < index))
    const ambiguous = await Promise.all(rivals.map((rule) => refExists(repository.layout, rule.replace("%s", short))))
    if (!ambiguous.some(Boolean)) return short
  }
  return refname
}

/** Mirrors `git for-each-ref --format=%(refname:short) refs/heads` containing `name`. */
export async function hasBranch(repository: Repository, name: string) {
  const strict = bool(get(repository.config, "core", "warnambiguousrefs")) ?? true
  // An ambiguous branch is listed as `heads/<name>` or `refs/heads/<name>`.
  const refs = [
    `refs/heads/${name}`,
    ...(name.startsWith("heads/") ? [`refs/${name}`] : []),
    ...(name.startsWith("refs/heads/") ? [name] : []),
  ]
  const matches = await Promise.all(
    refs.map(
      async (ref) => (await refExists(repository.layout, ref)) && (await shorten(repository, ref, strict)) === name,
    ),
  )
  return matches.some(Boolean)
}

/** Like `git symbolic-ref --quiet --short HEAD`: undefined when HEAD is detached. */
export async function branch(repository: Repository) {
  if (!("ref" in repository.head)) return undefined
  return (await shorten(repository, repository.head.ref, false)) || undefined
}

/** Like `git symbolic-ref <name>`: the target, or undefined when the ref is missing or not symbolic. */
export async function symbolicRef(layout: Layout, name: string) {
  const value = await readRef(layout, name)
  return value?.startsWith("ref:") ? value.slice(4).trim() : undefined
}

export function parseConfig(input: string): Entry[] | undefined {
  const source = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  const entries: Entry[] = []
  let section: string | undefined
  let subsection: string | undefined
  let index = 0
  while (index < source.length) {
    const char = source[index]!
    if (char === "\n" || char === " " || char === "\t") {
      index++
      continue
    }
    if (char === "#" || char === ";") {
      index = lineEnd(source, index)
      continue
    }
    if (char === "[") {
      const header = parseHeader(source, index + 1)
      if (!header) return undefined
      section = header.section
      subsection = header.subsection
      index = header.end
      continue
    }
    if (!/[A-Za-z]/.test(char) || section === undefined) return undefined
    let end = index
    while (end < source.length && /[A-Za-z0-9-]/.test(source[end]!)) end++
    const key = source.slice(index, end).toLowerCase()
    while (source[end] === " " || source[end] === "\t") end++
    if (end >= source.length || source[end] === "\n") {
      entries.push({ section, subsection, key })
      index = end
      continue
    }
    if (source[end] !== "=") return undefined
    const value = parseValue(source, end + 1)
    if (!value) return undefined
    entries.push({ section, subsection, key, value: value.value })
    index = value.end
  }
  return entries
}

function parseHeader(source: string, start: number) {
  let index = start
  while (index < source.length && /[A-Za-z0-9.-]/.test(source[index]!)) index++
  const name = source.slice(start, index)
  if (!name) return undefined
  if (source[index] === "]") {
    const dot = name.indexOf(".")
    // `[section.subsection]` is the deprecated, case-insensitive spelling.
    if (dot === -1) return { section: name.toLowerCase(), subsection: undefined, end: index + 1 }
    return { section: name.slice(0, dot).toLowerCase(), subsection: name.slice(dot + 1).toLowerCase(), end: index + 1 }
  }
  if (name.includes(".")) return undefined
  while (source[index] === " " || source[index] === "\t") index++
  if (source[index] !== '"') return undefined
  index++
  let subsection = ""
  while (index < source.length && source[index] !== '"') {
    if (source[index] === "\n") return undefined
    if (source[index] === "\\") index++
    if (index >= source.length || source[index] === "\n") return undefined
    subsection += source[index]
    index++
  }
  if (source[index] !== '"' || source[index + 1] !== "]") return undefined
  return { section: name.toLowerCase(), subsection, end: index + 2 }
}

// Follows config.c's parse_value: quotes toggle, comments end the value, inner whitespace survives.
function parseValue(source: string, start: number) {
  let index = start
  let value = ""
  let quoted = false
  let comment = false
  let spaces = 0
  while (true) {
    if (index >= source.length || source[index] === "\n") {
      if (quoted) return undefined
      return { value, end: index }
    }
    const char = source[index++]!
    if (comment) continue
    if ((char === " " || char === "\t") && !quoted) {
      if (value.length) spaces++
      continue
    }
    if (!quoted && (char === "#" || char === ";")) {
      comment = true
      continue
    }
    value += " ".repeat(spaces)
    spaces = 0
    if (char === "\\") {
      const next = source[index++]
      if (next === "\n") continue
      const escaped = next === "t" ? "\t" : next === "b" ? "\b" : next === "n" ? "\n" : next
      if (escaped !== "\\" && escaped !== '"' && escaped !== "\t" && escaped !== "\b" && escaped !== "\n")
        return undefined
      value += escaped
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    value += char
  }
}

async function load(
  file: string,
  context: { layout: Layout; head: Head; depth: number },
): Promise<Entry[] | undefined> {
  const content = await text(file)
  if (content === undefined) return []
  const entries = parseConfig(content)
  if (!entries) return undefined
  const expanded = await Promise.all(
    entries.map(async (entry) => {
      const include = entry.key === "path" ? await included(entry, file, context) : false
      if (include === undefined) return undefined
      if (!include) return [entry]
      if (context.depth >= 10) return undefined
      const nested = await load(include, { ...context, depth: context.depth + 1 })
      return nested ? [entry, ...nested] : undefined
    }),
  )
  if (expanded.some((entry) => entry === undefined)) return undefined
  return expanded.flatMap((entry) => entry ?? [])
}

/**
 * Config that decides the layout. Git reads the repository format without includes but later settings
 * with them, so a layout key that only an include sets is left to Git.
 */
async function layoutConfig(file: string, context: { layout: Layout; head: Head; depth: number }) {
  const [direct, loaded] = await Promise.all([
    text(file).then((content) => parseConfig(content ?? "")),
    load(file, context),
  ])
  if (!direct || !loaded) return undefined
  return layoutKeys(loaded) === layoutKeys(direct) ? loaded : undefined
}

function layoutKeys(config: readonly Entry[]) {
  return config.filter(
    (entry) =>
      entry.section === "extensions" ||
      (entry.section === "core" && ["bare", "worktree", "repositoryformatversion"].includes(entry.key)),
  ).length
}

/** Path of the file an include entry pulls in, false when it doesn't apply, undefined when unsupported. */
async function included(entry: Entry, file: string, context: { layout: Layout; head: Head }) {
  if (entry.value === undefined) return entry.section === "include" || entry.section === "includeif" ? undefined : false
  const target = expandHome(entry.value)
  const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(file), target)
  if (entry.section === "include" && entry.subsection === undefined) return resolved
  if (entry.section !== "includeif" || entry.subsection === undefined) return false
  const condition = entry.subsection
  if (condition.startsWith("gitdir:") || condition.startsWith("gitdir/i:")) {
    const caseless = condition.startsWith("gitdir/i:")
    const pattern = gitdirPattern(condition.slice(caseless ? 9 : 7), file)
    const candidates = [
      await fs.realpath(context.layout.gitDirectory).catch(() => context.layout.gitDirectory),
      path.resolve(context.layout.gitDirectory),
    ]
    const matches = candidates.map((candidate) => wildmatch(pattern, slashes(candidate), caseless))
    if (matches.includes(undefined)) return undefined
    return matches.includes(true) ? resolved : false
  }
  if (condition.startsWith("onbranch:")) {
    if (!("ref" in context.head) || !context.head.ref.startsWith("refs/heads/")) return false
    const pattern = condition.slice(9)
    const branch = context.head.ref.slice("refs/heads/".length)
    const matched = wildmatch(pattern.endsWith("/") ? pattern + "**" : pattern, branch, false)
    if (matched === undefined) return undefined
    return matched ? resolved : false
  }
  // `hasconfig:` depends on the whole config; unknown conditions never match in Git.
  if (condition.startsWith("hasconfig:")) return undefined
  return false
}

function gitdirPattern(input: string, file: string) {
  const expanded = input.startsWith("./") ? slashes(path.dirname(file)) + input.slice(1) : expandHome(input)
  const absolute = slashes(expanded)
  const anchored = absolute.startsWith("/") || /^[A-Za-z]:\//.test(absolute) ? absolute : "**/" + absolute
  return anchored.endsWith("/") ? anchored + "**" : anchored
}

/**
 * Wildmatch with WM_PATHNAME: `*` stays within a segment, `**` crosses them.
 * Undefined for a pattern it doesn't model, so the caller can leave it to Git.
 */
export function wildmatch(pattern: string, value: string, caseless: boolean): boolean | undefined {
  let regex = ""
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!
    if (char === "*" && pattern[index + 1] === "*") {
      const leading = index === 0 || pattern[index - 1] === "/"
      index++
      if (leading && pattern[index + 1] === "/") {
        regex += "(?:.*/)?"
        index++
      } else regex += ".*"
      continue
    }
    if (char === "*") regex += "[^/]*"
    else if (char === "?") regex += "[^/]"
    else if (char === "[") {
      const negated = pattern[index + 1] === "!" || pattern[index + 1] === "^"
      // A `]` right after the opening bracket (and any negation) is a member, not the end.
      const close = pattern.indexOf("]", index + (negated ? 3 : 2))
      // Git matches nothing for an unterminated class; escapes and POSIX classes are left to it.
      if (close === -1) return undefined
      const body = pattern.slice(index + (negated ? 2 : 1), close)
      if (body.includes("\\") || body.includes("[:")) return undefined
      // Under WM_PATHNAME no class matches `/`.
      regex += `(?!/)[${negated ? "^" : ""}${body.replace(/[[\]]/g, "\\$&")}]`
      index = close
    } else if (char === "\\" && index + 1 < pattern.length) {
      regex += escapeRegex(pattern[++index]!)
    } else regex += escapeRegex(char)
  }
  // A range such as `[z-a]` is invalid as a regular expression.
  try {
    return new RegExp(`^${regex}$`, caseless ? "i" : "").test(value)
  } catch {
    return undefined
  }
}

function escapeRegex(char: string) {
  return char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
}

function expandHome(value: string) {
  return value.startsWith("~/") ? path.join(process.env.HOME || os.homedir(), value.slice(2)) : value
}

function slashes(value: string) {
  return value.replaceAll("\\", "/")
}

function repositoryFormat(config: readonly Entry[]) {
  const version = Number(get(config, "core", "repositoryformatversion") ?? "0")
  if (!Number.isInteger(version) || version > 1) return false
  return config.every((entry) => entry.section !== "extensions" || extensions.has(entry.key))
}

async function gitFile(dotGit: string) {
  const content = await text(dotGit)
  const match = content?.match(/^gitdir: (.+?)\r?\n?$/m)
  if (!match?.[1]) return undefined
  // Git resolves `..` physically, so start from the real directory holding the `.git` file.
  const directory = await fs.realpath(path.dirname(dotGit)).catch(() => undefined)
  if (!directory) return undefined
  return fs.realpath(path.resolve(directory, match[1])).catch(() => undefined)
}

// Git's is_git_directory: a valid HEAD plus objects and refs in the common directory.
async function valid(gitDirectory: string, commonDirectory: string) {
  const [head, objects, refs] = await Promise.all([
    readHead(gitDirectory),
    fs.stat(path.join(commonDirectory, "objects")).catch(() => undefined),
    fs.stat(path.join(commonDirectory, "refs")).catch(() => undefined),
  ])
  return objects?.isDirectory() && refs?.isDirectory() ? head : undefined
}

// Git refuses repositories owned by someone else unless safe.directory allows them; leave that to Git.
async function owned(paths: readonly string[]) {
  const uid = process.getuid?.()
  if (uid === undefined) return false
  const stats = await Promise.all(paths.map((item) => fs.stat(item).catch(() => undefined)))
  return stats.every((info) => info?.uid === uid)
}

async function legacyRemotes(layout: Layout) {
  const listed = await Promise.all(
    ["remotes", "branches"].map((directory) =>
      fs.readdir(path.join(layout.commonDirectory, directory)).catch(() => [] as string[]),
    ),
  )
  return listed.some((entries) => entries.length > 0)
}

async function packedRefs(commonDirectory: string) {
  const content = (await text(path.join(commonDirectory, "packed-refs"))) ?? ""
  return new Map(
    content.split("\n").flatMap((line) => {
      if (!line || line.startsWith("#") || line.startsWith("^")) return []
      const space = line.indexOf(" ")
      const oid = line.slice(0, space)
      return space > 0 && isObjectID(oid) ? [[line.slice(space + 1).trimEnd(), oid] as const] : []
    }),
  )
}

function perWorktree(name: string) {
  return (
    !name.includes("/") ||
    name.startsWith("refs/bisect/") ||
    name.startsWith("refs/worktree/") ||
    name.startsWith("refs/rewritten/")
  )
}

/** A subset of `git check-ref-format`: enough to keep a name inside the refs directories. */
export function validRef(name: string) {
  if (!name || name.startsWith("/") || name.endsWith("/") || name.endsWith(".") || name.includes("//")) return false
  if (name.includes("..") || name.includes("@{") || /[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false
  return name.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"))
}

function isObjectID(value: string) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
}

function lineEnd(source: string, index: number) {
  const end = source.indexOf("\n", index)
  return end === -1 ? source.length : end
}

async function text(file: string) {
  return fs.readFile(file, "utf8").catch(() => undefined)
}
