import { describe, expect, test } from "bun:test"
import { makeACPFixture, makeSession, secondModel, type FixtureContext, type FixtureRequest } from "./service-fixture"

describe("acp service prompt routing and usage", () => {
  test("routes slash commands, skills, and compact through their session endpoints", async () => {
    await using fixture = makeACPFixture({
      fetch(request, context) {
        if (request.method === "POST" && request.path === "/api/session") {
          return Response.json({ data: makeSession("ses_routes") })
        }
        if (request.method === "GET" && request.path === "/api/session/ses_routes") {
          return Response.json({ data: makeSession("ses_routes") })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_routes/command") {
          const id = requestID(request)
          completeTurn(context, "ses_routes", {
            id: `evt_${id}`,
            type: "session.input.promoted",
            data: { sessionID: "ses_routes", inputID: id },
          })
          return Response.json({ data: {} })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_routes/skill") {
          const id = requestID(request)
          completeTurn(context, "ses_routes", {
            id: id.replace(/^msg_/, "evt_"),
            type: "session.skill.activated",
            data: { sessionID: "ses_routes", skill: "verify" },
          })
          return new Response(null, { status: 204 })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_routes/compact") {
          const id = requestID(request)
          completeTurn(context, "ses_routes", {
            id: `evt_${id}`,
            type: "session.compaction.admitted",
            data: { sessionID: "ses_routes", inputID: id },
          })
          return Response.json({ data: {} })
        }
        return undefined
      },
    })
    const session = await fixture.service.newSession({ cwd: "/workspace", mcpServers: [] })

    const commandResult = await fixture.service.prompt({
      sessionId: session.sessionId,
      messageId: "client-command",
      prompt: [{ type: "text", text: "/review now" }],
    })
    const skillResult = await fixture.service.prompt({
      sessionId: session.sessionId,
      messageId: "client-skill",
      prompt: [{ type: "text", text: "/verify" }],
    })
    const compactResult = await fixture.service.prompt({
      sessionId: session.sessionId,
      messageId: "client-compact",
      prompt: [{ type: "text", text: "/compact" }],
    })

    expect([commandResult.stopReason, skillResult.stopReason, compactResult.stopReason]).toEqual([
      "end_turn",
      "end_turn",
      "end_turn",
    ])
    const command = fixture.requests.find((request) => request.path === "/api/session/ses_routes/command")
    const skill = fixture.requests.find((request) => request.path === "/api/session/ses_routes/skill")
    const compact = fixture.requests.find((request) => request.path === "/api/session/ses_routes/compact")
    expect(command?.body).toMatchObject({
      id: expect.any(String),
      command: "review",
      arguments: "now",
      files: [],
      delivery: "steer",
    })
    expect(skill?.body).toMatchObject({ id: expect.any(String), skill: "verify" })
    expect(compact?.body).toMatchObject({ id: expect.any(String) })
    expect(fixture.requests.some((request) => request.path === "/api/session/ses_routes/prompt")).toBe(false)
  })

  test("returns turn usage and publishes current context usage with cumulative session cost", async () => {
    const assistantTokens = {
      input: 100,
      output: 40,
      reasoning: 7,
      cache: { read: 11, write: 13 },
    }
    await using fixture = makeACPFixture({
      fetch(request, context) {
        if (request.method === "POST" && request.path === "/api/session") {
          return Response.json({ data: makeSession("ses_usage") })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_usage/model") {
          return new Response(null, { status: 204 })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_usage/prompt") {
          const id = requestID(request)
          context.send({
            id: `evt_${id}`,
            type: "session.input.promoted",
            data: { sessionID: "ses_usage", inputID: id },
          })
          context.send({
            id: "evt_step",
            type: "session.step.ended",
            data: {
              sessionID: "ses_usage",
              assistantMessageID: "msg_assistant",
              finish: "stop",
              cost: 0.5,
              tokens: assistantTokens,
            },
          })
          context.send({
            id: "evt_done",
            type: "session.execution.succeeded",
            data: { sessionID: "ses_usage" },
          })
          return Response.json({ data: {} })
        }
        if (request.method === "GET" && request.path === "/api/session/ses_usage/message/msg_assistant") {
          return Response.json({
            data: {
              id: "msg_assistant",
              type: "assistant",
              agent: "build",
              model: { providerID: "test", id: secondModel.id },
              content: [{ type: "text", text: "done" }],
              finish: "stop",
              tokens: assistantTokens,
              time: { created: 1, completed: 2 },
            },
          })
        }
        if (request.method === "GET" && request.path === "/api/session/ses_usage") {
          return Response.json({
            data: makeSession("ses_usage", {
              model: { providerID: "test", id: secondModel.id },
              cost: 3.5,
              tokens: { input: 120, output: 50, reasoning: 8, cache: { read: 30, write: 4 } },
            }),
          })
        }
        return undefined
      },
    })
    const session = await fixture.service.newSession({ cwd: "/workspace", mcpServers: [] })
    await fixture.service.setSessionConfigOption({
      sessionId: session.sessionId,
      configId: "model",
      value: "test/second-model",
    })

    const response = await fixture.service.prompt({
      sessionId: session.sessionId,
      messageId: "client-message",
      prompt: [{ type: "text", text: "hello" }],
    })

    expect(response).toEqual({
      stopReason: "end_turn",
      userMessageId: "client-message",
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        thoughtTokens: 7,
        cachedReadTokens: 11,
        cachedWriteTokens: 13,
        totalTokens: 171,
      },
      _meta: {},
    })
    expect(fixture.updates.filter((item) => item.update.sessionUpdate === "usage_update")).toEqual([
      {
        sessionId: "ses_usage",
        update: {
          sessionUpdate: "usage_update",
          used: 171,
          size: 200_000,
          cost: { amount: 3.5, currency: "USD" },
        },
      },
    ])
  })

  test("does not fail a completed prompt when the usage refresh fails", async () => {
    await using fixture = makeACPFixture({
      fetch(request, context) {
        if (request.method === "POST" && request.path === "/api/session") {
          return Response.json({ data: makeSession("ses_usage_failure") })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_usage_failure/prompt") {
          const id = requestID(request)
          context.send({
            id: `evt_${id}`,
            type: "session.input.promoted",
            data: { sessionID: "ses_usage_failure", inputID: id },
          })
          context.send({
            id: "evt_step_failure",
            type: "session.step.ended",
            data: {
              sessionID: "ses_usage_failure",
              assistantMessageID: "msg_usage_failure",
              finish: "stop",
              cost: 0,
              tokens: { input: 3, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          })
          context.send({
            id: "evt_done_failure",
            type: "session.execution.succeeded",
            data: { sessionID: "ses_usage_failure" },
          })
          return Response.json({ data: {} })
        }
        if (request.method === "GET" && request.path === "/api/session/ses_usage_failure/message/msg_usage_failure") {
          return Response.json({
            data: {
              id: "msg_usage_failure",
              type: "assistant",
              agent: "build",
              model: { providerID: "test", id: "test-model" },
              content: [],
              finish: "stop",
              tokens: { input: 3, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: 1, completed: 2 },
            },
          })
        }
        if (request.method === "GET" && request.path === "/api/session/ses_usage_failure") {
          return new Response(null, { status: 500 })
        }
        return undefined
      },
    })
    const session = await fixture.service.newSession({ cwd: "/workspace", mcpServers: [] })

    const response = await fixture.service.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hello" }],
    })

    expect(response.stopReason).toBe("end_turn")
    expect(fixture.updates.some((item) => item.update.sessionUpdate === "usage_update")).toBe(false)
  })
})

function requestID(request: FixtureRequest) {
  if (!request.body || typeof request.body !== "object") throw new Error(`missing body for ${request.path}`)
  const id = Reflect.get(request.body, "id")
  if (typeof id !== "string") throw new Error(`missing prompt id for ${request.path}`)
  return id
}

function completeTurn(context: FixtureContext, sessionID: string, start: unknown) {
  context.send(start)
  context.send({
    id: `evt_done_${sessionID}`,
    type: "session.execution.succeeded",
    data: { sessionID },
  })
}
