import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import { describe, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

type Sdk = Parameters<typeof withSession>[0]

function norm(v: string) {
  return v.replace(/\u200B/g, "").trim()
}

const isBash = (part: unknown): part is ToolPart => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "tool") return false
  if (!("tool" in part) || part.tool !== "bash") return false
  return "state" in part
}

async function edge(driver: WebDriver, pos: "start" | "end") {
  await driver.executeScript(
    `
    const sel = arguments[0]
    const p = arguments[1]
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) return
    const selection = window.getSelection()
    if (!selection) return
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes = []
    for (let node = walk.nextNode(); node; node = walk.nextNode()) nodes.push(node)
    if (nodes.length === 0) {
      const node = document.createTextNode("")
      el.appendChild(node)
      nodes.push(node)
    }
    const node = p === "start" ? nodes[0] : nodes[nodes.length - 1]
    const range = document.createRange()
    range.setStart(node, p === "start" ? 0 : (node.textContent || "").length)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  `,
    promptSelector,
    pos,
  )
}

async function wait(driver: WebDriver, value: string) {
  await driver.wait(async () => {
    const el = await driver.findElement(By.css(promptSelector))
    return norm(await el.getText()) === value
  }, 30_000)
}

async function replyWait(driver: WebDriver, sdk: Sdk, sessionID: string, token: string) {
  await driver.wait(async () => {
    const r = await sdk.session.messages({ sessionID, limit: 50 })
    const messages = r.data
    if (!messages) return false
    const body = messages
      .filter((item) => item.info.role === "assistant")
      .flatMap((item) => item.parts)
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n")
    return body.includes(token)
  }, 90_000)
}

async function shellWait(driver: WebDriver, sdk: Sdk, sessionID: string, cmd: string, token: string) {
  await driver.wait(async () => {
    const r = await sdk.session.messages({ sessionID, limit: 50 })
    const messages = r.data
    if (!messages) return false
    const part = messages
      .filter((item) => item.info.role === "assistant")
      .flatMap((item) => item.parts)
      .filter(isBash)
      .find((item) => item.state.input?.command === cmd && item.state.status === "completed")

    if (!part || part.state.status !== "completed") return false
    const out =
      typeof part.state.metadata?.output === "string" ? part.state.metadata.output : part.state.output
    return typeof out === "string" && out.includes(token)
  }, 90_000)
}

describe("prompt history (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("prompt history restores unsent draft with arrow navigation", async () => {
    await withSession(app.sdk, `e2e prompt history ${Date.now()}`, async (session) => {
      await app.gotoSession(session.id)

      const prompt = await waitVisible(app.driver, By.css(promptSelector))
      const firstToken = `E2E_HISTORY_ONE_${Date.now()}`
      const secondToken = `E2E_HISTORY_TWO_${Date.now()}`
      const first = `Reply with exactly: ${firstToken}`
      const second = `Reply with exactly: ${secondToken}`
      const draft = `draft ${Date.now()}`

      await prompt.click()
      await prompt.sendKeys(first)
      await app.driver.actions().sendKeys(Key.ENTER).perform()
      await wait(app.driver, "")
      await replyWait(app.driver, app.sdk, session.id, firstToken)

      await prompt.click()
      await prompt.sendKeys(second)
      await app.driver.actions().sendKeys(Key.ENTER).perform()
      await wait(app.driver, "")
      await replyWait(app.driver, app.sdk, session.id, secondToken)

      await prompt.click()
      await prompt.sendKeys(draft)
      await wait(app.driver, draft)

      await edge(app.driver, "start")
      await app.driver.actions().sendKeys(Key.ARROW_UP).perform()
      await wait(app.driver, second)

      await app.driver.actions().sendKeys(Key.ARROW_UP).perform()
      await wait(app.driver, first)

      await app.driver.actions().sendKeys(Key.ARROW_DOWN).perform()
      await wait(app.driver, second)

      await app.driver.actions().sendKeys(Key.ARROW_DOWN).perform()
      await wait(app.driver, draft)
    })
  }, 120_000)

  test("shell history stays separate from normal prompt history", async () => {
    await withSession(app.sdk, `e2e shell history ${Date.now()}`, async (session) => {
      await app.gotoSession(session.id)

      const prompt = await waitVisible(app.driver, By.css(promptSelector))
      const firstToken = `E2E_SHELL_ONE_${Date.now()}`
      const secondToken = `E2E_SHELL_TWO_${Date.now()}`
      const normalToken = `E2E_NORMAL_${Date.now()}`
      const first = `echo ${firstToken}`
      const second = `echo ${secondToken}`
      const normal = `Reply with exactly: ${normalToken}`

      await prompt.click()
      await prompt.sendKeys("!")
      await prompt.sendKeys(first)
      await app.driver.actions().sendKeys(Key.ENTER).perform()
      await wait(app.driver, "")
      await shellWait(app.driver, app.sdk, session.id, first, firstToken)

      await prompt.click()
      await prompt.sendKeys("!")
      await prompt.sendKeys(second)
      await app.driver.actions().sendKeys(Key.ENTER).perform()
      await wait(app.driver, "")
      await shellWait(app.driver, app.sdk, session.id, second, secondToken)

      await prompt.click()
      await prompt.sendKeys("!")
      await app.driver.actions().sendKeys(Key.ARROW_UP).perform()
      await wait(app.driver, second)

      await app.driver.actions().sendKeys(Key.ARROW_UP).perform()
      await wait(app.driver, first)

      await app.driver.actions().sendKeys(Key.ARROW_DOWN).perform()
      await wait(app.driver, second)

      await app.driver.actions().sendKeys(Key.ARROW_DOWN).perform()
      await wait(app.driver, "")

      await app.driver.actions().sendKeys(Key.ESCAPE).perform()
      await wait(app.driver, "")

      await prompt.click()
      await prompt.sendKeys(normal)
      await app.driver.actions().sendKeys(Key.ENTER).perform()
      await wait(app.driver, "")
      await replyWait(app.driver, app.sdk, session.id, normalToken)

      await prompt.click()
      await app.driver.actions().sendKeys(Key.ARROW_UP).perform()
      await wait(app.driver, normal)
    })
  }, 120_000)
})
