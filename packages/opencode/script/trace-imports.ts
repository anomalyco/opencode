#!/usr/bin/env bun
import * as path from "path"
import * as ts from "typescript"

const BASE_DIR = "/home/thdxr/dev/projects/anomalyco/opencode/packages/opencode"

// Get entry file from command line arg or use default
const ENTRY_FILE = process.argv[2] || "src/cli/cmd/tui/plugin/index.ts"

const visited = new Set<string>()

function resolveImport(importPath: string, fromFile: string): string | null {
  if (importPath.startsWith("@/")) {
    return path.join(BASE_DIR, "src", importPath.slice(2))
  }

  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const dir = path.dirname(fromFile)
    return path.resolve(dir, importPath)
  }

  return null
}

function isInternalImport(importPath: string): boolean {
  return importPath.startsWith("@/") || importPath.startsWith("./") || importPath.startsWith("../")
}

async function tryExtensions(filePath: string): Promise<string | null> {
  const extensions = [".ts", ".tsx", ".js", ".jsx"]

  try {
    const file = Bun.file(filePath)
    const stat = await file.stat()

    if (stat?.isDirectory()) {
      for (const ext of extensions) {
        const indexPath = path.join(filePath, "index" + ext)
        const indexFile = Bun.file(indexPath)
        if (await indexFile.exists()) return indexPath
      }
      return null
    }

    // It's a file
    return filePath
  } catch {
    // Path doesn't exist, try adding extensions
    for (const ext of extensions) {
      const withExt = filePath + ext
      const extFile = Bun.file(withExt)
      if (await extFile.exists()) return withExt
    }
    return null
  }
}

function extractImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = []

  function visit(node: ts.Node) {
    // import x from "path" or import { x } from "path"
    if (ts.isImportDeclaration(node)) {
      // Skip type-only imports
      if (node.importClause?.isTypeOnly) return

      const moduleSpec = node.moduleSpecifier
      if (ts.isStringLiteral(moduleSpec)) {
        imports.push(moduleSpec.text)
      }
    }

    // export { x } from "path"
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text)
      }
    }

    // Dynamic import: import("path")
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteral(arg)) {
        imports.push(arg.text)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

async function traceFile(filePath: string, depth = 0): Promise<void> {
  const normalizedPath = path.relative(BASE_DIR, filePath)

  if (visited.has(filePath)) {
    return
  }

  // Only trace TypeScript/JavaScript files
  if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) {
    return
  }

  visited.add(filePath)
  console.log("\t".repeat(depth) + normalizedPath)

  let content: string
  try {
    content = await Bun.file(filePath).text()
  } catch {
    return
  }

  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)

  const imports = extractImports(sourceFile)
  const internalImports = imports.filter(isInternalImport)
  const externalImports = imports.filter((imp) => !isInternalImport(imp))

  // Print external imports
  for (const imp of externalImports) {
    console.log("\t".repeat(depth + 1) + `[ext] ${imp}`)
  }

  for (const imp of internalImports) {
    const resolved = resolveImport(imp, filePath)
    if (!resolved) continue

    const actualPath = await tryExtensions(resolved)
    if (!actualPath) continue

    await traceFile(actualPath, depth + 1)
  }
}

async function main() {
  const entryPath = path.join(BASE_DIR, ENTRY_FILE)

  // Check if file exists
  const file = Bun.file(entryPath)
  if (!(await file.exists())) {
    console.error(`File not found: ${ENTRY_FILE}`)
    console.error(`Resolved to: ${entryPath}`)
    process.exit(1)
  }

  await traceFile(entryPath)
}

main().catch(console.error)
