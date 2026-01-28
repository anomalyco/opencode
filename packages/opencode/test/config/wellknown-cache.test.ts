import { test, expect, mock } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { tmpdir } from "../fixture/fixture"

test("uses cached well-known config when fetch fails", async () => {
  const originalFetch = globalThis.fetch
  let phase: "ok" | "fail" = "ok"

  globalThis.fetch = mock((url: string | URL | Request) => {
    const urlStr = url.toString()
    if (!urlStr.includes(".well-known/opencode")) {
      return originalFetch(url)
    }

    if (phase === "ok") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            config: {
              theme: "remote-theme",
            },
          }),
          { status: 200 },
        ),
      )
    }

    return Promise.resolve(new Response("nope", { status: 500 }))
  }) as unknown as typeof fetch

  const originalAuthAll = Auth.all
  Auth.all = mock(() =>
    Promise.resolve({
      "https://example.com": {
        type: "wellknown" as const,
        key: "TEST_TOKEN",
        token: "test-token",
      },
    }),
  )

  try {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        phase = "ok"
        const first = await Config.get()
        expect(first.theme).toBe("remote-theme")

        await Instance.dispose()

        phase = "fail"
        const second = await Config.get()
        expect(second.theme).toBe("remote-theme")
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    Auth.all = originalAuthAll
  }
})

