/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, mock, test } from "bun:test"

const opened: string[] = []
mock.module("@opencode/util/open", () => ({ openUrl: async (url: string) => void opened.push(url) }))
const { Link } = await import("../../src/ui/link")

test("opens a plain click once and leaves modified native hyperlink clicks to the terminal", async () => {
  const url = "https://example.com/oauth/authorize"
  const app = await testRender(() => <Link href={url}>Sign in</Link>, { width: 60, height: 5 })
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Sign in"))
    await app.mockMouse.click(2, 0)
    expect(opened).toEqual([url])
    await app.mockMouse.click(2, 0, 0, { modifiers: { ctrl: true } })
    await app.mockMouse.click(2, 0, 0, { modifiers: { shift: true } })
    await app.mockMouse.click(2, 0, 0, { modifiers: { alt: true } })
    await app.mockMouse.click(2, 0, 2)
    expect(opened).toEqual([url])
  } finally {
    app.renderer.destroy()
  }
})
