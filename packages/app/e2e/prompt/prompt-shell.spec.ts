import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import { test, expect } from "../fixtures"
import { sessionIDFromUrl } from "../actions"
import { promptSelector } from "../selectors"
import { createSdk } from "../utils"

const isBash = (part: unknown): part is ToolPart => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "tool") return false
  if (!("tool" in part) || part.tool !== "bash") return false
  return "state" in part
}

test("shell mode runs a command in the project directory", async ({ page, withProject }) => {
  test.setTimeout(120_000)

  await withProject(async ({ directory, gotoSession }) => {
    const sdk = createSdk(directory)
    const prompt = page.locator(promptSelector)
    const cmd = process.platform === "win32" ? "dir" : "ls"

    await gotoSession()
    await prompt.click()
    await page.keyboard.type("!")
    await expect(prompt).toHaveAttribute("aria-label", /enter shell command/i)

    await page.keyboard.type(cmd)
    await page.keyboard.press("Enter")

    await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })

    const id = sessionIDFromUrl(page.url())
    if (!id) throw new Error(`Failed to parse session id from url: ${page.url()}`)

    await expect
      .poll(
        async () => {
          const list = await sdk.session.messages({ sessionID: id, limit: 50 }).then((x) => x.data ?? [])
          const msg = list.findLast(
            (item) => item.info.role === "assistant" && "path" in item.info && item.info.path.cwd === directory,
          )
          if (!msg) return

          const part = msg.parts
            .filter(isBash)
            .find((item) => item.state.input?.command === cmd && item.state.status === "completed")

          if (!part || part.state.status !== "completed") return
          const output =
            typeof part.state.metadata?.output === "string" ? part.state.metadata.output : part.state.output
          if (!output.includes("README.md")) return

          return { cwd: directory, output }
        },
        { timeout: 90_000 },
      )
      .toEqual(expect.objectContaining({ cwd: directory, output: expect.stringContaining("README.md") }))

    await expect(prompt).toHaveText("")
  })
})
