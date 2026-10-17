// opencode-pty does not ship Windows binaries.
export const available = process.platform !== "win32"

export async function resolveBinary(_bin: string) {
  return process.env.OPENCODE_PTY_BIN || "opencode-pty"
}
