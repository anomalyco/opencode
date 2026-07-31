import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAdmission } from "../src/admission"
import { createEventLog } from "../src/event-log"
import type { NormalizedFeishuMessage } from "../src/feishu-channel"
import { openGatewayStore } from "../src/store"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("durable Feishu admission", () => {
  test("commits the task and complete/sentence events before enqueueing", async () => {
    const { admission, store, queued, observedStates } = await fixture()

    expect(await admission.receive(message())).toBe("created")
    expect(observedStates).toEqual(["received"])
    expect(queued).toEqual(["task_9ea7bd37716f24cc969718a23b7fdfda6f07b6ffacc12f93"])
    expect(store.eventsForTrace(store.getTask(queued[0])!.traceID).map((event) => event.eventType)).toEqual([
      "message_received",
      "message_received_sentence",
      "message_received_sentence",
    ])
    store.close()
  })

  test("does not await background model work in the callback", async () => {
    const { store, log, fallbackPath } = await base()
    let release: (() => void) | undefined
    const delayed = new Promise<void>((resolve) => {
      release = resolve
    })
    const admission = createAdmission({
      store,
      eventLog: log,
      fallbackPath,
      secrets: [],
      enqueue() {
        void delayed
      },
    })

    expect(await admission.receive(message())).toBe("created")
    release?.()
    store.close()
  })

  test("coalesces duplicate delivery without enqueueing a second task", async () => {
    const { admission, store, queued } = await fixture()

    expect(await admission.receive(message())).toBe("created")
    expect(await admission.receive(message())).toBe("duplicate")
    expect(queued).toHaveLength(1)
    store.close()
  })

  test("writes a sanitized fallback and schedules nothing when persistence fails", async () => {
    const { store, log, fallbackPath } = await base(["secret-canary"])
    const queued: string[] = []
    store.close()
    const admission = createAdmission({
      store,
      eventLog: log,
      fallbackPath,
      secrets: ["secret-canary"],
      enqueue(taskID) {
        queued.push(taskID)
      },
    })

    await expect(
      admission.receive(message({ originalText: "secret-canary", promptText: "secret-canary" })),
    ).rejects.toThrow("Gateway admission failed")
    expect(queued).toEqual([])
    expect(await Bun.file(fallbackPath).text()).not.toContain("secret-canary")
  })
})

async function fixture() {
  const setup = await base()
  const queued: string[] = []
  const observedStates: Array<string | undefined> = []
  return {
    ...setup,
    queued,
    observedStates,
    admission: createAdmission({
      store: setup.store,
      eventLog: setup.log,
      fallbackPath: setup.fallbackPath,
      secrets: [],
      enqueue(taskID) {
        observedStates.push(setup.store.getTask(taskID)?.state)
        queued.push(taskID)
      },
    }),
  }
}

async function base(secrets: readonly string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "feishu-admission-"))
  directories.push(directory)
  const store = openGatewayStore(join(directory, "gateway.sqlite"), secrets)
  let event = 0
  return {
    store,
    fallbackPath: join(directory, "fallback.jsonl"),
    log: createEventLog({
      store,
      now: () => 1_700_000_000_000,
      makeEventID: () => `evt_${++event}`,
    }),
  }
}

function message(overrides: Partial<NormalizedFeishuMessage> = {}): NormalizedFeishuMessage {
  return {
    chatType: "direct",
    chatID: "oc_chat_1",
    senderID: "ou_user_1",
    messageID: "om_message_1",
    originalText: "第一句。\n第二句",
    promptText: "第一句。\n第二句",
    replyTarget: "oc_chat_1",
    ...overrides,
  }
}
