import { z } from "zod"

// Enum status
export const StatusEnum = z.enum(["pending", "in_progress", "completed"])
// Enum priority
export const PriorityEnum = z.enum(["high", "medium", "low"])

// Schema for todo info
export const TodoInfo = z.object({
  content: z.string().min(1).describe("Brief description of the task"),
  status: StatusEnum.describe("Current status of the task"),
  priority: PriorityEnum.describe("Priority level of the task"),
  id: z.string().describe("Unique identifier for the todo item"),
})
export type StatusEnum = z.infer<typeof StatusEnum>
export type PriorityEnum = z.infer<typeof PriorityEnum>
export type TodoInfo = z.infer<typeof TodoInfo>
