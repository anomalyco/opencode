import { createOpencodeClient, type ToolPart } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import { cleanupSession, sessionIDFromUrl } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { createSdk, serverUrl } from "../../../../e2e/utils"
import { waitVisible } from "../../support/wd-wait"
import { openProjectSession, useAppWebDriver } from "../../support/use-app-webdriver"

type Sdk = ReturnType<typeof createSdk>

const isBash = (part: unknown): part is ToolPart => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "tool") return false
  if (!("tool" in part) || part.tool !== "bash") return false
  return "state" in part
}

async function waitShellOutput(driver: WebDriver, sdk: Sdk, sessionID: string, directory: string, cmd: string) {
  await driver.wait(
    async () => {
      const r = await sdk.session.messages({ sessionID, limit: 50 })
      const list = r.data
      if (!list) return false
      const msg = list.findLast(
        (item) => item.info.role === "assistant" && "path" in item.info && item.info.path.cwd === directory,
      )
      if (!msg) return false
      const part = msg.parts
        .filter(isBash)
        .find((item) => item.state.input?.command === cmd && item.state.status === "completed")
      if (!part || part.state.status !== "completed") return false
      const output =
        typeof part.state.metadata?.output === "string" ? part.state.metadata.output : part.state.output
      return typeof output === "string" && output.includes("README.md")
    },
    90_000,
  )
}

describe("prompt shell (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("shell mode runs a command in the project directory", async () => {
    const listSdk = createOpencodeClient({ baseUrl: serverUrl, throwOnError: true })
    const created = await listSdk.project.create({ name: `e2e shell ${Date.now()}` })
    if (!created.data?.project?.id) throw new Error("project create failed")
    const pid = created.data.project.id
    const directory = pid
    const sdk = createSdk({ id: pid })

    await openProjectSession(app.driver, app.origin, pid)

    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()
    await prompt.sendKeys("!")
    expect(await prompt.getAttribute("aria-label")).toMatch(/enter shell command/i)

    const cmd = process.platform === "win32" ? "dir" : "ls"
    await prompt.sendKeys(cmd)
    await app.driver.actions().sendKeys(Key.ENTER).perform()

    await app.driver.wait(async () => /\/session\/[^/?#]+/.test(await app.driver.getCurrentUrl()), 30_000)
    const sid = sessionIDFromUrl(await app.driver.getCurrentUrl())
    if (!sid) throw new Error("session id missing from url")

    try {
      await waitShellOutput(app.driver, sdk, sid, directory, cmd)
      expect(await prompt.getText()).toBe("")
    } finally {
      await cleanupSession({ sdk, sessionID: sid })
    }
  }, 120_000)
})
