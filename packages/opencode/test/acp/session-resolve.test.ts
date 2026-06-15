import { describe, expect, it } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { SessionResolver } from "@/acp/session-resolve"
import { ACPSession } from "@/acp/session"

function makeSessionService() {
  return ManagedRuntime.make(ACPSession.defaultLayer).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

function sdkWithSessions(sessions: Record<string, { parentID?: string; directory?: string }>) {
  return {
    session: {
      get: (input: { sessionID: string }) =>
        Promise.resolve({
          data: sessions[input.sessionID]
            ? {
                id: input.sessionID,
                parentID: sessions[input.sessionID]?.parentID,
                directory: sessions[input.sessionID]?.directory ?? "/workspace",
              }
            : undefined,
        }),
    },
  } as unknown as OpencodeClient
}

describe("acp session resolve", () => {
  it("registers unknown child sessions by walking the SDK parent chain", async () => {
    const session = makeSessionService()
    await Effect.runPromise(session.create({ id: "ses_root", cwd: "/workspace" }))
    const resolver = new SessionResolver(session, sdkWithSessions({ ses_child: { parentID: "ses_root" } }))

    const resolved = await resolver.resolve("ses_child")

    expect(resolved).toMatchObject({
      id: "ses_child",
      rootSessionId: "ses_root",
      cwd: "/workspace",
    })
    expect(await Effect.runPromise(session.getRoot("ses_child"))).toMatchObject({ id: "ses_root" })
  })

  it("registers nested grandchild sessions through the full ancestry chain", async () => {
    const session = makeSessionService()
    await Effect.runPromise(session.create({ id: "ses_root", cwd: "/workspace" }))
    const resolver = new SessionResolver(
      session,
      sdkWithSessions({
        ses_grandchild: { parentID: "ses_child" },
        ses_child: { parentID: "ses_root" },
      }),
    )

    const resolved = await resolver.resolve("ses_grandchild")

    expect(resolved).toMatchObject({ id: "ses_grandchild", rootSessionId: "ses_root" })
    expect(await Effect.runPromise(session.tryGet("ses_child"))).toMatchObject({ rootSessionId: "ses_root" })
    expect(await Effect.runPromise(session.getRoot("ses_grandchild"))).toMatchObject({ id: "ses_root" })
  })

  it("returns undefined when the SDK parent chain contains a cycle", async () => {
    const session = makeSessionService()
    await Effect.runPromise(session.create({ id: "ses_root", cwd: "/workspace" }))
    const resolver = new SessionResolver(
      session,
      sdkWithSessions({
        ses_a: { parentID: "ses_b" },
        ses_b: { parentID: "ses_a" },
      }),
    )

    expect(await resolver.resolve("ses_a")).toBeUndefined()
    expect(await Effect.runPromise(session.tryGet("ses_a"))).toBeUndefined()
  })

  it("invalidates cached parent lookups after session deletion", async () => {
    const session = makeSessionService()
    await Effect.runPromise(session.create({ id: "ses_root", cwd: "/workspace" }))
    const resolver = new SessionResolver(session, sdkWithSessions({ ses_child: { parentID: "ses_root" } }))

    await resolver.resolve("ses_child")
    resolver.invalidate("ses_child")

    const resolved = await resolver.resolve("ses_child")
    expect(resolved).toMatchObject({ id: "ses_child", rootSessionId: "ses_root" })
  })
})
