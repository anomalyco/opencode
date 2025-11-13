import { test, expect } from "bun:test"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { writeConfigFile } from "../../src/config/write"
import { Config } from "../../src/config/config"

test("writeConfigFile preserves JSONC comments without triggering fallback", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-jsonc-"))
  const filepath = path.join(dir, "opencode.jsonc")
  const original = `{
  // keep me
  "model": "before"
}
`
  await Bun.write(filepath, original)

  try {
    await expect(
      writeConfigFile(
        filepath,
        {
          model: "after",
        },
        original,
      ),
    ).resolves.toBeUndefined()

    const updated = await Bun.file(filepath).text()
    expect(updated).toContain("// keep me")
    expect(updated).toContain(`"model": "after"`)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("writeConfigFile incremental edits keep JSONC valid", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-jsonc-incremental-"))
  const filepath = path.join(dir, "opencode.jsonc")
  const original = `{
  // settings
  "model": "anthropic/old",
  "theme": "light",
  "agent": {
    "build": {
      "model": "anthropic/old"
    }
  }
}
`
  await Bun.write(filepath, original)

  const nextConfig = Config.Info.parse({
    $schema: "https://opencode.ai/schema/config.json",
    model: "anthropic/new",
    theme: "dark",
    agent: {
      build: { model: "anthropic/new" },
      plan: { model: "anthropic/new" },
    },
  })

  try {
    await writeConfigFile(filepath, nextConfig, original)
    const updated = await Bun.file(filepath).text()
    const errors: ParseError[] = []
    parseJsonc(updated, errors, { allowTrailingComma: true })
    expect(errors.length).toBe(0)
    expect(updated).toContain("// settings")
    expect(updated).toContain(`"theme": "dark"`)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
