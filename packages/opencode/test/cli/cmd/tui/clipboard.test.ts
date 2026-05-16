import { describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { pathToFileURL } from "url"

describe("TUI clipboard", () => {
  test("rejects when the selected native clipboard command fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-clipboard-"))

    try {
      const xclip = path.join(directory, "xclip")
      await writeFile(xclip, "#!/bin/sh\nexit 7\n")
      await chmod(xclip, 0o755)

      const clipboard = path.resolve(import.meta.dir, "../../../../src/cli/cmd/tui/util/clipboard.ts")
      const script = path.join(directory, "copy-fails.mjs")
      await writeFile(
        script,
        `
import * as Clipboard from ${JSON.stringify(pathToFileURL(clipboard).href)}

try {
  await Clipboard.copy("hello")
  console.error("copy resolved")
  process.exit(1)
} catch {
  process.exit(0)
}
`.trimStart(),
      )

      const proc = Bun.spawn([process.execPath, script], {
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
          WAYLAND_DISPLAY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      expect(`${stdout}${stderr}`).not.toContain("copy resolved")
      expect(code).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
