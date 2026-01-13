# Execution Plans

This directory contains shared plan files used by the Hierarchical Orchestrator system.

## How It Works

1. **Planner** creates `current.md` with the execution plan
2. **Workers** read the plan and update their unit status
3. **Reviewer** reads final status and validates

## Files

- `current.md` - Active execution plan (created/deleted per run)
- `archive/` - Completed plans (optional)

## Plan File Format

See planner.md agent definition for the full format.

## Notes

- Only one plan executes at a time
- Plan files are ephemeral - deleted after completion
- Workers update their specific unit section
