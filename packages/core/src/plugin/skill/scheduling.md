---
name: scheduling
description: Schedule recurring prompts with cron_add, list with cron_list, cancel with cron_delete. Use when you need recurring reminders, checks, or automated actions.
---

## Adding a schedule

Use `cron_add` to schedule a prompt:

```
cron_add(interval: "5m", prompt: "Check for new issues")
```

Interval format: `5m`, `1h`, `2h30m`, `90s`. Minimum 1m, max 7d lifespan, max 50 jobs/session.

## Listing

Use `cron_list` to see all scheduled jobs, in the following format:

| ID            | Prompt                | Interval | Run | Next |
| :------------ | :-------------------- | :------- | :-- | :--- |
| `e15f1b62...` | Write "Hello, World!" | 1m       | 6   | ~1m  |

## Cancelling

`cron_delete(id: "id")` for one, `cron_delete(id: "all")` for all.
