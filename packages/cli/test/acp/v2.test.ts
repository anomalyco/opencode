import { describe, expect, test } from "bun:test"
import {
  batchRequest,
  client,
  ndJsonStream,
  MessageTooLargeError,
  type SessionUpdate,
} from "@agentclientprotocol/sdk/experimental/v2"
import { OpenCode } from "@opencode/client/effect"
import { Effect, Exit, Logger, Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { ACP } from "../../src/acp/agent"
import { tmpdir } from "../fixture/tmpdir"
import {
  delivered,
  durableEvent,
  ephemeralEvent,
  childCreated,
  fileDiff,
  failed,
  interrupted,
  makeSession,
  permissionAsked,
  startServer,
  succeeded,
  stepEnded,
  textDelta,
  toolCalled,
  toolStarted,
  toolSucceeded,
  turn,
  type WireOptions,
} from "./wire-fixture"

describe("acp v2 wire protocol", () => {
  test.each(["close", "cancel"] as const)(
    "%s settles every pending prompt and interrupts after an inbox cancellation fails",
    async (operation) => {
      await using wire = await startV2({
        onPrompt: () => [],
        fetch: (request) =>
          request.method === "DELETE" && request.path.includes("/inbox/")
            ? new Response("temporary failure", { status: 503 })
            : undefined,
      })
      await wire.clientConnection.agent.request("initialize", {
        protocolVersion: 2,
        info: { name: "test", version: "1" },
      })
      const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
      const prompts = ["first", "second"].map((text) =>
        wire.clientConnection.agent
          .request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text }] })
          .catch((error: Error) => error),
      )
      await wire.until(() => wire.server.submissions.length === 2)
      if (operation === "close")
        await wire.clientConnection.agent.request("session/close", { sessionId: session.sessionId })
      if (operation === "cancel")
        await wire.clientConnection.agent.notify("session/cancel", { sessionId: session.sessionId })
      expect(await Promise.all(prompts)).toEqual([
        expect.objectContaining({ code: -32800 }),
        expect.objectContaining({ code: -32800 }),
      ])
      await wire.until(() => wire.server.interrupts.length === 1)
      expect(
        wire.server.requests.filter((request) => request.method === "DELETE" && request.path.includes("/inbox/")),
      ).toHaveLength(2)
      expect(wire.logs).toContainEqual(expect.objectContaining({ message: ["ACP inbox cancellation failed"] }))
    },
  )

  test("streams compaction updates instead of dropping the v1 capability", async () => {
    await using wire = await startV2({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: id }),
          ephemeralEvent("session.compaction.delta", { sessionID, text: "summary" }),
          durableEvent("session.compaction.ended", { sessionID, reason: "manual", text: "summary", recent: "" }),
        ),
    })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hello" }],
    })
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "compaction_update",
        status: "completed",
        summary: [{ type: "text", text: "summary" }],
      }),
    )
    expect(wire.updates).toContainEqual(expect.objectContaining({ sessionUpdate: "compaction_summary_chunk" }))
  })

  test("offers terminal authentication, validates method IDs, and closes the connection on logout", async () => {
    await using wire = await startV2()
    const initialized = await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
      capabilities: { auth: { terminal: {} } },
    })
    expect(initialized.authMethods).toEqual([
      expect.objectContaining({ type: "terminal", methodId: "opencode-login", args: ["--login"] }),
    ])
    expect(await wire.clientConnection.agent.request("auth/login", { methodId: "opencode-login" })).toEqual({})
    await expect(wire.clientConnection.agent.request("auth/login", { methodId: "missing" })).rejects.toMatchObject({
      code: -32602,
    })
    expect(await wire.clientConnection.agent.request("auth/logout", {})).toEqual({})
    await wire.agentConnection.closed
  })

  test("forks sessions with v2 config options", async () => {
    await using wire = await startV2()
    const initialized = await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    expect(initialized.capabilities?.session?.fork).toEqual({})
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    const forked = await wire.clientConnection.agent.request("session/fork", {
      sessionId: session.sessionId,
      cwd: "/workspace",
    })
    expect(forked.sessionId).not.toBe(session.sessionId)
    expect(forked.configOptions?.map((option) => option.configId)).toContain("mode")
  })

  test.each(["/review changes", "/compact"])("advertises and executes %s", async (text) => {
    await using wire = await startV2()
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    await wire.until(() => wire.updates.some((update) => update.sessionUpdate === "available_commands_update"))
    expect(wire.updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "available_commands_update",
        availableCommands: expect.arrayContaining([
          expect.objectContaining({ name: "review" }),
          expect.objectContaining({ name: "compact" }),
        ]),
      }),
    )
    const accepted = await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text }],
    })
    expect(accepted.messageId).toBeTruthy()
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual({
      sessionUpdate: "user_message",
      messageId: accepted.messageId,
      content: [{ type: "text", text }],
    })
    expect(wire.server.submissions).toContainEqual(
      expect.objectContaining({ kind: text === "/compact" ? "compact" : "command" }),
    )
  })

  test("closing a session cancels pending input and resume installs a fresh observer", async () => {
    await using wire = await startV2({
      onPrompt: ({ sessionID, id, text }) =>
        text === "queued" ? [] : turn(sessionID, id, textDelta(sessionID, "msg_after_resume", "after resume")),
    })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    const pending = wire.clientConnection.agent
      .request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: "queued" }] })
      .catch((error: Error) => error)
    await wire.until(() => wire.server.submissions.length === 1)
    await wire.clientConnection.agent.request("session/close", { sessionId: session.sessionId })
    expect(await pending).toMatchObject({ code: -32800 })
    expect(
      wire.server.requests.some((request) => request.method === "DELETE" && request.path.includes("/inbox/")),
    ).toBe(true)
    await wire.clientConnection.agent.request("session/resume", { sessionId: session.sessionId, cwd: "/workspace" })
    await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "again" }],
    })
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg_after_resume",
      content: { type: "text", text: "after resume" },
    })
  })

  test("fails undelivered prompts and invalidates confirmed state when the observer disconnects", async () => {
    await using wire = await startV2({ onPrompt: () => [] })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    const pending = wire.clientConnection.agent
      .request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: "queued" }] })
      .catch((error: Error) => error)
    await wire.until(() => wire.server.submissions.length === 1)
    wire.server.closeEvents()
    expect(await pending).toMatchObject({ code: -32603 })
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "unknown"),
    )
    expect(wire.logs).toContainEqual(expect.objectContaining({ message: ["ACP session observer failed"] }))
  })

  test("cancelling an undelivered steer does not interrupt the running session", async () => {
    await using wire = await startV2({
      onPrompt: ({ sessionID, id, text }) => (text === "hold" ? [delivered(sessionID, id)] : []),
    })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hold" }],
    })
    const controller = new AbortController()
    const pending = wire.clientConnection.agent
      .request(
        "session/prompt",
        { sessionId: session.sessionId, prompt: [{ type: "text", text: "queued steer" }] },
        { cancellationSignal: controller.signal },
      )
      .catch((error: Error) => error)
    await wire.until(() => wire.server.submissions.length === 2)
    controller.abort()
    expect(await pending).toMatchObject({ code: -32800 })
    await wire.until(() =>
      wire.server.requests.some((request) => request.method === "GET" && request.path.includes("/message/")),
    )
    expect(wire.server.interrupts).toHaveLength(0)
    wire.server.send(textDelta(session.sessionId, "msg_still_running", "still running"), succeeded(session.sessionId))
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" })
  })

  test("does not retain a failed execution's outcome for the next prompt", async () => {
    await using wire = await startV2({
      onPrompt: ({ sessionID, id, text }) =>
        text === "fail"
          ? [delivered(sessionID, id), failed(sessionID, { type: "provider.transport", message: "offline" })]
          : turn(sessionID, id, textDelta(sessionID, "msg_recovered", "recovered")),
    })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "fail" }],
    })
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    wire.updates.length = 0
    await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "recover" }],
    })
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" })
    expect(
      wire.updates.some(
        (update) => update.sessionUpdate === "state_update" && update.state === "idle" && update.stopReason === "error",
      ),
    ).toBe(false)
  })

  test("steers a running session without duplicate streaming or per-prompt idle snapshots", async () => {
    await using wire = await startV2({
      onPrompt: ({ sessionID, id, text }) => [delivered(sessionID, id), textDelta(sessionID, `msg_${text}`, text)],
    })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    const first = await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }],
    })
    const second = await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "steer" }],
    })
    expect(first.messageId).not.toBe(second.messageId)
    await wire.until(() => wire.updates.filter((update) => update.sessionUpdate === "agent_message_chunk").length === 2)
    expect(wire.updates.filter((update) => update.sessionUpdate === "user_message")).toHaveLength(2)
    expect(wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle")).toBe(
      false,
    )
    wire.server.send(succeeded(session.sessionId))
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(
      wire.updates.filter((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    ).toHaveLength(1)
    expect(
      wire.server.submissions
        .filter((submission) => submission.kind === "prompt")
        .map((submission) => submission.delivery),
    ).toEqual(["steer", "steer"])
  })

  test("continues observing parent output when execution resumes after idle", async () => {
    await using wire = await startV2({
      onPrompt: ({ sessionID, id }) =>
        turn(sessionID, id, childCreated("ses_background", sessionID, "Background task")),
    })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }],
    })
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    wire.updates.length = 0
    wire.server.send(
      succeeded("ses_background"),
      delivered(session.sessionId, "msg_child_completion"),
      textDelta(session.sessionId, "msg_resumed", "resumed parent"),
      succeeded(session.sessionId),
    )
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toEqual([
      { sessionUpdate: "state_update", state: "running" },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_resumed",
        content: { type: "text", text: "resumed parent" },
      },
      { sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" },
    ])
  })

  test("handles batched session requests on the opt-in v2 connection", async () => {
    await using wire = await startV2()
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const [first, second] = await wire.clientConnection.agent.batch([
      batchRequest("session/new", { cwd: "/workspace" }),
      batchRequest("session/new", { cwd: "/workspace" }),
    ])
    expect(first.sessionId).not.toBe(second.sessionId)
    const [listed, resumed] = await wire.clientConnection.agent.batch([
      batchRequest("session/list", {}),
      batchRequest("session/resume", { cwd: "/workspace", sessionId: first.sessionId }),
    ])
    expect(listed.sessions.map((session) => session.sessionId)).toEqual(
      expect.arrayContaining([first.sessionId, second.sessionId]),
    )
    expect(resumed.configOptions?.map((option) => option.configId)).toContain("model")
  })

  test("preserves the transport size-limit failure through version negotiation", async () => {
    await using wire = await startV2({}, undefined, 1024)
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    const pending = wire.clientConnection.agent
      .request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: "x".repeat(2048) }] })
      .catch(() => undefined)
    await wire.agentConnection.closed
    expect(wire.agentConnection.signal.reason).toBeInstanceOf(MessageTooLargeError)
    wire.clientConnection.close()
    await pending
  })
  test("does not acknowledge queued work as an inserted message and cancels it before delivery", async () => {
    await using wire = await startV2({ onPrompt: () => [] })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    const controller = new AbortController()
    const pending = wire.clientConnection.agent.request(
      "session/prompt",
      { sessionId: session.sessionId, prompt: [{ type: "text", text: "queued" }] },
      { cancellationSignal: controller.signal },
    )
    const rejected = pending.then(
      () => ({ code: 0 }),
      (error) => error,
    )
    await wire.until(() => wire.server.submissions.length > 0)
    expect(wire.updates.some((update) => update.sessionUpdate === "user_message")).toBe(false)
    controller.abort()
    expect(await rejected).toMatchObject({ code: -32800 })
    await wire.until(() =>
      wire.server.requests.find((request) => request.method === "DELETE" && request.path.includes("/inbox/")),
    )
    expect(wire.updates.some((update) => update.sessionUpdate === "user_message")).toBe(false)
  })

  test("reports failure after acceptance as an idle error snapshot", async () => {
    await using wire = await startV2({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        failed(sessionID, { type: "provider.transport", message: "lost connection" }),
      ],
    })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    const accepted = await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hello" }],
    })
    expect(accepted.messageId).toBeTruthy()
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "state_update",
        state: "idle",
        stopReason: "error",
        error: { code: -32603, message: "Prompt processing failed" },
      }),
    )
  })
  test("cancels an outstanding permission request with its session", async () => {
    const asked = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    await using wire = await startV2(
      {
        onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), permissionAsked(sessionID, "per_v2")],
        onInterrupt: ({ sessionID }) => [interrupted(sessionID)],
      },
      async (signal) => {
        asked.resolve()
        signal.addEventListener("abort", () => cancelled.resolve(), { once: true })
        await cancelled.promise
        return { outcome: { outcome: "cancelled" } }
      },
    )
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "run" }],
    })
    await asked.promise
    await wire.clientConnection.agent.notify("session/cancel", { sessionId: session.sessionId })
    await cancelled.promise
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual({ sessionUpdate: "state_update", state: "idle", stopReason: "cancelled" })
  })

  test("rejects unknown prompt content before admission and remains usable", async () => {
    await using wire = await startV2()
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    await expect(
      wire.clientConnection.agent.request("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "_unknown" }],
      }),
    ).rejects.toMatchObject({ code: -32602 })
    expect(wire.server.submissions).toHaveLength(0)
    const accepted = await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hello" }],
    })
    expect(accepted.messageId).toBeTruthy()
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
  })
  test("preserves renderable diffs and treats empty file content as a modification", async () => {
    await using dir = await tmpdir()
    const file = `${dir.path}/file.txt`
    await Bun.write(file, "")
    await using wire = await startV2({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          toolStarted(sessionID, "call_edit", "edit"),
          toolCalled(sessionID, "call_edit", { path: file, oldString: "before", newString: "" }),
          toolSucceeded(sessionID, "call_edit", { files: [fileDiff(file, "before", "")] }, "edited"),
        ),
    })
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "empty the file" }],
    })
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "call_edit",
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "diff",
            changes: [{ operation: "modify", path: file, fileType: "text" }],
            patch: { format: "git_patch", text: expect.stringContaining("-before") },
          }),
        ]),
      }),
    )
  })

  test("resumes with user history and a state snapshot, and rejects unsupported replay cursors", async () => {
    await using wire = await startV2()
    wire.server.sessions.set("ses_replay", makeSession("ses_replay"))
    wire.server.messages.set("ses_replay", [
      { id: "msg_history", type: "user", text: "previous input", time: { created: 1 } },
    ])
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    const params = { sessionId: "ses_replay", cwd: "/workspace" }
    await expect(
      wire.clientConnection.agent.request("session/resume", {
        ...params,
        replayFrom: { type: "_unsupported" },
      }),
    ).rejects.toMatchObject({ code: -32602 })
    await wire.clientConnection.agent.request("session/resume", params)
    await wire.until(() => wire.updates.some((update) => update.sessionUpdate === "state_update"))
    expect(wire.updates.some((update) => update.sessionUpdate === "user_message")).toBe(false)
    wire.updates.length = 0
    await wire.clientConnection.agent.request("session/resume", { ...params, replayFrom: { type: "start" } })
    await wire.until(() => wire.updates.some((update) => update.sessionUpdate === "state_update"))
    expect(wire.updates).toContainEqual({
      sessionUpdate: "user_message",
      messageId: "msg_history",
      content: [{ type: "text", text: "previous input" }],
    })
    expect(wire.updates.at(-1)).toEqual({ sessionUpdate: "state_update", state: "unknown" })
    wire.updates.length = 0
    await wire.clientConnection.agent.request("session/resume", { ...params, replayFrom: { type: "start" } })
    await wire.until(() => wire.updates.some((update) => update.sessionUpdate === "state_update"))
    expect(wire.updates.filter((update) => update.sessionUpdate === "user_message")).toEqual([
      {
        sessionUpdate: "user_message",
        messageId: "msg_history",
        content: [{ type: "text", text: "previous input" }],
      },
    ])
  })

  test("accepts MCP transports with omitted optional arguments and headers", async () => {
    await using wire = await startV2()
    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
    })
    await wire.clientConnection.agent.request("session/new", {
      cwd: "/workspace",
      mcpServers: [
        { type: "http", name: "remote", url: "https://example.com/mcp" },
        { type: "stdio", name: "local", command: "/bin/example" },
      ],
    })
    expect(wire.server.mcp).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "remote", config: expect.objectContaining({ headers: {} }) }),
        expect.objectContaining({
          name: "local",
          config: expect.objectContaining({ command: ["/bin/example"], environment: {} }),
        }),
      ]),
    )
  })

  test("negotiates v2 and acknowledges an inserted prompt before reporting idle", async () => {
    await using wire = await startV2()

    const initialized = await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
      capabilities: {},
    })
    expect(initialized).toMatchObject({ protocolVersion: 2, info: { name: "opencode" } })
    expect(initialized.capabilities?.session?.prompt).toHaveProperty("image")

    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    expect(session.configOptions?.map((option) => option.configId)).toContain("model")

    const accepted = await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hello" }],
    })
    expect(accepted.messageId).toBeTruthy()

    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
    expect(wire.updates).toContainEqual({
      sessionUpdate: "user_message",
      messageId: accepted.messageId,
      content: [{ type: "text", text: "hello" }],
    })
    expect(wire.updates).toContainEqual({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" })
    expect(wire.updates).toContainEqual({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg_v2",
      content: { type: "text", text: "answer" },
    })
    expect(wire.updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "call_v2",
        name: "read",
      }),
    )
  })

  test("returns the prompt acknowledgment while the accepted run is still active", async () => {
    await using wire = await startV2({
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id)],
      onInterrupt: ({ sessionID }) => [interrupted(sessionID)],
    })

    await wire.clientConnection.agent.request("initialize", {
      protocolVersion: 2,
      info: { name: "test", version: "1" },
      capabilities: {},
    })
    const session = await wire.clientConnection.agent.request("session/new", { cwd: "/workspace" })
    const accepted = await wire.clientConnection.agent.request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hold" }],
    })

    expect(accepted.messageId).toBeTruthy()
    expect(wire.updates).not.toContainEqual(expect.objectContaining({ sessionUpdate: "state_update", state: "idle" }))
    await wire.until(() =>
      wire.updates.some((update) => update.sessionUpdate === "state_update" && update.state === "running"),
    )
    wire.updates.length = 0
    await wire.clientConnection.agent.request("session/resume", { sessionId: session.sessionId, cwd: "/workspace" })
    await wire.until(() => wire.updates.some((update) => update.sessionUpdate === "state_update"))
    expect(wire.updates).toContainEqual({ sessionUpdate: "state_update", state: "running" })

    await wire.clientConnection.agent.notify("session/cancel", { sessionId: session.sessionId })
    await wire.until(() =>
      wire.updates.find((update) => update.sessionUpdate === "state_update" && update.state === "idle"),
    )
  })
})

