export function normalizeWorktreePath(directory: string) {
  const normalized = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!/^[a-z]:\//i.test(normalized)) return normalized
  return normalized[0]!.toLowerCase() + normalized.slice(1)
}

export function sameWorktreePath(a: string, b: string) {
  return normalizeWorktreePath(a) === normalizeWorktreePath(b)
}
