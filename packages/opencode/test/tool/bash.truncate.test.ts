import { describe, expect, test } from "bun:test"
import { App } from "../../src/app/app"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Log } from "../../src/util/log"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const bash = await BashTool.init()
const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function repeat(s: string, n: number) {
  return Array.from({ length: n }, () => s).join("")
}

describe("tool.bash truncation", () => {
  test("keeps tail when over limit", async () => {
    await App.provide({ cwd: projectRoot }, async () => {
      const prefix = "START-"
      const suffix = "-END"
      const long = prefix + repeat("x", 35000) + suffix
      const cmd = `node -e "process.stdout.write('${long}')"`
      const result = await bash.execute(
        {
          command: cmd,
          description: "emit long output",
        },
        ctx,
      )
      expect(result.output.startsWith("(Output was truncated due to length limit)\n\n")).toBe(true)
      expect(result.output.includes(prefix)).toBe(false)
      expect(result.output.endsWith(suffix)).toBe(true)
      expect(result.output.length).toBeLessThanOrEqual(30000 + 2 + 49) // limit + header
    })
  })
})
