const PORT_MIN = 40000
const PORT_SPAN = 20000

export function fixedPortForCwd(cwd: string) {
  const normalized = cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return PORT_MIN + (hash >>> 0) % PORT_SPAN
}