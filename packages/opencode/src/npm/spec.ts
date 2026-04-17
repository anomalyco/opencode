import npa from "npm-package-arg"
import path from "path"

export type Spec =
  | { kind: "registry"; name: string; version: string }
  | { kind: "github"; owner: string; repo: string; ref?: string }
  | { kind: "git"; url: string }
  | { kind: "release"; owner: string; repo: string; tag: string; asset: string }
  | { kind: "file"; path: string }

const RELEASE_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^?#]+)$/

export function classify(spec: string): Spec {
  // 1. Release asset URL takes precedence over generic https/git parsing
  const rel = RELEASE_RE.exec(spec)
  if (rel) {
    const [, owner, repo, tag, asset] = rel
    return { kind: "release", owner, repo, tag, asset }
  }

  // 2. Local filesystem path → canonicalize to absolute
  if (isLocalPath(spec)) {
    const raw = spec.startsWith("file:") ? spec.slice("file:".length) : spec
    const expanded = raw.startsWith("~/") ? path.join(process.env.HOME ?? "", raw.slice(2)) : raw
    return { kind: "file", path: path.resolve(process.cwd(), expanded) }
  }

  // 3. Otherwise defer to npm-package-arg
  const parsed = npa(spec)
  switch (parsed.type) {
    case "range":
    case "version":
    case "tag": {
      // npa maps bare names to range "*"; normalize to "latest" for bare specs
      const hasVersion = spec.includes("@") && spec.lastIndexOf("@") > 0
      const version = hasVersion ? (parsed.fetchSpec ?? "latest") : "latest"
      return {
        kind: "registry",
        name: parsed.name ?? spec,
        version,
      }
    }
    case "git": {
      const host = parsed.hosted
      if (host?.type === "github") {
        // Prefer raw spec's #... portion because npa may strip ::path: from gitCommittish
        const hashIdx = spec.indexOf("#")
        const ref = hashIdx >= 0 ? spec.slice(hashIdx + 1) : (parsed.gitCommittish ?? undefined)
        return { kind: "github", owner: host.user, repo: host.project, ref }
      }
      return { kind: "git", url: spec }
    }
    default:
      throw new Error(`unsupported spec: ${spec} (npa type=${parsed.type})`)
  }
}

function isLocalPath(spec: string): boolean {
  if (spec.startsWith("file:")) return true
  if (spec.startsWith("/")) return true
  if (spec.startsWith("./")) return true
  if (spec.startsWith("../")) return true
  if (spec.startsWith("~/")) return true
  return false
}
