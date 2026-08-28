import { describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import os from "node:os"
import { createInterface } from "node:readline"

const script = await Bun.file(new URL("../src/shell/powershell-worker.ps1", import.meta.url)).text()

const shells = ["pwsh", ...(process.platform === "win32" ? ["powershell"] : [])].filter(
  (shell) => spawnSync(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"]).status === 0,
)

for (const shell of shells) {
  describe(`PowerShell worker (${shell})`, () => {
    test("streams output and isolates runspaces, directories, and environments", async () => {
      const child = spawn(shell, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ])
      const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
      const run = async (command: string, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env) => {
        child.stdin.write(Buffer.from(JSON.stringify({ command, cwd, env }), "utf8").toString("base64") + "\n")
        let output = ""
        while (true) {
          const line = await lines.next()
          if (line.done) throw new Error("PowerShell worker exited before sending its completion event")
          const event = JSON.parse(line.value.replace(/^\u001e/, "")) as
            | { type: "output"; data: string }
            | { type: "exit"; code: number }
          if (event.type === "exit") return { output, exit: event.code }
          output += Buffer.from(event.data, "base64").toString("utf8")
        }
      }

      try {
        const multiline = await run('$value = "first"\n$value\n"second"\n[char]0x03BB')
        expect(multiline.exit).toBe(0)
        expect(multiline.output).toContain("first")
        expect(multiline.output).toContain("second")
        expect(multiline.output).toContain("\u03bb")

        const streams = await run('Write-Host "host"; Write-Warning "warning"; Write-Error "failure"')
        expect(streams.output).toContain("host")
        expect(streams.output).toContain("warning")
        expect(streams.output).toContain("failure")

        const first = await run('$script:privateValue = "hidden"; $env:OPENCODE_WORKER_TEST', os.tmpdir(), {
          ...process.env,
          OPENCODE_WORKER_TEST: "first",
        })
        expect(first.output).toContain("first")

        const second = await run(
          '"location=$((Get-Location).Path)"; "process=$([Environment]::CurrentDirectory)"; "variable=$script:privateValue"; "environment=$env:OPENCODE_WORKER_TEST"',
          process.cwd(),
          process.env,
        )
        expect(second.exit).toBe(0)
        expect(second.output).toContain(`location=${process.cwd()}`)
        expect(second.output).toContain(`process=${process.cwd()}`)
        expect(second.output).toMatch(/variable=\r?\n/)
        expect(second.output).toMatch(/environment=\r?\n/)

        const exited = await run("exit 7")
        expect(exited.exit).toBe(7)
        expect((await run('"still running"')).output).toContain("still running")

        const native =
          process.platform === "win32"
            ? await run('& "$env:SystemRoot\\System32\\cmd.exe" /d /c "echo native-error 1>&2 & exit /b 9"')
            : await run("& /bin/sh -c 'echo native-error >&2; exit 9'")
        expect(native.output).toContain("native-error")
        expect(native.exit).toBe(1)

        const recovered =
          process.platform === "win32"
            ? await run('& "$env:SystemRoot\\System32\\cmd.exe" /d /c "exit /b 9"; "recovered"')
            : await run("& /bin/sh -c 'exit 9'; 'recovered'")
        expect(recovered.output).toContain("recovered")
        expect(recovered.exit).toBe(0)
      } finally {
        child.stdin.end()
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve()
          child.once("exit", () => resolve())
        })
      }
    }, 30_000)
  })
}

if (shells.length === 0) {
  test.skip("PowerShell worker requires pwsh or Windows PowerShell", () => {})
}
