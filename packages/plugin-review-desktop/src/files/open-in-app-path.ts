export function resolveOpenInAppPath(root: string, path: string) {
  if (!path) return root
  const windowsRoot = root.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(root)
  if (path.startsWith("/") || (windowsRoot && path.startsWith("\\")) || /^[A-Za-z]:[\\/]/.test(path)) return path
  if (!root) return path

  const separator = root.includes("\\") ? "\\" : "/"
  const relative = windowsRoot ? path.replace(/^[\\/]+/, "") : path
  return `${root.replace(/[\\/]+$/, "")}${separator}${windowsRoot ? relative.replaceAll(separator === "\\" ? "/" : "\\", separator) : relative}`
}

export function openInAppParentPath(path: string) {
  const value = path.replace(/[\\/]+$/, "")
  const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"))
  if (index < 0) return path
  if (index === 0) return value.slice(0, 1)
  if (index === 2 && /^[A-Za-z]:/.test(value)) return value.slice(0, 3)
  return value.slice(0, index)
}
