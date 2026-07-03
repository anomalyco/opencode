import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeClient, type V2Event } from "@opencode-ai/sdk/v2"
import { runNonInteractivePrompt } from "@/cli/cmd/run/noninteractive"

type FormInfo = Extract<V2Event, { type: "form.created" }>["data"]["form"]

function ok<T>(data: T) {
  return Promise.resolve({
    data,
    error: undefined,
    request: new Request("https://opencode.test"),
    response: new Response(),
  })
}

function form(id: string, sessionID: string): FormInfo {
  return { id, sessionID, mode: "form", fields: [] }
}

function formCreated(info: FormInfo): V2Event {
  return { id: `evt_${info.id}`, created: 0, type: "form.created", data: { form: info } }
}

function prompted(inputID: string): V2Event {
  return {
    id: "evt_prompted",
    created: 0,
    type: "session.prompt.promoted",
    durable: { aggregateID: "ses_1", seq: 0, version: 1 },
    data: { sessionID: "ses_1", inputID },
  }
}

function settled(outcome: "success" | "interrupted" = "success"): V2Event {
  return {
    id: "evt_settled",
    created: 0,
    type: "session.execution.settled",
    data: { sessionID: "ses_1", outcome },
  }
}

// Runs one non-interactive prompt against a mocked SDK. `turn` produces the
// live events the prompt admission triggers, keyed by the generated message ID.
async function run(input: { turn: (inputID: string) => V2Event[]; pendingForms?: FormInfo[]; attached?: boolean }) {
  const sdk = new OpencodeClient()
  const values: V2Event[] = [{ id: "evt_connected", created: 0, type: "server.connected", data: {} }]
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
  spyOn(sdk.v2.event, "subscribe").mockImplementation(
    () => Promise.resolve({ stream }) as ReturnType<typeof sdk.v2.event.subscribe>,
  )
  spyOn(sdk.v2.session.permission, "list").mockImplementation(() => ok({ data: [] }) as never)
  spyOn(sdk.v2.session.question, "list").mockImplementation(() => ok({ data: [] }) as never)
  spyOn(sdk.v2.session.form, "list").mockImplementation(
    (request) =>
      ok({ data: input.pendingForms?.filter((item) => item.sessionID === request.sessionID) ?? [] }) as never,
  )
  spyOn(sdk.v2.session.form, "cancel").mockImplementation(() => ok(undefined) as never)
  spyOn(sdk.v2.session, "prompt").mockImplementation((request) => {
    const messageID = request.id ?? "msg_prompt"
    values.push(...input.turn(messageID))
    wake?.()
    wake = undefined
    return ok({ data: { admittedSeq: 1, id: messageID, sessionID: "ses_1", timeCreated: 1 } }) as never
  })
  await runNonInteractivePrompt({
    client: sdk,
    sessionID: "ses_1",
    message: "hello",
    files: [],
    thinking: false,
    format: "default",
    dangerouslySkipPermissions: false,
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
    expect(sdk.v2.session.form.cancel).toHaveBeenCalledWith({ sessionID: "global", formID: "frm_live" })
    expect(sdk.v2.session.form.cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "frm_pending" })
    expect(sdk.v2.session.form.cancel).toHaveBeenCalledWith({ sessionID: "global", formID: "frm_pending_global" })
  })

  test("attach mode cancels only session-owned forms", async () => {
    const sdk = await run({
      attached: true,
      pendingForms: [form("frm_pending", "ses_1"), form("frm_pending_global", "global")],
      turn: (messageID) => [formCreated(form("frm_live", "global")), prompted(messageID), settled()],
    })
    expect(sdk.v2.session.form.cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "frm_pending" })
    expect(sdk.v2.session.form.list).not.toHaveBeenCalledWith({ sessionID: "global" })
    expect(sdk.v2.session.form.cancel).not.toHaveBeenCalledWith({ sessionID: "global", formID: "frm_live" })
    expect(sdk.v2.session.form.cancel).not.toHaveBeenCalledWith({ sessionID: "global", formID: "frm_pending_global" })
  })
})
