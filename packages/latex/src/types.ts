export type MathVariant = "normal" | "bold" | "italic" | "sans" | "monospace" | "double-struck" | "script" | "fraktur"

export type MathNode =
  | { type: "row"; body: MathNode[] }
  | { type: "symbol"; value: string; role?: SymbolRole }
  | { type: "text"; value: string }
  | { type: "raw"; value: string }
  | { type: "space"; width: number }
  | {
      type: "fraction"
      numerator: MathNode
      denominator: MathNode
      bar: boolean
      numeratorAlign?: "left" | "right"
    }
  | { type: "root"; body: MathNode; index?: MathNode }
  | { type: "boxed"; body: MathNode }
  | { type: "scripts"; base: MathNode; superscript?: MathNode; subscript?: MathNode }
  | { type: "delimited"; left: string; body: MathNode; right: string }
  | { type: "matrix"; rows: MathNode[][]; environment: MatrixEnvironment; columns?: string }
  | { type: "brace"; body: MathNode; position: "over" | "under" }
  | { type: "accent"; accent: AccentKind; body: MathNode }
  | { type: "variant"; variant: MathVariant; body: MathNode }
  | { type: "operator"; value: string; limits: boolean }
  | { type: "overunder"; base: MathNode; over?: MathNode; under?: MathNode }
  | { type: "color"; color: string; body: MathNode }

export type SymbolRole = "ordinary" | "binary" | "relation" | "operator" | "punctuation" | "opening" | "closing"

export type MatrixEnvironment =
  | "matrix"
  | "pmatrix"
  | "bmatrix"
  | "Bmatrix"
  | "vmatrix"
  | "Vmatrix"
  | "cases"
  | "aligned"
  | "align"
  | "gathered"
  | "gather"
  | "smallmatrix"
  | "array"

export type AccentKind = "hat" | "widehat" | "bar" | "overline" | "underline" | "vec" | "tilde" | "dot" | "ddot"

export interface ParseOptions {
  macros?: Readonly<Record<string, string>>
  maxExpand?: number
  /**
   * Maximum accepted input length. This guards interactive and AI-generated
   * formulas against accidentally exhausting the terminal process.
   */
  maxSourceLength?: number
  /**
   * Maximum length after user-macro expansion. Defaults to
   * `maxSourceLength`.
   */
  maxExpandedLength?: number
  /** Maximum structural nesting depth. */
  maxDepth?: number
  strict?: boolean
  /** Preserve unknown commands verbatim without relaxing structural validation. */
  unknownCommands?: "error" | "preserve"
}

export class LatexParseError extends Error {
  public readonly position: number

  constructor(message: string, position: number) {
    super(`${message} at offset ${position}`)
    this.name = "LatexParseError"
    this.position = position
  }
}

export interface MathStyle {
  color?: string
  bold?: boolean
  italic?: boolean
  dim?: boolean
}

export interface MathCell {
  char: string
  style?: MathStyle
}

export interface MathLayout {
  readonly width: number
  readonly height: number
  readonly baseline: number
  readonly cells: ReadonlyArray<ReadonlyArray<MathCell | undefined>>
  toString(): string
}

export interface RenderLatexOptions extends ParseOptions {
  displayMode?: boolean
  compactScripts?: boolean
  color?: string
}
