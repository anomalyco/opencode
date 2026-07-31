import type { FeishuPort, FeishuReplyResult } from "./feishu-channel"
import type { ChatPort } from "./opencode"
import { splitMessage } from "./sentence"
import type { GatewayEventInput, GatewayStore, GatewayTask, TaskState } from "./store"

export type PreModelRouteResult =
  | { handled: false }
  | { handled: true; text: string; route: "inventory"; status: string }

export type PreModelRoute = {
  handle(task: GatewayTask): Promise<PreModelRouteResult>
}

export type GatewayWorker = {
  enqueue(taskID: string): void
  recover(): Promise<void>
  idle(): Promise<void>
  stop(): Promise<void>
}

export function createGatewayWorker(input: {
  store: GatewayStore
  chat: ChatPort
  feishu: FeishuPort
  preModelRoute: PreModelRoute
  maxConcurrency: number
  replyAttempts: number
  replyTimeoutMs: number
  now: () => number
}): GatewayWorker {
  const queues = new Map<string, GatewayTask[]>()
  const activeSessions = new Set<string>()
  const scheduled = new Set<string>()
  const drains = new Set<Promise<void>>()
  const semaphore = createSemaphore(input.maxConcurrency)
  let accepting = true

  const enqueue = (taskID: string) => {
    if (!accepting) return
    const target = input.store.getTask(taskID)
    if (!target || isTerminal(target.state)) return

    const queue = queues.get(target.sessionID) ?? []
    input.store
      .recoverableTasks()
      .filter((task) => task.sessionID === target.sessionID && !scheduled.has(task.id))
      .forEach((task) => {
        scheduled.add(task.id)
        queue.push(task)
      })
    queue.sort((left, right) => left.receiveSequence - right.receiveSequence)
    queues.set(target.sessionID, queue)
    if (activeSessions.has(target.sessionID)) return

    activeSessions.add(target.sessionID)
    const drain = drainSession(target.sessionID)
      .catch(() => undefined)
      .finally(() => drains.delete(drain))
    drains.add(drain)
  }

  const processSafely = async (taskID: string) => {
    try {
      await processTask(taskID)
    } catch {
      const task = input.store.getTask(taskID)
      if (!task || isTerminal(task.state)) return
      input.store.transition(task.id, "failed", {
        event: event(task, {
          eventType: "task_failed",
          actor: "gateway",
          status: "failed",
          content: { stage: task.state },
        }),
      })
    }
  }

  async function drainSession(sessionID: string) {
    const queue = queues.get(sessionID)
    for (;;) {
      const task = queue?.shift()
      if (!task) break
      await semaphore.acquire()
      try {
        await processSafely(task.id)
      } finally {
        semaphore.release()
        scheduled.delete(task.id)
      }
    }
    queues.delete(sessionID)
    activeSessions.delete(sessionID)
  }

  async function processTask(taskID: string): Promise<void> {
    const task = input.store.getTask(taskID)
    if (!task || isTerminal(task.state)) return
    if (task.state === "sending") {
      input.store.transition(task.id, "uncertain_delivery", {
        event: event(task, {
          eventType: "delivery_uncertain",
          actor: "gateway",
          status: "uncertain_delivery",
          content: { reason: "restart_during_send" },
        }),
      })
      return
    }
    if (task.state === "answered") {
      await deliver(task)
      return
    }
    if (task.state === "running") {
      await answer(task)
      return
    }
    if (task.state === "admitted") {
      input.store.transition(task.id, "running", {
        event: event(task, {
          eventType: "model_started",
          actor: "gateway",
          status: "running",
          content: {
            sessionID: task.sessionID,
            promptMessageID: task.promptMessageID,
          },
        }),
      })
      return processTask(task.id)
    }

    input.store.transition(task.id, "admitted", {
      event: event(task, {
        eventType: "task_admitted",
        actor: "gateway",
        status: "admitted",
        content: {
          sessionID: task.sessionID,
          promptMessageID: task.promptMessageID,
        },
      }),
    })
    return processTask(task.id)
  }

  async function answer(task: GatewayTask) {
    const route = await input.preModelRoute.handle(task)
    if (route.handled) {
      input.store.appendEvent(
        event(task, {
          eventType: "route_selected",
          actor: "gateway",
          status: "running",
          content: { route: route.route, version: 1, status: route.status },
        }),
      )
      await persistAnswer(task, route.text, { outcome: "success", route: route.route })
      return processTask(task.id)
    }

    const result = await input.chat.complete(task)
    if (result.ok) {
      await persistAnswer(task, result.value.text, {
        outcome: "success",
        model: result.value.model,
      })
      return processTask(task.id)
    }

    await persistAnswer(task, `处理失败，请稍后重试。追踪号：${task.traceID}`, {
      outcome: "failure",
      kind: result.error.kind,
      retryable: result.error.retryable,
    })
    return processTask(task.id)
  }

  async function persistAnswer(task: GatewayTask, text: string, details: Record<string, unknown>) {
    const messageID = `answer_${task.turnID}`
    const complete = event(task, {
      eventType: "answer_recorded",
      actor: "assistant",
      status: "answered",
      messageID,
      content: { ...details, text },
    })
    const sentences = await splitMessage(messageID, text)
    input.store.transition(task.id, "answered", {
      answer: text,
      event: complete,
    })
    sentences.forEach((sentence) =>
      input.store.appendEvent(
        event(task, {
          eventType: "answer_recorded_sentence",
          actor: "assistant",
          status: "answered",
          messageID,
          sentenceID: sentence.id,
          sentenceIndex: sentence.index,
          parentEventID: complete.eventID,
          content: { text: sentence.text },
        }),
      ),
    )
  }

  async function deliver(task: GatewayTask): Promise<void> {
    if (!task.answer) throw new Error("Answered gateway task has no persisted answer")
    if (task.sendAttempts >= input.replyAttempts) {
      input.store.transition(task.id, "failed", {
        event: event(task, {
          eventType: "delivery_failed",
          actor: "gateway",
          status: "failed",
          content: { reason: "attempts_exhausted", attempts: task.sendAttempts },
        }),
      })
      return
    }

    const attempt = task.sendAttempts + 1
    const sending = input.store.transition(task.id, "sending", {
      sendAttempts: attempt,
      event: event(task, {
        eventType: attempt === 1 ? "send_attempted" : "send_retried",
        actor: "gateway",
        status: "sending",
        content: { attempt },
      }),
    })
    const result = await settleReply(input.feishu.send(sending, task.answer), input.replyTimeoutMs)
    if (result.kind === "delivered") {
      input.store.transition(task.id, "delivered", {
        event: event(task, {
          eventType: "delivery_confirmed",
          actor: "gateway",
          status: "delivered",
          content: { attempt, externalReplyID: result.externalReplyID },
        }),
      })
      return
    }
    if (result.kind === "uncertain") {
      input.store.transition(task.id, "uncertain_delivery", {
        event: event(task, {
          eventType: "delivery_uncertain",
          actor: "gateway",
          status: "uncertain_delivery",
          content: { attempt, reason: result.reason },
        }),
      })
      return
    }
    if (result.retryable && attempt < input.replyAttempts) {
      input.store.transition(task.id, "answered", {
        event: event(task, {
          eventType: "delivery_not_sent",
          actor: "gateway",
          status: "answered",
          content: { attempt, reason: result.reason, retryable: true },
        }),
      })
      return processTask(task.id)
    }

    input.store.transition(task.id, "failed", {
      event: event(task, {
        eventType: "delivery_failed",
        actor: "gateway",
        status: "failed",
        content: {
          attempt,
          reason: result.reason,
          retryable: result.retryable,
          exhausted: result.retryable,
        },
      }),
    })
  }

  function event(
    task: Pick<GatewayTask, "conversationID" | "turnID" | "traceID">,
    details: Omit<GatewayEventInput, "eventID" | "occurredAt" | "conversationID" | "turnID" | "traceID" | "version">,
  ): GatewayEventInput {
    return {
      eventID: `evt_${crypto.randomUUID()}`,
      occurredAt: input.now(),
      conversationID: task.conversationID,
      turnID: task.turnID,
      traceID: task.traceID,
      version: 1,
      ...details,
    }
  }

  return {
    enqueue,
    async recover() {
      input.store.recoverableTasks().forEach((task) => enqueue(task.id))
      await idle()
    },
    idle,
    async stop() {
      accepting = false
      await idle()
    },
  }

  async function idle(): Promise<void> {
    while (drains.size) await Promise.all(drains)
  }
}

function createSemaphore(limit: number) {
  let active = 0
  const waiting: Array<() => void> = []
  return {
    async acquire() {
      if (active < limit) {
        active++
        return
      }
      await new Promise<void>((resolve) =>
        waiting.push(() => {
          active++
          resolve()
        }),
      )
    },
    release() {
      active--
      waiting.shift()?.()
    },
  }
}

function isTerminal(state: TaskState) {
  return state === "delivered" || state === "failed" || state === "uncertain_delivery"
}

async function settleReply(promise: Promise<FeishuReplyResult>, timeoutMs: number): Promise<FeishuReplyResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<FeishuReplyResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "uncertain", reason: "timeout" }), timeoutMs)
  })
  return Promise.race([
    promise.catch(() => ({ kind: "uncertain" as const, reason: "exception" })),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
