import { getAvatarColors, type AvatarColorKey } from "@/context/layout"

const keys = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const satisfies readonly AvatarColorKey[]

export function actorColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i) * (i + 1)) | 0
  return getAvatarColors(keys[Math.abs(hash) % keys.length])
}
