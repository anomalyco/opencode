# Session start prompts

## Prompt 1

```text
Implement phase 1 for a new OpenCode plugin hook named "session.start".

Requirements:
- Add this hook type to `packages/plugin/src/index.ts`:

"session.start"?: (
  input: { trigger: "startup" | "resume" | "compact"; sessionID: string },
  output: { additionalContext: string[] }
) => Promise<void>

- Add a persistent per-session storage field for pending one-shot context in the session schema, using snake_case naming.
- Generate or prepare the Drizzle migration for that field.
- Add minimal session helpers in `packages/opencode/src/session/index.ts` to:
  - read pending context
  - append pending context
  - clear pending context

Constraints:
- Keep new helper names short where possible
- Avoid broad refactors
- Do not wire trigger points yet
- Use JSON array storage, not in-memory storage

After editing, explain exactly which files changed and why.
```

## Prompt 2

```text
Implement phase 2 for the new plugin hook "session.start".

Requirements:
- Create a focused server-side helper, preferably in `packages/opencode/src/session/start.ts`
- Export one function that accepts:
  { sessionID: string, trigger: "startup" | "resume" | "compact" }
- It should call the plugin hook "session.start" with output { additionalContext: [] }
- Normalize plugin output by trimming strings and dropping empty entries
- Append valid strings into the session's pending context storage
- Plugin failures must log and continue, not throw

Constraints:
- Do not change client code yet
- Do not inject into prompts yet
- Keep logic small and easy for a non-TypeScript expert to follow
- Prefer one main function with a tiny helper if needed

After editing, show the control flow in plain English.
```

## Prompt 3

```text
Implement phase 3 trigger points for `session.start`.

Requirements:
- Trigger `startup` once from the session creation flow
- Trigger `compact` after successful session compaction only
- Add an explicit server endpoint for `resume`, likely `POST /session/:sessionID/resume`
- The resume endpoint must validate the session exists, then trigger `session.start` with `trigger: "resume"`

Constraints:
- Keep all hook execution server-side
- Do not call plugin hooks from TUI or CLI files
- Do not inject pending context into prompts yet
- Plugin failures should still not break lifecycle actions

After editing, list the exact trigger points and why each one is correct.
```

## Prompt 4

```text
Implement phase 4 one-shot prompt injection for pending session context.

Requirements:
- In the session prompt/model-turn path, read pending context for the session before the assistant generation starts
- Append it to the system prompt, not the user message
- Wrap the injected text in a clear block like:
  <session-start-context>
  ...
  </session-start-context>
- Clear the stored pending context after one use

Constraints:
- Keep this one-shot
- Preserve ordering of stored context strings
- Do not surface this as a visible session message
- Keep the change narrow and easy to review

After editing, explain exactly when context is read, injected, and cleared.
```

## Prompt 5

```text
Implement phase 5 client wiring for explicit resume requests.

Requirements:
- From the TUI session route entry for existing sessions, call the new session resume API after the session sync succeeds
- Guard against duplicate resume calls from reactive reruns
- From CLI run paths that reopen existing sessions (`--continue` or `--session`), call the resume API before prompting
- Do not call resume for newly created sessions

Constraints:
- Client code should only call the server endpoint
- No direct plugin execution in client code
- Keep route-level logic simple and obvious

After editing, explain how the current POC race is avoided by this design.
```

## Prompt 6

```text
Finish phase 6 with validation and cleanup.

Requirements:
- Regenerate the JS SDK if needed after adding the resume endpoint
- Update any compile errors caused by the new route or hook type
- Add or update focused tests if there is an obvious existing test pattern
- Keep tests local to affected packages
- Do not run tests from repo root

Also provide:
- a short manual test checklist for startup/resume/compact
- known edge cases that still deserve follow-up before opening a PR
```

## Prompt 7

```text
Do a final review of the `session.start` implementation.

Please check for:
- startup firing exactly once per created session
- resume firing only from explicit resume requests
- compact firing only after successful compaction
- one-shot pending context consumption
- plugin failures being logged without breaking lifecycle flows
- TUI duplicate resume risks
- any accidental client-side plugin execution
- naming/style issues in new code based on repo conventions

Return a concise review with:
- confirmed behaviors
- anything suspicious
- specific file-level cleanup suggestions
```
