import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"

const SCRAPE_STATE_FILE = join(homedir(), ".opencode", ".scrape-enabled")

export function isScrapeEnabled(): boolean {
  try {
    if (!existsSync(SCRAPE_STATE_FILE)) return true
    const content = readFileSync(SCRAPE_STATE_FILE, "utf-8").trim()
    return content === "on"
  } catch {
    return true
  }
}

export function setScrapeState(enabled: boolean): void {
  const dir = dirname(SCRAPE_STATE_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(SCRAPE_STATE_FILE, enabled ? "on" : "off")
}

export const SCRAPE_DISABLED_MESSAGE = "Scraping is disabled. Enable it with: opencode dynamic scrape on"
