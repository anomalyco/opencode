import { Effect } from "effect"
import type { SkeletonResult, Strategy } from "../strategy"

export class PythonStrategy implements Strategy {
  readonly name = "python"
  readonly extensions = [".py", ".pyi"] as const

  prune(filepath: string, content: string): Effect.Effect<SkeletonResult> {
    return Effect.sync(() => {
      const lines = content.split("\n")
      const outputLines: string[] = []
      let i = 0
      let prunedStatements = 0

      while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trimStart()
        const indentMatch = line.match(/^(\s*)/)
        const currentIndent = indentMatch ? indentMatch[1] : ""

        // Check if line starts a function or method definition
        const isDefStart = /^(?:async\s+)?def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(trimmed)

        if (isDefStart) {
          const headerLines: string[] = [line]
          let j = i
          while (j < lines.length && !headerLines[headerLines.length - 1].trim().endsWith(":")) {
            j++
            if (j < lines.length) {
              headerLines.push(lines[j])
            }
          }

          if (headerLines[headerLines.length - 1].trim().endsWith(":")) {
            outputLines.push(...headerLines)
            i = j + 1

            const defIndentLen = currentIndent.length
            const bodyIndent = currentIndent + "    "
            let bodyStarted = false
            let hasDocstring = false
            let docstringQuotes = ""
            let inDocstring = false
            let bodyLinesOmitted = 0

            while (i < lines.length) {
              const bodyLine = lines[i]
              const bodyTrimmed = bodyLine.trim()

              if (bodyTrimmed === "" && !bodyStarted) {
                i++
                continue
              }

              const lineIndentMatch = bodyLine.match(/^(\s*)/)
              const lineIndentLen = lineIndentMatch ? lineIndentMatch[1].length : 0

              if (bodyTrimmed !== "" && lineIndentLen <= defIndentLen) {
                break
              }

              bodyStarted = true

              // Preserve docstring if present at start of body
              if (!hasDocstring && (bodyTrimmed.startsWith('"""') || bodyTrimmed.startsWith("'''"))) {
                hasDocstring = true
                docstringQuotes = bodyTrimmed.startsWith('"""') ? '"""' : "'''"
                outputLines.push(bodyLine)

                if (bodyTrimmed.length > 3 && bodyTrimmed.slice(3).includes(docstringQuotes)) {
                  inDocstring = false
                } else {
                  inDocstring = true
                }
                i++
                continue
              }

              if (inDocstring) {
                outputLines.push(bodyLine)
                if (bodyTrimmed.includes(docstringQuotes)) {
                  inDocstring = false
                }
                i++
                continue
              }

              // Check if statement was not already an ellipsis or pass
              if (bodyTrimmed !== "..." && bodyTrimmed !== "pass") {
                bodyLinesOmitted++
              }
              i++
            }

            if (bodyLinesOmitted > 0) {
              prunedStatements += bodyLinesOmitted
              outputLines.push(`${bodyIndent}...`)
            } else if (!hasDocstring) {
              outputLines.push(`${bodyIndent}...`)
            }
            continue
          }
        }

        outputLines.push(line)
        i++
      }

      if (prunedStatements === 0) {
        return {
          content,
          pruned: false,
          originalLines: lines.length,
          skeletonLines: lines.length,
        }
      }

      const result = outputLines.join("\n")
      return {
        content: result,
        pruned: true,
        originalLines: lines.length,
        skeletonLines: outputLines.length,
      }
    })
  }
}

export const pythonStrategy = new PythonStrategy()
