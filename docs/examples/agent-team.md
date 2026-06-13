# agent-team — design notes

A walkthrough of the [`examples/agent-team/`](../../examples/agent-team/) bundle: what it
is, why it is built this way, and how it was validated.

## Why this exists

It is easy to write an "ultimate" agent system prompt that promises formal verification,
mathematical proofs of correctness, RDF knowledge graphs, and guaranteed security. None of
that is deliverable by a prompt — a language model cannot be made to prove a program
correct by being told to. `agent-team` is the realistic alternative: a small team of
agents that encodes strong engineering *habits* and uses only features opencode actually
supports.

## Architecture

One primary agent delegates to three specialists via opencode's `task` tool:

| Agent | Mode | Tools | Role |
|-------|------|-------|------|
| orchestrator | primary | edit, bash, webfetch, task | Plans, delegates, verifies, reports |
| explorer | subagent (hidden) | read, grep, glob, webfetch, websearch | Read-only codebase + library research |
| reviewer | subagent (hidden) | read, grep, glob | Read-only diff review (correctness / security / simplify) |
| verifier | subagent (hidden) | read, grep, glob, bash | Runs the project's real tests / typecheck / lint |

The loop is explore → implement → review → verify → report. The orchestrator runs
`git diff` and passes it to the reviewer (which has no shell). Read-only subagents use the
default-deny pattern `tools: { "*": false, ... }` — the same pattern the repo's own
`.opencode/agent/triage.md` uses.

## Design decisions grounded in opencode internals

- A custom agent `prompt` **replaces** the base system prompt (see
  `packages/opencode/src/session/llm/request.ts`), so each prompt here is a complete role
  definition, not a delta.
- The file-write tool is gated by the `edit` permission, not a `write` key (see
  `normalize()` in `packages/core/src/v1/config/agent.ts`); the verifier therefore uses
  `edit: ask` for an optional, confirmation-gated report — not a no-op `write: ask`.
- Subagents are `hidden: true` and resolved by the orchestrator's `task` tool by name.

## Safety habits (not guarantees)

- **Prompt-injection:** the explorer and orchestrator treat fetched web content and tool
  output as untrusted data, never as instructions.
- **Security hard stop:** on a critical finding the reviewer replies only with
  `SECURITY_HARD_STOP: <CWE-ID> — ...`, and the orchestrator halts and asks the human.
- **No silent edits or commits:** read-only subagents cannot edit; nothing is committed
  unless the user asks.

## Validation

- `examples/agent-team/scripts/verify.mjs` — dependency-free static checks: JSONC parses,
  frontmatter is valid, subagents are hidden, `default_agent` resolves, and no inline
  secrets are present.
- Schema conformance matches the fields in `packages/core/src/v1/config/agent.ts` and
  mirrors the repo's own shipped agents.
- Behavioral acceptance is manual, because LLM output is non-deterministic — see
  `examples/agent-team/TESTING.md`.

See [`examples/agent-team/README.md`](../../examples/agent-team/README.md) for usage.
