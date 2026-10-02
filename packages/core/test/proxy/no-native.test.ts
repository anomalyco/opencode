import { expect, test } from "bun:test"
import { makeDispatcher } from "../../src/proxy/dispatcher"
import { startFakeProxy } from "./fake-proxy"

test("explicit negotiate without the addon reports missing-native", async () => {
  const proxy = await startFakeProxy({ schemes: ["Negotiate"], accept: () => true })
  const dispatcher = makeDispatcher({ url: proxy.url, auth: "negotiate" })
  try {
    await expect(dispatcher.fetch("http://example.test/")).rejects.toMatchObject({ kind: "missing-native" })
  } finally {
    await dispatcher.close()
    await proxy.close()
  }
})

test("auto without credentials reports no-credentials, never hangs", async () => {
  const proxy = await startFakeProxy({ schemes: ["Basic"], accept: () => false })
  const dispatcher = makeDispatcher({ url: proxy.url, auth: "auto" })
  try {
    await expect(dispatcher.fetch("http://example.test/")).rejects.toMatchObject({ kind: "no-credentials" })
  } finally {
    await dispatcher.close()
    await proxy.close()
  }
})
