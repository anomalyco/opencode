/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { SDKProvider, useSDK } from "../../../../src/context/sdk"
import { createEventSource } from "../../../fixture/tui-sdk"

test("requests keep the caller's headers and ask the server to omit tool media and sync events", async () => {
  const seen: Headers[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init).headers)
    return new Response("{}", { headers: { "content-type": "application/json" } })
  }) as typeof globalThis.fetch
  let sdk!: ReturnType<typeof useSDK>
  function Probe() {
    const ctx = useSDK()
    onMount(() => {
      sdk = ctx
    })
    return <box />
  }

  const app = await testRender(() => (
    <SDKProvider
      url="http://test"
      fetch={fetch}
      headers={{ Authorization: "Basic dGVzdA==" }}
      events={createEventSource().source}
    >
      <Probe />
    </SDKProvider>
  ))

  try {
    await sdk.client.session.get({ sessionID: "ses_test" })
    expect(seen.at(-1)?.get("authorization")).toBe("Basic dGVzdA==")
    expect(seen.at(-1)?.get("x-opencode-omit-tool-media")).toBe("1")
    expect(seen.at(-1)?.get("x-opencode-omit-sync-events")).toBe("1")
  } finally {
    app.renderer.destroy()
  }
})
