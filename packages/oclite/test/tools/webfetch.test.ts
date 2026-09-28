import { describe, expect, test } from "bun:test"
import { isPrivate } from "../../src/tools/extra"
import { tmpdir } from "../lib/tmp"
import { config, toolset } from "./harness"

function serve(handler: (request: Request) => Response) {
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
}

const allow = (pattern: string) => ({ permission: "webfetch", pattern, action: "allow" as const })

describe("webfetch", () => {
  test("loopback is denied by default, even with a blanket webfetch allow", async () => {
    await using dir = await tmpdir()
    using server = serve(() => new Response("internal"))
    const tools = await toolset(config(dir.path, { permission: [allow("*")] }))
    const result = await tools.call("webfetch", { url: `http://127.0.0.1:${server.port}/`, format: "text" })
    expect(result.status).toBe("error")
    expect(result.text).toContain("local or private address")
    const named = await tools.call("webfetch", { url: `http://localhost:${server.port}/`, format: "text" })
    expect(named.text).toContain("local or private address")
  })

  test("an allow rule for the exact origin lets it through; a redirect to another local origin is re-checked", async () => {
    await using dir = await tmpdir()
    using other = serve(() => new Response("other"))
    using server = serve((request) =>
      new URL(request.url).pathname === "/hop"
        ? Response.redirect(`http://127.0.0.1:${other.port}/`, 302)
        : new Response("hello from local"),
    )
    const origin = `http://127.0.0.1:${server.port}`
    const tools = await toolset(config(dir.path, { permission: [allow(`${origin}/*`)] }))
    expect((await tools.call("webfetch", { url: `${origin}/`, format: "text" })).text).toBe("hello from local")
    const hop = await tools.call("webfetch", { url: `${origin}/hop`, format: "text" })
    expect(hop.text).toContain(`http://127.0.0.1:${other.port} is a local or private address`)
  })

  test("the body is capped at 5 MB while streaming", async () => {
    await using dir = await tmpdir()
    const chunk = new Uint8Array(1024 * 1024).fill(97)
    // No content-length: the cap has to trip while streaming.
    using server = serve(() => {
      const state = { sent: 0 }
      return new Response(
        new ReadableStream({
          pull: (controller) => {
            if (state.sent++ === 6) return controller.close()
            controller.enqueue(chunk)
          },
        }),
      )
    })
    const origin = `http://127.0.0.1:${server.port}`
    const tools = await toolset(config(dir.path, { permission: [allow(`${origin}/*`)] }))
    const result = await tools.call("webfetch", { url: `${origin}/`, format: "text" })
    expect(result.text).toContain("exceeds 5MB")
  })

  test("always is per origin", async () => {
    await using dir = await tmpdir()
    const tools = await toolset(config(dir.path))
    const webfetch = tools.set.tools.webfetch
    expect(webfetch).toBeDefined()
    const { extraTools } = await import("../../src/tools/extra")
    const item = extraTools({ ruleset: [] } as never, config(dir.path)).find((tool) => tool.name === "webfetch")!
    expect(item.access({ url: "https://example.com/a/b?c=1" }).always).toEqual(["https://example.com/*"])
  })

  test("private address ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
    ])
      expect(isPrivate(ip)).toBe(true)
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111"]) expect(isPrivate(ip)).toBe(false)
  })
})
