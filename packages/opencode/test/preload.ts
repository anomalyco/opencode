// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first
import os from "os"
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { afterAll } from "bun:test"

// Print all OPENCODE_TEST_* env vars for visibility
const testEnvVars = Object.entries(process.env)
  .filter(([key]) => key.startsWith("OPENCODE_TEST_"))
  .sort(([a], [b]) => a.localeCompare(b))

if (testEnvVars.length > 0) {
  const title = " Test Environment Variables "
  const lines = testEnvVars.map(([key, value]) => `│ ${key}=${value}`)
  const maxContentWidth = Math.max(title.length, ...lines.map((l) => l.length - 1))
  const width = maxContentWidth + 1

  console.log("\n┌" + "─" + title + "─".repeat(width - title.length - 1) + "┐")
  for (const line of lines) {
    console.log(line + " ".repeat(width - line.length + 1) + "│")
  }
  console.log("└" + "─".repeat(width) + "┘\n")
}

const dir = path.join(os.tmpdir(), "opencode-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })
afterAll(() => {
  fsSync.rmSync(dir, { recursive: true, force: true })
})
// Set test home directory to isolate tests from user's actual home directory
// This prevents tests from picking up real user configs/skills from ~/.claude/skills
const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["OPENCODE_TEST_HOME"] = testHome

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")

// Pre-fetch models.json so tests don't need the macro fallback
// Also write the cache version file to prevent global/index.ts from clearing the cache
const cacheDir = path.join(dir, "cache", "opencode")
await fs.mkdir(cacheDir, { recursive: true })
await fs.writeFile(path.join(cacheDir, "version"), "14")
const response = await fetch("https://models.dev/api.json")
if (response.ok) {
  await fs.writeFile(path.join(cacheDir, "models.json"), await response.text())
}
// Disable models.dev refresh to avoid race conditions during tests
process.env["OPENCODE_DISABLE_MODELS_FETCH"] = "true"

// Clear provider env vars to ensure clean test state
delete process.env["ANTHROPIC_API_KEY"]
delete process.env["OPENAI_API_KEY"]
delete process.env["GOOGLE_API_KEY"]
delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
delete process.env["AZURE_OPENAI_API_KEY"]
delete process.env["AWS_ACCESS_KEY_ID"]
delete process.env["AWS_PROFILE"]
delete process.env["AWS_REGION"]
delete process.env["AWS_BEARER_TOKEN_BEDROCK"]
delete process.env["OPENROUTER_API_KEY"]
delete process.env["GROQ_API_KEY"]
delete process.env["MISTRAL_API_KEY"]
delete process.env["PERPLEXITY_API_KEY"]
delete process.env["TOGETHER_API_KEY"]
delete process.env["XAI_API_KEY"]
delete process.env["DEEPSEEK_API_KEY"]
delete process.env["FIREWORKS_API_KEY"]
delete process.env["CEREBRAS_API_KEY"]
delete process.env["SAMBANOVA_API_KEY"]

// Now safe to import from src/
const { Log } = await import("../src/util/log")

Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})
