/**
 * Regex Complexity Validator
 *
 * Validates regular expression patterns to prevent ReDoS (Regular Expression Denial of Service) attacks.
 * Checks for dangerous patterns that could cause exponential backtracking.
 */

export interface RegexValidationResult {
  valid: boolean
  reason?: string
  complexityScore?: number
}

const MAX_PATTERN_LENGTH = 1000
const MAX_COMPLEXITY_SCORE = 100
const EXECUTION_TIMEOUT_MS = 5000

/**
 * Patterns that indicate potential ReDoS vulnerabilities
 */
const DANGEROUS_PATTERNS = [
  // Nested quantifiers - exponential backtracking
  /\([^)]*[+*?]\)[+*?]/,
  /\([^)]*[+*]\)\{[^}]+\}/,
  /\{[^}]+\}\{[^}]+\}/,

  // Nested groups with quantifiers
  /\(\?:[^)]*[+*?]\)[+*?]/,

  // Overlapping alternations with quantifiers
  /\([^)|]*\|[^)|]*\)\+/,
  /\([^)|]*\|[^)|]*\)\*/,

  // Multiple consecutive quantifiers (invalid but could cause parser issues)
  /[+*?]{2,}/,

  // Extremely long character classes
  /\[[^\]]{100,}\]/,

  // Nested backreferences with quantifiers
  /\(.*\).*\\1[+*]/,

  // Complex lookahead/lookbehind with quantifiers
  /\(\?[=!<][^)]*[+*]\)[+*]/,
]

/**
 * Patterns that contribute to complexity score
 */
const COMPLEXITY_PATTERNS: Array<{ pattern: RegExp; score: number; name: string }> = [
  { pattern: /\([^)]*[+*]\)/g, score: 10, name: "group with quantifier" },
  { pattern: /\([^)]*\|[^)]*\)/g, score: 5, name: "alternation" },
  { pattern: /\.[+*]/g, score: 8, name: "wildcard with quantifier" },
  { pattern: /\\d[+*]/g, score: 3, name: "digit with quantifier" },
  { pattern: /\\w[+*]/g, score: 3, name: "word char with quantifier" },
  { pattern: /\\s[+*]/g, score: 3, name: "whitespace with quantifier" },
  { pattern: /\[[^\]]+\][+*]/g, score: 7, name: "character class with quantifier" },
  { pattern: /\{[0-9]+,\}/g, score: 6, name: "unbounded repetition" },
  { pattern: /\{[0-9]+,[0-9]+\}/g, score: 4, name: "bounded repetition" },
  { pattern: /\(\?=/g, score: 5, name: "positive lookahead" },
  { pattern: /\(\?!/g, score: 5, name: "negative lookahead" },
  { pattern: /\(\?<=/g, score: 6, name: "positive lookbehind" },
  { pattern: /\(\?<!/g, score: 6, name: "negative lookbehind" },
]

/**
 * Validates a regex pattern for potential ReDoS vulnerabilities
 */
export function validateRegexComplexity(pattern: string): RegexValidationResult {
  // Check pattern length
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      valid: false,
      reason: `Pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters (length: ${pattern.length})`,
    }
  }

  // Check for empty pattern
  if (!pattern || pattern.trim().length === 0) {
    return {
      valid: false,
      reason: "Pattern cannot be empty",
    }
  }

  // Check for dangerous patterns
  for (const dangerousPattern of DANGEROUS_PATTERNS) {
    if (dangerousPattern.test(pattern)) {
      return {
        valid: false,
        reason: `Pattern contains potentially dangerous construct that could cause exponential backtracking: ${dangerousPattern.source}`,
      }
    }
  }

  // Calculate complexity score
  let complexityScore = 0
  const complexityBreakdown: string[] = []

  for (const { pattern: checkPattern, score, name } of COMPLEXITY_PATTERNS) {
    const matches = pattern.match(checkPattern)
    if (matches) {
      const contribution = matches.length * score
      complexityScore += contribution
      complexityBreakdown.push(`${name}: ${matches.length} occurrences (+${contribution})`)
    }
  }

  // Check for deeply nested groups
  const nestingDepth = calculateNestingDepth(pattern)
  if (nestingDepth > 5) {
    complexityScore += nestingDepth * 10
    complexityBreakdown.push(`deep nesting: depth ${nestingDepth} (+${nestingDepth * 10})`)
  }

  // Reject if complexity score is too high
  if (complexityScore > MAX_COMPLEXITY_SCORE) {
    return {
      valid: false,
      reason: `Pattern complexity score (${complexityScore}) exceeds maximum allowed (${MAX_COMPLEXITY_SCORE}). ${complexityBreakdown.join(", ")}`,
      complexityScore,
    }
  }

  // Try to compile the regex to catch syntax errors
  try {
    new RegExp(pattern)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      valid: false,
      reason: `Invalid regex syntax: ${errorMessage}`,
    }
  }

  return {
    valid: true,
    complexityScore,
  }
}

/**
 * Calculates the maximum nesting depth of groups in a pattern
 */
function calculateNestingDepth(pattern: string): number {
  let maxDepth = 0
  let currentDepth = 0
  let inCharClass = false

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    const prevChar = i > 0 ? pattern[i - 1] : ""

    // Skip escaped characters
    if (prevChar === "\\") {
      continue
    }

    // Track character classes
    if (char === "[" && !inCharClass) {
      inCharClass = true
      continue
    }
    if (char === "]" && inCharClass) {
      inCharClass = false
      continue
    }

    // Don't count groups inside character classes
    if (inCharClass) {
      continue
    }

    if (char === "(") {
      currentDepth++
      maxDepth = Math.max(maxDepth, currentDepth)
    } else if (char === ")") {
      currentDepth = Math.max(0, currentDepth - 1)
    }
  }

  return maxDepth
}

/**
 * Wraps a promise with a timeout
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = EXECUTION_TIMEOUT_MS): Promise<T> {
  let timeoutId: Timer | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([promise, timeoutPromise])
    if (timeoutId) clearTimeout(timeoutId)
    return result
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Validates pattern and throws if invalid
 */
export function assertValidRegex(pattern: string): void {
  const result = validateRegexComplexity(pattern)
  if (!result.valid) {
    throw new Error(`Invalid regex pattern: ${result.reason}`)
  }
}
