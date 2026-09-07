import assert from "node:assert/strict"
import { spawn } from "../../src/pty/pty.bun"

const raw = process.argv[2] === "raw"
const pty = spawn(
  Bun.which("pwsh") ?? "powershell.exe",
  [
    "-NoLogo",
    "-NoProfile",
    ...(raw ? [] : ["-NoExit"]),
    "-Command",
    raw
      ? "[Console]::TreatControlCAsInput = $true; Write-Output 'PTY_RAW_READY'; $key = [Console]::ReadKey($true); Write-Output ('PTY_KEY:' + [int]$key.KeyChar)"
      : "Remove-Module PSReadLine -ErrorAction SilentlyContinue; function prompt { 'PTY_PROMPT> ' }",
  ],
  { name: "xterm-256color", cols: 160, rows: 24, env: { ...process.env, TERM: "xterm-256color" } },
)
const output = { text: "", cursor: 0 }
const listeners = new Set<() => void>()
const exited = Promise.withResolvers<number>()
pty.onExit((event) => exited.resolve(event.exitCode))
pty.onData((text) => {
  output.text += text
  listeners.forEach((check) => check())
})

try {
  if (raw) {
    await waitFor("PTY_RAW_READY")
    pty.write("\x03")
    await waitFor("PTY_KEY:3")
  }
  if (!raw) {
    await waitFor("PTY_PROMPT>")
    // Split markers so echoed command text cannot satisfy the output checks.
    pty.write("Write-Output ('PTY_' + 'BUSY'); Start-Sleep -Seconds 60; Write-Output ('PTY_' + 'COMPLETED')\r")
    await waitFor("PTY_BUSY")
    pty.write("\x03")
    await waitFor("PTY_PROMPT>")
    assert.ok(!output.text.includes("PTY_COMPLETED"))
    pty.write("Write-Output ('PTY_' + 'REUSED')\r")
    await waitFor("PTY_REUSED")
    await waitFor("PTY_PROMPT>")
    pty.write("exit 0\r")
  }
  assert.equal(await exited.promise, 0)
} finally {
  pty.kill()
}
process.exit(0)

function waitFor(text: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      listeners.delete(check)
      reject(new Error(`Timed out waiting for ${JSON.stringify(text)}: ${output.text}`))
    }, 5_000)
    const check = () => {
      const index = output.text.indexOf(text, output.cursor)
      if (index === -1) return
      output.cursor = index + text.length
      listeners.delete(check)
      clearTimeout(timeout)
      resolve()
    }
    listeners.add(check)
    check()
  })
}
