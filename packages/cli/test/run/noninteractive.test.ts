import { WorkspaceID } from "@opencode/schema/workspace-id"
import { Model } from "@opencode/schema/model"
import { Form } from "@opencode/schema/form"
import { Provider } from "@opencode/schema/provider"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  OpenCode,
  type EventSubscribeOutput,
  type SessionMessageAssistantTool,
  type SessionMessageInfo,
} from "@opencode/client/promise"
import { runNonInteractivePrompt } from "../../src/run/noninteractive"

type V2Event = EventSubscribeOutput
type FormInfo = Extract<V2Event, { type: "form.created" }>["data"]["form"]
const location = { directory: "/work tree", workspaceID: WorkspaceID.make("wrk_1", { disableChecks: true }) }

function ok<T>(data: T) {
  return Promise.resolve(data)
}

function form(id: string, sessionID: string): FormInfo {
  return {
    id: Form.ID.make(id, { disableChecks: true }),
    sessionID: Session.ID.make(sessionID, { disableChecks: true }),
    title: "Input requested",
    fields: [{ key: "authorization", type: "external", url: "https://example.com/form" }],
  }
}

function formCreated(info: FormInfo, eventLocation = location): V2Event {
  return {
    id: Event.ID.make(`evt_${info.id}`, { disableChecks: true }),
    created: 0,
    type: "form.created",
    location: eventLocation,
    data: { form: info },
  }
}

function prompted(inboxID: string): V2Event {
  return {
    id: Event.ID.make("evt_prompted", { disableChecks: true }),
    created: 0,
    type: "session.inbox.delivered",
    durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 0, version: 1 },
    data: {
      sessionID: Session.ID.make("ses_1", { disableChecks: true }),
      inboxID: SessionMessage.ID.make(inboxID, { disableChecks: true }),
    },
  }
}

function settled(outcome: "success" | "interrupted" = "success"): V2Event {
  if (outcome === "interrupted")
    return {
      id: Event.ID.make("evt_interrupted", { disableChecks: true }),
      created: 0,
      type: "session.execution.interrupted",
      durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 1, version: 1 },
      data: { sessionID: Session.ID.make("ses_1", { disableChecks: true }), reason: "user" },
    }
  return {
    id: Event.ID.make("evt_succeeded", { disableChecks: true }),
    created: 0,
    type: "session.execution.succeeded",
    durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 1, version: 1 },
    data: { sessionID: Session.ID.make("ses_1", { disableChecks: true }) },
  }
}

function stepStarted(): V2Event {
  return {
    id: Event.ID.make("evt_step_started", { disableChecks: true }),
    created: 1,
    type: "session.step.started",
    durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 1, version: 1 },
    data: {
      started: 1,
      sessionID: Session.ID.make("ses_1", { disableChecks: true }),
      assistantMessageID: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
      agent: Agent.ID.make("build", { disableChecks: true }),
      model: {
        providerID: Provider.ID.make("test", { disableChecks: true }),
        id: Model.ID.make("test-model", { disableChecks: true }),
      },
    },
  }
}

function stepFailed(message: string): V2Event {
  return {
    id: Event.ID.make("evt_step_failed", { disableChecks: true }),
    created: 2,
    type: "session.step.failed",
    durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 2, version: 1 },
    data: {
      sessionID: Session.ID.make("ses_1", { disableChecks: true }),
      assistantMessageID: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
      error: { type: "provider.transport", message },
    },
  }
}

function executionFailed(message: string): V2Event {
  return {
    id: Event.ID.make("evt_execution_failed", { disableChecks: true }),
    created: 3,
    type: "session.execution.failed",
    durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 3, version: 1 },
    data: {
      sessionID: Session.ID.make("ses_1", { disableChecks: true }),
      error: { type: "provider.transport", message },
    },
  }
}

function failedTool(inboxID: string): V2Event[] {
  return [
    prompted(inboxID),
    {
      id: Event.ID.make("evt_failed_tool_input", { disableChecks: true }),
      created: 1,
      type: "session.tool.input.started",
      durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 1, version: 1 },
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_failed_tool", { disableChecks: true }),
        id: "call_failed_tool",
        name: "shell",
      },
    },
    {
      id: Event.ID.make("evt_failed_tool_called", { disableChecks: true }),
      created: 2,
      type: "session.tool.called",
      durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 2, version: 1 },
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_failed_tool", { disableChecks: true }),
        id: "call_failed_tool",
        input: { command: "printf partial && false" },
        executed: true,
      },
    },
    {
      id: Event.ID.make("evt_failed_tool_progress", { disableChecks: true }),
      created: 3,
      type: "session.tool.progress",
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_failed_tool", { disableChecks: true }),
        id: "call_failed_tool",
        metadata: { checkpoint: 1 },
      },
    },
    {
      id: Event.ID.make("evt_failed_tool_terminal", { disableChecks: true }),
      created: 4,
      type: "session.tool.failed",
      durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 4, version: 2 },
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_failed_tool", { disableChecks: true }),
        id: "call_failed_tool",
        error: { type: "unknown", message: "tool failed" },
        metadata: { checkpoint: 1 },
        content: [{ type: "text", text: "partial output" }],
        executed: true,
      },
    },
    settled(),
  ]
}

