export function shell() {
  const s = process.env.SHELL
  if (s) return s
  if (process.platform === "darwin") {
    return "/bin/zsh"
  }
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe"
  }
  const bash = Bun.which("bash")
  if (bash) return bash
  return "bash"
}
