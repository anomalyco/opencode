import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode, type EventSubscribeOutput } from "@opencode-ai/client/promise"
import { runNonInteractivePrompt } from "@opencode-ai/cli/mini/noninteractive"

type V2Event = EventSubscribeOutput
type FormInfo = Extract<V2Event, { type: "form.created" }>["data"]["form"]

function ok<T>(data: T) {
  return Promise.resolve(data)
}

function form(id: string, sessionID: string): FormInfo {
  return {
    id,
    sessionID,
    title: "Input requested",
    fields: [{ key: "authorization", type: "external", url: "https://example.com/form" }],
  }
}

function formCreated(info: FormInfo): V2Event {
  return { id: `evt_${info.id}`, created: 0, type: "form.created", data: { form: info } }
}

function prompted(inputID: string): V2Event {
  return {
    id: "evt_prompted",
    created: 0,
    type: "session.input.promoted",
    durable: { aggregateID: "ses_1", seq: 0, version: 1 },
    data: { sessionID: "ses_1", inputID },
  }
}

function settled(outcome: "success" | "interrupted" = "success"): V2Event {
  if (outcome === "interrupted")
    return {
      id: "evt_interrupted",
      created: 0,
      type: "session.execution.interrupted",
      durable: { aggregateID: "ses_1", seq: 1, version: 1 },
      data: { sessionID: "ses_1", reason: "user" },
    }
  return {
    id: "evt_succeeded",
    created: 0,
    type: "session.execution.succeeded",
    durable: { aggregateID: "ses_1", seq: 1, version: 1 },
    data: { sessionID: "ses_1" },
  }
}

// Runs one non-interactive prompt against a mocked SDK. `turn` produces the
// live events the prompt admission triggers, keyed by the generated message ID.
async function run(input: { turn: (inputID: string) => V2Event[]; pendingForms?: FormInfo[]; attached?: boolean }) {
  const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
  const values: V2Event[] = [{ id: "evt_connected", type: "server.connected", data: {} }]
  let wake: (() => void) | undefined
  const stream = (async function* (): AsyncGenerator<V2Event, void, unknown> {
    while (true) {
      const value = values.shift()
      if (!value) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      yield value
    }
  })()
  spyOn(sdk.event, "subscribe").mockImplementation(() => stream)
  spyOn(sdk.permission, "list").mockImplementation(() => ok([]) as never)
  spyOn(sdk.question, "list").mockImplementation(() => ok([]) as never)
  spyOn(sdk.form, "list").mockImplementation(
    (request) => ok(input.pendingForms?.filter((item) => item.sessionID === request.sessionID) ?? []) as never,
  )
  spyOn(sdk.form, "cancel").mockImplementation(() => ok(undefined) as never)
  spyOn(sdk.session, "prompt").mockImplementation((request) => {
    const messageID = request.id ?? "msg_prompt"
    values.push(...input.turn(messageID))
    wake?.()
    wake = undefined
    return ok({ admittedSeq: 1, id: messageID, sessionID: "ses_1", timeCreated: 1 }) as never
  })
  await runNonInteractivePrompt({
    client: sdk,
    sessionID: "ses_1",
    message: "hello",
    files: [],
    thinking: false,
    format: "default",
    auto: false,
    attached: input.attached ?? false,
    renderTool: () => Promise.resolve(),
    renderToolError: () => Promise.resolve(),
  })
  return sdk
}

afterEach(() => {
  mock.restore()
})

describe("runNonInteractivePrompt", () => {
  test("cancels session and global form blockers and exits on pre-promotion interrupt", async () => {
    const sdk = await run({
      pendingForms: [form("frm_pending", "ses_1"), form("frm_pending_global", "global")],
      // No prompted event: the execution settles interrupted before promotion,
      // which must not leave the consume loop waiting forever.
      turn: () => [formCreated(form("frm_live", "global")), settled("interrupted")],
    })
    expect(sdk.form.cancel).toHaveBeenCalledWith({ sessionID: "global", formID: "frm_live" })
    expect(sdk.form.cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "frm_pending" })
    expect(sdk.form.cancel).toHaveBeenCalledWith({ sessionID: "global", formID: "frm_pending_global" })
  })

  test("attach mode cancels only session-owned forms", async () => {
    const sdk = await run({
      attached: true,
      pendingForms: [form("frm_pending", "ses_1"), form("frm_pending_global", "global")],
      turn: (messageID) => [formCreated(form("frm_live", "global")), prompted(messageID), settled()],
    })
    expect(sdk.form.cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "frm_pending" })
    expect(sdk.form.list).not.toHaveBeenCalledWith({ sessionID: "global" })
    expect(sdk.form.cancel).not.toHaveBeenCalledWith({ sessionID: "global", formID: "frm_live" })
    expect(sdk.form.cancel).not.toHaveBeenCalledWith({ sessionID: "global", formID: "frm_pending_global" })
  })
})
