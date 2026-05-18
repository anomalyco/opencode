import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import type { Page } from "playwright"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"

const text = (value: string | null) => (value ?? "").replace(/\u200B/g, "").trim()

const isBash = (part: unknown): part is ToolPart => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "tool") return false
  if (!("tool" in part) || part.tool !== "bash") return false
  return "state" in part
}

async function edge(page: Page, pos: "start" | "end") {
  await page.locator(promptSelector).evaluate((el: HTMLElement, p: "start" | "end") => {
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

    const node = p === "start" ? nodes[0]! : nodes[nodes.length - 1]!
    const range = document.createRange()
    range.setStart(node, p === "start" ? 0 : (node.textContent ?? "").length)
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

        if (!part || part.state.status !== "completed") return ""
        const out =
          typeof part.state.metadata?.output === "string" ? part.state.metadata.output : part.state.output
        return typeof out === "string" ? out : ""
      },
      { timeout: 90_000 },
    )
    .toContain(token)
}

describe("prompt history", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "prompt history restores unsent draft with arrow navigation",
    async () => {
      await withSession(app.sdk, `e2e prompt history ${Date.now()}`, async (session) => {
        await app.gotoSession(session.id)

        const prompt = app.page.locator(promptSelector)
        const firstToken = `E2E_HISTORY_ONE_${Date.now()}`
        const secondToken = `E2E_HISTORY_TWO_${Date.now()}`
        const first = `Reply with exactly: ${firstToken}`
        const second = `Reply with exactly: ${secondToken}`
        const draft = `draft ${Date.now()}`

        await prompt.click()
        await app.page.keyboard.type(first)
        await app.page.keyboard.press("Enter")
        await wait(app.page, "")
        await reply(app.sdk, session.id, firstToken)

        await prompt.click()
        await app.page.keyboard.type(second)
        await app.page.keyboard.press("Enter")
        await wait(app.page, "")
        await reply(app.sdk, session.id, secondToken)

        await prompt.click()
        await app.page.keyboard.type(draft)
        await wait(app.page, draft)

        await edge(app.page, "start")
        await app.page.keyboard.press("ArrowUp")
        await wait(app.page, second)

        await app.page.keyboard.press("ArrowUp")
        await wait(app.page, first)

        await app.page.keyboard.press("ArrowDown")
        await wait(app.page, second)

        await app.page.keyboard.press("ArrowDown")
        await wait(app.page, draft)
      })
    },
    120_000,
  )

  test(
    "shell history stays separate from normal prompt history",
    async () => {
      await withSession(app.sdk, `e2e shell history ${Date.now()}`, async (session) => {
        await app.gotoSession(session.id)

        const prompt = app.page.locator(promptSelector)
        const firstToken = `E2E_SHELL_ONE_${Date.now()}`
        const secondToken = `E2E_SHELL_TWO_${Date.now()}`
        const normalToken = `E2E_NORMAL_${Date.now()}`
        const first = `echo ${firstToken}`
        const second = `echo ${secondToken}`
        const normal = `Reply with exactly: ${normalToken}`

        await prompt.click()
        await app.page.keyboard.type("!")
        await app.page.keyboard.type(first)
        await app.page.keyboard.press("Enter")
        await wait(app.page, "")
        await shell(app.sdk, session.id, first, firstToken)

        await prompt.click()
        await app.page.keyboard.type("!")
        await app.page.keyboard.type(second)
        await app.page.keyboard.press("Enter")
        await wait(app.page, "")
        await shell(app.sdk, session.id, second, secondToken)

        await prompt.click()
        await app.page.keyboard.type("!")
        await app.page.keyboard.press("ArrowUp")
        await wait(app.page, second)

        await app.page.keyboard.press("ArrowUp")
        await wait(app.page, first)

        await app.page.keyboard.press("ArrowDown")
        await wait(app.page, second)

        await app.page.keyboard.press("ArrowDown")
        await wait(app.page, "")

        await app.page.keyboard.press("Escape")
        await wait(app.page, "")

        await prompt.click()
        await app.page.keyboard.type(normal)
        await app.page.keyboard.press("Enter")
        await wait(app.page, "")
        await reply(app.sdk, session.id, normalToken)

        await prompt.click()
        await app.page.keyboard.press("ArrowUp")
        await wait(app.page, normal)
      })
    },
    120_000,
  )
})
