export function avatarLabel(name: string) {
  if (!name) return ""
  return name.length >= 2 ? name.slice(-2) : name
}
