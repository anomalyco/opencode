import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { openProjectSession, useAppBrowser } from "../../support/use-app-browser"
import { cleanupSession, sessionIDFromUrl } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { createSdk, serverUrl } from "../../../../e2e/utils"

const isBash = (part: unknown): part is ToolPart => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "tool") return false
  if (!("tool" in part) || part.tool !== "bash") return false
  return "state" in part
}

describe("prompt shell", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "shell mode runs a command in the project directory",
    async () => {
      const page = app.page
      const listSdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })
      const created = await listSdk.project.create({ name: `e2e shell ${Date.now()}` })
      if (!created.data?.project?.id) throw new Error("project create failed")
      const pid = created.data.project.id
      const directory = pid
      const sdk = createSdk({ id: pid })

      await openProjectSession(page, app.origin, pid)

      const prompt = page.locator(promptSelector)
      await prompt.click()
      await page.keyboard.type("!")
      expect(await prompt.getAttribute("aria-label")).toMatch(/enter shell command/i)

      const cmd = process.platform === "win32" ? "dir" : "ls"
      await page.keyboard.type(cmd)
      await page.keyboard.press("Enter")

      await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/session\/[^/?#]+/)
      const sid = sessionIDFromUrl(page.url())
      if (!sid) throw new Error(`Failed to parse session id from url: ${page.url()}`)

      try {
        await expect
          .poll(
            async () => {
              const list = await sdk.session.messages({ sessionID: sid, limit: 50 }).then((r) => r.data ?? [])
              const msg = list.findLast(
                (item: (typeof list)[number]) =>
                  item.info.role === "assistant" && "path" in item.info && item.info.path.cwd === directory,
              )
              if (!msg) return undefined

              const bashParts: ToolPart[] = msg.parts.filter(isBash)
              const part = bashParts.find((p) => p.state.input?.command === cmd && p.state.status === "completed")

              if (!part || part.state.status !== "completed") return undefined
              const output =
                typeof part.state.metadata?.output === "string" ? part.state.metadata.output : part.state.output
              if (typeof output !== "string" || !output.includes("README.md")) return undefined

              return { cwd: directory, output }
            },
            { timeout: 90_000 },
          )
          .toEqual(
            expect.objectContaining({
              cwd: directory,
              output: expect.stringContaining("README.md"),
            }),
          )

        expect(((await prompt.textContent()) ?? "").trim()).toBe("")
      } finally {
        await cleanupSession({ sdk, sessionID: sid })
      }
    },
    120_000,
  )
})
