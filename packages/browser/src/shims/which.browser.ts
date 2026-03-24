// Browser-compatible 'which' shim
function resolveCommand(cmd: string): string | null {
  switch (cmd) {
    case "rg":
      return "/opencode/cache/bin/rg"
    case "bash":
      return "/bin/sh"
    case "sh":
      return "/bin/sh"
    case "git":
      return "/usr/bin/git"
    default:
      return null
  }
}

export default function which(cmd: string): Promise<string> {
  const resolved = resolveCommand(cmd)
  if (resolved) return Promise.resolve(resolved)
  return Promise.reject(new Error(`which: ${cmd} not available in browser`))
}
export function sync(cmd: string): string {
  const resolved = resolveCommand(cmd)
  if (resolved) return resolved
  throw new Error(`which: ${cmd} not available in browser`)
}
which.sync = sync
