import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FeishuPort, FeishuReplyResult, NormalizedFeishuMessage } from "../src/feishu-channel"
import { createInventoryRoute } from "../src/inventory-route"
import type { ChatCompletion, ChatFailure, ChatPort } from "../src/opencode"
import {
  openGatewayStore,
  type GatewayEventInput,
  type GatewayStore,
  type GatewayTask,
  type NewGatewayTask,
  type TaskState,
} from "../src/store"
import {
  createGatewayWorker,
  type PreModelRoute,
} from "../src/worker"

const directories: string[] = []
const stores: GatewayStore[] = []

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("gateway worker", () => {
  test("serializes one Session in receive order while different Sessions overlap within the limit", async () => {
    const store = await createStore()
    admit(store, task("task_1", "session_a"))
    admit(store, task("task_2", "session_a"))
    admit(store, task("task_3", "session_b"))
    const gates = new Map<string, ReturnType<typeof deferred>>()
    const timeline: string[] = []
    let active = 0
    let maximum = 0
    const chat = fakeChat(async (current) => {
      timeline.push(`start:${current.id}`)
      active++
      maximum = Math.max(maximum, active)
      const gate = deferred()
      gates.set(current.id, gate)
      await gate.promise
      active--
      timeline.push(`end:${current.id}`)
      return completed(current.id)
    })
    const worker = createWorker(store, chat, fakeFeishu())

    worker.enqueue("task_2")
    worker.enqueue("task_3")
    await waitFor(() => gates.has("task_1") && gates.has("task_3"))
    expect(gates.has("task_2")).toBeFalse()
    gates.get("task_1")!.resolve()
    gates.get("task_3")!.resolve()
    await waitFor(() => gates.has("task_2"))
    gates.get("task_2")!.resolve()
    await worker.idle()

    expect(maximum).toBe(2)
    expect(timeline.indexOf("start:task_2")).toBeGreaterThan(timeline.indexOf("end:task_1"))
    expect(["task_1", "task_2", "task_3"].map((id) => store.getTask(id)?.state)).toEqual([
      "delivered",
      "delivered",
      "delivered",
    ])
  })

  test("coalesces duplicate enqueue and releases a Session after one task throws", async () => {
    const store = await createStore()
    admit(store, task("task_1", "session_a"))
    admit(store, task("task_2", "session_a"))
    const chat = fakeChat(async (current) => {
      if (current.id === "task_1") throw new Error("provider-secret")
      return completed(current.id)
    })
    const feishu = fakeFeishu()
    const worker = createWorker(store, chat, feishu)

    worker.enqueue("task_1")
    worker.enqueue("task_1")
    worker.enqueue("task_2")
    await worker.idle()

    expect(chat.calls).toEqual(["task_1", "task_2"])
    expect(store.getTask("task_1")?.state).toBe("failed")
    expect(store.getTask("task_2")?.state).toBe("delivered")
    expect(feishu.calls.map((item) => item.task.id)).toEqual(["task_2"])
    expect(JSON.stringify(store.eventsForTrace("trace_task_1"))).not.toContain("provider-secret")
  })

  test("recovers each durable state without rerunning delivered or ambiguous sends", async () => {
    const store = await createStore()
    const states = [
      ["received", "received"],
      ["admitted", "admitted"],
      ["running", "running"],
      ["answered", "answered"],
      ["sending", "sending"],
      ["delivered", "delivered"],
      ["uncertain", "uncertain_delivery"],
    ] as const
    states.forEach(([id, state]) => {
      admit(store, task(id, `session_${id}`))
      advanceTo(store, id, state)
    })
    const chat = fakeChat(async (current) => completed(current.id))
    const feishu = fakeFeishu()
    const worker = createWorker(store, chat, feishu)

    await worker.recover()

    expect(chat.calls.sort()).toEqual(["admitted", "received", "running"])
    expect(feishu.calls.map((item) => item.task.id).sort()).toEqual(["admitted", "answered", "received", "running"])
    expect(store.getTask("sending")?.state).toBe("uncertain_delivery")
    expect(store.getTask("delivered")?.state).toBe("delivered")
    expect(store.getTask("uncertain")?.state).toBe("uncertain_delivery")
  })

  test("recovers an unnamed group requester into delivery without changing the answer body", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feishu-worker-mention-recovery-"))
    directories.push(directory)
    const path = join(directory, "gateway.sqlite")
    const initial = openGatewayStore(path)
    admit(initial, {
      ...task("mention_recovery", "session_mention_recovery"),
      replyMentionID: "ou_requester",
    })
    initial.close()
    const store = openGatewayStore(path)
    stores.push(store)
    const body = "6001ZZ（货架号：A-2-1）库存177"
    const feishu = fakeFeishu()
    const worker = createWorker(store, fakeChat(async () => completed("mention_recovery", body)), feishu)

    await worker.recover()

    expect(feishu.calls).toHaveLength(1)
    expect(feishu.calls[0]).toMatchObject({
      task: { replyMentionID: "ou_requester", answer: "6001ZZ（货架号：A-2-1）库存177" },
      text: "6001ZZ（货架号：A-2-1）库存177",
    })
    expect(feishu.calls[0]?.task).not.toHaveProperty("replyMentionName")
    expect(store.getTask("mention_recovery")).toMatchObject({
      state: "delivered",
      replyMentionID: "ou_requester",
      answer: "6001ZZ（货架号：A-2-1）库存177",
    })
  })

  test("uses a handled pre-model route byte-for-byte without calling chat", async () => {
    const store = await createStore()
    const inventoryTask = task("inventory", "session_inventory")
    inventoryTask.promptText = "6001ZZ库存和位置"
    inventoryTask.originalText = inventoryTask.promptText
    admit(store, inventoryTask)
    const chat = fakeChat(async (current) => completed(current.id))
    const feishu = fakeFeishu()
    const inventoryCalls: string[] = []
    const route = createInventoryRoute({
      inventory: {
        async query(request) {
          inventoryCalls.push(request.term)
          return {
            status: "ok",
            text: "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
          }
        },
      },
      createContext: (current) => ({
        source: "feishu",
        conversationID: current.conversationID,
        messageID: current.promptMessageID,
        traceID: current.traceID,
        admittedAt: 1_000,
        expiresAt: 2_000,
        integrity: "trusted",
      }),
      record: async () => {},
    })
    const worker = createWorker(store, chat, feishu, { route })

    worker.enqueue("inventory")
    await worker.idle()

    expect(chat.calls).toEqual([])
    expect(inventoryCalls).toEqual(["6001ZZ"])
    expect(feishu.calls[0]?.text).toBe(
      "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
    )
    expect(store.eventsForTrace("trace_inventory")).toContainEqual(
      expect.objectContaining({
        eventType: "route_selected",
        content: { route: "inventory", version: 1, status: "ok" },
      }),
    )
  })

  test("sends one fixed trace-bearing response for classified model failure", async () => {
    const store = await createStore()
    admit(store, task("failure", "session_failure"))
    const chat = fakeChat(async () => ({
      ok: false,
      error: {
        kind: "authentication",
        retryable: false,
        message: "Model authentication failed.",
      },
    }))
    const feishu = fakeFeishu()
    const worker = createWorker(store, chat, feishu)

    worker.enqueue("failure")
    await worker.idle()

    expect(feishu.calls).toHaveLength(1)
    expect(feishu.calls[0]?.text).toContain("trace_failure")
    expect(feishu.calls[0]?.text).not.toContain("authentication")
    expect(store.getTask("failure")?.state).toBe("delivered")
  })

  test("retries only confirmed non-delivery and stops on exhaustion, final failure, uncertainty, or timeout", async () => {
    const store = await createStore()
    const ids = ["delivered", "retry", "exhausted", "final", "uncertain", "timeout"]
    ids.forEach((id) => admit(store, task(id, `session_${id}`)))
    const outcomes = new Map<string, FeishuReplyResult[]>([
      ["delivered", [{ kind: "delivered", externalReplyID: "reply_delivered" }]],
      [
        "retry",
        [
          { kind: "not_sent", retryable: true, reason: "rate_limited" },
          { kind: "delivered", externalReplyID: "reply_retry" },
        ],
      ],
      [
        "exhausted",
        [
          { kind: "not_sent", retryable: true, reason: "rate_limited" },
          { kind: "not_sent", retryable: true, reason: "rate_limited" },
        ],
      ],
      ["final", [{ kind: "not_sent", retryable: false, reason: "permission_denied" }]],
      ["uncertain", [{ kind: "uncertain", reason: "network" }]],
    ])
    const feishu = fakeFeishu(async (current) => {
      if (current.id === "timeout") return new Promise<FeishuReplyResult>(() => undefined)
      return outcomes.get(current.id)!.shift()!
    })
    const worker = createWorker(store, fakeChat(async (current) => completed(current.id)), feishu, {
      replyAttempts: 2,
      replyTimeoutMs: 10,
    })

    ids.forEach((id) => worker.enqueue(id))
    await worker.idle()
    worker.enqueue("delivered")
    await worker.idle()

    expect(store.getTask("delivered")).toEqual(expect.objectContaining({ state: "delivered", sendAttempts: 1 }))
    expect(store.getTask("retry")).toEqual(expect.objectContaining({ state: "delivered", sendAttempts: 2 }))
    expect(store.getTask("exhausted")).toEqual(expect.objectContaining({ state: "failed", sendAttempts: 2 }))
    expect(store.getTask("final")).toEqual(expect.objectContaining({ state: "failed", sendAttempts: 1 }))
    expect(store.getTask("uncertain")).toEqual(
      expect.objectContaining({ state: "uncertain_delivery", sendAttempts: 1 }),
    )
    expect(store.getTask("timeout")).toEqual(expect.objectContaining({ state: "uncertain_delivery", sendAttempts: 1 }))
    expect(feishu.calls.filter((item) => item.task.id === "delivered")).toHaveLength(1)
  })

  test("retries a named group requester with unchanged metadata and answer body", async () => {
    const store = await createStore()
    admit(store, {
      ...task("mention_retry", "session_mention_retry"),
      replyMentionID: "ou_requester",
      replyMentionName: "求精轴承",
    })
    const body = "6001ZZ（货架号：A-2-1）库存177"
    const outcomes: FeishuReplyResult[] = [
      { kind: "not_sent", retryable: true, reason: "rate_limited" },
      { kind: "delivered", externalReplyID: "reply_mention_retry" },
    ]
    const feishu = fakeFeishu(async () => outcomes.shift()!)
    const worker = createWorker(store, fakeChat(async () => completed("mention_retry", body)), feishu, {
      replyAttempts: 2,
    })

    worker.enqueue("mention_retry")
    await worker.idle()

    expect(
      feishu.calls.map((item) => ({
        replyMentionID: item.task.replyMentionID,
        replyMentionName: item.task.replyMentionName,
        answer: item.task.answer,
        text: item.text,
      })),
    ).toEqual([
      {
        replyMentionID: "ou_requester",
        replyMentionName: "求精轴承",
        answer: "6001ZZ（货架号：A-2-1）库存177",
        text: "6001ZZ（货架号：A-2-1）库存177",
      },
      {
        replyMentionID: "ou_requester",
        replyMentionName: "求精轴承",
        answer: "6001ZZ（货架号：A-2-1）库存177",
        text: "6001ZZ（货架号：A-2-1）库存177",
      },
    ])
    expect(store.getTask("mention_retry")).toMatchObject({
      state: "delivered",
      sendAttempts: 2,
      replyMentionID: "ou_requester",
      replyMentionName: "求精轴承",
      answer: "6001ZZ（货架号：A-2-1）库存177",
    })
  })
})

