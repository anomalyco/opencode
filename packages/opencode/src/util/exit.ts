export function safeExit(code: number = Number(process.exitCode ?? 0)): void {
  if (process.platform !== "win32") {
    process.exit(code)
    return
  }

  // On Windows process.exit() calls ExitProcess(), which broadcasts
  // CTRL_CLOSE_EVENT to the whole console process group. The parent shell
  // (pwsh/cmd) is attached to the same console, so it is killed together with
  // opencode when it exits from a TUI session (https://github.com/anomalyco/opencode/issues/28673).
  // Setting the exit code and returning lets the process end naturally, which
  // only detaches opencode from the console and leaves the shell alive.
  process.exitCode = code
}