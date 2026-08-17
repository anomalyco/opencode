import { Effect } from "effect"

// Lightweight TUI-side stub for session prompt helpers.
// The authoritative implementation lives in the `opencode` package.

export const simplePrompt = Effect.gen(function* () {
  const createUserMessage = Effect.fn("Simple.createUserMessage")((input: unknown) =>
    Effect.succeed({ info: null, parts: [] as unknown[] }),
  )

  const prompt = Effect.fn("Simple.prompt")((input: unknown) =>
    Effect.succeed({ info: null, parts: [] as unknown[] }),
  )

  return { createUserMessage, prompt }
})
