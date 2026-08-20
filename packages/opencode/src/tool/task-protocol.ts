export const ASYNC_TASK_STATUS = "[attached async tasks: 0]"

export const ASYNC_TASK_PROTOCOL = [
  "**Async Task Protocol**",
  "",
  "Usage:",
  "",
  "`async: true` starts the subagent asynchronously; Task returns a running receipt instead of waiting for the subagent's result. When `async` is omitted, Task waits for the result.",
  "",
  "Async results and errors are delivered to you automatically, so sleeping, polling for progress, or asking for status is unnecessary.",
  "",
  "Continue with non-overlapping work, or wait for the result.",
  "",
  "Returning your result:",
  "",
  "You cannot return your result to your caller while any async Task you started from this invocation is still outstanding.",
  "While those tasks remain, ending your turn is a wait — it does not return your result.",
  "",
  `Once every async Task started from this invocation has finished, the system reports \`${ASYNC_TASK_STATUS}\`. Your next turn-end response is then returned to your caller.`,
  "",
  "That result must be a complete, self-contained answer to the task you were given, drawing on the task, the results you collected, and your own reasoning.",
].join("\n")
