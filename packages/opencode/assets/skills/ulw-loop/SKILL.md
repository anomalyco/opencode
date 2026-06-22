---
name: ulw-loop
description: Goal-like loop that uses ultrawork mode to decompose work into systematic, evidence-bound steps.
metadata:
  short-description: Goal-like ultrawork loop for systematic decomposition
---

# ulw-loop

Use this skill when the user asks for `ulw-loop`, `ulw`, durable goal execution, evidence-led work, manual QA, or checkpointed long-running delivery.

This skill is intentionally compact. The full workflow lives in `references/full-workflow.md`. Read only the sections needed for the current phase, then execute them exactly.

## Required First Steps

1. Open `references/full-workflow.md`.
2. Read through **Bootstrap** (including its tier triage), **Execution Loop**, and the **Manual-QA channels** table before running any ULW command or recording evidence.
3. If the task has code edits, tests, QA, or commit work, follow the full workflow's delegation and evidence rules. Tests alone never prove done.

## Non-Negotiables

- Use the ulw-loop CLI state under `.omo/ulw-loop`; do not hand-edit goal state.
- After any compaction or context loss, re-read brief + goals + ledger FIRST (`omo sparkshell cat .omo/ulw-loop/ledger.jsonl` or read directly) plus `omo ulw-loop status --json`, then resume; never re-plan from scratch.
- If `omo ulw-loop create-goals` says the existing aggregate is already complete, start unrelated new work with a fresh `--session-id <new-id>` instead of steering or forcing the completed default state. Use `--force` only to intentionally overwrite completed evidence.
- Every success criterion needs observable evidence from a real surface: a channel (tmux, HTTP, browser, computer-use) or, for CLI- or data-shaped criteria, an auxiliary surface (CLI stdout, DB diff, parsed config dump).
- Record evidence through the CLI only after cleanup receipts are available.
- Delegate code edits, test writes, fixes, and QA execution to right-sized Codex subagents when the workflow requires it.
- Every `multi_agent_v1.spawn_agent` message starts with `TASK:`, then names `DELIVERABLE`, `SCOPE`, and `VERIFY`; put role and specialty instructions inside `message`; use `fork_context: false` unless full history is truly required.
- Plan and reviewer agents may run for a long time; spawn them in the background, keep doing independent root work, and poll with short `multi_agent_v1.wait_agent` cycles. Never use a single long blocking wait for them.
- For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long reading, testing, or review passes, and `BLOCKED: <reason>` only when it cannot progress.
- Track spawned agent names locally. Use `multi_agent_v1.wait_agent` for mailbox signals, not proof of completion. A timeout only means no new mailbox update arrived. Treat a running child as alive.
- While children run, surface the active subagent count, agent names, and latest `WORKING:` phase.
- Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running. Then record inconclusive and respawn a smaller `fork_context: false` task with the missing deliverable.
- Use `git-master` for git-tracked edits: inspect recent and touched-path commit history, then commit each verified work unit atomically in the repository's observed language, scope, and message style with only that unit's files staged.

## Codex Tool Mapping

The full workflow may mention OpenCode-style orchestration examples. In Codex, translate them to native tools:

| Workflow intent | Codex tool |
| --- | --- |
| Plan agent | `multi_agent_v1.spawn_agent({"message":"TASK: act as a planning agent. ...","fork_context":false})` |
| Search/read-only worker | `multi_agent_v1.spawn_agent({"message":"TASK: act as an explorer. ...","fork_context":false})` |
| Implementation or QA worker | `multi_agent_v1.spawn_agent({"message":"TASK: act as an implementation or QA worker. ...","fork_context":false})` |
| Final verification reviewer | `multi_agent_v1.spawn_agent({"message":"TASK: act as a rigorous reviewer. ...","fork_context":false})` |
| Wait for background result | `multi_agent_v1.wait_agent(...)` |
| Clean up finished worker | `multi_agent_v1.close_agent(...)` |

When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`.
