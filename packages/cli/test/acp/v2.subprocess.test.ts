import { expect, test } from "bun:test"
import type { InitializeResponse, NewSessionResponse, PromptResponse } from "@agentclientprotocol/sdk/experimental/v2"
import { Option, Schema } from "effect"
import { createAcpFixture, expectOk } from "./subprocess"

// Runs the real CLI, private server, durable inbox, runner and provider adapter against a local model endpoint.
test("v2 stdio admits and steers real session execution, then replays it", async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const calls = { count: 0 }
  await using fixture = await createAcpFixture({
    respond: async () => {
      calls.count++
      if (calls.count === 1) {
        started.resolve()
        await release.promise
      }
      return calls.count >= 3
        ? "## Objective\nContinue the user's work.\n\n## Next Move\nAwait further instructions."
        : "local model reply"
    },
  })
  const acp = fixture.spawn({ experimentalV2: true })
  const initialized = expectOk(
    await acp.request<InitializeResponse>("initialize", {
      protocolVersion: 2,
      info: { name: "integration-test", version: "1" },
    }),
  )
  expect(initialized.protocolVersion).toBe(2)
  const session = expectOk(await acp.request<NewSessionResponse>("session/new", { cwd: fixture.home }))
  const first = expectOk(
    await acp.request<PromptResponse>("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first request" }],
    }),
  )
  await started.promise
  const second = acp.request<PromptResponse>("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "steering request" }],
  })
  release.resolve()
  const steered = expectOk(await second)
  expect(first.messageId).not.toBe(steered.messageId)
  const decode = Schema.decodeUnknownOption(
    Schema.Struct({
      params: Schema.Struct({
        update: Schema.Struct({
          sessionUpdate: Schema.String,
          state: Schema.optional(Schema.String),
          status: Schema.optional(Schema.String),
        }),
      }),
    }),
  )
  const messages: Array<Awaited<ReturnType<typeof acp.notification>>> = []
  const observed = { replies: 0 }
  while (true) {
    const message = await acp.notification()
    messages.push(message)
    const update = decode(message)
    if (Option.isNone(update)) continue
    if (update.value.params.update.sessionUpdate === "agent_message_chunk") observed.replies++
    if (observed.replies >= 2 && update.value.params.update.state === "idle") break
  }
  expect(fixture.llm.requests.length).toBeGreaterThanOrEqual(2)
  expect(messages).toContainEqual(
    expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "local model reply" },
        }),
      }),
    }),
  )
  const compacted = expectOk(
    await acp.request<PromptResponse>("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "/compact" }],
    }),
  )
  expect(compacted.messageId).toBeTruthy()
  const compaction = { completed: false }
  while (true) {
    const message = await acp.notification().catch((error: Error) => {
      throw new Error(`${error.message}: ${JSON.stringify(messages)}`)
    })
    messages.push(message)
    const update = decode(message)
    if (Option.isNone(update)) continue
    if (
      update.value.params.update.sessionUpdate === "compaction_update" &&
      update.value.params.update.status === "completed"
    )
      compaction.completed = true
    if (compaction.completed && update.value.params.update.state === "idle") break
  }
  expect(compaction.completed).toBe(true)
  expectOk(
    await acp.request("session/resume", {
      sessionId: session.sessionId,
      cwd: fixture.home,
      replayFrom: { type: "start" },
    }),
  )
  expect(await acp.close()).toBe(0)
}, 30_000)
