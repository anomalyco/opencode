import type { GatewayConfig } from "./config"
import { createAdmission } from "./admission"
import { createEventLog } from "./event-log"
import type { FeishuPort } from "./feishu-channel"
import type { ChatPort } from "./opencode"
import type { GatewayStore } from "./store"
import { createGatewayWorker, type PreModelRoute } from "./worker"

export type Gateway = {
  start(): Promise<void>
  idle(): Promise<void>
  stop(): Promise<void>
}

export function createGateway(input: {
  config: GatewayConfig
  feishu: FeishuPort
  chat: ChatPort
  inventoryRoute: PreModelRoute
  store: GatewayStore
  fallbackPath: string
  close?: () => Promise<void>
}): Gateway {
  const worker = createGatewayWorker({
    store: input.store,
    chat: input.chat,
    feishu: input.feishu,
    preModelRoute: input.inventoryRoute,
    maxConcurrency: input.config.maxConcurrency,
    replyAttempts: input.config.replyAttempts,
    replyTimeoutMs: input.config.replyTimeoutMs,
    now: Date.now,
  })
  const admission = createAdmission({
    store: input.store,
    eventLog: createEventLog({ store: input.store }),
    enqueue: (taskID) => worker.enqueue(taskID),
    fallbackPath: input.fallbackPath,
    secrets: [input.config.appSecret],
  })
  let channelOpened = false
  let stopped = false
  let startPromise: Promise<void> | undefined
  let stopPromise: Promise<void> | undefined

  return {
    start() {
      if (stopped) return Promise.reject(new Error("Gateway is stopped"))
      if (startPromise) return startPromise
      startPromise = worker
        .recover()
        .then(() => {
          channelOpened = true
          return input.feishu.start(async (message) => {
            await admission.receive(message)
          })
        })
      return startPromise
    },
    idle: () => worker.idle(),
    stop() {
      if (stopPromise) return stopPromise
      stopped = true
      stopPromise = stopResources()
      return stopPromise
    },
  }

  async function stopResources() {
    const channel = channelOpened
      ? await input.feishu.stop().then(
          () => true,
          () => false,
        )
      : true
    const drained = await worker.stop().then(
      () => true,
      () => false,
    )
    const chat = await input.chat.close().then(
      () => true,
      () => false,
    )
    const extra = await (input.close?.() ?? Promise.resolve()).then(
      () => true,
      () => false,
    )
    const store = await Promise.resolve()
      .then(() => input.store.close())
      .then(
        () => true,
        () => false,
      )
    if (channel && drained && chat && extra && store) return
    throw new Error("Gateway shutdown failed")
  }
}
