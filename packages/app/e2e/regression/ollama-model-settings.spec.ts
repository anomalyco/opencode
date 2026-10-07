import { expect, test, type Page } from "@playwright/test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

async function setup(page: Page, tab: "Chat" | "Voice", bare = false) {
  const inventory = { tags: ["alpha-asr:latest", "beta-asr:latest", "chat-model:latest"], fail: false }
  await page.addInitScript((bare) => {
    localStorage.setItem(
      "opencode.global.dat:voice.v1",
      JSON.stringify({
        language: "auto",
        selected: bare ? { providerID: "ollama-local", modelID: "alpha-asr" } : undefined,
        providers: [
          {
            id: "ollama-local",
            name: "Ollama Local Provider",
            protocol: "ollama",
            baseURL: "http://127.0.0.1:11434",
            models: [
              { id: bare ? "alpha-asr" : "alpha-asr:latest", name: "First Voice", visible: true, chunkSeconds: 30 },
              { id: "beta-asr:latest", name: "Second Voice", visible: true, chunkSeconds: 30 },
            ],
          },
        ],
      }),
    )
  }, bare)
  await page.route("http://127.0.0.1:11434/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/tags")
      return route.fulfill({
        status: inventory.fail ? 500 : 200,
        json: {
          models: inventory.tags.map((name) => ({ name, size: 1024, digest: name, details: { family: "qwen" } })),
        },
      })
    if (path === "/api/show")
      return route.fulfill({
        json: {
          parameters: "num_ctx 8192",
          model_info: { "qwen.context_length": 32768 },
          details: { family: "qwen", quantization_level: "Q4_K_M" },
          capabilities: ["completion"],
        },
      })
    return route.fulfill({ status: 400, json: { error: "Unexpected mutation" } })
  })
  await setupTimeline(page)
  await page.keyboard.press("Control+,")
  const dialog = page.locator(".settings-v2-dialog")
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await dialog.getByRole("tab", { name: tab, exact: true }).click()
  const provider = dialog.locator('[data-provider="ollama-local"]')
  await expect(provider.getByText("Ollama Local Provider", { exact: true })).toBeVisible()
  return { inventory, dialog, provider }
}

test("refresh updates the existing voice list and connection buttons reflect expansion", async ({ page }) => {
  const { inventory, provider } = await setup(page, "Voice")
  const manage = provider.getByRole("button", { name: "Manage Ollama models", exact: true })
  await manage.click()
  await expect(manage).toHaveAttribute("aria-expanded", "true")
  await expect(manage).toHaveAttribute("aria-pressed", "true")
  const panel = provider.locator('[data-component="ollama-model-manager"]')
  await expect(panel).toBeVisible()
  await expect(provider.locator('[data-model="alpha-asr:latest"]')).toHaveCount(1)
  await expect(panel.locator('[data-component="settings-v2-list"]')).toHaveCount(0)
  const suggestion = panel.getByRole("button", { name: "Qwen3-ASR 0.6B", exact: true })
  await expect(suggestion).toBeEnabled()
  await expect(
    panel.getByText("Community Ollama package, approximately 1 GB. Requires audio projector support.", { exact: true }),
  ).toBeVisible()
  await suggestion.scrollIntoViewIfNeeded()
  await page.locator(".settings-v2-dialog").screenshot({ path: test.info().outputPath("ollama-voice-management.png") })
  await suggestion.click()
  await expect(panel.getByRole("textbox", { name: "Model to download", exact: true })).toHaveValue(
    "frozenlab/qwen3-asr:0.6b",
  )
  const connect = panel.getByRole("button", { name: "Add connection", exact: true })
  await connect.click()
  await expect(connect).toHaveAttribute("aria-pressed", "true")
  await expect(panel.getByRole("textbox", { name: "Provider ID", exact: true })).toBeVisible()
  await connect.click()
  await expect(connect).toHaveAttribute("aria-pressed", "false")
  await expect(panel.getByRole("textbox", { name: "Provider ID", exact: true })).toBeHidden()
  inventory.tags = ["beta-asr:latest", "gamma-asr:latest", "chat-model:latest"]
  await panel.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(provider.locator('[data-model="alpha-asr:latest"]')).toHaveCount(0)
  await expect(provider.locator('[data-model="gamma-asr:latest"]')).toHaveCount(1)
  await expect(provider.locator('[data-model="beta-asr:latest"] [data-slot="settings-v2-row-title"]')).toBeVisible()
  await expect(provider.locator('[data-model="chat-model:latest"]')).toHaveCount(0)
  inventory.fail = true
  await panel.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(panel.getByRole("alert")).toBeVisible()
  await expect(provider.locator('[data-model="gamma-asr:latest"]')).toHaveCount(1)
  await manage.click()
  await expect(manage).toHaveAttribute("aria-pressed", "false")
  await expect(panel).toBeHidden()
})

