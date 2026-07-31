import { formatInventoryAnswer } from "./inventory-answer"
import type { InventoryQueryEvent, MysqlInventory } from "./mysql-inventory"
import type { MysqlPreflight } from "./mysql-preflight"

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
  | {
      status: "ok"
      text: string
      evidence?: {
        templateVersion: "mysql-inventory-v1"
        schemaVersion: "mysql-inventory-v1"
        database: string
        mysqlVersion: string
        rowCount: number
        durationMs: number
        itemCount: number
        mappedItems: string
      }
    }
  | { status: "clarify"; text: "请告诉我要查询的商品名称或型号。" }
  | { status: "error"; text: "库存查询失败，请稍后再试。"; reason: "policy" | "query" }

export function createInventoryTool(input: {
  inventory: Pick<MysqlInventory, "query"> & { preflight?: MysqlPreflight }
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
        return failure("policy")
      }
      const verified = await Promise.resolve()
        .then(() => input.verifyContext(context))
        .catch(() => false)
      if (!verified) return failure("policy")

      const term = typeof request.term === "string" ? request.term.trim() : ""
      if (!term) {
        return {
          status: "clarify",
          text: "请告诉我要查询的商品名称或型号。",
        }
      }

      const events: InventoryQueryEvent[] = []
      return input.inventory
        .query(term, undefined, (event) => {
          events.push(event)
        })
        .then(
          (items): InventoryToolResult => {
            const completed = events.find((event) => event.type === "query_completed")
            const preflight = input.inventory.preflight
            return {
              status: "ok",
              text: formatInventoryAnswer(items),
              ...(completed?.type === "query_completed" && preflight
                ? {
                    evidence: {
                      templateVersion: completed.templateVersion,
                      schemaVersion: preflight.contractVersion,
                      database: preflight.database,
                      mysqlVersion: preflight.mysqlVersion,
                      rowCount: completed.rowCount,
                      durationMs: completed.durationMs,
                      itemCount: items.length,
                      mappedItems: JSON.stringify(items),
                    },
                  }
                : {}),
            }
          },
        )
        .catch(() => failure("query"))
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

function failure(reason: "policy" | "query"): InventoryToolResult {
  return {
    status: "error",
    text: "库存查询失败，请稍后再试。",
    reason,
  }
}
