import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import type { Session } from "electron"
import { readManifest } from "./extensions"

/** The most a store package may download; the largest store extensions are a few tens of megabytes. */
const DOWNLOAD_BYTES = 128 * 1024 * 1024

/** How long a store download may take, inside the 120 seconds the window gives the whole install. */
const DOWNLOAD_MS = 90_000

/** Directories an install writes before it swaps them in, named so the next start can remove what a crash left. */
const STAGING = ".staging-"

/**
 * Downloads a store package through the profile's session, so it takes the system's proxy as pages do. Undefined when
 * the store does not answer, answers with an error, takes longer than `DOWNLOAD_MS` or sends more than
 * `DOWNLOAD_BYTES`.
 */
export async function download(session: Session, url: string) {
  const response = await session.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) }).catch(() => undefined)

  if (!response?.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > DOWNLOAD_BYTES)
    return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  const state = { total: 0, done: false }

  while (!state.done) {
    const next = await reader.read().catch(() => undefined)

    if (!next) return undefined
    state.done = next.done
    state.total += next.value?.byteLength ?? 0

    if (state.total > DOWNLOAD_BYTES) {
      await reader.cancel().catch(() => undefined)

      return undefined
    }

    if (next.value) chunks.push(next.value)
  }

  return Buffer.concat(chunks)
}

/**
 * Writes a new copy of an extension into a staging directory inside `directory`, through `fill`. Returns the staging
 * directory once it holds an extension manifest; on any failure removes it and returns undefined.
 */
export async function stageExtension(directory: string, fill: (staging: string) => Promise<boolean>) {
  await mkdir(directory, { recursive: true })
  const staging = await mkdtemp(path.join(directory, STAGING))

  if ((await fill(staging).catch(() => false)) && (await readManifest(staging))) return staging
  await rm(staging, { recursive: true, force: true }).catch(() => undefined)

  return undefined
}

/**
 * Moves `staging` to `folder`, keeping the copy that was there as `backup` until the caller removes it or puts it
 * back. Undefined when either move failed, with the previous copy back at `folder`.
 */
export async function swapIn(staging: string, folder: string) {
  const backup = `${staging}-previous`

  const moved = await rename(folder, backup).then(
    () => true,
    (cause: NodeJS.ErrnoException) => (cause.code === "ENOENT" ? false : undefined),
  )

  if (moved === undefined) return undefined

  if (await rename(staging, folder).then(() => true, () => false)) return { backup: moved ? backup : undefined }

  if (moved) await rename(backup, folder).catch(() => undefined)

  return undefined
}

/** Removes the staging directories an install left behind when the app stopped during it. */
export async function clearStaging(directory: string) {
  const entries = await readdir(directory).catch(() => [])

  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(STAGING))
      .map((entry) => rm(path.join(directory, entry), { recursive: true, force: true }).catch(() => undefined)),
  )
}
