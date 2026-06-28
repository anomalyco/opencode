import { existsSync, mkdirSync, writeFileSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import DEFAULT_ASSETS from "./default-assets.json"

/**
 * Seeds the user's global opencode config directory with a set of bundled
 * default assets (an agent, a skill, quality plugins, helper tools and
 * instruction files) on first run, so a fresh install comes pre-provisioned.
 *
 * Safety:
 * - Never overwrites a file that already exists (user edits always win).
 * - Best-effort: any failure is swallowed so it can never block startup.
 * - Gated by a version marker so it does almost no work after the first run.
 */

const MARKER_VERSION = "1"
const MARKER_FILE = ".defaults-provisioned"

export function provisionDefaults(): void {
  try {
    const configDir = Global.make().config
    const marker = path.join(configDir, MARKER_FILE)
    if (existsSync(marker)) return

    for (const [rel, content] of Object.entries(DEFAULT_ASSETS as Record<string, string>)) {
      const target = path.join(configDir, rel)
      if (existsSync(target)) continue
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, content, "utf8")
    }

    mkdirSync(configDir, { recursive: true })
    writeFileSync(marker, MARKER_VERSION + "\n", "utf8")
  } catch {
    // best-effort: provisioning must never break startup
  }
}

export * as Provision from "./provision"
