Poll the status of a background subagent task launched with the task tool.

Use this for tasks started with `task(background=true)`.

Parameters:
- `task_id` (required): the task session id returned by the task tool
- `wait` (optional): when true, wait for completion
- `timeout_ms` (optional): max wait duration in milliseconds when `wait=true`

Returns compact, parseable output:
- `task_id`
- `state` (`running`, `completed`, `error`, or `cancelled`)
- `<task_result>...</task_result>` or `<task_error>...</task_error>` containing final output, error summary, or current progress text
