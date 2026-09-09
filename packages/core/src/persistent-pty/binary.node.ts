export async function resolveBinary() {
  return process.env.OPENCODE_PTY_BIN || "opencode-pty"
}
