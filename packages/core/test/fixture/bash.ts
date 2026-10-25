import fs from "node:fs"

let cached: boolean | undefined
let cachedZsh: boolean | undefined

/**
 * FreeBSD's default bash build uses named pipes under /tmp for process
 * substitution (FDESCFS is off). In that mode a substitution is unsafe when
 * the command never opens the path: bash blocks opening the FIFO.
 */
export function bashUsesFifoProcessSubstitution(): boolean {
  if (cached !== undefined) return cached
  const executable = Bun.which("bash")
  if (!executable) return (cached = false)
  const result = Bun.spawnSync(
    [executable, "--noprofile", "--norc", "-c", "echo <(true)"],
    { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
  )
  return (cached = /\/sh-np\./.test(result.stdout.toString()))
}

/** zsh uses temporary FIFOs for process substitution when /dev/fd is unavailable. */
export function zshUsesFifoProcessSubstitution(): boolean {
  if (cachedZsh !== undefined) return cachedZsh
  // Do not spawn zsh with a process substitution here: on FIFO-based systems
  // the child blocks on the FIFO and Bun waits for it. Checking whether /dev/fd
  // exposes an open descriptor is enough to know which implementation zsh uses.
  let fd: number | undefined
  try {
    fd = fs.openSync("/dev/null", "r")
    return (cachedZsh = !fs.existsSync(`/dev/fd/${fd}`))
  } catch {
    return (cachedZsh = true)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
