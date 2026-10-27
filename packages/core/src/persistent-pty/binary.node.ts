export const available = true

export async function resolveBinary(_bin: string) {
  return process.env.OPENCODE_PTY_BIN || "opencode-pty"
}