async function startV2(
  options: WireOptions = {},
  permission?: (signal: AbortSignal) => Promise<{ outcome: { outcome: "cancelled" } }>,
  maxMessageBytes?: number,
) {
  const changedWaiters = new Set<() => void>()
  const changed = () => changedWaiters.forEach((wake) => wake())
  const server = startServer(
    {
      ...options,
      onPrompt:
        options.onPrompt ??
        (({ sessionID, id }) =>
          turn(
            sessionID,
            id,
            toolStarted(sessionID, "call_v2", "read"),
            toolCalled(sessionID, "call_v2", { filePath: "/workspace/README.md" }),
            toolSucceeded(sessionID, "call_v2", {}, "contents"),
            textDelta(sessionID, "msg_v2", "answer"),
            stepEnded(sessionID, "msg_v2"),
          )),
    },
    changed,
  )
  const agentScope = Scope.makeUnsafe()
  const logs: Array<Pick<Logger.Options<unknown>, "message" | "cause">> = []
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  const agentConnection = await Effect.runPromise(
    OpenCode.make({ baseUrl: server.url }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.flatMap((client) => ACP.router(client, { experimentalV2: true })),
      Effect.map((router) =>
        router.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable, { maxMessageBytes })),
      ),
      Scope.provide(agentScope),
      Effect.provide(Logger.layer([Logger.make((log) => logs.push({ message: log.message, cause: log.cause }))])),
    ),
  )
  const updates: SessionUpdate[] = []
  const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
  const clientConnection = client({ name: "test" })
    .onRequest("session/request_permission", (ctx) =>
      permission ? permission(ctx.signal) : { outcome: { outcome: "cancelled" } },
    )
    .onNotification("session/update", (ctx) => {
      updates.push(ctx.params.update)
      changed()
    })
    .connect(clientStream)

  const until = <A>(read: () => A | undefined | false, timeout = 5_000): Promise<A> => {
    const initial = read()
    if (initial !== undefined && initial !== false) return Promise.resolve(initial)
    return new Promise((resolve, reject) => {
      const wake = () => {
        const value = read()
        if (value === undefined || value === false) return
        clearTimeout(timer)
        changedWaiters.delete(wake)
        resolve(value)
      }
      const timer = setTimeout(() => {
        changedWaiters.delete(wake)
        reject(new Error("timed out waiting for ACP v2 update"))
      }, timeout)
      changedWaiters.add(wake)
    })
  }

  return {
    logs,
    agentConnection,
    server,
    updates,
    until,
    clientConnection,
    async [Symbol.asyncDispose]() {
      clientConnection.close()
      await Effect.runPromise(Scope.close(agentScope, Exit.void))
      await server.stop()
    },
  }
}
