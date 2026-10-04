import { Effect } from "effect"
import ts from "typescript"
import type { SkeletonResult, Strategy } from "../strategy"

export class TypeScriptStrategy implements Strategy {
  readonly name = "typescript"
  readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".d.ts"] as const

  prune(filepath: string, content: string): Effect.Effect<SkeletonResult> {
    return Effect.sync(() => {
      const sourceFile = ts.createSourceFile(filepath, content, ts.ScriptTarget.Latest, true)
      const cuts: { start: number; end: number }[] = []

      const walk = (node: ts.Node) => {
        if (
          (ts.isFunctionDeclaration(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isConstructorDeclaration(node) ||
            ts.isGetAccessor(node) ||
            ts.isSetAccessor(node)) &&
          node.body
        ) {
          cuts.push({ start: node.body.getStart(sourceFile), end: node.body.getEnd() })
        } else if (
          (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          node.body &&
          ts.isBlock(node.body)
        ) {
          cuts.push({ start: node.body.getStart(sourceFile), end: node.body.getEnd() })
        }

        ts.forEachChild(node, walk)
      }

      walk(sourceFile)

      if (cuts.length === 0) {
        const lines = content.split("\n").length
        return {
          content,
          pruned: false,
          originalLines: lines,
          skeletonLines: lines,
        }
      }

      // Filter out nested cuts contained entirely within an outer cut
      const nonOverlapping = cuts.filter(
        (cut, i) => !cuts.some((other, j) => i !== j && other.start <= cut.start && other.end >= cut.end),
      )

      // Sort descending so offset replacements do not invalidate earlier indices
      nonOverlapping.sort((a, b) => b.start - a.start)

      let result = content
      for (const cut of nonOverlapping) {
        result = result.slice(0, cut.start) + "{ /* body omitted */ }" + result.slice(cut.end)
      }

      const originalLines = content.split("\n").length
      const skeletonLines = result.split("\n").length

      return {
        content: result,
        pruned: true,
        originalLines,
        skeletonLines,
      }
    })
  }
}

export const typeScriptStrategy = new TypeScriptStrategy()
