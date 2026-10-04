import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import path from "path"
import type { Strategy, SyntaxDiagnostic, ValidationResult } from "./strategy"
import { typeScriptValidator } from "./strategies/typescript"
import { pythonValidator } from "./strategies/python"

export type { Strategy, SyntaxDiagnostic, ValidationResult } from "./strategy"

export interface Interface {
  readonly supports: (filepath: string) => boolean
  readonly validate: (filepath: string, content: string) => Effect.Effect<ValidationResult>
  readonly formatReport: (filepath: string, errors: readonly SyntaxDiagnostic[]) => string
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SyntaxValidator") {}

const strategies: readonly Strategy[] = [typeScriptValidator, pythonValidator]

const findStrategy = (filepath: string): Strategy | undefined => {
  const ext = path.extname(filepath).toLowerCase()
  return strategies.find((s) => s.extensions.includes(ext))
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() =>
    Service.of({
      supports: (filepath: string) => findStrategy(filepath) !== undefined,
      validate: (filepath: string, content: string) => {
        const strategy = findStrategy(filepath)
        if (!strategy) {
          return Effect.succeed({ valid: true, errors: [] })
        }
        return strategy.validate(filepath, content)
      },
      formatReport: (filepath: string, errors: readonly SyntaxDiagnostic[]) => {
        const filename = path.basename(filepath)
        const lines = errors.map((e) => `  - Line ${e.line}, Col ${e.column}: ${e.message}`)
        return `Syntax error(s) detected in ${filename}:\n${lines.join("\n")}\nPlease review and ensure valid syntax.`
      },
    }),
  ),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as SyntaxValidator from "./index"
