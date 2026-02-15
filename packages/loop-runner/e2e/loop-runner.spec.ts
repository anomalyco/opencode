import { test, expect } from "@playwright/test"

test.describe("Loop Runner UI", () => {
  test("page loads with correct title and header", async ({ page }) => {
    await page.goto("/")

    await expect(page).toHaveTitle("OpenCode Loop Runner")
    await expect(page.locator("h1")).toHaveText("OpenCode Loop Runner")
  })

  test("displays all configuration elements", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#modelSelect")).toBeVisible()
    await expect(page.locator("#systemPrompt")).toBeVisible()
    await expect(page.locator("#userPrompt")).toBeVisible()
    await expect(page.locator("#interval")).toBeVisible()
    await expect(page.locator("#maxIterations")).toBeVisible()
    await expect(page.locator("#monitorCommand")).toBeVisible()
    await expect(page.locator("#monitorInterval")).toBeVisible()
  })

  test("displays memory sections", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#workingMemory")).toBeVisible()
    await expect(page.locator("#persistentMemory")).toBeVisible()
    await expect(page.locator("#updateWorkingBtn")).toBeVisible()
    await expect(page.locator("#updatePersistentBtn")).toBeVisible()
  })

  test("displays control buttons", async ({ page }) => {
    await page.goto("/")

    const startBtn = page.locator("#startBtn")
    const stopBtn = page.locator("#stopBtn")

    await expect(startBtn).toBeVisible()
    await expect(startBtn).toHaveText("Start Loop")
    await expect(stopBtn).toBeVisible()
    await expect(stopBtn).toHaveText("Stop")
    await expect(stopBtn).toBeDisabled()
  })

  test("displays tabs for output sections", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator(".tab").filter({ hasText: "Live Output" })).toBeVisible()
    await expect(page.locator(".tab").filter({ hasText: "History" })).toBeVisible()
    await expect(page.locator(".tab").filter({ hasText: "Event Log" })).toBeVisible()
  })
})

test.describe("SSE Connection", () => {
  test("establishes connection and shows connected status", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#statusText")).toHaveText("Stopped", { timeout: 20000 })
    await expect(page.locator("#statusDot")).toHaveClass(/stopped/)
  })

  test("loads models into dropdown", async ({ page }) => {
    await page.goto("/")

    const modelSelect = page.locator("#modelSelect")
    await expect(modelSelect).toBeVisible()

    await expect(async () => {
      const options = await modelSelect.locator("option").all()
      expect(options.length).toBeGreaterThan(1)
    }).toPass({ timeout: 20000 })

    const firstOption = await modelSelect.locator("option").first().textContent()
    expect(firstOption).not.toContain("Loading models...")
    expect(firstOption).not.toContain("Failed to load")
  })

  test("receives initial config from server", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#statusText")).toHaveText("Stopped", { timeout: 20000 })

    const systemPrompt = page.locator("#systemPrompt")
    await expect(async () => {
      const value = await systemPrompt.inputValue()
      expect(value.length).toBeGreaterThan(0)
    }).toPass({ timeout: 10000 })
  })
})

test.describe("Tab Navigation", () => {
  test("switches between tabs correctly", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#liveTab")).toBeVisible()
    await expect(page.locator("#historyTab")).toBeHidden()
    await expect(page.locator("#logsTab")).toBeHidden()

    await page.locator(".tab").filter({ hasText: "History" }).click()
    await expect(page.locator("#liveTab")).toBeHidden()
    await expect(page.locator("#historyTab")).toBeVisible()

    await page.locator(".tab").filter({ hasText: "Event Log" }).click()
    await expect(page.locator("#historyTab")).toBeHidden()
    await expect(page.locator("#logsTab")).toBeVisible()

    await page.locator(".tab").filter({ hasText: "Live Output" }).click()
    await expect(page.locator("#liveTab")).toBeVisible()
    await expect(page.locator("#logsTab")).toBeHidden()
  })

  test("active tab has correct styling", async ({ page }) => {
    await page.goto("/")

    const liveTab = page.locator(".tab").filter({ hasText: "Live Output" })
    const historyTab = page.locator(".tab").filter({ hasText: "History" })

    await expect(liveTab).toHaveClass(/active/)
    await expect(historyTab).not.toHaveClass(/active/)

    await historyTab.click()
    await expect(historyTab).toHaveClass(/active/)
    await expect(liveTab).not.toHaveClass(/active/)
  })
})

