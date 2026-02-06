export const EVENTS = {
  TASK_CREATED: "task:created",
  TASK_UPDATED: "task:updated",
  TASK_PROGRESS: "task:progress",
  TASK_COMPLETED: "task:completed",
  TASK_ERROR: "task:error",
  TASK_BLOCKED: "task:blocked",
  TASK_UNBLOCKED: "task:unblocked",
  TASK_PAUSED: "task:paused",
  TASK_RESUMED: "task:resumed",
  TASK_CANCELLED: "task:cancelled",
  TASK_SUBMIT: "task:submit",
  BOARD_EMPTY: "board:empty",
  AGENT_DECISION: "agent:decision",
  USER_INPUT: "user:input",
  USER_INTERRUPT: "user:interrupt",
} as const

export type EventType = (typeof EVENTS)[keyof typeof EVENTS]
