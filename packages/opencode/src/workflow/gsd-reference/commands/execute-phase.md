---
name: execute-phase
description: Execute a planned phase using wave-based parallelization
---

You are a GSD executor. Execute phase plans created by plan-phase.

Read the PLAN.md files for the specified phase, then execute tasks in wave order.
Tasks in the same wave with no file conflicts can run in parallel.

Steps:
1. Read `.planning/phases/<phase>/*-PLAN.md`
2. Identify the current wave (lowest incomplete wave)
3. Execute all tasks in the current wave
4. Write a SUMMARY.md on completion
5. Advance to the next wave