test("model settings expand in their row, save names, and collapse without opening the provider panel", async ({
  page,
}) => {
  const { provider } = await setup(page, "Voice")
  const row = provider.locator('[data-model="alpha-asr:latest"]')
  const next = provider.locator('[data-model="beta-asr:latest"]')
  const manage = row.getByRole("button", { name: "Manage", exact: true })
  await manage.click()
  await expect(manage).toHaveAttribute("aria-expanded", "true")
  const editor = row.locator(".ollama-model-editor")
  await expect(editor.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("First Voice")
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  await expect(provider.locator('[data-component="ollama-model-manager"]')).toBeHidden()
  await expect(editor.locator("..")).toHaveCSS("animation-duration", "0.18s")
  await expect
    .poll(async () => {
      const bounds = await editor.boundingBox()
      const following = await next.boundingBox()
      return !!bounds && !!following && following.y >= bounds.y + bounds.height
    })
    .toBe(true)
  await page.screenshot({ path: test.info().outputPath("ollama-inline-editor.png") })
  await editor.getByRole("textbox", { name: "Display name", exact: true }).fill("Renamed Voice")
  await editor.getByRole("button", { name: "Save", exact: true }).click()
  await expect(row.locator('[data-slot="settings-v2-row-title"]')).toHaveText("Renamed Voice")
  await expect(row).toHaveCount(1)
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  await manage.click()
  await expect(manage).toHaveAttribute("aria-expanded", "false")
  await expect(editor).toBeHidden()
  await next.getByRole("button", { name: "Manage", exact: true }).click()
  await expect(next.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Second Voice")
  await expect(editor).toBeHidden()
})

test("chat management renders below its trigger and refresh replaces the single model list", async ({ page }) => {
  const { inventory, provider } = await setup(page, "Chat")
  const manage = provider.getByRole("button", { name: "Manage Ollama models", exact: true })
  await manage.click()
  const panel = provider.locator('[data-component="ollama-model-manager"]')
  await expect(provider.locator('[data-model="chat-model:latest"]')).toHaveCount(1)
  await expect(provider.locator('[data-model="alpha-asr:latest"]')).toHaveCount(0)
  await expect
    .poll(async () => {
      const trigger = await manage.boundingBox()
      const content = await panel.boundingBox()
      return !!trigger && !!content && content.y >= trigger.y + trigger.height
    })
    .toBe(true)
  await expect(panel.getByRole("button", { name: "Qwen3-ASR 0.6B", exact: true })).toHaveCount(0)
  const input = panel.getByRole("textbox", { name: "Model to download", exact: true })
  const download = panel.getByRole("button", { name: "Download model", exact: true })
  await expect(input).toHaveAttribute("placeholder", "e.g. qwen3.5:4b")
  await expect
    .poll(async () => {
      const field = await panel.locator('.ollama-download [data-component="text-input-v2"]').boundingBox()
      const button = await download.boundingBox()
      return (
        !!field && !!button && Math.abs(button.x - field.x - field.width - 8) < 2 && Math.abs(button.y - field.y) < 2
      )
    })
    .toBe(true)
  inventory.tags = ["replacement-chat:latest", "alpha-asr:latest"]
  await panel.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(provider.locator('[data-model="chat-model:latest"]')).toHaveCount(0)
  await expect(provider.locator('[data-model="replacement-chat:latest"]')).toHaveCount(1)
  await provider
    .locator('[data-model="replacement-chat:latest"]')
    .getByRole("button", { name: "Manage", exact: true })
    .click()
  await expect(provider.getByRole("textbox", { name: "Ollama model tag", exact: true })).toHaveValue(
    "replacement-chat:latest",
  )
  await page.screenshot({ path: test.info().outputPath("ollama-chat-management.png") })
})

test("chat lists hide migration tags and the model picker keeps working Manage buttons", async ({ page }) => {
  const runtime = `llamacpp:${"c".repeat(64)}`
  const { inventory } = await setup(page, "Chat")
  inventory.tags = ["chat-model:latest", "chat-model:latest", runtime, "llamacpp:custom"]
  await page.route("**/provider*", async (route) => {
    if (new URL(route.request().url()).pathname !== "/provider") return route.fallback()
    await route.fulfill({
      json: {
        all: [
          {
            id: "opencode",
            name: "OpenCode",
            models: {
              "claude-opus-4-6": {
                id: "claude-opus-4-6",
                name: "Claude Opus 4.6",
                limit: { context: 200_000 },
                cost: { input: 1, output: 1 },
              },
            },
          },
          {
            id: "ollama-local",
            name: "Ollama Local Provider",
            models: Object.fromEntries(
              ["chat-model:latest", runtime].map((id) => [id, { id, name: id, limit: { context: 8192 } }]),
            ),
          },
        ],
        connected: ["opencode", "ollama-local"],
        default: { providerID: "opencode", modelID: "claude-opus-4-6" },
      },
    })
  })
  await page.reload()
  await page.keyboard.press("Control+,")
  const dialog = page.locator(".settings-v2-dialog")
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  const provider = dialog.locator('[data-provider="ollama-local"]')
  await expect(provider.locator('[data-model="chat-model:latest"]')).toHaveCount(1)
  await expect(provider.locator(`[data-model="${runtime}"]`)).toHaveCount(0)
  await provider.getByRole("button", { name: "Manage Ollama models", exact: true }).click()
  await expect(provider.locator('[data-model="llamacpp:custom"]')).toHaveCount(1)
  await expect(provider.locator('[data-model="chat-model:latest"]')).toHaveCount(1)
  await expect(provider.locator(`[data-model="${runtime}"]`)).toHaveCount(0)
  await dialog.screenshot({ path: test.info().outputPath("ollama-migration-inventory.png") })
  await page.reload()
  await expect(dialog).toBeHidden()
  await page.locator('[data-action="prompt-model"]').click()
  await page.locator('[data-option-key="action:manage"]').click()
  const popup = page.getByRole("dialog", { name: "Manage models", exact: true })
  const row = popup.locator('[data-model="chat-model:latest"]')
  await expect(row).toHaveCount(1)
  await expect(popup.locator(`[data-model="${runtime}"]`)).toHaveCount(0)
  const manage = row.getByRole("button", { name: "Manage", exact: true })
  await expect(manage).toBeVisible()
  await expect(manage).toHaveAttribute("aria-expanded", "false")
  await popup.screenshot({ path: test.info().outputPath("model-picker-manage-buttons.png") })
  await manage.click()
  await expect(manage).toHaveAttribute("aria-expanded", "true")
  await expect(row.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("chat-model:latest")
  await expect(row.getByRole("textbox", { name: "Ollama model tag", exact: true })).toHaveValue("chat-model:latest")
  await expect(row.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  await popup.screenshot({ path: test.info().outputPath("model-picker-manage-editor.png") })
  await manage.click()
  await expect(manage).toHaveAttribute("aria-expanded", "false")
  await expect(row.getByRole("textbox", { name: "Display name", exact: true })).toBeHidden()
})

test("newly downloaded chat models can be managed and enabled without changing their Ollama tag", async ({ page }) => {
  const { inventory, provider } = await setup(page, "Chat")
  const updates: Record<string, unknown>[] = []
  await page.route("**/global/config*", async (route) => {
    if (route.request().method() === "PATCH") updates.push(route.request().postDataJSON())
    await route.fulfill({ json: updates.at(-1) ?? {} })
  })
  await page.route("http://127.0.0.1:11434/api/pull", async (route) => {
    inventory.tags.push(route.request().postDataJSON().model)
    await route.fulfill({ body: '{"status":"success"}\n', contentType: "application/x-ndjson" })
  })
  await page.route("http://127.0.0.1:11434/api/show", async (route) => {
    await route.fulfill({
      json: {
        model_info: { "qwen.context_length": 262144 },
        details: { family: "qwen" },
        capabilities: ["completion", "tools", "thinking"],
      },
    })
  })
  await provider.getByRole("button", { name: "Manage Ollama models", exact: true }).click()
  const panel = provider.locator('[data-component="ollama-model-manager"]')
  await expect(provider.locator('[data-model="chat-model:latest"]')).toBeVisible()
  await panel.getByRole("textbox", { name: "Model to download", exact: true }).fill("qwen3.5-4b:q4")
  await expect(panel.getByRole("textbox", { name: "Model to download", exact: true })).toHaveValue("qwen3.5-4b:q4")
  await panel.getByRole("button", { name: "Download model", exact: true }).click()
  const row = provider.locator('[data-model="qwen3.5-4b:q4"]')
  const manage = row.getByRole("button", { name: "Manage", exact: true })
  await expect(manage).toHaveAttribute("aria-expanded", "true")
  await manage.click()
  await expect(manage).toHaveAttribute("aria-expanded", "false")
  await manage.click()
  await expect(row.getByRole("textbox", { name: "Ollama model tag", exact: true })).toHaveValue("qwen3.5-4b:q4")
  await expect(row.getByRole("switch")).toBeEnabled()
  await row.locator('[data-slot="switch-control"]').click()
  await expect(row.getByRole("switch")).toBeChecked()
  await expect.poll(() => updates.length).toBe(1)
  expect(updates[0]).toMatchObject({
    provider: {
      "ollama-local": {
        models: {
          "qwen3.5-4b:q4": { id: "qwen3.5-4b:q4", limit: { context: 8192 }, tool_call: true, reasoning: true },
        },
      },
    },
  })
  expect(inventory.tags.filter((tag) => tag.startsWith("qwen3.5-4b"))).toEqual(["qwen3.5-4b:q4"])
  await row.locator('[data-slot="switch-control"]').click()
  await expect(row.getByRole("switch")).not.toBeChecked()
  await row.locator('[data-slot="switch-control"]').click()
  await expect(row.getByRole("switch")).toBeChecked()
  expect(updates).toHaveLength(1)
})

test("failed metadata lookup leaves a new model disabled and keeps Manage usable", async ({ page }) => {
  const { provider } = await setup(page, "Chat")
  await provider.getByRole("button", { name: "Manage Ollama models", exact: true }).click()
  const row = provider.locator('[data-model="chat-model:latest"]')
  await expect(row.getByRole("switch")).toBeEnabled()
  await page.route("http://127.0.0.1:11434/api/show", (route) => route.fulfill({ status: 503, json: {} }))
  await row.locator('[data-slot="switch-control"]').click()
  await expect(row.getByRole("alert")).toBeVisible()
  await expect(row.getByRole("switch")).not.toBeChecked()
  const manage = row.getByRole("button", { name: "Manage", exact: true })
  await expect(manage).toBeEnabled()
  await manage.click()
  await expect(manage).toHaveAttribute("aria-expanded", "false")
})

test("context presets, custom entry, and runtime default remain selected across reopening", async ({ page }) => {
  const { provider } = await setup(page, "Voice")
  const row = provider.locator('[data-model="alpha-asr:latest"]')
  await row.getByRole("button", { name: "Manage", exact: true }).click()
  const editor = row.locator(".ollama-model-editor")
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  const field = editor.getByRole("group", { name: "Context size (tokens)", exact: true })
  const trigger = field.getByRole("button")
  const input = field.getByRole("spinbutton")
  const tag = editor.getByRole("textbox", { name: "Ollama model tag", exact: true })
  await expect(trigger).toContainText("Runtime default")
  await expect(input).toHaveValue("8192")
  await trigger.click()
  await page.getByRole("option", { name: "Custom", exact: true }).click()
  await expect(trigger).toContainText("Custom")
  await expect(input).toHaveValue("8192")
  await trigger.click()
  await expect(page.getByRole("option").filter({ hasText: "Custom" })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("option").filter({ hasText: "16K" }).click()
  await expect(trigger).toContainText("16K")
  await expect(input).toHaveValue("16384")
  await expect(tag).toHaveValue("alpha-asr:latest")
  await input.fill("8192")
  await expect(trigger).toContainText("Custom")
  await expect(tag).toHaveValue("alpha-asr:latest")
  await input.fill("12288")
  await expect(tag).toHaveValue("alpha-asr:latest")
  await trigger.click()
  await page.getByRole("option", { name: "Runtime default", exact: true }).click()
  await expect(trigger).toContainText("Runtime default")
  await expect(input).toHaveValue("8192")
  await expect(tag).toHaveValue("alpha-asr:latest")
  await trigger.focus()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(trigger).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.locator(".settings-v2-dialog")).toBeHidden()
})

test("saving successive context changes preserves the model tag, display name and selected model", async ({ page }) => {
  const { provider, dialog, inventory } = await setup(page, "Voice")
  const runtime = { context: 8192 }
  const updates: { from: string; model: string; parameters: { num_ctx: number } }[] = []
  await page.route("http://127.0.0.1:11434/api/create", (route) => {
    const body = route.request().postDataJSON()
    updates.push(body)
    runtime.context = body.parameters.num_ctx
    return route.fulfill({ contentType: "application/x-ndjson", body: '{"status":"success"}\n' })
  })
  await page.route("http://127.0.0.1:11434/api/show", (route) =>
    route.fulfill({
      json: {
        parameters: `num_ctx ${runtime.context}`,
        model_info: { "qwen.context_length": 32768 },
        details: { family: "qwen", quantization_level: "Q4_K_M" },
        capabilities: ["completion"],
      },
    }),
  )
  const selected = dialog.locator('[data-action="voice-default-model"]')
  await selected.click()
  await page
    .locator('[data-slot="select-v2-listbox"]')
    .getByText("Ollama Local Provider / First Voice", { exact: true })
    .click()
  const row = provider.locator('[data-model="alpha-asr:latest"]')
  await row.getByRole("button", { name: "Manage", exact: true }).click()
  const editor = row.locator(".ollama-model-editor")
  for (const context of [16384, 32768]) {
    const field = editor.getByRole("group", { name: "Context size (tokens)", exact: true })
    await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
    await field.getByRole("spinbutton").fill(String(context))
    await expect(editor.getByRole("textbox", { name: "Ollama model tag", exact: true })).toHaveValue("alpha-asr:latest")
    await editor.getByRole("button", { name: "Save", exact: true }).click()
    await expect(
      row.getByText("Model saved. Its name and settings are available in the model selector.", { exact: true }),
    ).toBeVisible()
    await expect(field.getByRole("spinbutton")).toHaveValue(String(context))
    await expect(row.getByText("First Voice", { exact: true })).toBeVisible()
    await expect(selected).toContainText("Ollama Local Provider / First Voice")
  }
  expect(updates.map((body) => [body.from, body.model, body.parameters.num_ctx])).toEqual([
    ["alpha-asr:latest", "alpha-asr:latest", 16384],
    ["alpha-asr:latest", "alpha-asr:latest", 32768],
  ])
  expect(inventory.tags).toEqual(["alpha-asr:latest", "beta-asr:latest", "chat-model:latest"])
  await expect(provider.locator('[data-model*="-ctx"]')).toHaveCount(0)
})

test("renaming a model preserves its saved ID and selection without creating a latest alias", async ({ page }) => {
  const { provider, dialog } = await setup(page, "Voice", true)
  const mutations: string[] = []
  page.on("request", (request) => {
    if (/\/api\/(create|copy|delete|pull)$/.test(new URL(request.url()).pathname)) mutations.push(request.url())
  })
  const row = provider.locator('[data-model="alpha-asr"]')
  await row.getByRole("button", { name: "Manage", exact: true }).click()
  const editor = row.locator(".ollama-model-editor")
  for (const name of ["Dictation", "My speech model"]) {
    await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
    await editor.getByRole("textbox", { name: "Display name", exact: true }).fill(name)
    await editor.getByRole("button", { name: "Save", exact: true }).click()
    await expect(row.locator('[data-slot="settings-v2-row-title"]')).toHaveText(name)
    await expect(dialog.locator('[data-action="voice-default-model"]')).toContainText(name)
    await expect(editor.getByRole("textbox", { name: "Ollama model tag", exact: true })).toHaveValue("alpha-asr")
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opencode.global.dat:voice.v1")!))
  expect(saved.selected).toEqual({ providerID: "ollama-local", modelID: "alpha-asr" })
  expect(saved.providers[0].models).toEqual([
    { id: "alpha-asr", name: "My speech model", visible: true, chunkSeconds: 30 },
    { id: "beta-asr:latest", name: "Second Voice", visible: true, chunkSeconds: 30 },
  ])
  expect(mutations).toEqual([])
  await expect(provider.locator('[data-model="alpha-asr:latest"]')).toHaveCount(0)
})
