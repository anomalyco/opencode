# automation

## GET /api/experimental/automation (experimental)

List automations, oldest first.

Parameters:
- `sessionID?: string` Only automations created by this Session.
- `directory?: string` Only automations in the project that owns this directory.

Returns: `{ data: Automation.Info[] }`

## POST /api/experimental/automation (experimental)

Create an automation that sends a prompt, runs a Code Mode program, or runs a shell command at a time, every interval, or on a cron. Creating an MCP event watch requires the automation_create tool in a local session; a session ID over HTTP is not a watch authorization.

Body:
- `sessionID?: string`
- `directory?: string` Where it runs when there is no Session. Defaults to the server user's home folder.
- `name: string` A short label shown in lists.
- `trigger: Automation.Trigger`
- `action: Automation.ActionInput`
- `expires?: string`

Returns: `{ data: Automation.Info }`

## GET /api/experimental/automation/{automationID} (experimental)

Read one automation.

Returns: `{ data: Automation.Info }`

## DELETE /api/experimental/automation/{automationID} (experimental)

Delete an automation.

Returns: nothing

## POST /api/experimental/automation/{automationID}/pause (experimental)

Stop an automation from running until it is resumed.

Returns: `{ data: Automation.Info }`

## POST /api/experimental/automation/{automationID}/resume (experimental)

Resume a paused automation. A missed `at` runs once; repeating timers resume at their next slot. Event watches request replay from their saved cursor.

Returns: `{ data: Automation.Info }`

## Types

- `Automation.ActionInput`: `Automation.PromptActionInput | Automation.CodeActionInput | Automation.ShellActionInput`
- `Automation.CodeActionInput`: `{ type: "code"; code: string; args?: unknown }`
- `Automation.Info`: `{ id, name, projectID, sessionID, directory, trigger, tz, action, expires, status, nextDueAt, runCount, lastRunAt, lastOutcome, lastOutput, state, time }`
- `Automation.PromptActionInput`: `{ type: "prompt"; prompt: string; to?: Automation.Target }`
- `Automation.ShellActionInput`: `{ type: "shell"; command: string }`
- `Automation.Target`: `{ session: string; subagent?: unknown } | { subagent: string; session?: unknown }`
- `Automation.Trigger`: `Automation.Trigger.At | Automation.Trigger.Every | Automation.Trigger.Cron | Automation.Trigger.Event`
- `Automation.Trigger.At`: `{ type: "at"; at: string; tz?: string }`
- `Automation.Trigger.Cron`: `{ type: "cron"; cron: string; tz?: string }`
- `Automation.Trigger.Event`: `{ type: "event"; server: string; event: string; args?: Record<string, unknown> }`
- `Automation.Trigger.Every`: `{ type: "every"; every: string; tz?: string }`
