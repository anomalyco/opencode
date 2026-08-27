import { Effect } from "effect"
import { ForegroundProcess } from "../src/process.ts"

const executable = Bun.which("pwsh")
if (!executable) throw new Error("PowerShell 7 is required for this example")

const result = await Effect.runPromise(
  ForegroundProcess.run({
    executable,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::OutputEncoding.CodePage; Write-Output 'captured'; [Console]::Error.Write('stderr tail'); exit 7",
    ],
  }),
)

console.log({ exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() })
