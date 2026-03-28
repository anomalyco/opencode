import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

// 定义外键错误类型，便于在 SyncEvent.run() 中识别和重试
export const ForeignKeyError = NamedError.create(
  "ForeignKeyError",
  z.object({
    message: z.string(),
  }),
)

// 检测是否为 SQLite 外键约束错误
export function isForeignKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  if ("code" in err && err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") return true
  return "message" in err && typeof err.message === "string" && err.message.includes("FOREIGN KEY constraint failed")
}
