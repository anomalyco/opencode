# session/generate

## POST /api/session/{sessionID}/generate

Generate transient text from the current session context without mutating session history. Its tokens and cost count toward the session's totals.

Body:
- `prompt: string`

Returns: `SessionGenerateResponse`

## Types

- `SessionGenerateResponse`: `{ data: { text, tokens, cost } }`
