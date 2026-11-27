import { artworkNames } from "../catalog"
import { iconUsageByFile } from "./icon-usage.generated"

type ArtworkName = ReturnType<typeof artworkNames>[number]

export const iconSourceFiles = new Map<ArtworkName, string[]>()

for (const [file, icons] of Object.entries(iconUsageByFile)) {
  for (const icon of icons) {
    const files = iconSourceFiles.get(icon) ?? []

    files.push(file)
    iconSourceFiles.set(icon, files)
  }
}

export const unusedDesktopIcons = artworkNames()
  .filter((name) => !iconSourceFiles.has(name))
  .toSorted()
