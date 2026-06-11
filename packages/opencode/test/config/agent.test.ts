import { expect, test, describe, beforeAll, afterAll } from "bun:test"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigAgent } from "@/config/agent"

const frontmatter = (lines: string[]) => ["---", ...lines, "---", "prompt body"].join("\n")

describe("ConfigAgent: invalid files are skipped, not fatal", () => {
  let dir: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-agent-config-"))
    await fs.mkdir(path.join(dir, "agents"), { recursive: true })
    await fs.mkdir(path.join(dir, "modes"), { recursive: true })

    await fs.writeFile(path.join(dir, "agents", "valid.md"), frontmatter(["name: valid", "temperature: 0.5"]))
    // Cursor-format agent: `tools` is a YAML array, not an object (#31481)
    await fs.writeFile(
      path.join(dir, "agents", "cursor.md"),
      frontmatter(["name: cursor", "tools: [execute/runNotebookCell, read_file]"]),
    )

    await fs.writeFile(path.join(dir, "modes", "valid.md"), frontmatter(["name: validmode", "temperature: 0.3"]))
    // invalid mode: wrong type for temperature (#27133)
    await fs.writeFile(path.join(dir, "modes", "bad.md"), frontmatter(["name: badmode", "temperature: nope"]))
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  test("load() does not throw when an agent file is invalid", async () => {
    expect(ConfigAgent.load(dir)).resolves.toBeDefined()
  })

  test("load() keeps valid agents and skips the invalid Cursor-format one", async () => {
    const agents = await ConfigAgent.load(dir)
    expect(Object.keys(agents)).toContain("valid")
    expect(Object.keys(agents)).not.toContain("cursor")
  })

  test("loadMode() keeps valid modes and skips the invalid one", async () => {
    const modes = await ConfigAgent.loadMode(dir)
    expect(Object.keys(modes)).toContain("validmode")
    expect(Object.keys(modes)).not.toContain("badmode")
  })
})
