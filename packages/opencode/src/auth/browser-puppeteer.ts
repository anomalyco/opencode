import path from "path"
import fs from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "auth.browser.puppeteer" })

let puppeteerInitialized = false
let cachedPuppeteer: any = null

async function installPuppeteer(onProgress?: (msg: string) => void): Promise<boolean> {
  const report = onProgress ?? ((msg: string) => log.info(msg))
  report("Installing puppeteer for browser automation...")

  try {
    const puppeteerDir = path.join(Global.Path.data, "puppeteer")
    await fs.mkdir(puppeteerDir, { recursive: true })

    const pkgPath = path.join(puppeteerDir, "package.json")
    await fs.writeFile(
      pkgPath,
      JSON.stringify(
        {
          name: "opencode-puppeteer",
          private: true,
          dependencies: {
            puppeteer: "^24.9.0",
            "puppeteer-extra": "^3.3.6",
            "puppeteer-extra-plugin-stealth": "^2.11.2",
          },
        },
        null,
        2,
      ),
    )

    report("Installing puppeteer packages (this may take a moment)...")

    const proc = Bun.spawn(["bun", "install"], { cwd: puppeteerDir, stdout: "pipe", stderr: "pipe" })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      log.error("Failed to install puppeteer package", { stderr })

      report("Trying with npm...")
      const npmProc = Bun.spawn(["npm", "install"], { cwd: puppeteerDir, stdout: "pipe", stderr: "pipe" })
      if ((await npmProc.exited) !== 0) return false
    }

    report("Puppeteer installation complete!")
    return true
  } catch (error) {
    log.error("Failed to install puppeteer", { error })
    return false
  }
}

async function loadFromPath(extraPath: string, stealthPath: string): Promise<any | null> {
  try {
    const puppeteerExtra = await import(extraPath)
    const stealthPlugin = await import(stealthPath)
    if (!puppeteerInitialized) {
      puppeteerExtra.default.use(stealthPlugin.default())
      puppeteerInitialized = true
    }
    cachedPuppeteer = puppeteerExtra.default
    return cachedPuppeteer
  } catch {
    return null
  }
}

export async function getPuppeteer(onProgress?: (msg: string) => void): Promise<any | null> {
  if (puppeteerInitialized && cachedPuppeteer) return cachedPuppeteer

  // Try normal node_modules first
  const fromNodeModules = await loadFromPath("puppeteer-extra", "puppeteer-extra-plugin-stealth")
  if (fromNodeModules) return fromNodeModules

  // Try our custom install location
  const puppeteerDir = path.join(Global.Path.data, "puppeteer")
  return loadFromPath(
    path.join(puppeteerDir, "node_modules", "puppeteer-extra"),
    path.join(puppeteerDir, "node_modules", "puppeteer-extra-plugin-stealth"),
  )
}

export async function ensurePuppeteer(onProgress?: (msg: string) => void): Promise<any> {
  let puppeteer = await getPuppeteer(onProgress)

  if (!puppeteer) {
    const installed = await installPuppeteer(onProgress)
    if (!installed) {
      throw new Error(
        "Failed to install puppeteer automatically. Please install it manually:\n" +
          "  npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth",
      )
    }

    const puppeteerDir = path.join(Global.Path.data, "puppeteer")
    puppeteer = await loadFromPath(
      path.join(puppeteerDir, "node_modules", "puppeteer-extra"),
      path.join(puppeteerDir, "node_modules", "puppeteer-extra-plugin-stealth"),
    )
    if (!puppeteer) throw new Error("Puppeteer was installed but could not be loaded. Please restart and try again.")
  }

  return puppeteer
}
