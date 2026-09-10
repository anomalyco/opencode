export const ASYNC_TASK_STATUS = "[attached async tasks: 0]"

export const ASYNC_TASK_PROTOCOL = [
  "**Async Task Protocol**",
  "",
  "Usage:",
  "",
  "`async: true` starts the agent asynchronously; Task produces a running receipt without waiting for the agent's A2A return. When `async` is omitted, Task waits for the A2A return.",
  "",
  "A prompt sent with a running task's `task_id` joins that task's conversation as a supplemental prompt. It is registered and queued for admission immediately. Once admitted, the model incorporates it at the next history reload; if the turn has already ended, it starts a new one.",
  "",
  "Because async Task results and errors are delivered automatically, sleeping, polling for progress, or requesting status is unnecessary.",
  "",
  "Continue with non-overlapping tasks, or yield/wait for the result.",
  "",
  "Returning to Caller:",
  "",
  "A called-agent cannot A2A-return to its caller-agent while any async Task attached to that Task invocation remains outstanding.",
  "While attached async tasks remain, a turn-end response is a yield and does not return to caller.",
  "",
  `After a Task invocation has had attached async Tasks and none remain attached, the system will report to the Task invocation's agent \`${ASYNC_TASK_STATUS}\`. When no attached tasks remain, a called-agent's next turn-end response is relayed as the A2A-return to its caller-agent.`,
  "",
  "The A2A-return must be a complete, self-contained answer to the caller's task, based on the task, relevant results and context, and the agent(s) reasoning.",
].join("\n")
