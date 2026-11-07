import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  ClientError,
  OpenCode,
  type EventSubscribeOutput,
  type ExperimentalJobListOutput,
  type SessionActiveOutput,
  type SessionInboxListOutput,
  type SessionMessageAssistantTool,
  type SessionMessageInfo,
} from "@opencode/client/promise"
import { runNonInteractivePrompt } from "../../src/run/noninteractive"

type V2Event = EventSubscribeOutput
type FormInfo = Extract<V2Event, { type: "form.created" }>["data"]["form"]
const location = { directory: "/work tree", workspaceID: "wrk_1" }

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

function formCreated(info: FormInfo, eventLocation = location): V2Event {
  return { id: `evt_${info.id}`, created: 0, type: "form.created", location: eventLocation, data: { form: info } }
}

function prompted(inboxID: string): V2Event {
  return {
    id: "evt_prompted",
    created: 0,
    type: "session.inbox.delivered",
    durable: { aggregateID: "ses_1", seq: 0, version: 1 },
    data: { sessionID: "ses_1", inboxID },
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

function stepStarted(): V2Event {
  return {
    id: "evt_step_started",
    created: 1,
    type: "session.step.started",
    durable: { aggregateID: "ses_1", seq: 1, version: 1 },
    data: {
      started: 1,
      sessionID: "ses_1",
      assistantMessageID: "msg_assistant",
      agent: "build",
      model: { providerID: "test", id: "test-model" },
    },
  }
}

function stepFailed(message: string): V2Event {
  return {
    id: "evt_step_failed",
    created: 2,
    type: "session.step.failed",
    durable: { aggregateID: "ses_1", seq: 2, version: 1 },
    data: {
      sessionID: "ses_1",
      assistantMessageID: "msg_assistant",
      error: { type: "provider.transport", message },
    },
  }
}

function executionFailed(message: string): V2Event {
  return {
    id: "evt_execution_failed",
    created: 3,
    type: "session.execution.failed",
    durable: { aggregateID: "ses_1", seq: 3, version: 1 },
    data: {
      sessionID: "ses_1",
      error: { type: "provider.transport", message },
    },
  }
}

function idleMessage(outcome: "succeeded" | "failed" | "interrupted", id = "msg_idle") {
  return {
    id,
    type: "idle",
    outcome,
    ...(outcome === "failed" ? { error: { type: "provider.transport", message: "Execution failed" } } : {}),
    time: { created: 5 },
  } satisfies SessionMessageInfo
}

// A step that failed and was retried, followed by the step that recovered.
function recoveredMessages(outcome: "succeeded" | "failed" | "interrupted") {
  return (messageID: string): SessionMessageInfo[] => [
    idleMessage(outcome),
    {
      id: "msg_recovered",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test-model" },
      content: [{ type: "text", text: "Recovered answer" }],
      finish: "stop",
      time: { created: 3, completed: 4 },
    },
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test-model" },
      content: [],
      finish: "error",
      error: { type: "provider.transport", message: "Recovered transport error" },
      time: { created: 2, completed: 3 },
    },
    { id: messageID, type: "user", text: "hello", time: { created: 1 } },
  ]
}

function jsonLines(stdout: string) {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function failedTool(inboxID: string): V2Event[] {
  return [
    prompted(inboxID),
    {
      id: "evt_failed_tool_input",
      created: 1,
      type: "session.tool.input.started",
      durable: { aggregateID: "ses_1", seq: 1, version: 1 },
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_failed_tool",
        id: "call_failed_tool",
        name: "shell",
      },
    },
    {
      id: "evt_failed_tool_called",
      created: 2,
      type: "session.tool.called",
      durable: { aggregateID: "ses_1", seq: 2, version: 1 },
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_failed_tool",
        id: "call_failed_tool",
        input: { command: "printf partial && false" },
        executed: true,
      },
    },
    {
      id: "evt_failed_tool_progress",
      created: 3,
      type: "session.tool.progress",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_failed_tool",
        id: "call_failed_tool",
        metadata: { checkpoint: 1 },
      },
    },
    {
      id: "evt_failed_tool_terminal",
      created: 4,
      type: "session.tool.failed",
      durable: { aggregateID: "ses_1", seq: 4, version: 2 },
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_failed_tool",
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
      id: "evt_grep_input",
      created: 1,
      type: "session.tool.input.started",
      durable: { aggregateID: "ses_1", seq: 1, version: 1 },
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_grep",
        id: "call_grep",
        name: "grep",
      },
    },
    {
      id: "evt_grep_called",
      created: 2,
      type: "session.tool.called",
      durable: { aggregateID: "ses_1", seq: 2, version: 1 },
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_grep",
        id: "call_grep",
        input: { pattern: "needle" },
        executed: true,
      },
    },
    {
      id: "evt_grep_success",
      created: 3,
      type: "session.tool.success",
      durable: { aggregateID: "ses_1", seq: 3, version: 2 },
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_grep",
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
  standalone?: boolean
  format?: "default" | "json"
  cancel?: (input: { sessionID: string; formID: string }) => Promise<void>
  renderTool?: (part: SessionMessageAssistantTool) => Promise<void>
  renderToolError?: (part: SessionMessageAssistantTool) => Promise<void>
  messages?: (inboxID: string) => SessionMessageInfo[]
  wait?: () => Promise<void>
  jobs?: () => ExperimentalJobListOutput
  inbox?: (sessionID: string) => SessionInboxListOutput
  active?: () => SessionActiveOutput
  terminalDelay?: number
  signal?: AbortSignal
}) {
  const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
  const values: V2Event[] = [{ id: "evt_connected", type: "server.connected", data: {} }]
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
  spyOn(sdk.event, "subscribe").mockImplementation((() => stream) as typeof sdk.event.subscribe)
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
  let promptID = "msg_prompt"
  spyOn(sdk.experimental.session, "wait").mockImplementation(() => input.wait?.() ?? wait.promise)
  spyOn(sdk.experimental.job, "list").mockImplementation((async () => input.jobs?.() ?? []) as never)
  spyOn(sdk.session, "active").mockImplementation((async () => input.active?.() ?? {}) as never)
  spyOn(sdk.session.inbox, "list").mockImplementation(
    (async (request: { sessionID: string }) => input.inbox?.(request.sessionID) ?? []) as never,
  )
  spyOn(sdk.session.inbox, "cancel").mockImplementation(() => ok(undefined))
  spyOn(sdk.session, "interrupt").mockImplementation(() => ok({ interrupted: true }) as never)
  spyOn(sdk.shell, "remove").mockImplementation(() => ok(undefined) as never)
  spyOn(sdk.session, "get").mockImplementation(
    ({ sessionID }) => ok({ id: sessionID, parentID: sessionID === "ses_child" ? "ses_1" : undefined }) as never,
  )
  spyOn(sdk.message, "list").mockImplementation(() =>
    ok({
      data: input.messages?.(promptID) ?? [{ id: promptID, type: "user", text: "hello", time: { created: 1 } }],
      cursor: {},
    }),
  )
  spyOn(sdk.session, "prompt").mockImplementation((request) => {
    const messageID = request.id ?? "msg_prompt"
    promptID = messageID
    values.push(...input.turn(messageID))
    wake?.()
    wake = undefined
    return ok({ id: messageID, sessionID: "ses_1", time: { created: 1 } }) as never
  })
  await runNonInteractivePrompt({
    client: sdk,
    sessionID: "ses_1",
    location,
    message: "hello",
    files: [],
    thinking: false,
    format: input.format ?? "default",
    auto: false,
    standalone: input.standalone ?? false,
    signal: input.signal ?? new AbortController().signal,
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

function shellJob(id: string, command: string): ExperimentalJobListOutput[number] {
  return { kind: "shell", id, sessionID: "ses_1", status: "running", shellID: id, command, time: { started: 1 } }
}

const subagentJob: ExperimentalJobListOutput[number] = {
  kind: "subagent",
  id: "ses_child",
  sessionID: "ses_1",
  status: "running",
  childSessionID: "ses_child",
  agent: "explore",
  description: "scan repo",
  time: { started: 1 },
}

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
        idleMessage("succeeded"),
        {
          id: "msg_assistant",
          type: "assistant",
          agent: "build",
          model: { providerID: "test", id: "test-model" },
          content: [{ type: "text", text: "projected answer" }],
          finish: "stop",
          time: { created: 2, completed: 3 },
        },
        { id: messageID, type: "user", text: "hello", time: { created: 1 } },
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
    ).toEqual([
      expect.objectContaining({ type: "step_start", part: expect.objectContaining({ messageID: "msg_assistant" }) }),
      expect.objectContaining({ type: "text", part: expect.objectContaining({ text: "projected answer" }) }),
    ])
  })

  test("reports usage for a step that ends after the Session goes idle", async () => {
    const tokens = { input: 3, output: 5, reasoning: 7, cache: { read: 11, write: 13 } }
    const assistant = (messageID: string): SessionMessageInfo[] => [
      idleMessage("succeeded"),
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        content: [{ type: "text", text: "done" }],
        finish: "stop",
        cost: 0.25,
        tokens,
        time: { created: 2, completed: 3 },
      },
      { id: messageID, type: "user", text: "hello", time: { created: 1 } },
    ]
    const lines = async (turn: (messageID: string) => V2Event[]) =>
      (await capture({ format: "json", turn, messages: assistant, wait: () => Promise.resolve() })).stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))

    const missed = await lines((messageID) => [prompted(messageID), stepStarted()])
    expect(missed.map((event) => event.type)).toEqual(["step_start", "text", "step_finish"])
    expect(missed[2].part).toMatchObject({ messageID: "msg_assistant", reason: "stop", cost: 0.25, tokens })

    const seen = await lines((messageID) => [
      prompted(messageID),
      stepStarted(),
      {
        id: "evt_step_ended",
        created: 2,
        type: "session.step.ended",
        durable: { aggregateID: "ses_1", seq: 2, version: 1 },
        data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", finish: "stop", cost: 0.25, tokens },
      },
      settled(),
    ])
    expect(seen.filter((event) => event.type === "step_finish")).toHaveLength(1)
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
          promotedBeforeFailure ? [{ id: messageID, type: "user", text: "hello", time: { created: 1 } }] : [],
        wait: () => Promise.resolve(),
        terminalDelay: 10,
      })

      expect(output.exitCode).toBe(1)
      expect(output.stdout).toContain("selection unavailable")
    }
  })

  for (const standalone of [true, false]) {
    test(`${standalone ? "a standalone" : "an attached"} run ${standalone ? "cancels" : "leaves"} MCP input requests in its location`, async () => {
      const cancelled: { sessionID: string; formID: string }[] = []
      const output = await capture({
        format: "json",
        standalone,
        pendingForms: [form("frm_pending", "ses_1"), form("frm_pending_global", "global")],
        turn: (messageID) => [
          formCreated(form("frm_live", "global")),
          formCreated(form("frm_elsewhere", "global"), { ...location, directory: "/elsewhere" }),
          prompted(messageID),
          settled(),
        ],
        cancel: (request) => {
          cancelled.push(request)
          return Promise.resolve()
        },
      })
      const global = standalone ? ["frm_live", "frm_pending_global"] : []
      expect(cancelled.map((request) => request.formID).sort()).toEqual(["frm_pending", ...global].sort())
      expect(output.exitCode).toBe(1)
      expect(jsonLines(output.stdout).filter((event) => event.type === "error")).toHaveLength(1)
    })
  }

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

  test("keeps failed tool partial output out of the JSON tool_use shape", async () => {
    const output = await capture({ format: "json", turn: failedTool })
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

  test("waits for a background shell and streams the reply it wakes", async () => {
    const lists: ExperimentalJobListOutput[] = [[shellJob("sh_train", "python train.py")], []]
    const output = await capture({
      format: "json",
      jobs: () => lists.shift() ?? [],
      turn: (id) => [
        prompted(id),
        settled(),
        {
          id: "evt_text",
          created: 2,
          type: "session.text.ended",
          durable: { aggregateID: "ses_1", seq: 2, version: 1 },
          data: { sessionID: "ses_1", assistantMessageID: "msg_2", ordinal: 0, text: "Training finished." },
        },
        settled(),
      ],
    })
    expect(output.stdout).toContain("Training finished.")
  })

  test("waits for a background shell owned by a subagent", async () => {
    const lists: ExperimentalJobListOutput[] = [[{ ...shellJob("sh_test", "pytest"), sessionID: "ses_child" }], []]
    const sdk = await run({
      jobs: () => lists.shift() ?? [],
      turn: (id) => [
        prompted(id),
        settled(),
        {
          id: "evt_child_done",
          created: 2,
          type: "session.execution.succeeded",
          durable: { aggregateID: "ses_child", seq: 1, version: 1 },
          data: { sessionID: "ses_child" },
        },
      ],
    })
    expect(sdk.experimental.job.list).toHaveBeenCalledWith({ sessionID: "ses_1", descendants: true })
    expect(lists).toEqual([])
  })

  test("a recovered step failure exits 0, reports its retry once, and still waits for background work", async () => {
    const lists: ExperimentalJobListOutput[] = [[shellJob("sh_train", "python train.py")], []]
    const retry = { attempt: 1, error: { type: "provider.transport", message: "Recovered transport error" } }
    const output = await capture({
      format: "json",
      jobs: () => lists.shift() ?? [],
      messages: recoveredMessages("succeeded"),
      turn: (id) => [
        prompted(id),
        stepStarted(),
        stepFailed("Recovered transport error"),
        {
          id: "evt_retry",
          created: 3,
          type: "session.retry.scheduled",
          durable: { aggregateID: "ses_1", seq: 3, version: 1 },
          data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", at: 2003, ...retry },
        },
        stepStarted(),
        settled(),
        {
          id: "evt_text",
          created: 4,
          type: "session.text.ended",
          durable: { aggregateID: "ses_1", seq: 4, version: 1 },
          data: { sessionID: "ses_1", assistantMessageID: "msg_2", ordinal: 0, text: "Training finished." },
        },
        settled(),
      ],
    })
    const events = jsonLines(output.stdout)
    expect(output.exitCode).toBe(0)
    expect(events.filter((event) => event.type === "error" || event.type === "retry")).toEqual([
      { type: "retry", timestamp: 3, sessionID: "ses_1", messageID: "msg_assistant", nextRetryAt: 2003, ...retry },
    ])
    expect(
      events.filter((event) => event.part?.messageID === "msg_assistant" && event.type === "step_start"),
    ).toHaveLength(1)
    expect(events.find((event) => event.type === "background_wait")).toMatchObject({
      jobs: [{ id: "sh_train", kind: "shell" }],
    })
    expect(output.stdout).toContain("Training finished.")
    expect(lists).toEqual([])
  })

  for (const outcome of ["failed", "interrupted"] as const) {
    test(`a final ${outcome} outcome exits 1 with one error when the live event is dropped`, async () => {
      const output = await capture({
        format: "json",
        turn: (id) => [prompted(id)],
        // Without the failed step, so only the idle marker can report the outcome.
        messages: (id) => recoveredMessages(outcome)(id).filter((message) => message.id !== "msg_assistant"),
        wait: () => Promise.resolve(),
      })
      expect(output.exitCode).toBe(1)
      expect(jsonLines(output.stdout).filter((event) => event.type === "error")).toHaveLength(1)
    })
  }

  test("only the first idle marker after the prompt decides the outcome", async () => {
    const output = await capture({
      format: "json",
      turn: (id) => [prompted(id)],
      wait: () => Promise.resolve(),
      messages: (messageID) => [
        idleMessage("failed", "msg_later_idle"),
        { id: "msg_other_prompt", type: "user", text: "another client", time: { created: 6 } },
        ...recoveredMessages("succeeded")(messageID),
        idleMessage("failed", "msg_previous_idle"),
      ],
    })
    expect(output.exitCode).toBe(0)
    expect(output.stdout).not.toContain('"type":"error"')
  })

  test("a prompt left in the inbox by a failure before promotion does not hang", async () => {
    const output = await capture({
      format: "json",
      turn: () => [executionFailed("instructions unavailable")],
      messages: () => [],
      inbox: (sessionID) => (sessionID === "ses_1" ? [{ id: "msg_prompt" } as SessionInboxListOutput[number]] : []),
    })
    expect(output.exitCode).toBe(1)
    expect(jsonLines(output.stdout)).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ message: "instructions unavailable" }),
      }),
    ])
  })

  test("keeps waiting when a woken reply moves from the inbox to running between reads", async () => {
    // The wake leaves the inbox as it is read, and its reply runs until the next check.
    let wake: "queued" | "running" | "done" = "queued"
    const output = await capture({
      format: "json",
      inbox: () => {
        if (wake === "queued") wake = "running"
        return []
      },
      active: (): SessionActiveOutput => {
        if (wake !== "running") return {}
        wake = "done"
        return { ses_1: { type: "running" } }
      },
      turn: (id) => [
        prompted(id),
        settled(),
        {
          id: "evt_text",
          created: 2,
          type: "session.text.ended",
          durable: { aggregateID: "ses_1", seq: 2, version: 1 },
          data: { sessionID: "ses_1", assistantMessageID: "msg_2", ordinal: 0, text: "Shell finished." },
        },
        settled(),
      ],
    })
    expect(output.stdout).toContain("Shell finished.")
  })

  test("fails the run when a background state read fails instead of treating it as done", async () => {
    await expect(
      run({
        turn: (id) => [prompted(id), settled()],
        active: () => {
          throw new Error("state unavailable")
        },
      }),
    ).rejects.toThrow("state unavailable")
  })

  test("treats a server without the job list endpoint as having no jobs", async () => {
    const output = await capture({
      turn: (id) => [prompted(id), settled()],
      jobs: () => {
        throw new ClientError("UnsupportedContentType", { detail: "text/plain" })
      },
    })
    expect(output.exitCode).toBe(0)
    expect(output.stderr).toBe("")
  })

  test("does not wait on a job started before this prompt", async () => {
    // A dev server left running by an earlier turn, as with --continue.
    const output = await capture({
      turn: (id) => [prompted(id), settled()],
      jobs: () => [{ ...shellJob("sh_dev", "bun dev"), time: { started: 0 } }],
    })
    expect(output.exitCode).toBe(0)
    expect(output.stderr).not.toContain("waiting for")
  })

  test("cancelling while waiting on background work stops the Session and this prompt's jobs", async () => {
    const controller = new AbortController()
    const old = { ...shellJob("sh_dev", "bun dev"), time: { started: 0 } }
    const all = [old, shellJob("sh_train", "python train.py"), subagentJob]
    // After the cancel reads and stops this prompt's jobs, only the older dev server is left.
    let reads = 0
    const running = run({
      signal: controller.signal,
      turn: (id) => [prompted(id), settled()],
      jobs: () => (controller.signal.aborted && reads++ > 0 ? [old] : all),
    })
    expect(await Promise.race([running.then(() => "exited"), Bun.sleep(20).then(() => "waiting")])).toBe("waiting")
    controller.abort()
    const sdk = await running
    expect(sdk.session.interrupt).toHaveBeenCalledWith({ sessionID: "ses_1" })
    expect(sdk.session.interrupt).toHaveBeenCalledWith({ sessionID: "ses_child" })
    expect(sdk.shell.remove).toHaveBeenCalledWith({ id: "sh_train", location: { directory: "/work tree" } })
    expect(sdk.shell.remove).not.toHaveBeenCalledWith(expect.objectContaining({ id: "sh_dev" }))
  })

  test("cancelling mid-turn interrupts the Session and ignores the transport errors that follow", async () => {
    const controller = new AbortController()
    const closed = Promise.withResolvers<void>()
    const output = capture({
      signal: controller.signal,
      turn: (id) => [prompted(id)],
      // The private server shuts down while the idle wait is open.
      wait: () => closed.promise,
    })
    await Bun.sleep(10)
    controller.abort()
    closed.reject(new ClientError("Transport", { detail: "ECONNRESET" }))
    expect(await output).toMatchObject({ stdout: "", stderr: "", exitCode: 0 })
  })
})
