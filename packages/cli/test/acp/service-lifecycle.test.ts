import { describe, expect, test } from "bun:test"
import type { CreateElicitationRequest, SessionConfigOption } from "@agentclientprotocol/sdk"
import { makeACPFixture, makeSession, secondModel } from "./service-fixture"
import { durableEvent, ephemeralEvent } from "./sse-fixture"

describe("acp service lifecycle", () => {
  test("enables form elicitation from negotiated client capabilities", async () => {
    const elicitations: CreateElicitationRequest[] = []
    await using fixture = makeACPFixture({
      createElicitation: async (request) => {
        elicitations.push(request)
        return { action: "accept", content: { name: "Ada" } }
      },
      fetch(request, context) {
        if (request.method === "POST" && request.path === "/api/session") {
          return Response.json({ data: makeSession("ses_elicitation") })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_elicitation/prompt") {
          if (!request.body || typeof request.body !== "object") return new Response(null, { status: 400 })
          const inputID = Reflect.get(request.body, "id")
          if (typeof inputID !== "string") return new Response(null, { status: 400 })
          context.send(durableEvent("session.input.promoted", { sessionID: "ses_elicitation", inputID }))
          context.send(
            ephemeralEvent("form.created", {
              form: {
                id: "frm_elicitation",
                sessionID: "ses_elicitation",
                title: "Profile",
                fields: [{ key: "name", title: "Name", type: "string", required: true }],
              },
            }),
          )
          return Response.json({ data: { text: "hello" } })
        }
        if (
          request.method === "POST" &&
          request.path === "/api/session/ses_elicitation/form/frm_elicitation/reply"
        ) {
          context.send(
            ephemeralEvent("form.replied", {
              id: "frm_elicitation",
              sessionID: "ses_elicitation",
              answer: { name: "Ada" },
            }),
          )
          context.send(durableEvent("session.execution.succeeded", { sessionID: "ses_elicitation" }))
          return new Response(null, { status: 204 })
        }
        return undefined
      },
    })
    await fixture.service.initialize({
      protocolVersion: 1,
      clientCapabilities: { elicitation: { form: {} } },
      clientInfo: { name: "test", version: "1.0.0" },
    })
    const session = await fixture.service.newSession({ cwd: "/workspace", mcpServers: [] })

    const response = await fixture.service.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hi" }] })

    expect(response.stopReason).toBe("end_turn")
    expect(elicitations).toEqual([
      {
        sessionId: "ses_elicitation",
        mode: "form",
        message: "Profile",
        requestedSchema: {
          type: "object",
          title: "Profile",
          properties: { name: { type: "string", title: "Name" } },
          required: ["name"],
        },
      },
    ])
  })

  test("loads and forks with paginated replay while resume does not replay", async () => {
    await using fixture = makeACPFixture({
      fetch(request) {
        if (request.method === "GET" && request.path === "/api/session/ses_loaded") {
          return Response.json({
            data: makeSession("ses_loaded", {
              cwd: "/workspace",
              agent: "plan",
              model: { providerID: "test", id: secondModel.id, variant: "medium" },
            }),
          })
        }
        if (request.method === "GET" && request.path === "/api/session/ses_resume") {
          return Response.json({
            data: makeSession("ses_resume", {
              cwd: "/workspace",
              agent: "plan",
              model: { providerID: "test", id: secondModel.id, variant: "low" },
            }),
          })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_loaded/fork") {
          return Response.json({
            data: makeSession("ses_fork", {
              cwd: "/workspace",
              agent: "plan",
              model: { providerID: "test", id: secondModel.id, variant: "medium" },
            }),
          })
        }
        if (request.method === "GET" && request.path === "/api/session/ses_loaded/message") {
          if (request.query.cursor === "messages-2") {
            return Response.json({
              data: [
                {
                  id: "msg_assistant",
                  type: "assistant",
                  content: [{ type: "text", text: "hi there" }],
                },
              ],
              cursor: {},
            })
          }
          return Response.json({
            data: [{ id: "msg_user", type: "user", text: "hello", time: { created: 1 } }],
            cursor: { next: "messages-2" },
          })
        }
        if (request.method === "GET" && request.path === "/api/session/ses_fork/message") {
          return Response.json({
            data: [{ id: "msg_fork", type: "user", text: "forked", time: { created: 2 } }],
            cursor: {},
          })
        }
        return undefined
      },
    })

    const loaded = await fixture.service.loadSession({
      cwd: "/ignored",
      sessionId: "ses_loaded",
      mcpServers: [],
    })
    const resumed = await fixture.service.resumeSession({
      cwd: "/ignored",
      sessionId: "ses_resume",
      mcpServers: [],
    })
    const forked = await fixture.service.forkSession({
      cwd: "/ignored",
      sessionId: "ses_loaded",
      mcpServers: [],
    })

    expect(currentValue(loaded, "model")).toBe("test/second-model")
    expect(currentValue(loaded, "effort")).toBe("medium")
    expect(currentValue(loaded, "mode")).toBe("plan")
    expect(currentValue(resumed, "effort")).toBe("low")
    expect(forked.sessionId).toBe("ses_fork")
    expect(currentValue(forked, "effort")).toBe("medium")
    expect(
      fixture.updates.filter(
        (item) =>
          item.update.sessionUpdate === "user_message_chunk" || item.update.sessionUpdate === "agent_message_chunk",
      ),
    ).toEqual([
      {
        sessionId: "ses_loaded",
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "msg_user",
          content: { type: "text", text: "hello" },
        },
      },
      {
        sessionId: "ses_loaded",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_assistant",
          content: { type: "text", text: "hi there" },
        },
      },
      {
        sessionId: "ses_fork",
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "msg_fork",
          content: { type: "text", text: "forked" },
        },
      },
    ])
    expect(
      fixture.requests
        .filter((request) => request.path.endsWith("/message"))
        .map((request) => ({ path: request.path, query: request.query })),
    ).toEqual([
      {
        path: "/api/session/ses_loaded/message",
        query: { limit: "200", order: "asc" },
      },
      {
        path: "/api/session/ses_loaded/message",
        query: { limit: "200", cursor: "messages-2" },
      },
      {
        path: "/api/session/ses_fork/message",
        query: { limit: "200", order: "asc" },
      },
    ])
    expect(fixture.requests).toContainEqual({
      method: "POST",
      path: "/api/session/ses_loaded/fork",
      query: {},
      body: {},
    })
  })

  test("lists server-backed pages and forwards cwd and cursor", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      makeSession(`ses_${100 - index}`, {
        cwd: "/workspace",
        time: { created: index, updated: 100_000 - index },
        title: `Session ${100 - index}`,
      }),
    )
    await using fixture = makeACPFixture({
      fetch(request) {
        if (request.method !== "GET" || request.path !== "/api/session") return undefined
        if (request.query.cursor === "page-2") {
          return Response.json({
            data: [makeSession("ses_0", { cwd: "/workspace", time: { created: 0, updated: 1 } })],
            cursor: {},
          })
        }
        return Response.json({ data: firstPage, cursor: { next: "page-2" } })
      },
    })

    const first = await fixture.service.listSessions({ cwd: "/workspace" })
    const second = await fixture.service.listSessions({ cwd: "/workspace", cursor: first.nextCursor })

    expect(first.sessions).toHaveLength(100)
    expect(first.sessions[0]).toEqual({
      sessionId: "ses_100",
      cwd: "/workspace",
      title: "Session 100",
      updatedAt: new Date(100_000).toISOString(),
    })
    expect(first.nextCursor).toBe("page-2")
    expect(second.sessions.map((session) => session.sessionId)).toEqual(["ses_0"])
    expect(second.nextCursor).toBeUndefined()
    expect(
      fixture.requests.filter((request) => request.path === "/api/session").map((request) => request.query),
    ).toEqual([
      { limit: "100", order: "desc", directory: "/workspace" },
      { limit: "100", order: "desc", directory: "/workspace", cursor: "page-2" },
    ])
  })

  test("cancel preserves the attachment while close removes it and interrupts best-effort", async () => {
    await using fixture = makeACPFixture({
      fetch(request) {
        if (request.method === "POST" && request.path === "/api/session") {
          return Response.json({ data: makeSession("ses_lifecycle") })
        }
        if (request.method === "POST" && request.path === "/api/session/ses_lifecycle/model") {
          return new Response(null, { status: 204 })
        }
        if (request.method === "POST" && request.path.endsWith("/interrupt")) {
          return new Response(null, { status: 500 })
        }
        return undefined
      },
    })
    const created = await fixture.service.newSession({ cwd: "/workspace", mcpServers: [] })

    await fixture.service.cancel({ sessionId: created.sessionId })
    const updated = await fixture.service.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: "effort",
      value: "high",
    })

    expect(currentValue(updated, "effort")).toBe("high")
    expect(await fixture.service.closeSession({ sessionId: created.sessionId })).toEqual({})
    const missing = await fixture.service
      .setSessionConfigOption({
        sessionId: created.sessionId,
        configId: "effort",
        value: "default",
      })
      .catch((error: unknown) => error)
    expect(missing).toMatchObject({ _tag: "ACPSessionNotFoundError", sessionId: created.sessionId })
    expect(await fixture.service.closeSession({ sessionId: "missing" })).toEqual({})
    expect(
      fixture.requests.filter((request) => request.path.endsWith("/interrupt")).map((request) => request.path),
    ).toEqual([
      "/api/session/ses_lifecycle/interrupt",
      "/api/session/ses_lifecycle/interrupt",
      "/api/session/missing/interrupt",
    ])
  })
})

function currentValue(result: { readonly configOptions?: readonly SessionConfigOption[] | null }, id: string) {
  return result.configOptions?.find((option) => option.id === id)?.currentValue
}
