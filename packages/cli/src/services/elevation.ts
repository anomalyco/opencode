export * as Elevation from "./elevation"

import { Effect } from "effect"
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)

export const check = Effect.fn("cli.elevation.check")(function* (allowed = false) {
  if (allowed) return
  if (!(yield* elevated())) return
  return yield* Effect.fail(
    new Error(
      "OpenCode is running as administrator or root.\n\n" +
        "The server and AI tools would have administrator privileges, including in standalone mode.\n\n" +
        "If this is intentional, launch again with --allow-elevated.\n" +
        "Otherwise, launch OpenCode from a non-administrator user or terminal.",
    ),
  )
})

export const elevated = Effect.fn("cli.elevation.detect")(function* () {
  if (process.platform !== "win32") return process.geteuid?.() === 0
  // Administrator group membership alone is insufficient: UAC's filtered token is not elevated.
  const result = yield* Effect.tryPromise({
    try: () =>
      execute(
        path.win32.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ],
        { windowsHide: true, timeout: 10_000 },
      ),
    catch: (cause) =>
      new Error("Could not check administrator privileges. Retry with --allow-elevated only if intentional.", {
        cause,
      }),
  })
  if (result.stdout.trim() === "True") return true
  if (result.stdout.trim() === "False") return false
  return yield* Effect.fail(
    new Error("Could not determine administrator privileges. Retry with --allow-elevated only if intentional."),
  )
})
