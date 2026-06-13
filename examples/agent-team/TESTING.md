# Testing the agent-team bundle

This bundle is configuration plus prompts, so its QA has two layers: **static checks**
that are fully automated, and **behavioral acceptance** that is run by a human because
LLM output is non-deterministic (you cannot assert that a model will emit identical text).

## Layer 1 -- Static verification (automated)

```sh
node scripts/verify.mjs    # or: bun scripts/verify.mjs
```

`scripts/verify.mjs` is dependency-free and checks:

1. `.opencode/opencode.jsonc` parses (string-aware JSONC stripping) and `default_agent`
   is a string.
2. Every `.opencode/agent/*.md` has valid frontmatter: `mode` is `primary`, `subagent`,
   or `all`; every `subagent` sets `hidden: true`; and the prompt body is non-empty.
3. `default_agent` resolves to an existing `primary` agent.
4. No obvious inline secrets (API-key, token, or private-key patterns) anywhere in the bundle.

This is practical sanity-checking, not full schema validation. The **authoritative**
schema check is opencode's own config loader: if opencode starts without a config error,
the config is valid.

## Layer 2 -- Behavioral acceptance (manual)

Run these by hand against a small test project. They are acceptance criteria, not
deterministic assertions -- judge the output against the "Then" clauses.

### Explorer

- **Given** the orchestrator delegates "find where X is defined",
- **When** `@explorer` runs,
- **Then** the reply contains `file:line` references, **and** no file is modified, **and**
  no shell command is run.

### Reviewer

- **Given** a diff that concatenates untrusted input directly into a SQL string,
- **When** `@reviewer` analyzes it,
- **Then** the reply flags an injection issue with a `file:line` reference, **and** no file
  is modified.

### Verifier

- **Given** a project with real test and typecheck scripts,
- **When** `@verifier` runs,
- **Then** it reports the commands it ran and pass/fail with trimmed output.
- **Given** a project with no test setup,
- **Then** it names the detected stack, recommends minimal tooling, and asks before
  configuring anything.

### Security hard stop

- **Given** a diff that hardcodes a credential,
- **When** `@reviewer` reviews it,
- **Then** its reply starts with `SECURITY_HARD_STOP:`, **and** the orchestrator stops and
  asks the user instead of proceeding to the verifier.

### Triangulation

- **Given** `@reviewer` reports it cannot assess a change without missing context,
- **When** the orchestrator receives that,
- **Then** it re-delegates to `@explorer` to gather the context before continuing.

## Pre-flight QA checklist

- [ ] `scripts/verify.mjs` passes (jsonc, frontmatters, default_agent, no secrets)
- [ ] every subagent has `hidden: true`; no inline keys in `opencode.jsonc`
- [ ] prompts contain no contradictory or dead instructions
- [ ] each agent's behavioral scenario above passes manually
- [ ] the full pipeline runs end to end (explore, review, verify, consolidated summary)
- [ ] acceptance: a real refactor task is runnable via the orchestrator, the pipeline
      catches at least one real issue, and the summary is useful without hand-holding
