import path from "path"
import { fileURLToPath } from "url"
import { Global } from "@opencode-ai/core/global"

export type Reference = {
  host: string
  path: string
  segments: string[]
  owner?: string
  repo: string
  remote: string
  label: string
  protocol?: string
}

function normalize(input: string) {
  return input.trim().replace(/^git\+/, "").replace(/#.*$/, "").replace(/\/+$/, "")
}

function trimGitSuffix(input: string) {
  return input.replace(/\.git$/, "")
}

function parts(input: string) {
  return input
    .split("/")
    .map((item) => trimGitSuffix(item.trim()))
    .filter(Boolean)
}

function safeHost(input: string) {
  return Boolean(input) && !input.startsWith("-") && !/[\s/\\]/.test(input)
}

function safeSegment(input: string) {
  return input !== "." && input !== ".." && !input.includes(":") && !/[\s/\\]/.test(input)
}

function hostLike(input: string) {
  return input.includes(".") || input.includes(":") || input === "localhost"
}

function withSlash(input: string) {
  return input.endsWith("/") ? input : `${input}/`
}

function githubRemote(pathname: string) {
  const base = process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL
  if (!base) return `https://github.com/${pathname}.git`
  return new URL(`${pathname}.git`, withSlash(base)).href
}

function build(input: { host: string; segments: string[]; remote?: string; protocol?: string }) {
  const segments = input.segments.map(trimGitSuffix).filter(Boolean)
  if (!safeHost(input.host) || !segments.length || segments.some((segment) => !safeSegment(segment))) return null
  const pathname = segments.join("/")
  const repo = segments[segments.length - 1]
  const host = input.host.toLowerCase()
  return {
    host,
    path: pathname,
    segments,
    owner: segments.length === 2 ? segments[0] : undefined,
    repo,
    remote: input.remote ?? (host === "github.com" ? githubRemote(pathname) : `https://${host}/${pathname}.git`),
    label: host === "github.com" && segments.length === 2 ? pathname : `${host}/${pathname}`,
    protocol: input.protocol,
  } satisfies Reference
}

function buildFile(input: { url: URL; remote: string }) {
  const filePath = path.normalize(fileURLToPath(input.url))
  const segments = filePath.split(/[\\/]+/).filter(Boolean)
  if (!segments.length) return null
  return {
    host: "file",
    path: filePath,
    segments: segments.map((segment) => segment.replace(/:$/, "")),
    owner: undefined,
    repo: trimGitSuffix(segments[segments.length - 1]),
    remote: input.remote,
    label: filePath,
    protocol: "file:",
  } satisfies Reference
}

export function parseRepositoryReference(input: string) {
  const cleaned = normalize(input)
  if (!cleaned) return null

  const githubPrefixed = cleaned.match(/^github:([^/\s]+)\/([^/\s]+)$/)
  if (githubPrefixed) return build({ host: "github.com", segments: [githubPrefixed[1], githubPrefixed[2]] })

  if (!cleaned.includes("://")) {
    const scp = cleaned.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/)
    if (scp) return build({ host: scp[1], segments: parts(scp[2]), remote: cleaned })

    const direct = parts(cleaned)
    if (direct.length >= 2 && hostLike(direct[0])) {
      return build({ host: direct[0], segments: direct.slice(1) })
    }

    if (direct.length === 2) {
      return build({ host: "github.com", segments: direct })
    }
  }

  try {
    const url = new URL(cleaned)
    if (url.protocol === "file:") return buildFile({ url, remote: cleaned })
    const pathname = parts(url.pathname)
    const host = url.host
    return build({
      host,
      segments: pathname,
      remote: host === "github.com" ? githubRemote(pathname.join("/")) : cleaned,
      protocol: url.protocol,
    })
  } catch {
    return null
  }
}

export function parseGitHubRemote(input: string) {
  const cleaned = normalize(input)
  if (!cleaned.includes("://") && !cleaned.match(/^(?:[^@/\s]+@)?github\.com:/)) return null

  const parsed = parseRepositoryReference(cleaned)
  if (!parsed || parsed.host !== "github.com" || !parsed.owner || parsed.segments.length !== 2) return null
  return { owner: parsed.owner, repo: parsed.repo }
}

export function repositoryCachePath(input: Reference) {
  return path.join(Global.Path.repos, ...input.host.split(":"), ...input.segments)
}

export function sameRepositoryReference(left: Reference, right: Reference) {
  return left.host === right.host && left.path === right.path
}
