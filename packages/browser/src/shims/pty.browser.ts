// Stub for bun-pty - not needed in browser agent loop
export function spawn() {
  throw new Error("PTY not available in browser")
}
export default { spawn }
