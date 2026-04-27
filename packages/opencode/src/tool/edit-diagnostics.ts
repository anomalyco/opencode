import { Effect } from "effect"
import { Instance } from "../project/instance"
import type { Diagnostic } from "../lsp/client"
import { Diagnostic as DiagnosticUtil } from "../lsp/lsp"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export function diffDiagnostics(pre: Diagnostic[], post: Diagnostic[]): Diagnostic[] {
  const key = (d: Diagnostic) =>
    `${d.severity}:${d.code ?? "none"}:${d.message}:${d.range.start.line}:${d.range.start.character}`
  const preSet = new Set(pre.map(key))
  return post.filter((d) => !preSet.has(key(d)))
}

export function reportDiagnostics(
  filePath: string,
  pre: Record<string, Diagnostic[]>,
  post: Record<string, Diagnostic[]>,
): string | undefined {
  const normalized = AppFileSystem.normalizePath(filePath)
  const preList = pre[normalized] ?? []
  const postList = post[normalized] ?? []
  const newErrors = diffDiagnostics(preList, postList)
  if (newErrors.length === 0) return undefined
  return DiagnosticUtil.report(filePath, newErrors)
}

let sessionGitHead: string | undefined

export function checkGitStaleness() {
  return Effect.gen(function* () {
    const current = yield* Effect.sync(() => {
      try {
        const proc = Bun.spawnSync(["git", "-C", Instance.worktree, "rev-parse", "HEAD"])
        if (proc.success) return new TextDecoder().decode(proc.stdout).trim()
      } catch {
        // not a git repo or git unavailable
      }
      return undefined
    })
    if (sessionGitHead && current && sessionGitHead !== current) {
      sessionGitHead = current
      return `Warning: git HEAD changed since last edit (now ${current.slice(0, 8)}). The file contents you are editing may be stale.`
    }
    sessionGitHead = current
    return undefined
  })
}
