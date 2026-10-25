/* GENERATED, DO NOT EDIT DIRECTLY */

/* @checksum: 3QCTtOH6rJM5_AGJ58rGpeEaBEfaJz17MSCxWB4X_PU */

export type PaddingType = 'any' | 'never' | 'always'
export type StatementOption =
  | StatementMatcher
  | [StatementMatcher, ...StatementMatcher[]]
export type StatementMatcher =
  | StatementType
  | SelectorOption
export type StatementType =
  | '*'
  | 'exports'
  | 'require'
  | 'directive'
  | 'iife'
  | 'block'
  | 'empty'
  | 'function'
  | 'ts-method'
  | 'break'
  | 'case'
  | 'class'
  | 'continue'
  | 'debugger'
  | 'default'
  | 'do'
  | 'for'
  | 'if'
  | 'import'
  | 'switch'
  | 'throw'
  | 'try'
  | 'while'
  | 'with'
  | 'cjs-export'
  | 'cjs-import'
  | 'enum'
  | 'interface'
  | 'function-overload'
  | 'block-like'
  | 'singleline-block-like'
  | 'multiline-block-like'
  | 'expression'
  | 'singleline-expression'
  | 'multiline-expression'
  | 'return'
  | 'singleline-return'
  | 'multiline-return'
  | 'export'
  | 'singleline-export'
  | 'multiline-export'
  | 'var'
  | 'singleline-var'
  | 'multiline-var'
  | 'let'
  | 'singleline-let'
  | 'multiline-let'
  | 'const'
  | 'singleline-const'
  | 'multiline-const'
  | 'using'
  | 'singleline-using'
  | 'multiline-using'
  | 'type'
  | 'singleline-type'
  | 'multiline-type'
export type PaddingLineBetweenStatementsSchema0 = {
  blankLine: PaddingType
  prev: StatementOption
  next: StatementOption
}[]

export interface SelectorOption {
  selector: string
  lineMode?: 'any' | 'singleline' | 'multiline'
}

export type PaddingLineBetweenStatementsRuleOptions
  = PaddingLineBetweenStatementsSchema0

export type RuleOptions
  = PaddingLineBetweenStatementsRuleOptions
export type MessageIds =
  | 'unexpectedBlankLine'
  | 'expectedBlankLine'
