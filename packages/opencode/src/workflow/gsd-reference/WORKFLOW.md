---
name: gsd
version: 1.0.0
description: Get Shit Done — structured project planning and execution methodology for CoBuilder
commands:
  - plan-phase
  - execute-phase
  - discuss-phase
---

# GSD Workflow

The GSD (Get Shit Done) workflow provides structured project planning and execution commands
for use with CoBuilder. It implements the plan-phase → execute-phase cycle with discuss-phase
for collaborative refinement.

## Commands

- `/plan-phase` — create a detailed phase plan with task breakdown and dependency analysis
- `/execute-phase` — execute a planned phase with wave-based parallelization
- `/discuss-phase` — gather context and decisions before planning

## Installation

```bash
cobuilder workflow add gsd
```

After installation, restart CoBuilder to activate the slash commands.
