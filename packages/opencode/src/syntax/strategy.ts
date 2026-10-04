import type { Effect } from "effect"

export interface SyntaxDiagnostic {
  readonly line: number
  readonly column: number
  readonly message: string
}

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: readonly SyntaxDiagnostic[]
}

export interface Strategy {
  readonly name: string
  readonly extensions: readonly string[]
  validate(filepath: string, content: string): Effect.Effect<ValidationResult>
}
