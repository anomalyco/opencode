import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { ACP } from "../../src/acp/agent"
import type { ACPConfig } from "../../src/acp/types"

function createAgent() {
  const calls: Array<Record<string, unknown> | undefined> = []
  const sessions = [
    {
      id: "session_2",
      directory: "/tmp/two",
      title: "second",
      time: { updated: 1710000000000 },
    },
    {
      id: "session_1",
      directory: "/tmp/one",
      title: "first",
      time: { updated: 1700000000000 },
    },
  ]

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({
        stream: (async function* () {
          await new Promise<void>((resolve) => {
            if (opts?.signal?.aborted) {
              resolve()
              return
            }
            opts?.signal?.addEventListener("abort", () => resolve(), { once: true })
          })
        })(),
      }),
    },
    experimental: {
      session: {
        list: async (input?: Record<string, unknown>) => {
          calls.push(input)
          return {
            data: sessions,
            request: new Request("http://localhost/experimental/session"),
            response: new Response("[]", {
              headers: {
                "x-next-cursor": "1700000000000",
              },
            }),
          }
        },
      },
    },
  } as unknown as OpencodeClient

  const agent = new ACP.Agent({} as AgentSideConnection, { sdk } satisfies ACPConfig)
  const stop = () => {
    ;(agent as unknown as { eventAbort: AbortController }).eventAbort.abort()
  }

  return { agent, calls, stop }
}

describe("acp.agent unstable_listSessions", () => {
  test("uses the global experimental session list", async () => {
    const { agent, calls, stop } = createAgent()

    try {
      const result = await agent.unstable_listSessions({
        cwd: "/tmp/current",
        cursor: "1715000000000",
      })

      expect(calls).toEqual([
        {
          roots: true,
          cursor: 1715000000000,
          limit: 100,
        },
      ])
      expect(result).toEqual({
        sessions: [
          {
            sessionId: "session_2",
            cwd: "/tmp/two",
            title: "second",
            updatedAt: "2024-03-09T16:00:00.000Z",
          },
          {
            sessionId: "session_1",
            cwd: "/tmp/one",
            title: "first",
            updatedAt: "2023-11-14T22:13:20.000Z",
          },
        ],
        nextCursor: "1700000000000",
      })
    } finally {
      stop()
    }
  })
})
