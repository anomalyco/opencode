import { Effect } from "effect"
import ts from "typescript"
import type { Strategy, SyntaxDiagnostic, ValidationResult } from "../strategy"

export class TypeScriptValidator implements Strategy {
  readonly name = "typescript"
  readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"] as const

  validate(filepath: string, content: string): Effect.Effect<ValidationResult> {
    return Effect.sync(() => {
      const sourceFile = ts.createSourceFile(filepath, content, ts.ScriptTarget.Latest, true)
      const parseDiagnostics: readonly ts.Diagnostic[] = (sourceFile as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []

      if (parseDiagnostics.length === 0) {
        return {
          valid: true,
          errors: [],
        }
      }

      const errors: SyntaxDiagnostic[] = parseDiagnostics.map((d) => {
        const pos = d.start !== undefined ? sourceFile.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 }
        const message = ts.flattenDiagnosticMessageText(d.messageText, "\n")
        return {
          line: pos.line + 1,
          column: pos.character + 1,
          message,
        }
      })

      return {
        valid: false,
        errors,
      }
    })
  }
}

export const typeScriptValidator = new TypeScriptValidator()
