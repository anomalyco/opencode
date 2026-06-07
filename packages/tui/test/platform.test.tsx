import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { TuiPlatformProvider, useTuiPlatform, type TuiPlatform } from "../src/platform"

test("provides host platform operations", async () => {
  const platform: TuiPlatform = {
    files: {
      readText: async (path) => `text:${path}`,
      readBytes: async () => new Uint8Array([1, 2, 3]),
      mime: async () => "text/plain",
    },
  }

  function Consumer() {
    const value = useTuiPlatform()
    return <text>{value.clipboard ? "clipboard" : "files-only"}</text>
  }

  const app = await testRender(
    () => (
      <TuiPlatformProvider value={platform}>
        <Consumer />
      </TuiPlatformProvider>
    ),
    { width: 20, height: 3 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("files-only")
    expect(await platform.files.readText("file.txt")).toBe("text:file.txt")
    expect(await platform.files.readBytes("file.bin")).toEqual(new Uint8Array([1, 2, 3]))
  } finally {
    app.renderer.destroy()
  }
})

test("requires a platform provider", () => {
  expect(() => useTuiPlatform()).toThrow("TuiPlatformProvider is missing")
})
