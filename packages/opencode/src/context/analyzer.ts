import { Glob } from "@opencode-ai/core/util/glob"
import { minimatch } from "minimatch"
import fuzzysort from "fuzzysort"
import path from "path"
import { readFile } from "fs/promises"
import { statSync } from "fs"
import ts from "typescript"

export interface ContextSuggestion {
  filePath: string
  score: number
  reason: string
}

const CONFIG_PATTERNS = ["package.json", "tsconfig.json", "tsconfig.*.json", ".env*", "*.config.*", "docker-compose*"]
const TEST_FILE_RE = /\.(test|spec)\.[^/]+$/
const TEST_DIR_RE = /\/[(_]tests?[)_]\/|__tests__\//

function isTestPath(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath) || TEST_DIR_RE.test(filePath)
}

function isConfigPath(filePath: string): boolean {
  const base = path.basename(filePath)
  for (const pat of CONFIG_PATTERNS) {
    if (minimatch(base, pat, { dot: true })) return true
  }
  return false
}

function rel(absPath: string, root: string): string {
  return path.relative(root, absPath).replace(/\\/g, "/")
}

async function readImports(filePath: string): Promise<string[]> {
  try {
    const content = await readFile(filePath, "utf-8")
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)
    const imports: string[] = []
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text
        if (spec.startsWith(".") || spec.startsWith("/")) imports.push(spec)
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
        for (const arg of node.arguments) {
          if (ts.isStringLiteral(arg) && (arg.text.startsWith(".") || arg.text.startsWith("/"))) {
            imports.push(arg.text)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return imports
  } catch {
    return []
  }
}

function resolveLocal(spec: string, fromFile: string, root: string): string | undefined {
  const fromDir = path.dirname(fromFile)
  const resolved = path.resolve(fromDir, spec)
  if (!resolved.startsWith(root)) return undefined

  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"]
  for (const ext of exts) {
    try {
      const c = resolved + ext
      if (statSync(c).isFile()) return c
    } catch {}
  }
  return undefined
}

function globFiles(root: string): string[] {
  return Glob.scanSync("**/*.{ts,tsx,js,jsx,mjs,mts,cts,vue,svelte}", {
    cwd: root,
    absolute: true,
    dot: true,
    symlink: false,
  }).filter((f) => !f.includes("node_modules") && !f.includes("/.git/"))
}

export async function analyzeContext(
  query: string,
  root: string,
  maxFiles = 10,
  currentFile?: string,
  includeTests = true,
): Promise<ContextSuggestion[]> {
  const suggestions: ContextSuggestion[] = []
  const seen = new Set<string>()

  const push = (filePath: string, score: number, reason: string) => {
    if (!seen.has(filePath)) {
      seen.add(filePath)
      suggestions.push({ filePath, score, reason })
    }
  }

  if (currentFile) {
    const abs = path.resolve(root, currentFile)
    const direct = await readImports(abs)
    for (const spec of direct) {
      const resolved = resolveLocal(spec, abs, root)
      if (resolved) push(resolved, 10, "direct import")
    }
    const currentName = path.basename(currentFile, path.extname(currentFile))
    for (const d of direct) {
      const resolved = resolveLocal(d, abs, root)
      if (resolved) {
        const indirect = await readImports(resolved)
        for (const ispec of indirect) {
          const ir = resolveLocal(ispec, resolved, root)
          if (ir && ir !== abs) push(ir, 5, "indirect import")
        }
      }
    }

    if (includeTests) {
      const dir = path.dirname(currentFile)
      const testGlobs = [
        `**/${dir}/**/${currentName}.test.*`,
        `**/${dir}/**/${currentName}.spec.*`,
        `test/${currentName}.test.*`,
      ]
      for (const tg of testGlobs) {
        for (const m of Glob.scanSync(tg, { cwd: root, absolute: true, dot: true })) {
          push(m, 4, "test file for current module")
        }
      }
    }
  }

  const ql = query.toLowerCase()
  const tokens = ql.split(/[\s,;]+/).filter((t) => t.length > 2)

  if (tokens.some((t) => t === "config" || t === "setting" || t === "setup")) {
    for (const cf of Glob.scanSync(`{${CONFIG_PATTERNS.join(",")}}`, { cwd: root, absolute: true, dot: true })) {
      if (!cf.includes("node_modules") && !cf.includes("/.git/")) push(cf, 3, "configuration file")
    }
  }

  const allFiles = globFiles(root)
  for (const f of allFiles) {
    if (seen.has(f)) continue
    const rp = rel(f, root)
    const fn = path.basename(f)
    const fnStem = path.basename(f, path.extname(f))

    if (tokens.some((t) => fnStem.toLowerCase() === t || rp === t)) {
      push(f, 8, "name matches query")
    } else if (fuzzysort.single(query, fn) !== null && fuzzysort.single(query, fn)!.score > -1000) {
      push(f, 6, "fuzzy match")
    } else if (tokens.some((t) => rp.includes(t) || fn.toLowerCase().includes(t))) {
      push(f, 6, "fuzzy match")
    }
  }

  suggestions.sort((a, b) => b.score - a.score)
  return suggestions.slice(0, maxFiles).map((s) => ({ ...s, filePath: rel(s.filePath.startsWith(root) ? s.filePath : path.resolve(root, s.filePath), root) }))
}

export * as ContextAnalyzer from "./analyzer"
