import { Installation } from "@/installation"
import { Storage } from "@/storage/storage"
import { config } from "@/../../console/app/src/config"

const REPO = config.github.repoUrl.replace("https://github.com/", "")
const CACHE_DURATION = 60 * 60 * 1000 // 1 hour

async function getFromCache(version: string): Promise<string | null> {
  try {
    const cached = await Storage.read<{ notes: string; fetchedAt: number }>(["release_notes", version])
    if (cached && Date.now() - cached.fetchedAt < CACHE_DURATION) {
      return cached.notes
    }
    return null
  } catch {
    return null
  }
}

async function saveToCache(version: string, notes: string) {
  await Storage.write(["release_notes", version], { notes, fetchedAt: Date.now() })
}

export async function getReleaseNotes(version?: string): Promise<string | null> {
  const targetVersion = version ?? Installation.VERSION

  const cached = await getFromCache(targetVersion)
  if (cached) return cached

  try {
    const tag =
      targetVersion === "local" ? "latest" : targetVersion.startsWith("v") ? targetVersion : `v${targetVersion}`
    const url =
      tag === "latest"
        ? `https://api.github.com/repos/${REPO}/releases/latest`
        : `https://api.github.com/repos/${REPO}/releases/tags/${tag}`

    const response = await fetch(url)
    if (!response.ok) return null

    const data = await response.json()
    const notes = data.body

    if (!notes || typeof notes !== "string") return null

    await saveToCache(targetVersion, notes)

    return notes
  } catch {
    return null
  }
}
