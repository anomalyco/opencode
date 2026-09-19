const storeName = /^[a-zA-Z0-9._-]+$/

export function isStoreName(value: string) {
  if (value.length === 0 || value.length > 255) return false
  if (value === "." || value === "..") return false
  return storeName.test(value)
}