function successfulGrep(inboxID: string): V2Event[] {
  const text = "Found 2 matches\n/src/a.ts:\n  Line 1: needle\n/src/b.ts:\n  Line 2: needle"
  return [
    prompted(inboxID),
    {
      id: Event.ID.make("evt_grep_input", { disableChecks: true }),
      created: 1,
      type: "session.tool.input.started",
      durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 1, version: 1 },
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_grep", { disableChecks: true }),
        id: "call_grep",
        name: "grep",
      },
    },
    {
      id: Event.ID.make("evt_grep_called", { disableChecks: true }),
      created: 2,
      type: "session.tool.called",
      durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 2, version: 1 },
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_grep", { disableChecks: true }),
        id: "call_grep",
        input: { pattern: "needle" },
        executed: true,
      },
    },
    {
      id: Event.ID.make("evt_grep_success", { disableChecks: true }),
      created: 3,
      type: "session.tool.success",
      durable: { aggregateID: Session.ID.make("ses_1", { disableChecks: true }), seq: 3, version: 2 },
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_grep", { disableChecks: true }),
        id: "call_grep",
        metadata: { matches: 2 },
        content: [{ type: "text", text }],
        executed: false,
      },
    },
    settled(),
  ]
}

// Runs one non-interactive prompt against a mocked SDK. `turn` produces the
// live events the prompt admission triggers, keyed by the generated message ID.
async function run(input: {
  turn: (inboxID: string) => V2Event[]
  pendingForms?: FormInfo[]
  attached?: boolean
  format?: "default" | "json"
  compatibility?: "v1"
  cancel?: (input: { sessionID: string; formID: string }) => Promise<void>
  renderTool?: (part: SessionMessageAssistantTool) => Promise<void>
  renderToolError?: (part: SessionMessageAssistantTool) => Promise<void>
  messages?: (inboxID: string) => SessionMessageInfo[]
  wait?: () => Promise<void>
  terminalDelay?: number
}) {
  const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
  const values: V2Event[] = [
    { id: Event.ID.make("evt_connected", { disableChecks: true }), type: "server.connected", data: {} },
  ]
  let wake: (() => void) | undefined
  const wait = Promise.withResolvers<void>()
  const stream = (async function* (): AsyncGenerator<V2Event, void, unknown> {
    while (true) {
      const value = values.shift()
      if (!value) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      if (value.type.startsWith("session.execution.")) {
        if (input.terminalDelay) await Bun.sleep(input.terminalDelay)
        setTimeout(wait.resolve, 0)
      }
      yield value
    }
  })()
  spyOn(sdk.event, "subscribe").mockImplementation(() => stream)
  spyOn(sdk.permission, "list").mockImplementation(() => ok([]) as never)
  spyOn(sdk.session.form, "list").mockImplementation(
    (request) => ok(input.pendingForms?.filter((item) => item.sessionID === request.sessionID) ?? []) as never,
  )
  spyOn(sdk.form, "list").mockImplementation(
    () =>
      ok({
        location: { ...location, project: { id: "proj_1", directory: location.directory } },
        data: input.pendingForms?.filter((item) => item.sessionID === "global") ?? [],
      }) as never,
  )
  spyOn(sdk.session.form, "cancel").mockImplementation((request) => (input.cancel?.(request) ?? ok(undefined)) as never)
  let promptID = SessionMessage.ID.make("msg_prompt", { disableChecks: true })
  spyOn(sdk.session, "wait").mockImplementation(() => input.wait?.() ?? wait.promise)
  spyOn(sdk.message, "list").mockImplementation(() =>
    ok({
      data: input.messages?.(promptID) ?? [{ id: promptID, type: "user", text: "hello", time: { created: 1 } }],
      cursor: {},
    }),
  )
  spyOn(sdk.session, "prompt").mockImplementation((request) => {
    const messageID = request.id ?? SessionMessage.ID.make("msg_prompt", { disableChecks: true })
    promptID = messageID
    values.push(...input.turn(messageID))
    wake?.()
    wake = undefined
    return ok({
      id: messageID,
      sessionID: Session.ID.make("ses_1", { disableChecks: true }),
      time: { created: 1 },
    }) as never
  })
  await runNonInteractivePrompt({
    client: sdk,
    sessionID: Session.ID.make("ses_1", { disableChecks: true }),
    location,
    message: "hello",
    files: [],
    thinking: false,
    format: input.format ?? "default",
    auto: false,
    attached: input.attached ?? false,
    compatibility: input.compatibility,
    renderTool: input.renderTool ?? (() => Promise.resolve()),
    renderToolError: input.renderToolError ?? (() => Promise.resolve()),
  })
  return sdk
}

