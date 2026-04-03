import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import { promptModelSelector, promptSelector, promptVariantSelector } from "../selectors"

const isBash = (part: unknown): part is ToolPart => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "tool") return false
  if (!("tool" in part) || part.tool !== "bash") return false
  return "state" in part
}

test("shell mode runs a command in the project directory", async ({ page, project }) => {
  test.setTimeout(120_000)

  await project.open()
  const cmd = process.platform === "win32" ? "dir" : "command ls"

  await withSession(project.sdk, `e2e shell ${Date.now()}`, async (session) => {
    project.trackSession(session.id)
    await project.gotoSession(session.id)
    const button = page.locator('[data-action="prompt-permissions"]').first()
    await expect(button).toBeVisible()
    if ((await button.getAttribute("aria-pressed")) !== "true") {
      await button.click()
      await expect(button).toHaveAttribute("aria-pressed", "true")
    }
    await project.shell(cmd)

    await expect
      .poll(
        async () => {
          const list = await project.sdk.session
            .messages({ sessionID: session.id, limit: 50 })
            .then((x) => x.data ?? [])
          const msg = list.findLast(
            (item) => item.info.role === "assistant" && "path" in item.info && item.info.path.cwd === project.directory,
          )
          if (!msg) return

          const part = msg.parts
            .filter(isBash)
            .find((item) => item.state.input?.command === cmd && item.state.status === "completed")

          if (!part || part.state.status !== "completed") return
          const output =
            typeof part.state.metadata?.output === "string" ? part.state.metadata.output : part.state.output
          if (!output.includes("README.md")) return

          return { cwd: project.directory, output }
        },
        { timeout: 90_000 },
      )
      .toEqual(expect.objectContaining({ cwd: project.directory, output: expect.stringContaining("README.md") }))
  })
})

test("shell mode unmounts model and variant controls", async ({ page, project }) => {
  await project.open()

  const prompt = page.locator(promptSelector).first()
  await expect(page.locator(promptModelSelector)).toHaveCount(1)
  await expect(page.locator(promptVariantSelector)).toHaveCount(1)

  await prompt.click()
  await page.keyboard.type("!")

  await expect(prompt).toHaveAttribute("aria-label", /enter shell command/i)
  await expect(page.locator(promptModelSelector)).toHaveCount(0)
  await expect(page.locator(promptVariantSelector)).toHaveCount(0)
})
