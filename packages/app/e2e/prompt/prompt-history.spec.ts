import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import { promptSelector } from "../selectors"

const text = (value: string | null) => (value ?? "").replace(/\u200B/g, "").trim()

const isBash = (part: unknown): part is ToolPart => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "tool") return false
  if (!("tool" in part) || part.tool !== "bash") return false
  return "state" in part
}

async function edge(page: Page, pos: "start" | "end") {
  await page.locator(promptSelector).evaluate((el: HTMLDivElement, pos: "start" | "end") => {
    const selection = window.getSelection()
    if (!selection) return

    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      nodes.push(node as Text)
    }

    if (nodes.length === 0) {
      const node = document.createTextNode("")
      el.appendChild(node)
      nodes.push(node)
    }

    const node = pos === "start" ? nodes[0]! : nodes[nodes.length - 1]!
    const range = document.createRange()
    range.setStart(node, pos === "start" ? 0 : (node.textContent ?? "").length)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }, pos)
}

async function wait(page: Page, value: string) {
  await expect.poll(async () => text(await page.locator(promptSelector).textContent())).toBe(value)
}

async function reply(sdk: Parameters<typeof withSession>[0], sessionID: string, token: string) {
  await expect
    .poll(
      async () => {
        const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
        return messages
          .filter((item) => item.info.role === "assistant")
          .flatMap((item) => item.parts)
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n")
      },
      { timeout: 90_000 },
    )
    .toContain(token)
}

async function shell(sdk: Parameters<typeof withSession>[0], sessionID: string, cmd: string, token: string) {
  await expect
    .poll(
      async () => {
        const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
        const part = messages
          .filter((item) => item.info.role === "assistant")
          .flatMap((item) => item.parts)
          .filter(isBash)
          .find((item) => item.state.input?.command === cmd && item.state.status === "completed")

        if (!part || part.state.status !== "completed") return
        return typeof part.state.metadata?.output === "string" ? part.state.metadata.output : part.state.output
      },
      { timeout: 90_000 },
    )
    .toContain(token)
}

test("prompt history restores unsent draft with arrow navigation", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  await withSession(sdk, `e2e prompt history ${Date.now()}`, async (session) => {
    await gotoSession(session.id)

    const prompt = page.locator(promptSelector)
    const firstToken = `E2E_HISTORY_ONE_${Date.now()}`
    const secondToken = `E2E_HISTORY_TWO_${Date.now()}`
    const first = `Reply with exactly: ${firstToken}`
    const second = `Reply with exactly: ${secondToken}`
    const draft = `draft ${Date.now()}`

    await prompt.click()
    await page.keyboard.type(first)
    await page.keyboard.press("Enter")
    await wait(page, "")
    await reply(sdk, session.id, firstToken)

    await prompt.click()
    await page.keyboard.type(second)
    await page.keyboard.press("Enter")
    await wait(page, "")
    await reply(sdk, session.id, secondToken)

    await prompt.click()
    await page.keyboard.type(draft)
    await wait(page, draft)

    // Clear the draft before navigating history (ArrowUp only works when prompt is empty)
    await prompt.fill("")
    await wait(page, "")

    await page.keyboard.press("ArrowUp")
    await wait(page, second)

    await page.keyboard.press("ArrowUp")
    await wait(page, first)

    await page.keyboard.press("ArrowDown")
    await wait(page, second)

    await page.keyboard.press("ArrowDown")
    await wait(page, "")
  })
})

test("shell history stays separate from normal prompt history", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  await withSession(sdk, `e2e shell history ${Date.now()}`, async (session) => {
    await gotoSession(session.id)

    const prompt = page.locator(promptSelector)
    const firstToken = `E2E_SHELL_ONE_${Date.now()}`
    const secondToken = `E2E_SHELL_TWO_${Date.now()}`
    const normalToken = `E2E_NORMAL_${Date.now()}`
    const first = `echo ${firstToken}`
    const second = `echo ${secondToken}`
    const normal = `Reply with exactly: ${normalToken}`

    await prompt.click()
    await page.keyboard.type("!")
    await page.keyboard.type(first)
    await page.keyboard.press("Enter")
    await wait(page, "")
    await shell(sdk, session.id, first, firstToken)

    await prompt.click()
    await page.keyboard.type("!")
    await page.keyboard.type(second)
    await page.keyboard.press("Enter")
    await wait(page, "")
    await shell(sdk, session.id, second, secondToken)

    await prompt.click()
    await page.keyboard.type("!")
    await page.keyboard.press("ArrowUp")
    await wait(page, second)

    await page.keyboard.press("ArrowUp")
    await wait(page, first)

    await page.keyboard.press("ArrowDown")
    await wait(page, second)

    await page.keyboard.press("ArrowDown")
    await wait(page, "")

    await page.keyboard.press("Escape")
    await wait(page, "")

    await prompt.click()
    await page.keyboard.type(normal)
    await page.keyboard.press("Enter")
    await wait(page, "")
    await reply(sdk, session.id, normalToken)

    await prompt.click()
    await page.keyboard.press("ArrowUp")
    await wait(page, normal)
  })
})
