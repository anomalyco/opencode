import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { DiscordPresence } from "../../src/discord/presence"

const baseSession = Session.Info.parse({
  id: "ses_test",
  slug: "test",
  projectID: "project",
  directory: "/tmp",
  title: "Test Session",
  version: "0.0.0",
  time: {
    created: 1_700_000_000_000,
    updated: 1_700_000_000_000,
  },
})

const sharedSession = Session.Info.parse({
  ...baseSession,
  id: "ses_shared",
  slug: "shared",
  share: {
    url: "https://opencode.ai/share/abc",
  },
})

describe("discord rich presence", () => {
  test("defaults to enabled with default client id", () => {
    expect(DiscordPresence.isEnabled()).toBe(true)
    expect(DiscordPresence.resolveClientId()).toBe(DiscordPresence.DEFAULT_CLIENT_ID)
  })

  test("allows disabling and custom client id", () => {
    expect(DiscordPresence.isEnabled({ enabled: false })).toBe(false)
    expect(DiscordPresence.resolveClientId({ useDefaultClientId: false })).toBeUndefined()
    expect(
      DiscordPresence.resolveClientId({
        clientId: "custom",
        useDefaultClientId: false,
      }),
    ).toBe("custom")
  })

  test("sets activity on busy status with session duration", async () => {
    const client = new DiscordPresence.TestClient()
    const manager = new DiscordPresence.Manager({
      client,
      config: {
        showSessionDuration: true,
      },
    })

    manager.handleSession(baseSession)
    await manager.handleStatus(baseSession.id, SessionStatus.Info.parse({ type: "busy" }))

    expect(client.activities).toHaveLength(1)
    expect(client.activities[0]?.details).toBe("Session: Test Session")
    expect(client.activities[0]?.startTimestamp).toBe(baseSession.time.created)
  })

  test("includes model in state when configured", async () => {
    const client = new DiscordPresence.TestClient()
    const manager = new DiscordPresence.Manager({
      client,
      config: {
        showModel: true,
      },
    })

    manager.handleSession(baseSession)
    manager.handleModel(baseSession.id, { providerID: "openai", modelID: "gpt-4.1" })
    await manager.handleStatus(baseSession.id, SessionStatus.Info.parse({ type: "busy" }))

    expect(client.activities[0]?.state).toBe("Model: openai/gpt-4.1")
  })

  test("uses tool details when available", async () => {
    const client = new DiscordPresence.TestClient()
    const manager = new DiscordPresence.Manager({
      client,
      config: {
        showTool: true,
      },
    })

    manager.handleSession(baseSession)
    manager.handleTool(baseSession.id, "rg")
    await manager.handleStatus(baseSession.id, SessionStatus.Info.parse({ type: "busy" }))

    expect(client.activities[0]?.details).toBe("Tool: rg")
  })

  test("adds session button when shared", async () => {
    const client = new DiscordPresence.TestClient()
    const manager = new DiscordPresence.Manager({
      client,
      config: {
        buttons: {
          session: true,
        },
      },
    })

    manager.handleSession(sharedSession)
    await manager.handleStatus(sharedSession.id, SessionStatus.Info.parse({ type: "busy" }))

    expect(client.activities[0]?.buttons).toEqual([
      {
        label: "Session",
        url: "https://opencode.ai/share/abc",
      },
    ])
  })
})
