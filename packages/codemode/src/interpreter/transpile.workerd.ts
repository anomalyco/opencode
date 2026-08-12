export interface TranspileResult {
  readonly outputText: string
  readonly error?: string
}

// workerd profile: the typescript compiler is ~11 MiB and probes node
// internals at module init, so codemode programs are passed through
// untranspiled. Plain-JS programs (the overwhelmingly common case) parse
// fine downstream via acorn; TypeScript-only syntax surfaces as a parse
// error from the interpreter instead of a transpile diagnostic.
export const transpile = (source: string): TranspileResult => ({ outputText: source })