function createWorker(
  store: GatewayStore,
  chat: ChatPort & { calls: string[] },
  feishu: FeishuPort & { calls: Array<{ task: GatewayTask; text: string }> },
  overrides: {
    route?: PreModelRoute
    maxConcurrency?: number
    replyAttempts?: number
    replyTimeoutMs?: number
  } = {},
) {
  let now = 1_700_000_000_000
  return createGatewayWorker({
    store,
    chat,
    feishu,
    preModelRoute: overrides.route ?? { handle: async () => ({ handled: false }) },
    maxConcurrency: overrides.maxConcurrency ?? 2,
    replyAttempts: overrides.replyAttempts ?? 3,
    replyTimeoutMs: overrides.replyTimeoutMs ?? 1_000,
    now: () => now++,
  })
}

function fakeChat(
  complete: (
    task: GatewayTask,
  ) => Promise<{ ok: true; value: ChatCompletion } | { ok: false; error: ChatFailure }>,
): ChatPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async complete(task) {
      calls.push(task.id)
      return complete(task)
    },
    async interrupt() {
      return true
    },
    async close() {},
  }
}

function fakeFeishu(
  send: (task: GatewayTask, text: string) => Promise<FeishuReplyResult> = async (task) => ({
    kind: "delivered",
    externalReplyID: `reply_${task.id}`,
  }),
): FeishuPort & { calls: Array<{ task: GatewayTask; text: string }> } {
  const calls: Array<{ task: GatewayTask; text: string }> = []
  return {
    calls,
    async start(_onMessage: (message: NormalizedFeishuMessage) => Promise<void>) {},
    async send(task, text) {
      calls.push({ task, text })
      return send(task, text)
    },
    async stop() {},
  }
}

