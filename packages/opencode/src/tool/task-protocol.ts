export const ASYNC_TASK_STATUS = "[attached async tasks: 0]"

export const ASYNC_TASK_PROTOCOL = [
  "**Async Task Protocol**",
  "",
  "Usage:",
  "",
  "`async: true` starts the subagent asynchronously; Task returns a running receipt instead of waiting for the subagent's result. When `async` is omitted, Task waits for the result.",
  "",
  "A prompt sent with a running task's `task_id` joins that task's conversation as a supplemental prompt. It is registered and queued for admission immediately. Once admitted, the subagent takes it into account at its next history reload; if its turn has already ended, the prompt starts a new one.",
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
