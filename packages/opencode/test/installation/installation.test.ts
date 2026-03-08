import { afterEach, describe, expect, test } from "bun:test"
import { Installation } from "../../src/installation"

const fetch0 = globalThis.fetch

afterEach(() => {
  globalThis.fetch = fetch0
})

describe("installation", () => {
  test("reads release version from GitHub releases", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch

    expect(await Installation.latest("unknown")).toBe("1.2.3")
  })

  test("reads scoop manifest versions", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: "2.3.4" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch

    expect(await Installation.latest("scoop")).toBe("2.3.4")
  })

  test("reads chocolatey feed versions", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          d: {
            results: [{ Version: "3.4.5" }],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch

    expect(await Installation.latest("choco")).toBe("3.4.5")
  })
})
