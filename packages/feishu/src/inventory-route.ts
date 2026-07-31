import type { InventoryToolResult, TrustedFeishuContext } from "./inventory-tool"
import type { InventoryTraceEvent } from "./inventory-trace"
import type { GatewayTask } from "./store"
import type { PreModelRoute } from "./worker"

export type InventoryIntent =
  | { kind: "chat" }
  | { kind: "clarify" }
  | { kind: "lookup"; productTerm: string }

export function parseInventoryIntent(text: string): InventoryIntent {
  const normalized = text.trim()
  if (!hasInventoryKeyword(normalized) || isUnsafe(normalized)) return { kind: "chat" }

  const quoted = quotedTerms(normalized)
  if (quoted.length > 1) return { kind: "chat" }
  if (quoted.length === 1) return { kind: "lookup", productTerm: quoted[0] }

  const compact = [
    ...new Set(
      (normalized.match(/[A-Za-z0-9][A-Za-z0-9._/-]{1,63}/g) ?? [])
        .filter((term) => /\d/.test(term))
        .map((term) => term.trim()),
    ),
  ]
  if (compact.length > 1) return { kind: "chat" }
  if (compact.length === 1) return { kind: "lookup", productTerm: compact[0] }
  if (remainingQueryText(normalized)) return { kind: "chat" }
  return { kind: "clarify" }
}

export function createInventoryRoute(input: {
  inventory: {
    query(request: { context?: TrustedFeishuContext; term: string }): Promise<InventoryToolResult>
  }
  createContext(task: GatewayTask): TrustedFeishuContext
  record(task: GatewayTask, events: readonly InventoryTraceEvent[]): Promise<void>
  now?: () => number
}): PreModelRoute {
  const now = input.now ?? Date.now

  return {
    async handle(task) {
      const intent = parseInventoryIntent(task.promptText)
      if (intent.kind === "chat") return { handled: false }

      if (intent.kind === "clarify") {
        await input.record(task, [
          trace(task, now(), "inventory_intent_admitted", {
            status: "clarify",
          }),
        ])
        return {
          handled: true,
          text: "请告诉我需要查询的商品名称或型号。",
          route: "inventory",
          status: "clarify",
        }
      }

      const startedAt = now()
      const prefix = [
        trace(task, startedAt, "inventory_intent_admitted", {
          term: intent.productTerm,
          status: "lookup",
        }),
        trace(task, startedAt, "inventory_query_started", {
          templateVersion: "mysql-inventory-v1",
          term: intent.productTerm,
          limit: 20,
        }),
      ] satisfies InventoryTraceEvent[]
      const outcome = await input.inventory.query({
        context: input.createContext(task),
        term: intent.productTerm,
      }).then(
        (result) => ({ result, threw: false }),
        () => ({
          result: {
            status: "error" as const,
            text: "库存查询失败，请稍后再试。" as const,
          },
          threw: true,
        }),
      )
      const completedAt = now()
      if (outcome.threw || outcome.result.status === "error") {
        await input.record(task, [
          ...prefix,
          trace(task, completedAt, "inventory_query_failed", {
            status: "error",
            durationMs: completedAt - startedAt,
          }),
        ])
        return {
          handled: true,
          text: outcome.result.text,
          route: "inventory",
          status: outcome.result.status,
        }
      }

      await input.record(task, [
        ...prefix,
        trace(task, completedAt, "inventory_query_completed", {
          status: outcome.result.status,
          durationMs: completedAt - startedAt,
        }),
        trace(task, completedAt, "inventory_answer_mapped", {
          status: outcome.result.status,
          lineCount: outcome.result.text.split("\n").length,
        }),
      ])
      return {
        handled: true,
        text: outcome.result.text,
        route: "inventory",
        status: outcome.result.status,
      }
    },
  }
}

function trace(
  task: GatewayTask,
  occurredAt: number,
  type: InventoryTraceEvent["type"],
  data: InventoryTraceEvent["data"],
): InventoryTraceEvent {
  return {
    traceID: task.traceID,
    conversationID: task.conversationID,
    messageID: task.promptMessageID,
    type,
    occurredAt,
    data,
  }
}

function hasInventoryKeyword(text: string) {
  return /库存|存货|货架|位置|在哪里|在哪|哪里/.test(text)
}

function isUnsafe(text: string) {
  return (
    /\b(?:select|update|insert|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(text) ||
    /(?:--|\/\*|\*\/|;\s*\S)/.test(text) ||
    /(?:修改|删除|写入|插入|新增|清空|更新).{0,8}(?:库存|存货|货架|位置|记录|数据)|(?:库存|存货|货架|位置|记录|数据).{0,8}(?:修改|删除|写入|插入|新增|清空|更新)/.test(text)
  )
}

function quotedTerms(text: string) {
  return [
    ...text.matchAll(/"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’|「([^」]+)」|『([^』]+)』/g),
  ]
    .map((match) => match.slice(1).find((term) => term !== undefined)?.trim())
    .filter((term): term is string => term !== undefined && term.length > 0)
}

function remainingQueryText(text: string) {
  return text
    .replace(/库存|存货|货架|位置|在哪里|在哪|哪里/g, "")
    .replace(/查一下|查询|查查|查|帮我|请问|请|商品|产品|型号|有多少|多少|哪个|的|在|一下|呢|吗|什么|？|\?|，|,|。|！|!/g, "")
    .replace(/\s/g, "")
}
