/**
 * Detects when a shell command failure was likely caused by the user
 * typing natural language instead of a real shell command.
 */

/**
 * Shell error patterns that strongly suggest natural language input.
 * These are parse/syntax errors that occur when the shell tries to
 * interpret English sentences as code.
 */
const ERROR_PATTERNS = [
  // zsh/bash parse errors
  /parse error/i,
  /syntax error/i,
  /unexpected token/i,
  /unexpected end of file/i,
  // command not found for subsequent words (the first word was valid but rest isn't shell)
  /command not found/i,
  // common errors from real commands receiving natural language args
  /no such file or directory/i,
  /invalid option/i,
  /unrecognized option/i,
  /illegal option/i,
  /unknown option/i,
  // make
  /no rule to make target/i,
  // find
  /unknown primary or operator/i,
  /missing argument to/i,
  // grep
  /invalid regular expression/i,
  // git
  /is not a git command/i,
  // subcommand-based tools (go, cargo, docker, npm, kubectl, etc.)
  /unknown command/i,
  /no such command/i,
]

/**
 * Words that are common in natural language but unusual as the second
 * token of a real shell command. Used as a signal that the input is
 * probably a sentence, not a command.
 */
const NATURAL_LANGUAGE_WORDS = new Set([
  // articles/determiners
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "my",
  "our",
  "your",
  // pronouns
  "i",
  "we",
  "you",
  "it",
  "they",
  "me",
  "us",
  "him",
  "her",
  "them",
  // prepositions
  "to",
  "of",
  "about",
  "with",
  "from",
  "into",
  "through",
  "between",
  "after",
  "before",
  "for",
  // conjunctions
  "and",
  "but",
  "or",
  "so",
  "because",
  "since",
  "although",
  // common verbs (when second word)
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "have",
  "has",
  "had",
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "need",
  "want",
  // adverbs
  "not",
  "already",
  "also",
  "just",
  "still",
  "even",
  "really",
  "actually",
  "probably",
  "maybe",
  // question words
  "how",
  "what",
  "when",
  "where",
  "why",
  "who",
  "which",
  // other common sentence starters/continuers
  "if",
  "there",
  "here",
  "all",
  "any",
  "some",
  "every",
  "no",
  "each",
  "does",
  "do",
  "did",
  "sure",
  "out",
  "up",
  "down",
  "ahead",
  "back",
  "over",
  "away",
  "around",
  "along",
  "please",
  "anyone",
  "someone",
  "everyone",
  "anything",
  "something",
  "everything",
])

/**
 * Minimum word count for the input to be considered potentially natural language.
 * Single-word or two-word inputs are usually real commands.
 */
const MIN_WORD_COUNT = 3

/**
 * Detect if a failed shell command was likely natural language.
 *
 * Returns a hint string if natural language is detected, or undefined.
 */
export function detectNaturalLanguage(input: string, output: string, exitCode: number | null): string | undefined {
  // Only check failed commands
  if (exitCode === 0 || exitCode === null) return undefined

  const trimmed = input.trim()
  const words = trimmed.split(/\s+/)

  // Very short inputs are probably real commands
  if (words.length < MIN_WORD_COUNT) return undefined

  // Check if the output matches known error patterns
  const hasErrorPattern = ERROR_PATTERNS.some((pattern) => pattern.test(output))
  if (!hasErrorPattern) return undefined

  // Check if the second word looks like natural language
  const second = words[1]?.toLowerCase()
  if (second && NATURAL_LANGUAGE_WORDS.has(second)) {
    return "This looks like a question for the agent. Try again without shell mode, or press Ctrl+Space to switch to Agent mode."
  }

  // Even without a natural language second word, if we have enough words
  // and a parse/syntax error, it's likely natural language
  if (words.length >= 5 && /parse error|syntax error|unexpected token/i.test(output)) {
    return "This looks like a question for the agent. Try again without shell mode, or press Ctrl+Space to switch to Agent mode."
  }

  return undefined
}
