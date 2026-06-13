# opencode agent-team

A realistic, multi-agent setup for [opencode](https://opencode.ai): one primary
orchestrator that delegates to three specialist subagents (explorer, reviewer,
verifier). It is built entirely on opencode's real features -- markdown agents, the
`task` tool for delegation, per-agent `tools`/`permission`, and `AGENTS.md` rules.
Nothing here requires a fork or a plugin.

## What this is

- **orchestrator** (primary) -- plans a task, delegates, verifies, and reports.
- **explorer** (subagent, read-only) -- fan-out codebase search plus up-to-date library docs.
- **reviewer** (subagent, read-only) -- reviews a diff for correctness, security, simplification.
- **verifier** (subagent) -- runs the project's real tests, typecheck, and lint.

The orchestrator drives the loop: explore, implement, review, verify, report.

## What this is NOT

This is a **workflow and a set of habits**, not a correctness oracle. It does **not**
provide formal verification, Hoare-logic proofs, model checking, RDF/SPARQL knowledge
graphs, or "guaranteed" correctness or security. A system prompt cannot make a language
model prove a program correct. What you get is a disciplined pipeline -- explore before
editing, review the diff, run the real tests, and surface security and performance
issues that are actually visible -- plus honest reporting when something fails. Treat
the security review as a careful, human-style read, not a guarantee.

## How to use

Option A -- run it directly:

```sh
cd examples/agent-team
opencode
```

The `orchestrator` is the default agent. Ask it to do a task; it will delegate to the
subagents as needed.

Option B -- adopt it in your own project: copy the `.opencode/` directory and `AGENTS.md`
into your project root. `default_agent` is already set in the bundled `opencode.jsonc`.

## Model IDs and secrets

The bundle pins no model, so each agent inherits whatever model you have configured. To
set models per agent, add overrides in `.opencode/opencode.jsonc` (see the comment
there). Valid model IDs depend on the providers configured in **your** environment;
opencode also exposes an `opencode/<model>` namespace, so do not assume a copied example
ID exists.

**Never put API keys in `opencode.jsonc`.** Use environment variables; opencode reads
provider credentials from the environment and its auth store.

## How the team works

1. The orchestrator reads the relevant code and plans.
2. It delegates fan-out search and library research to `@explorer`.
3. After making changes, it runs `git diff` and hands the diff to `@reviewer`.
   - If the reviewer returns `SECURITY_HARD_STOP: ...`, the orchestrator halts and asks you.
   - If the reviewer needs missing context, the orchestrator re-delegates to `@explorer`
     (triangulation) before continuing.
4. It asks `@verifier` to run the project's real checks.
5. It ends with a short consolidated summary of findings, risks, and next steps.

## Testing

See [TESTING.md](./TESTING.md). Run the static validator before anything else:

```sh
node scripts/verify.mjs   # or: bun scripts/verify.mjs
```
