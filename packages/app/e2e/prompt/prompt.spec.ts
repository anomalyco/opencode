import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { sessionIDFromUrl } from "../actions"

const mdl = { providerID: "openai", modelID: "gpt-5.3-chat-latest" }

async function pickModel(page: Parameters<typeof test>[0]["page"], value: { providerID: string; modelID: string }) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const win = window as Window & {
            __opencode_e2e?: {
              model?: {
                controls?: {
                  setModel?: (value: { providerID: string; modelID: string } | undefined) => void
                }
              }
            }
          }
          return !!win.__opencode_e2e?.model?.controls?.setModel
        }),
      { timeout: 30_000 },
    )
    .toBe(true)

  await page.evaluate((value) => {
    const win = window as Window & {
      __opencode_e2e?: {
        model?: {
          controls?: {
            setModel?: (value: { providerID: string; modelID: string } | undefined) => void
          }
        }
      }
    }
    const fn = win.__opencode_e2e?.model?.controls?.setModel
    if (!fn) throw new Error("Model e2e model control is not enabled")
    fn(value)
  }, value)

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const win = window as Window & {
            __opencode_e2e?: {
              model?: {
                current?: {
                  model?: { providerID: string; modelID: string }
                }
              }
            }
          }
          const model = win.__opencode_e2e?.model?.current?.model
          return model ? `${model.providerID}/${model.modelID}` : null
        }),
      { timeout: 30_000 },
    )
    .toBe(`${value.providerID}/${value.modelID}`)
}

test("can send a prompt and receive a reply", async ({ page, llm, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  const onPageError = (err: Error) => {
    pageErrors.push(err.message)
  }
  page.on("pageerror", onPageError)

  const prev = await sdk.global.config.get().then((res) => res.data ?? {})

  try {
    await sdk.global.config.update({
      config: {
        ...prev,
        model: `${mdl.providerID}/${mdl.modelID}`,
        enabled_providers: ["openai"],
        provider: {
          ...prev.provider,
          openai: {
            ...prev.provider?.openai,
            options: {
              ...prev.provider?.openai?.options,
              apiKey: "test-key",
              baseURL: llm.url,
            },
          },
        },
      },
    })

    const token = `E2E_OK_${Date.now()}`
    await llm.text("E2E Title")
    await llm.text(token)
    await gotoSession()
    await pickModel(page, mdl)

    const prompt = page.locator(promptSelector)
    await prompt.click()
    await page.keyboard.type(`Reply with exactly: ${token}`)
    await page.keyboard.press("Enter")

    await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })

    const sessionID = (() => {
      const id = sessionIDFromUrl(page.url())
      if (!id) throw new Error(`Failed to parse session id from url: ${page.url()}`)
      return id
    })()

    await expect.poll(() => llm.calls()).toBeGreaterThanOrEqual(2)

    await expect
      .poll(
        async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
          return messages
            .filter((m) => m.info.role === "assistant")
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
        },
        { timeout: 30_000 },
      )
      .toContain(token)
  } finally {
    await sdk.global.config.update({ config: prev })
    page.off("pageerror", onPageError)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})
