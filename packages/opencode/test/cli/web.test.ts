import { describe, expect, test } from "bun:test"
import { ChildProcess } from "node:child_process"

import { openBrowser } from "../../src/cli/cmd/web"

describe("web browser", () => {
  test("handles errors from the browser subprocess", async () => {
    const subprocess = new ChildProcess()

    await openBrowser("http://localhost:4096", async () => subprocess)

    expect(() => subprocess.emit("error", new Error("Executable not found"))).not.toThrow()
  })
})
