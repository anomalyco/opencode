import { iconNames, type IconName } from "@opencode/ui/icons/provider"

// Lab ids and display names map to @opencode/ui provider icon ids. ProviderIcon falls back to the generic
// "synthetic" icon for ids without one.
export function providerIconId(lab: string) {
  const id = lab.toLowerCase().replace(/[^a-z0-9]+/g, "")
  return aliases[id] ?? id
}

export function hasProviderIcon(lab: string) {
  return iconNames.includes(providerIconId(lab) as IconName)
}

const aliases: Record<string, string> = {
  moonshot: "moonshotai",
  qwen: "alibaba",
  zhipu: "zhipuai",
}