async function capture(input: Parameters<typeof run>[0]) {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = process.exitCode
  const stdoutWrite = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  try {
    await run(input)
    return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode: process.exitCode }
  } finally {
    process.exitCode = exitCode ?? 0
    stdoutWrite.mockRestore()
    stderrWrite.mockRestore()
  }
}

afterEach(() => {
  mock.restore()
  process.exitCode = 0
})

describe("runNonInteractivePrompt", () => {
  test("keeps formatted tool output and compact tool metadata in JSON", async () => {
    const output = await capture({ format: "json", turn: successfulGrep })
    const events = output.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "tool_use",
      part: {
        tool: "grep",
        state: {
          status: "completed",
          output: expect.stringContaining("Found 2 matches"),
          metadata: {
            metadata: { matches: 2 },
            content: [{ type: "text", text: expect.stringContaining("/src/a.ts") }],
          },
        },
      },
    })
    expect(events[0].part.state.metadata.metadata).toEqual({ matches: 2 })
    expect(events[0].part.state.metadata.result).toBeUndefined()
  })

  test("uses session.wait then reconciles projected output without a terminal event", async () => {
    const idle = Promise.withResolvers<void>()
    let done = false
    const task = capture({
      format: "json",
      turn: (messageID) => [prompted(messageID)],
      wait: () => idle.promise,
      messages: (messageID) => [
        {
          id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
          type: "assistant",
          agent: Agent.ID.make("build", { disableChecks: true }),
          model: {
            providerID: Provider.ID.make("test", { disableChecks: true }),
            id: Model.ID.make("test-model", { disableChecks: true }),
          },
          content: [{ type: "text", text: "projected answer" }],
          finish: "stop",
          time: { created: 2, completed: 3 },
        },
        {
          id: SessionMessage.ID.make(messageID, { disableChecks: true }),
          type: "user",
          text: "hello",
          time: { created: 1 },
        },
      ],
    }).then((output) => {
      done = true
      return output
    })

    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(done).toBe(false)
    idle.resolve()
    const output = await task
    expect(
      output.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    ).toEqual([expect.objectContaining({ type: "text", part: expect.objectContaining({ text: "projected answer" }) })])
  })

  test("reports an observed execution failure before prompt promotion", async () => {
    const output = await capture({
      format: "json",
      turn: () => [executionFailed("instructions unavailable")],
      messages: () => [],
    })

    expect(
      output.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    ).toEqual([
      expect.objectContaining({
        type: "error",
        error: { type: "provider.transport", message: "instructions unavailable" },
      }),
    ])
    expect(output.exitCode).toBe(1)
  })

  test("waits for a terminal failure when idle wins before projection", async () => {
    for (const promotedBeforeFailure of [true, false]) {
      const output = await capture({
        format: "json",
        turn: (messageID) => [
          ...(promotedBeforeFailure ? [prompted(messageID)] : []),
          executionFailed("selection unavailable"),
        ],
        messages: (messageID) =>
          promotedBeforeFailure
            ? [
                {
                  id: SessionMessage.ID.make(messageID, { disableChecks: true }),
                  type: "user",
                  text: "hello",
                  time: { created: 1 },
                },
              ]
            : [],
        wait: () => Promise.resolve(),
        terminalDelay: 10,
      })

      expect(output.exitCode).toBe(1)
      expect(output.stdout).toContain("selection unavailable")
    }
  })

  test("cancels session and global form blockers and exits on pre-promotion interrupt", async () => {
    const sdk = await run({
      pendingForms: [
        form(Form.ID.make("frm_pending", { disableChecks: true }), Session.ID.make("ses_1", { disableChecks: true })),
        form(Form.ID.make("frm_pending_global", { disableChecks: true }), "global"),
      ],
      // No prompted event: the execution settles interrupted before promotion,
      // which must not leave the consume loop waiting forever.
      turn: () => [
        formCreated(form(Form.ID.make("frm_live", { disableChecks: true }), "global")),
        settled("interrupted"),
      ],
    })
    const globalOptions = {
      headers: {
        "x-opencode-directory": "%2Fwork%20tree",
      },
    }
    expect(sdk.session.form.cancel).toHaveBeenCalledWith({ sessionID: "global", formID: "frm_live" }, globalOptions)
    expect(sdk.session.form.cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "frm_pending" })
    expect(sdk.session.form.cancel).toHaveBeenCalledWith({ sessionID: "global", formID: "frm_pending_global" }, globalOptions)
    expect(sdk.form.list).toHaveBeenCalledWith({
      location: { directory: "/work tree" },
    })
    expect(process.exitCode).toBe(1)
  })

  test("attach mode cancels only session-owned forms", async () => {
    const sdk = await run({
      attached: true,
      pendingForms: [
        form(Form.ID.make("frm_pending", { disableChecks: true }), Session.ID.make("ses_1", { disableChecks: true })),
        form(Form.ID.make("frm_pending_global", { disableChecks: true }), "global"),
      ],
      turn: (messageID) => [
        formCreated(form(Form.ID.make("frm_live", { disableChecks: true }), "global")),
        prompted(messageID),
        settled(),
      ],
    })
    expect(sdk.session.form.cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "frm_pending" })
    expect(sdk.form.list).not.toHaveBeenCalled()
    expect(sdk.session.form.cancel).not.toHaveBeenCalledWith({ sessionID: "global", formID: "frm_live" }, expect.anything())
    expect(sdk.session.form.cancel).not.toHaveBeenCalledWith(
      { sessionID: "global", formID: "frm_pending_global" },
      expect.anything(),
    )
    expect(process.exitCode).toBe(1)
  })

  test("V1 JSON output flushes step_start before an unrelated step failure", async () => {
    const output = await capture({
      compatibility: "v1",
      format: "json",
      turn: (messageID) => [
        prompted(messageID),
        stepStarted(),
        stepFailed("Provider request failed"),
        executionFailed("Provider request failed"),
      ],
    })

    expect(
      output.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    ).toEqual([
      expect.objectContaining({ type: "step_start", part: expect.objectContaining({ type: "step-start" }) }),
      expect.objectContaining({
        type: "error",
        error: { type: "provider.transport", message: "Provider request failed" },
      }),
    ])
    expect(output.stderr).toBe("")
    const sdk = await run({ compatibility: "v1", turn: (messageID) => [prompted(messageID), settled()] })
    expect(sdk.session.wait).not.toHaveBeenCalled()
    expect(sdk.message.list).not.toHaveBeenCalled()
  })

  test("V1 default output flushes step_start before an unrelated execution failure", async () => {
    const output = await capture({
      compatibility: "v1",
      turn: (messageID) => [prompted(messageID), stepStarted(), executionFailed("Execution failed")],
    })

    expect(output.stdout).toBe("")
    expect(output.stderr).toContain("> build · test-model")
    expect(output.stderr).toContain("Error: \u001b[0mExecution failed")
    expect(output.stderr.indexOf("> build · test-model")).toBeLessThan(output.stderr.indexOf("Execution failed"))
  })

  test("V1 preserves terminal-finish failure suppression before content", async () => {
    const output = await capture({
      compatibility: "v1",
      format: "json",
      turn: (messageID) => [
        prompted(messageID),
        stepStarted(),
        stepFailed("The provider response ended unexpectedly."),
        executionFailed("The provider response ended unexpectedly."),
      ],
    })

    expect(output).toEqual({ stdout: "", stderr: "", exitCode: 0 })
  })

  test("renders a native terminal failure snapshot when live progress was missed", async () => {
    const rendered: SessionMessageAssistantTool[] = []
    const failed: SessionMessageAssistantTool[] = []
    await capture({
      turn: (inboxID) => failedTool(inboxID).filter((event) => event.type !== "session.tool.progress"),
      renderTool: (part) => {
        rendered.push(part)
        return Promise.resolve()
      },
      renderToolError: (part) => {
        failed.push(part)
        return Promise.resolve()
      },
    })

    expect(rendered).toMatchObject([
      {
        id: "call_failed_tool",
        state: {
          status: "completed",
          metadata: { checkpoint: 1 },
          content: [{ type: "text", text: "partial output" }],
        },
      },
    ])
    expect(failed).toMatchObject([
      {
        id: "call_failed_tool",
        state: {
          status: "error",
          metadata: { checkpoint: 1 },
          content: [{ type: "text", text: "partial output" }],
          error: { message: "tool failed" },
        },
      },
    ])
  })

  test("keeps failed tool partial output out of the explicit V1 JSON bridge shape", async () => {
    const output = await capture({ compatibility: "v1", format: "json", turn: failedTool })
    const events = output.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "tool_use",
      part: {
        type: "tool",
        id: "call_failed_tool",
        tool: "shell",
        state: {
          status: "error",
          input: { command: "printf partial && false" },
          error: "tool failed",
        },
      },
    })
    expect(events[0].part.state.output).toBeUndefined()
    expect(events[0].part.state.metadata.metadata).toBeUndefined()
    expect(events[0].part.state.metadata.content).toBeUndefined()
    expect(output.stderr).toBe("")
  })
})
