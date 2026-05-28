---
description: Sprints menu — mirror of Jira / Azure DevOps / GitHub Issues via simplicio-sprint
argument-hint: "[list | run <ISSUE-ID> | watch]"
---

Open the **Sprints** view: a board that mirrors the active sprint from Jira, Azure DevOps, or GitHub Issues, then drives the work through `simplicio-sprint` (aka `sendsprint`).

Sub-commands (parse from `$ARGUMENTS`):

- `list` (default when no args) — fetch the active sprint from every configured tracker and print a unified board grouped by status (To Do / In Progress / Review / Done). Use whichever credentials are present:
  - Jira: `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
  - Azure DevOps: `AZDO_ORG`, `AZDO_PROJECT`, `AZDO_PAT`
  - GitHub: the existing `mcp__github__list_issues` tool
- `run <ISSUE-ID>` — delegate to `script/simplicio/flow.sh --sprint <ISSUE-ID> "<derived task>"`. The flow script calls `sendsprint run --issue <ID>` which: pulls the card, derives a task spec, runs `simplicio task` (Simplicio1 by default), commits to a branch, and opens a draft PR.
- `watch` — start `sendsprint watch` in the background so new sprint cards get processed automatically.

Always show the board first when args are empty; never run a card without explicit `run <ID>`.

Source of truth for credentials and behaviour: `.simplicio/config.json` → `tools.sprint`.
