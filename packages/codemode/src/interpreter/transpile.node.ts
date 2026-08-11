import { DiagnosticCategory, ModuleKind, ScriptTarget, flattenDiagnosticMessageText, transpileModule } from "typescript"

export interface TranspileResult {
  readonly outputText: string
  readonly error?: string
}

// Full TypeScript transpilation on node/bun runtimes.
export const transpile = (source: string): TranspileResult => {
  const transpiled = transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
    },
  })
  const diagnostic = transpiled.diagnostics?.find((item) => item.category === DiagnosticCategory.Error)
  if (diagnostic) {
    return {
      outputText: transpiled.outputText,
      error: flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }
  }
  return { outputText: transpiled.outputText }
}
