// Completion-signal contract for loops.
//
// The loop's only positive termination path is the model emitting a token.
// Before this module existed the token was checked but never disclosed: the
// iteration prompt was the user's string verbatim, so the model had no way to
// know the safe word. Loops could therefore never reach "completed" — they
// only ever ended stalled/max_reached/cancelled/error. contractPart() is what
// tells the model the word; matchesCompletion() is what reads it back.
//
// Import-free on purpose, same as ./similarity — loop.ts imports SessionPrompt,
// so anything prompt.ts might also want must not route through loop.ts. See the
// header of ./similarity.ts for the boot crash that cycle caused.

export const DEFAULT_COMPLETION_TOKEN = "<promise>COMPLETE</promise>"

// Only the tail of an iteration's output can complete a loop. A model that
// mentions the token while explaining its plan, then keeps working, has not
// finished. 200 chars is enough for the token plus a short sign-off line.
const TrailingWindow = 200

function squash(text: string) {
  return text.toLowerCase().replace(/\s+/g, "")
}

/**
 * The block appended to every iteration telling the model how to signal done.
 * The user's own prompt is sent as a separate, earlier part and is never
 * rewritten — this only ever augments.
 */
export function contractPart(token: string, iteration: number, maxIterations: number): string {
  return [
    "<loop-contract>",
    `You are running inside an automated loop (iteration ${iteration} of ${maxIterations}).`,
    "When the task described above is fully complete, emit exactly this token on its own",
    "line as the last line of your response:",
    token,
    "Do not emit it for partial progress. If you cannot proceed, explain why and do not",
    "emit the token.",
    "</loop-contract>",
  ].join("\n")
}

/**
 * True when the prompt itself carries the token, which makes a genuine signal
 * indistinguishable from the model quoting its instructions back. Completion
 * detection is forfeit for such a loop; callers should warn and suggest a
 * different completionToken.
 */
export function promptDisablesCompletion(promptText: string, token: string): boolean {
  const needle = squash(token)
  return needle.length > 0 && squash(promptText).includes(needle)
}

/**
 * True when `output` genuinely signals completion.
 *
 * Tolerates case and whitespace drift (so a token split across a line break, or
 * wrapped in a code fence, still counts) but only within the trailing window,
 * and never when the token also occurs in the prompt that produced the output —
 * a model quoting its instructions back is not a completion signal.
 */
export function matchesCompletion(output: string, token: string, promptText: string): boolean {
  const needle = squash(token)
  if (!needle) return false
  if (promptDisablesCompletion(promptText, token)) return false
  const tail = output.length > TrailingWindow ? output.slice(-TrailingWindow) : output
  return squash(tail).includes(needle)
}
