# Authoring opencode skills

A skill is a `SKILL.md` (discovered via `{skill,skills}/**/SKILL.md`) plus optional bundled scripts
and assets. These rules exist so the opencode skill ecosystem does not reproduce the failure modes
found in the audit of a separate skills platform (0% tests, god modules, duplicated wrappers, SSRF /
path-traversal, "remote/LLM as a data source"). The `skill-vetter` enforces the mechanical ones.

## Structure

```
.opencode/skills/<name>/
  SKILL.md            # frontmatter (name, description) + instructions
  scripts/*.ts        # bundled Bun scripts (optional)
  test/ or *.test.ts  # required if the skill has executable code
  eval/eval.json      # eval queries that define "working"
```

`SKILL.md` frontmatter:

```md
---
name: report-builder
description: One sentence the model uses to decide when to trigger this skill.
---
```

## Rules (the vetter checks these)

1. **No remote data.** Skills read **local, caller-provided** files. Do not `fetch()` facts/figures
   from arbitrary URLs — that is both an SSRF surface and a hallucinated-data risk. (HIGH)
2. **No hardcoded secrets.** Read credentials from env/config, never literals. (HIGH)
3. **Ship tests.** Every skill with executable code has tests. The audit's #1 gap was 0% coverage. (HIGH)
4. **Validate untrusted input.** Prefer Effect `Schema.decodeUnknownOption` over raw `JSON.parse`. (MED)
5. **Provide an eval set.** `eval/` queries make skill quality measurable (and enable regression checks). (MED)
6. **Cohesion over line count.** A large, cohesive file is fine; the vetter reports size as INFO only.
   Follow `AGENTS.md`: do not extract single-use helpers preemptively; do reuse genuinely shared logic.

## Reuse, don't duplicate (DRY)

Shared helpers live in [`.opencode/skills/lib`](./lib): `assertLocalSource` and `resolveInside`
(`safe.ts`) guard against SSRF/path-traversal; `fileCache`/`memoize` (`cache.ts`) add the caching the
audit found missing everywhere. Import them instead of re-implementing — the audit's "7 near-identical
wrappers" is exactly what this avoids.

## Frontmatter by artifact type

opencode has several extension types, each with its own frontmatter. Match the one you're adding
(verified against the in-repo examples cited):

| Type    | Path                               | Frontmatter / shape                                                                                            |
| ------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Command | `.opencode/command/<name>.md`      | `description`, `model?`, `subtask?` (see `command/commit.md`)                                                  |
| Agent   | `.opencode/agent/<name>.md`        | `mode`, `hidden?`, `model?`, `color?`, `tools`, `permissions?` (see `agent/triage.md`)                         |
| Tool    | `.opencode/tool/<name>.ts`         | `export default tool({ description, args, execute })` from `@opencode-ai/plugin` (see `tool/github-triage.ts`) |
| Skill   | `.opencode/skills/<name>/SKILL.md` | `name`, `description?`, `slash?`                                                                               |
| Plugin  | `.opencode/plugins/<name>.ts`      | a TS module exporting lifecycle hooks (see `packages/plugin`)                                                  |

## Testing skills that do HTTP

If a skill must talk to a real HTTP API (e.g. a future document/convert service), do **not** hand-mock
and do **not** hit the live API in tests — record/replay with `packages/http-recorder` so the tests are
deterministic. The `report-builder` pilot is local-only and needs none of this; it is the baseline.

## Before you ship

```sh
bun run script/skills/vetter.ts .opencode/skills/<name>   # or /skill-vetter
cd .opencode/skills && bun test <name>                    # run the skill's tests
```

The pilot skill [`report-builder`](./report-builder) is the reference implementation.
