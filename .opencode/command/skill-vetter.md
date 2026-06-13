---
description: Vet a skill for security/quality issues (SSRF, secrets, unsafe parse, missing tests)
subtask: true
---

Run the skill-vetter against the skill directory you changed, then fix what it reports.

It checks concrete risk patterns, not lines of code — a large, cohesive file is fine. See
`.opencode/skills/AUTHORING.md` for the rules.

## Vetter result

!`bun run script/skills/vetter.ts --json $ARGUMENTS`

## What to do with it

- Fix every **HIGH** finding (network call / hardcoded secret / no tests) before the skill ships.
- Address or justify **MED** findings (raw `JSON.parse`, missing eval set).
- **INFO** (large file) is a prompt to check cohesion, never a failure.
