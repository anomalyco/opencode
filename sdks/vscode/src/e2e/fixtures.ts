import { test as base, expect, type ElectronApplication, type Page } from "@playwright/test"
import { _electron as electron } from "playwright-core"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"

export const screenshotDir = process.env.SCREENSHOT_DIR ?? path.join(__dirname, "../../out/screenshots")

function resolveVSCode(): string {
  const dir = path.resolve(__dirname, "../../.vscode-test")
  const versions = fs
    .readdirSync(dir)
    .filter((d) => d.startsWith("vscode-linux") && fs.statSync(path.join(dir, d)).isDirectory())
    .sort()
    .reverse()
  if (!versions.length) throw new Error("No VS Code found in .vscode-test/. Run: bun run pretest")
  return path.join(dir, versions[0], "code")
}

type Fixtures = { app: ElectronApplication; page: Page }

export const test = base.extend<Fixtures>({
  app: async ({}: {}, use) => {
    const ext = path.resolve(__dirname, "../..")
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-e2e-"))
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-ws-"))

    fs.mkdirSync(screenshotDir, { recursive: true })

    const app = await electron.launch({
      executablePath: resolveVSCode(),
      args: [
        `--extensionDevelopmentPath=${ext}`,
        `--user-data-dir=${userData}`,
        "--disable-gpu",
        "--disable-updates",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        "--disable-telemetry",
        "--no-sandbox",
        ws,
      ],
      env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>,
    })

    await use(app)
    await app.close()
    fs.rmSync(userData, { recursive: true, force: true })
    fs.rmSync(ws, { recursive: true, force: true })
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForSelector(".monaco-workbench", { timeout: 30_000 })
    await page.waitForTimeout(2_000)
    await use(page)
  },
})

export { expect }
