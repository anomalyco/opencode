import z from "zod"
import { BusEvent } from "../bus/bus-event"

/**
 * Task status type
 */
export const TaskStatus = z.enum(["running", "completed", "failed"])
export type TaskStatus = z.infer<typeof TaskStatus>

/**
 * Task info schema for events
 */
export const TaskInfoSchema = z.object({
  id: z.string(),
  pid: z.number(),
  command: z.string(),
  startTime: z.number(),
  status: TaskStatus,
  exitCode: z.number().optional(),
  workdir: z.string(),
  description: z.string().optional(),
  logFile: z.string(),
  reconnectable: z.boolean(),
})

export type TaskInfo = z.infer<typeof TaskInfoSchema>

/**
 * Event: Task created and started
 */
export const TaskCreated = BusEvent.define(
  "task.created",
  z.object({
    info: TaskInfoSchema,
  }),
)

/**
 * Event: Task output received
 */
export const TaskOutput = BusEvent.define(
  "task.output",
  z.object({
    id: z.string(),
    data: z.string(),
    isError: z.boolean(),
  }),
)

/**
 * Event: Task completed (success or failure)
 */
export const TaskCompleted = BusEvent.define(
  "task.completed",
  z.object({
    id: z.string(),
    exitCode: z.number().nullable(),
    status: TaskStatus,
  }),
)

/**
 * Event: Task killed
 */
export const TaskKilled = BusEvent.define(
  "task.killed",
  z.object({
    id: z.string(),
  }),
)

/**
 * Event: Task reconnected (after restart)
 */
export const TaskReconnected = BusEvent.define(
  "task.reconnected",
  z.object({
    id: z.string(),
    stillRunning: z.boolean(),
  }),
)

export namespace TaskEvent {
  export const Created = TaskCreated
  export const Output = TaskOutput
  export const Completed = TaskCompleted
  export const Killed = TaskKilled
  export const Reconnected = TaskReconnected
}
