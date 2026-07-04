import { z } from "zod"

export const StatusEnum = z.enum(["pending", "in_progress", "completed"])
export const PriorityEnum = z.enum(["high", "medium", "low"])
