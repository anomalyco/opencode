import { expect, test, type Page } from "@playwright/test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

async function setup(page: Page, languages?: string[]) {
  await page.addInitScript((languages) => {
    if (localStorage.getItem("opencode.global.dat:voice.v1")) return
    localStorage.setItem(
      "opencode.global.dat:voice.v1",
      JSON.stringify({
        language: "ko",
        selected: { providerID: "speech-api", modelID: "whisper-1" },
        providers: [
          {
            id: "speech-api",
            name: "Speech service",
            protocol: "openai",
            baseURL: "https://speech.example/v1",
            models: [{ id: "whisper-1", name: "Whisper", visible: true, languages }],
          },
        ],
      }),
    )
  }, languages)
  await setupTimeline(page, { settings: { newLayoutDesigns: true }, viewport: { width: 1400, height: 900 } })
  await page.keyboard.press("Control+,")
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog.getByRole("tab", { name: "Providers", exact: true })).toBeVisible()
  return dialog
}

test("providers use one connected list and preserve editing, testing and disconnecting speech services", async ({
  page,
}) => {
  const dialog = await setup(page)
  await page.route("https://speech.example/v1/models", (route) => route.fulfill({ json: { data: [] } }))
  await dialog.getByRole("tab", { name: "Providers", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Voice providers", exact: true })).toHaveCount(0)
  await expect(dialog.locator('[data-component="voice-local-model"]')).toHaveCount(0)
  const row = dialog.locator('[data-component="connected-providers-section"] [data-provider="speech-api"]')
  await expect(row.getByText("Speech service", { exact: true })).toBeVisible()
  await row.getByRole("button", { name: "Test connection", exact: true }).click()
  await expect(
    dialog.getByText("Connection test passed. Test a recording to check transcription.", { exact: true }),
  ).toBeVisible()
  await row.getByRole("button", { name: "Edit", exact: true }).click()
  const form = dialog.locator("form.voice-settings-form")
  await expect(form.getByRole("textbox", { name: "Base URL", exact: true })).toHaveValue("https://speech.example/v1")
  await form.getByRole("textbox", { name: "Display name", exact: true }).fill("Renamed speech service")
  await form.getByRole("button", { name: "Save", exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(row.getByText("Renamed speech service", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("providers-unified.png") })
  await row.getByRole("button", { name: "Disconnect", exact: true }).click()
  await expect(row).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:voice.v1")!).selected))
    .toBeUndefined()
  await dialog.getByRole("button", { name: "Connect provider", exact: true }).click()
  await page.getByRole("menuitem", { name: "OpenAI-compatible transcription API", exact: true }).click()
  await form.getByRole("textbox", { name: "Provider ID", exact: true }).fill("new-speech")
  await form.getByRole("textbox", { name: "Display name", exact: true }).fill("New speech service")
  await form.getByRole("textbox", { name: "Base URL", exact: true }).fill("https://speech.example/v1")
  await form.getByRole("textbox", { name: "Model IDs", exact: true }).fill("whisper-1")
  await form.getByRole("button", { name: "Save", exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(
    dialog.locator('[data-component="connected-providers-section"] [data-provider="new-speech"]'),
  ).toBeVisible()
})

test("voice models own local installation and General owns the persisted recognition language", async ({ page }) => {
  const dialog = await setup(page)
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await dialog.getByRole("tab", { name: "Voice", exact: true }).click()
  await expect(dialog.locator('[data-action="voice-language"]')).toHaveCount(0)
  await expect(dialog.locator('[data-component="voice-local-model"]')).toHaveCount(1)
  await expect(dialog.getByText("Qwen3-ASR 0.6B", { exact: true })).toBeVisible()
  await expect(dialog.locator('[data-action="voice-default-model"]')).toContainText("Speech service / Whisper")
  await page.screenshot({ path: test.info().outputPath("models-voice.png") })
  await dialog.getByRole("tab", { name: "General", exact: true }).click()
  const language = dialog.locator('[data-action="voice-language"]')
  await expect(language).toHaveValue("ko")
  await language.fill("ja")
  await language.press("Tab")
  await expect(language).toHaveValue("ja")
  await page.reload()
  await page.keyboard.press("Control+,")
  await expect(page.locator('.settings-v2-dialog [data-action="voice-language"]')).toHaveValue("ja")
})

test("shared Ollama connections appear once and preserve saved speech models", async ({ page }) => {
  const dialog = await setup(page)
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("opencode.global.dat:voice.v1")!)
    config.providers.push({
      id: "ollama-local",
      name: "Ollama Local Provider",
      protocol: "ollama",
      baseURL: "http://127.0.0.1:11434",
      models: [{ id: "qwen3-asr:0.6b", name: "Qwen ASR", visible: true }],
    })
    localStorage.setItem("opencode.global.dat:voice.v1", JSON.stringify(config))
  })
  await page.route("**/provider", (route) =>
    route.fulfill({
      json: {
        all: [
          {
            id: "ollama-local",
            name: "Ollama Local Provider",
            source: "config",
            models: { chat: { id: "chat", name: "Chat", limit: { context: 32768 } } },
          },
        ],
        connected: ["ollama-local"],
        default: { providerID: "ollama-local", modelID: "chat" },
      },
    }),
  )
  await page.route("**/global/config*", (route) =>
    route.fulfill({
      json: {
        provider: {
          "ollama-local": {
            name: "Ollama Local Provider",
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "http://127.0.0.1:11434/v1" },
            models: { chat: { name: "Chat" } },
          },
        },
      },
    }),
  )
  await page.route("http://127.0.0.1:11434/api/tags", (route) =>
    route.fulfill({ json: { models: [{ name: "qwen3-asr:0.6b", details: { family: "qwen" } }] } }),
  )
  await page.reload()
  await page.keyboard.press("Control+,")
  await dialog.getByRole("tab", { name: "Providers", exact: true }).click()
  const row = dialog.locator('[data-component="settings-provider-row"][data-provider="ollama-local"]')
  await expect(row).toHaveCount(1)
  await expect(row.getByRole("button", { name: "Test connection", exact: true })).toBeVisible()
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await dialog.getByRole("tab", { name: "Voice", exact: true }).click()
  await expect(dialog.locator('[data-provider="ollama-local"] [data-model="qwen3-asr:0.6b"]')).toHaveCount(1)
})

test("automatic-only API models show a value rather than a disabled language selector", async ({ page }) => {
  const dialog = await setup(page, [])
  await dialog.getByRole("tab", { name: "General", exact: true }).click()
  await expect(dialog.locator('[data-action="voice-language"]')).toHaveText("Detect automatically")
  await expect(dialog.locator('[data-action="voice-language"]')).toHaveJSProperty("tagName", "SPAN")
})

test("model-specific languages replace the hardcoded list and retain supported choices", async ({ page }) => {
  const dialog = await setup(page)
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await dialog.getByRole("tab", { name: "Voice", exact: true }).click()
  const row = dialog.locator('[data-provider="speech-api"] [data-model="whisper-1"]')
  await row.getByRole("button", { name: "Manage", exact: true }).click()
  await row.locator('[data-action="voice-language-support"]').click()
  await page.locator('[data-slot="select-v2-listbox"]').getByText("Specific languages", { exact: true }).click()
  await row.getByRole("textbox", { name: "Language codes, separated by commas", exact: true }).fill("ja, fr")
  await row.getByRole("button", { name: "Save", exact: true }).click()
  await expect(row.getByRole("button", { name: "Save", exact: true })).toHaveCount(0)
  await dialog.getByRole("tab", { name: "General", exact: true }).click()
  const language = dialog.locator('[data-action="voice-language"]')
  await expect(language).toContainText("Detect automatically")
  await language.click()
  const list = page.locator('[data-slot="select-v2-listbox"]')
  await expect(list.getByText("Korean", { exact: true })).toHaveCount(0)
  await list.getByText("ja", { exact: true }).click()
  await expect(language).toContainText("ja")
  await page.reload()
  await page.keyboard.press("Control+,")
  await expect(page.locator('.settings-v2-dialog [data-action="voice-language"]')).toContainText("ja")
})

test("provider execution location is explicit and survives editing", async ({ page }) => {
  const dialog = await setup(page)
  await dialog.getByRole("tab", { name: "Providers", exact: true }).click()
  const row = dialog.locator('[data-component="connected-providers-section"] [data-provider="speech-api"]')
  await row.getByRole("button", { name: "Edit", exact: true }).click()
  const form = dialog.locator("form.voice-settings-form")
  await form.locator('[data-action="voice-execution"]').click()
  await page.locator('[data-slot="select-v2-listbox"]').getByText("Remote server", { exact: true }).click()
  await form.getByRole("button", { name: "Save", exact: true }).click()
  await expect(form).toHaveCount(0)
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await dialog.getByRole("tab", { name: "Voice", exact: true }).click()
  await expect(dialog.getByText("Remote server", { exact: true })).toBeVisible()
})

test("Ollama recognition retains the General language across reloads", async ({ page }) => {
  const dialog = await setup(page)
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("opencode.global.dat:voice.v1")!)
    config.language = "auto"
    config.providers[0].adapter = "ollama-qwen"
    config.providers[0].models[0].languages = []
    localStorage.setItem("opencode.global.dat:voice.v1", JSON.stringify(config))
  })
  await page.reload()
  await page.keyboard.press("Control+,")
  await dialog.getByRole("tab", { name: "General", exact: true }).click()
  const language = dialog.locator('[data-action="voice-language"]')
  await language.click()
  await page.locator('[data-slot="select-v2-listbox"]').getByText("Korean", { exact: true }).click()
  await expect(language).toContainText("Korean")
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:voice.v1")!).language))
    .toBe("ko")
  await page.reload()
  await page.keyboard.press("Control+,")
  await expect(language).toContainText("Korean")
})
