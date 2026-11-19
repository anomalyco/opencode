# Code Coach for VS Code

A silent side-panel that watches your edits and nudges you before bad habits
ship. No model, no network, no excuses — the triage decision is a deterministic
engine, so it is fast, honest, and costs nothing to run.

## How it works

1. You save a file.
2. The extension keeps the last few saved revisions and debounces saves.
3. It scores each saved change with `decide()`. Silence is the default.
4. When a finding fires, the side-panel shows a card with **Explain why**,
   **Fix my prompt**, and **Ignore**.

The security findings follow the same seven classes as the opencode slice:
plaintext passwords, missing rate limits, secrets committed to the repo,
SQL built from input, shell commands built from input, user content rendered as
HTML, and input used without validation. Plus correctness (eval, missing
error handling, stray console.log) and maintainability (TODO, debug logs).

`concept_tags` drive the learner profile. A concept you have been reminded about
three times is shown as mastered, so the card stops re-teaching the lesson.

## What is missing before it works end-to-end

- **Real diff capture.** The first pass scores the saved file's own text, not a
  git diff. On save, `decide(text, text, [masteredTags])` treats the file's
  content as both the ask and the "change" until a proper diff is wired. The
  reverse-engineering did not give us a clean editor-API diff hook in the
  slices we could read, so this is the next thing to build.
- **Cursor / Claude desktop.** This is a VS Code extension only. Capture those
  editors through their agent hooks or their desktop API before the card will
  appear there.
- **A real triage model.** The engine is regex + shape checks, not an LLM.
  That is a deliberate cost and honesty choice: the coach never feigns
  certainty. A pluggable model hook belongs in a later slice.
- **Post-send non-blocking.** The VS Code layer happens *after* you save, not
  before you send. It is a review nudge, not a pre-send gate.

## Tests

```
cd packages/extensions/code-coach-vscode
npm install
bun test
```

- `tests/triage.test.ts` — 12 scenarios covering every finding class, the
  two-finding cap, severity ordering, and mastered suppression.
- `tests/profile.test.ts` — record, count, mastered-3, deepen flag.
- `tests/rewriter.test.ts` — no findings passes through unchanged; findings
  rewrite into fixed lines.

## License

MIT. The engine, profile and rewriter are yours to run and ship however you
please. The VS Code extension itself follows the MIT license below.
