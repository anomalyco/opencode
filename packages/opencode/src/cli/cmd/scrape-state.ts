import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"

function stateFile(name: string) {
  return join(process.env.OPENCODE_STATE_DIR ?? join(homedir(), ".opencode"), name)
}

export function isScrapeEnabled(): boolean {
  try {
    const file = stateFile(".scrape-enabled")
    if (!existsSync(file)) return true
    const content = readFileSync(file, "utf-8").trim()
    return content === "on"
  } catch {
    return true
  }
}

export function setScrapeState(enabled: boolean): void {
  const file = stateFile(".scrape-enabled")
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, enabled ? "on" : "off")
}

export const SCRAPE_DISABLED_MESSAGE = "Scraping is disabled. Enable it with: opencode dynamic scrape on"

/**
 * Crawling is opt-in. Unlike scraping, it can start browser-backed and
 * multi-page requests, so an absent state file must never enable it.
 */
export function isCrawlEnabled(): boolean {
  try {
    const file = stateFile(".crawl-enabled")
    if (!existsSync(file)) return false
    return readFileSync(file, "utf-8").trim() === "on"
  } catch {
    return false
  }
}

export function setCrawlState(enabled: boolean): void {
  const file = stateFile(".crawl-enabled")
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, enabled ? "on" : "off")
}

export const CRAWL_DISABLED_MESSAGE = "Crawling agent is disabled.\nEnable it with: opencode dynamic crawl on."
