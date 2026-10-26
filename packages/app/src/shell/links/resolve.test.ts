import { describe, expect, test } from "bun:test"
import { resolveLinkSession, type LinkServer } from "./resolve"

type Session = { id: string }

function server(key: string, url: string, sessions: string[], calls: string[] = []): LinkServer<string, Session> {
  return {
    key,
    url,
    get: async (sessionID) => {
      calls.push(key)

      if (sessions.includes(sessionID)) return { id: sessionID }
      throw new Error("NotFound")
    },
  }
}

// Answers only when its signal aborts, like a server that is down.
function hanging(key: string, calls: string[] = []): LinkServer<string, Session> {
  return {
    key,
    url: "http://down.example.com",
    get: (_sessionID, signal) => {
      calls.push(key)

      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)))
    },
  }
}

describe("resolveLinkSession", () => {
  test("asks only the server the link names when it has the session", async () => {
    const calls: string[] = []

    const servers = [
      server("sidecar", "http://127.0.0.1:4096", ["ses_a"], calls),
      server("https://devbox.example.com:4096", "https://devbox.example.com:4096", ["ses_a"], calls),
    ]

    expect(
      await resolveLinkSession({ sessionID: "ses_a", hint: "https://devbox.example.com:4096", servers, timeout: 100 }),
    ).toEqual({ key: "https://devbox.example.com:4096", session: { id: "ses_a" } })
    expect(calls).toEqual(["https://devbox.example.com:4096"])
  })

  test("matches a named server by key or by origin", async () => {
    const servers = [server("ssh:devbox", "http://127.0.0.1:52000/", ["ses_a"])]

    expect((await resolveLinkSession({ sessionID: "ses_a", hint: "ssh:devbox", servers, timeout: 100 }))?.key).toBe(
      "ssh:devbox",
    )
    expect(
      (await resolveLinkSession({ sessionID: "ses_a", hint: "http://127.0.0.1:52000", servers, timeout: 100 }))?.key,
    ).toBe("ssh:devbox")
  })

  test("finds the session on another server when the named one is unknown or lacks it", async () => {
    const servers = [
      server("sidecar", "http://127.0.0.1:4096", ["ses_a"]),
      server("https://other.example.com", "https://other.example.com", []),
    ]

    expect(
      (await resolveLinkSession({ sessionID: "ses_a", hint: "https://devbox.example.com:4096", servers, timeout: 100 }))
        ?.key,
    ).toBe("sidecar")
    expect(
      (await resolveLinkSession({ sessionID: "ses_a", hint: "https://other.example.com", servers, timeout: 100 }))?.key,
    ).toBe("sidecar")
    expect((await resolveLinkSession({ sessionID: "ses_a", servers, timeout: 100 }))?.key).toBe("sidecar")
  })

  test("does not wait for a server that is down", async () => {
    const calls: string[] = []
    const servers = [hanging("ssh:down", calls), server("sidecar", "http://127.0.0.1:4096", ["ses_a"], calls)]
    const started = Date.now()

    expect((await resolveLinkSession({ sessionID: "ses_a", servers, timeout: 5_000 }))?.key).toBe("sidecar")
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(calls).toEqual(["ssh:down", "sidecar"])
  })

  test("gives up when no server has the session", async () => {
    const servers = [hanging("ssh:down"), server("sidecar", "http://127.0.0.1:4096", [])]

    expect(await resolveLinkSession({ sessionID: "ses_a", hint: "sidecar", servers, timeout: 20 })).toBeUndefined()
    expect(await resolveLinkSession({ sessionID: "ses_a", servers: [], timeout: 20 })).toBeUndefined()
  })
})
