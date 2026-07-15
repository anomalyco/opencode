export * as ContextWarmup from "./warmup"

import { spawnSync } from "child_process"
import path from "path"
import { statSync, readFileSync } from "fs"

const IMPORT_RE = /(?:import\s+(?:[\w*{},]\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g

const readImports = (content: string): ReadonlyArray<string> => {
  const imports: string[] = []
  let match: RegExpExecArray | null
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const spec = match[1] ?? match[2]
    if (spec && (spec.startsWith(".") || spec.startsWith("/"))) imports.push(spec)
  }
  return imports
}

const resolveLocal = (spec: string, fromFile: string, root: string): string | undefined => {
  const fromDir = path.dirname(fromFile)
  const resolved = path.resolve(fromDir, spec)
  if (!resolved.startsWith(root)) return
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"]) {
    try { if (statSync(resolved + ext).isFile()) return resolved + ext } catch {}
  }
}

const runGitCochange = (root: string, targetName: string): Array<{ file: string; score: number }> => {
  try {
    const result = spawnSync("git", ["log", "--all", "--name-only", "--pretty=format:", "--diff-filter=AMRC", "--since=6 months", "--max-count=500"], { cwd: root, maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
    if (result.status !== 0) return []
    const lines = (result.stdout ?? "").toString().split("\n").filter(Boolean)
    const counts = new Map<string, number>()
    let filesInCommit: string[] = []
    for (const line of lines) {
      if (line.trim().length === 0) {
        if (filesInCommit.some((f) => path.basename(f) === targetName || f.endsWith(targetName))) {
          for (const f of filesInCommit) {
            if (f !== targetName && !path.basename(f).startsWith(targetName.replace(/\.[^.]+$/, ""))) {
              counts.set(f, (counts.get(f) ?? 0) + 1)
            }
          }
        }
        filesInCommit = []
      } else {
        filesInCommit.push(line.trim())
      }
    }
    return [...counts.entries()]
      .map(([file, count]) => ({ file, score: count }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
  } catch { return [] }
}

export interface Prediction {
  readonly filePath: string
  readonly score: number
  readonly reason: string
}

export const predictWarmFiles = (
  currentFile: string | undefined,
  root: string,
  recentFiles: ReadonlyArray<string>,
  maxPredictions = 10,
): Prediction[] => {
  const seen = new Set<string>()
  const predictions: Prediction[] = []

  const push = (filePath: string, score: number, reason: string) => {
    const rp = path.relative(root, filePath).replace(/\\/g, "/")
    if (!seen.has(rp)) { seen.add(rp); predictions.push({ filePath: rp, score, reason }) }
  }

  const abs = (f: string) => path.isAbsolute(f) ? f : path.resolve(root, f)

  for (const rf of recentFiles) {
    const rfAbs = abs(rf)
    if (rfAbs !== abs(currentFile ?? "")) push(rfAbs, 7, "recently referenced")
  }

  if (currentFile) {
    const absFile = abs(currentFile)
    let content = ""
    try { content = readFileSync(absFile, "utf-8") } catch {}

    if (content) {
      const imports = readImports(content)
      for (const spec of imports) {
        const resolved = resolveLocal(spec, absFile, root)
        if (resolved) push(resolved, 6, "direct import")
      }
      for (const spec of imports) {
        const resolved = resolveLocal(spec, absFile, root)
        if (resolved) {
          try {
            const nestContent = readFileSync(resolved, "utf-8")
            const nestImports = readImports(nestContent)
            for (const ns of nestImports) {
              const nr = resolveLocal(ns, resolved, root)
              if (nr && nr !== absFile) push(nr, 5, "indirect import")
            }
          } catch {}
        }
      }
    }

    const cochanges = runGitCochange(root, path.basename(absFile))
    for (const cc of cochanges) push(abs(cc.file), Math.min(3 + cc.score * 2, 8), "frequently co-changed in git")
  }

  predictions.sort((a, b) => b.score - a.score)
  return predictions.slice(0, maxPredictions)
}