function completed(id: string, text = `answer:${id}`) {
  return {
    ok: true as const,
    value: {
      text,
      model: { providerID: "test", modelID: "test-model" },
      tokens: { input: 1, output: 1, reasoning: 0 },
      cost: 0,
      durationMs: 1,
    },
  }
}

function task(id: string, sessionID: string): NewGatewayTask {
  return {
    id,
    externalMessageHash: `hash_${id}`,
    conversationID: `conversation_${sessionID}`,
    sessionID,
    promptMessageID: `message_${id}`,
    turnID: `turn_${id}`,
    traceID: `trace_${id}`,
    promptText: `prompt:${id}`,
    originalText: `prompt:${id}`,
    replyTarget: `chat_${sessionID}`,
    state: "received",
  }
}

function admit(store: GatewayStore, input: NewGatewayTask) {
  store.admit(input, [event(input, "message_received", "received")])
}

function advanceTo(store: GatewayStore, taskID: string, state: TaskState) {
  const order: TaskState[] = ["admitted", "running", "answered", "sending", "delivered"]
  if (state === "received") return
  for (const next of order) {
    const current = store.getTask(taskID)!
    store.transition(taskID, next, {
      ...(next === "answered" ? { answer: `persisted:${taskID}` } : {}),
      ...(next === "sending" ? { sendAttempts: 1 } : {}),
      event: event(current, `seed_${next}`, next),
    })
    if (next === state) return
    if (state === "uncertain_delivery" && next === "sending") {
      const sending = store.getTask(taskID)!
      store.transition(taskID, "uncertain_delivery", {
        event: event(sending, "seed_uncertain_delivery", "uncertain_delivery"),
      })
      return
    }
  }
}

function event(
  task: Pick<GatewayTask | NewGatewayTask, "conversationID" | "turnID" | "traceID">,
  eventType: string,
  status: string,
): GatewayEventInput {
  return {
    eventID: `event_${eventType}_${task.turnID}_${crypto.randomUUID()}`,
    eventType,
    occurredAt: 1_700_000_000_000,
    conversationID: task.conversationID,
    turnID: task.turnID,
    traceID: task.traceID,
    actor: "gateway",
    version: 1,
    status,
    content: {},
  }
}

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "feishu-worker-"))
  directories.push(directory)
  const store = openGatewayStore(join(directory, "gateway.sqlite"), ["provider-secret"])
  stores.push(store)
  return store
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for worker state")
    await Bun.sleep(1)
  }
}
