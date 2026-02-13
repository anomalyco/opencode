export function validWorktree(input: string | undefined) {
  if (!input) return false
  const value = input.trim()
  if (!value) return false
  if (value.includes("\0")) return false
  if (value === "/" || value === "\\") return false
  if (value.length > 4096) return false

  const abs = value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")
  if (!abs) return false

  if (/^[A-Za-z]:[\\/]?$/.test(value)) return false
  if (value.includes("/..") || value.includes("\\..")) return false
  if (value.includes("/./") || value.includes("\\.\\")) return false

  return true
}
