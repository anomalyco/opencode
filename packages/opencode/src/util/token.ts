export namespace Token {
  // Characters per token ratios by category, derived from typical BPE tokenizer behavior on code

  // Digits tokenize poorly - often split into individual digits or small groups
  const DIGITS_RATIO = 1 / 1.9

  // Punctuation and symbols (brackets, operators, etc.) - most are single tokens,
  // though some pairs merge (e.g., ->, !=, ::)
  const PUNCTUATION_RATIO = 1 / 1.2

  // Whitespace - leading indentation often merges (4 spaces → 1 token),
  // but isolated spaces typically don't
  const WHITESPACE_RATIO = 1 / 2.5

  // Letters and other characters - keywords compress well, identifiers less so
  const DEFAULT_RATIO = 1 / 3.5

  // Adjustment multiplier for tuning estimates up (>1) or down (<1)
  // Set via OPENCODE_TOKEN_FACTOR environment variable
  const FACTOR = parseFloat(process.env.OPENCODE_TOKEN_FACTOR || "1.0") || 1.0

  export function estimate(input: string): number {
    let count = 0
    for (const char of input || "") {
      if (/\p{N}/u.test(char)) {
        count += DIGITS_RATIO
      } else if (/\p{P}|\p{S}/u.test(char)) {
        count += PUNCTUATION_RATIO
      } else if (/\s/.test(char)) {
        count += WHITESPACE_RATIO
      } else {
        count += DEFAULT_RATIO
      }
    }
    return Math.trunc(count * FACTOR)
  }
}
