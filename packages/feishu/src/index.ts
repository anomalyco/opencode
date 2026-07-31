import { createHmac, timingSafeEqual } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { parseGatewayConfig } from "./config"
import { createEventLog } from "./event-log"
import { createFeishuChannelPort } from "./feishu-channel"
import { createGateway, type Gateway } from "./gateway"
import { createInventoryRoute } from "./inventory-route"
import { createInventoryTool, type TrustedFeishuContext } from "./inventory-tool"
import { parseMysqlConfig } from "./mysql-config"
import { createMysqlInventory } from "./mysql-inventory"
import { createEmbeddedChatPort, type ChatEvidence } from "./opencode"
import { openGatewayStore, type GatewayTask } from "./store"

export async function main(env: Record<string, string | undefined>): Promise<void> {
  const config = parseGatewayConfig(env)
  const mysqlConfig = parseMysqlConfig(env)
  await mkdir(config.dataDirectory, { recursive: true })
  const store = openGatewayStore(join(config.dataDirectory, "gateway.sqlite"), [config.appSecret])
  const inventory = await createMysqlInventory(mysqlConfig).catch(() => {
    store.close()
    throw new Error("MySQL inventory preflight failed")
  })
  const eventLog = createEventLog({ store })
  const tool = createInventoryTool({
    inventory,
    verifyContext: (context) => verifyContext(config.appSecret, context),
    now: Date.now,
  })
  const inventoryRoute = createInventoryRoute({
    inventory: tool,
    createContext: (task) => createContext(config.appSecret, task),
    record: async (task, events) => {
      events.forEach((event) => eventLog.inventory(task, event))
    },
  })
  const chat = await createEmbeddedChatPort({
    config,
    record: async (task, evidence) => {
      eventLog.append(task, chatEvent(evidence))
    },
  }).catch(async () => {
    await inventory.close().catch(() => undefined)
    store.close()
    throw new Error("OpenCode model preflight failed")
  })
  const feishu = await createFeishuChannelPort(config).catch(async () => {
    await chat.close().catch(() => undefined)
    await inventory.close().catch(() => undefined)
    store.close()
    throw new Error("Feishu Channel initialization failed")
  })
  const gateway = createGateway({
    config,
    feishu,
    chat,
    inventoryRoute,
    store,
    fallbackPath: join(config.dataDirectory, "fallback.jsonl"),
    close: () => inventory.close(),
  })

  if (env.FEISHU_PREFLIGHT_ONLY?.trim().toLowerCase() === "true") {
    await gateway.stop()
    return
  }
  await gateway.start().catch(async () => {
    await gateway.stop().catch(() => undefined)
    throw new Error("Feishu gateway startup failed")
  })
  await waitForShutdown(gateway)
}

function createContext(secret: string, task: GatewayTask): TrustedFeishuContext {
  const admittedAt = Date.now()
  const context = {
    source: "feishu" as const,
    conversationID: task.conversationID,
    messageID: task.promptMessageID,
    traceID: task.traceID,
    admittedAt,
    expiresAt: admittedAt + 5 * 60_000,
  }
  return {
    ...context,
    integrity: signContext(secret, context),
  }
}

function verifyContext(secret: string, context: TrustedFeishuContext) {
  const expected = Buffer.from(signContext(secret, context), "hex")
  const actual = Buffer.from(context.integrity, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function signContext(
  secret: string,
  context: Pick<TrustedFeishuContext, "source" | "conversationID" | "messageID" | "traceID" | "admittedAt" | "expiresAt">,
) {
  return createHmac("sha256", secret)
    .update(
      [
        context.source,
        context.conversationID,
        context.messageID,
        context.traceID,
        context.admittedAt,
        context.expiresAt,
      ].join("\0"),
    )
    .digest("hex")
}

function chatEvent(evidence: ChatEvidence) {
  const provider = evidence.type === "model_completed" || evidence.type === "model_failed"
  const status =
    evidence.type === "model_completed"
      ? "completed"
      : evidence.type === "model_failed"
        ? "failed"
        : evidence.type === "operation_blocked"
          ? "blocked"
          : "recorded"
  return {
    eventType: evidence.type,
    actor: provider ? ("provider" as const) : ("gateway" as const),
    status,
    content: evidence,
  }
}

async function waitForShutdown(gateway: Gateway) {
  let closing = false
  let shutdown = () => undefined
  const stopped = new Promise<void>((resolve, reject) => {
    shutdown = () => {
      if (closing) return
      closing = true
      void gateway.stop().then(resolve, () => reject(new Error("Feishu gateway shutdown failed")))
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  })
  await stopped.finally(() => {
    process.off("SIGINT", shutdown)
    process.off("SIGTERM", shutdown)
  })
}

if (import.meta.main) {
  void main(Bun.env).catch(() => {
    console.error("Feishu gateway stopped because startup or runtime validation failed.")
    process.exitCode = 1
  })
}
