import { formatInventoryAnswer } from "./inventory-answer"
import type { MysqlInventory } from "./mysql-inventory"

export type TrustedFeishuContext = {
  source: "feishu"
  conversationID: string
  messageID: string
  traceID: string
  admittedAt: number
  expiresAt: number
  integrity: string
}

export type InventoryToolResult =
  | { status: "ok"; text: string }
  | { status: "clarify"; text: "请告诉我要查询的商品名称或型号。" }
  | { status: "error"; text: "库存查询失败，请稍后再试。" }

export function createInventoryTool(input: {
  inventory: Pick<MysqlInventory, "query">
  verifyContext(context: TrustedFeishuContext): boolean
  now(): number
}) {
  return {
    async query(request: {
      context?: TrustedFeishuContext
      term: string
    }): Promise<InventoryToolResult> {
      const context = request.context
      if (!isTrustedContextShape(context) || context.expiresAt <= input.now()) {
        return failure()
      }
      const verified = await Promise.resolve()
        .then(() => input.verifyContext(context))
        .catch(() => false)
      if (!verified) return failure()

      const term = typeof request.term === "string" ? request.term.trim() : ""
      if (!term) {
        return {
          status: "clarify",
          text: "请告诉我要查询的商品名称或型号。",
        }
      }

      return input.inventory
        .query(term)
        .then(
          (items): InventoryToolResult => ({
            status: "ok",
            text: formatInventoryAnswer(items),
          }),
        )
        .catch(failure)
    },
  }
}

function isTrustedContextShape(value: unknown): value is TrustedFeishuContext {
  if (!value || typeof value !== "object") return false
  if (!("source" in value) || value.source !== "feishu") return false
  if (!("conversationID" in value) || typeof value.conversationID !== "string" || !value.conversationID) return false
  if (!("messageID" in value) || typeof value.messageID !== "string" || !value.messageID) return false
  if (!("traceID" in value) || typeof value.traceID !== "string" || !value.traceID) return false
  if (!("integrity" in value) || typeof value.integrity !== "string" || !value.integrity) return false
  if (!("admittedAt" in value) || typeof value.admittedAt !== "number" || !Number.isFinite(value.admittedAt)) {
    return false
  }
  return "expiresAt" in value && typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
}

function failure(): InventoryToolResult {
  return {
    status: "error",
    text: "库存查询失败，请稍后再试。",
  }
}
