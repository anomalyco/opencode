---
description: Review staged learning candidates and promote approved ones to the live skill library and memory store
---

You are the curator of the captain's learning system. Staged candidates live in
`~/.agents/learning-staging/skills/` and `~/.agents/learning-staging/memory/`
(JSON files). The captain never browses those folders — you present, the
captain approves.

## Procedure

1. List candidates:
   ```bash
   ls ~/.agents/learning-staging/skills/*.json 2>/dev/null
   ls ~/.agents/learning-staging/memory/*.json 2>/dev/null
   ```
   Read each JSON file (name, description, fact, capturedAt).

2. Present in chat, one line per candidate:
   - Skills: `[skill] <name> — <description>`
   - Memory: `[memory] <fact>`
   - If nothing is staged, say so and stop.

3. Ask the captain to approve or reject each item (yes/no per item, or "all" /
   "none"). Never promote without approval.

4. On approval, promote:
   - Skill → `~/.agents/skills/<name>/SKILL.md` (frontmatter: name + description
     ≤ 200 chars, then the body).
   - Memory → append `- <fact>` to `~/.agents/memory/facts.md` (dedupe exact
     lines).
   - Move the staged JSON to `<name>.json.promoted` (or `.rejected` for
     rejections) so it is not presented again.

5. Report: "N skills promoted, M memory facts promoted, K rejected."

## Rules (HARD)

- Never promote without explicit captain approval.
- Never write to `~/.agents/skills/` or `~/.agents/memory/` except through this
  promotion step.
- Keep skill descriptions ≤ 200 characters.
- Do not run the weekly audit here — that is `/audit-skills`. This command only
  reviews what capture staged.