test.describe("Memory Updates", () => {
  test("updates working memory via API", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#statusText")).toHaveText("Stopped", { timeout: 20000 })

    const workingMemory = page.locator("#workingMemory")
    await workingMemory.fill("Test working memory content")

    const response = page.waitForResponse((res) => res.url().includes("/api/working") && res.status() === 200)
    await page.locator("#updateWorkingBtn").click()
    await response
  })

  test("updates persistent memory via API", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#statusText")).toHaveText("Stopped", { timeout: 20000 })

    const persistentMemory = page.locator("#persistentMemory")
    await persistentMemory.fill("Test persistent memory content")

    const response = page.waitForResponse((res) => res.url().includes("/api/persistent") && res.status() === 200)
    await page.locator("#updatePersistentBtn").click()
    await response
  })
})

test.describe("Configuration", () => {
  test("interval input accepts numeric values", async ({ page }) => {
    await page.goto("/")

    const interval = page.locator("#interval")
    await interval.fill("10000")
    await expect(interval).toHaveValue("10000")
  })

  test("max iterations input accepts numeric values", async ({ page }) => {
    await page.goto("/")

    const maxIterations = page.locator("#maxIterations")
    await maxIterations.fill("5")
    await expect(maxIterations).toHaveValue("5")
  })

  test("monitor command input accepts text", async ({ page }) => {
    await page.goto("/")

    const monitorCommand = page.locator("#monitorCommand")
    await monitorCommand.fill("echo hello")
    await expect(monitorCommand).toHaveValue("echo hello")
  })
})

test.describe("Loop Control", () => {
  test("start button sends start request", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#statusText")).toHaveText("Stopped", { timeout: 20000 })

    const startResponse = page.waitForResponse((res) => res.url().includes("/api/start") && res.status() === 200)

    await page.locator("#startBtn").click()
    await startResponse

    await expect(page.locator("#statusText")).toHaveText("Running", { timeout: 10000 })
    await expect(page.locator("#startBtn")).toBeDisabled()
    await expect(page.locator("#stopBtn")).toBeEnabled()
  })

  test("stop button sends stop request", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#statusText")).toHaveText("Stopped", { timeout: 20000 })

    await page.locator("#startBtn").click()
    await expect(page.locator("#statusText")).toHaveText("Running", { timeout: 10000 })

    const stopResponse = page.waitForResponse((res) => res.url().includes("/api/stop") && res.status() === 200)
    await page.locator("#stopBtn").click()
    await stopResponse

    await expect(page.locator("#statusText")).toHaveText("Stopped", { timeout: 10000 })
    await expect(page.locator("#startBtn")).toBeEnabled()
    await expect(page.locator("#stopBtn")).toBeDisabled()
  })

  test("iteration counter increments when loop runs", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#statusText")).toHaveText("Stopped", { timeout: 20000 })

    await expect(page.locator("#iterationCount")).toHaveText("0")

    await page.locator("#startBtn").click()
    await expect(page.locator("#statusText")).toHaveText("Running", { timeout: 10000 })

    await expect(async () => {
      const count = await page.locator("#iterationCount").textContent()
      expect(Number(count)).toBeGreaterThan(0)
    }).toPass({ timeout: 30000 })

    await page.locator("#stopBtn").click()
  })
})

test.describe("Live Output", () => {
  test("displays current prompt section", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#currentPrompt")).toBeVisible()
    await expect(page.locator("#promptIteration")).toBeVisible()
  })

  test("displays last response section", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#lastResponse")).toBeVisible()
    await expect(page.locator("#responseIteration")).toBeVisible()
  })

  test("displays monitor output section", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("#monitorOutput")).toBeVisible()
  })
})
