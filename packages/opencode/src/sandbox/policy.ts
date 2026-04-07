import path from "path"

export namespace SandboxPolicy {
  export type Mode = "workspace-write" | "read-only"

  export interface Input {
    cwd: string
    project_root: string
    worktree_root: string
    home: string
    mode?: Mode
    protected_roots?: string[]
    extra_read_roots?: string[]
    extra_write_roots?: string[]
    extra_deny_paths?: string[]
    opencode_roots?: string[]
    allow_network?: boolean
  }

  export interface Output {
    profile: string
    read: string[]
    write: string[]
    deny: string[]
  }

  const read = [
    "/bin",
    "/sbin",
    "/usr",
    "/opt/homebrew",
    "/System",
    "/Library",
    "/dev",
    "/tmp",
    "/private/tmp",
    "/private/etc",
  ]
  const temp = ["/tmp", "/private/tmp"]
  const secret = [".ssh", ".gnupg", ".aws", ".azure", path.join(".config", "gcloud"), ".netrc", ".npmrc"]

  function uniq(input: string[]) {
    return [...new Set(input.filter(Boolean))].toSorted((a, b) => a.localeCompare(b))
  }

  function quote(input: string) {
    return input.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
  }

  function allow(action: string, roots: string[]) {
    if (roots.length === 0) return []
    return [`(allow ${action}`, ...roots.map((item) => `  (subpath "${quote(item)}")`), ")"]
  }

  function deny(roots: string[]) {
    return roots.flatMap((item) => [
      `(deny file-read* (subpath "${quote(item)}"))`,
      `(deny file-write* (subpath "${quote(item)}"))`,
    ])
  }

  function denyWrite(roots: string[]) {
    return roots.map((item) => `(deny file-write* (subpath "${quote(item)}"))`)
  }

  export function build(input: Input): Output {
    const denyRoots = uniq([
      ...secret.map((item) => path.join(input.home, item)),
      ...(input.opencode_roots ?? []),
      ...(input.extra_deny_paths ?? []),
    ])
    const protectedRoots = uniq(input.protected_roots ?? [])
    const readRoots = uniq([
      input.cwd,
      input.project_root,
      input.worktree_root,
      ...read,
      ...(input.extra_read_roots ?? []),
    ])
    const writeRoots =
      input.mode === "read-only"
        ? uniq([...temp, ...(input.extra_write_roots ?? [])])
        : uniq([input.cwd, input.project_root, input.worktree_root, ...(input.extra_write_roots ?? [])])
    const profile = [
      "(version 1)",
      "(deny default)",
      '(import "system.sb")',
      "(allow process-exec)",
      "(allow process-fork)",
      "(allow signal (target same-sandbox))",
      "(allow process-info* (target same-sandbox))",
      '(allow file-write-data (require-all (path "/dev/null") (vnode-type CHARACTER-DEVICE)))',
      ...allow("file-read*", readRoots),
      ...allow("file-write*", writeRoots),
      ...deny(denyRoots),
      ...denyWrite(protectedRoots),
      ...(input.allow_network ? ["(allow network*)"] : []),
    ].join("\n")
    return {
      profile,
      read: readRoots,
      write: writeRoots,
      deny: denyRoots,
    }
  }
}
