import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import type { Session } from "electron"
import { readManifest, storeDownloadURL } from "./extensions"

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
export async function download(session: Session, target: { id: string; store: "chrome" | "edge" }) {
  const { net } = await import("electron")
  const signal = AbortSignal.timeout(DOWNLOAD_MS)
  let url = storeDownloadURL(target, process.versions.chrome ?? "140.0.0.0")

  for (let hop = 0; hop < 6 && !signal.aborted; hop++) {
    // Electron's fetch does not expose a manual redirect response. net.request exposes the target BEFORE following.
    const next = await new Promise<string | Buffer | undefined>((resolve) => {
      const request = net.request({ session, url, redirect: "manual", credentials: "omit" })

      const finish = (value: string | Buffer | undefined) => {
        signal.removeEventListener("abort", stop)
        resolve(value)
      }

      const stop = () => {
        finish(undefined)
        request.abort()
      }

      signal.addEventListener("abort", stop, { once: true })
      request.once("error", stop)
      request.once("redirect", (_status, _method, location) => {
        finish(storeRedirect(target.store, location))
        request.abort()
      })
      request.once("response", (response) => {
        if (response.statusCode !== 200 || Number(response.headers["content-length"]) > DOWNLOAD_BYTES) return stop()
        const chunks: Buffer[] = []
        let size = 0
        response.once("error", stop)
        response.on("data", (chunk: Buffer) => {
          size += chunk.length

          if (size > DOWNLOAD_BYTES) return stop()
          chunks.push(chunk)
        })
        response.once("end", () => finish(Buffer.concat(chunks)))
      })
      request.end()
    })

    if (next === undefined || Buffer.isBuffer(next)) return next
    url = next
  }
}

export function storeRedirect(store: "chrome" | "edge", location: string) {
  const url = URL.parse(location)

  if (!url || url.username || url.password || url.port) return

  if (store === "chrome") {
    if (url.protocol === "https:" && ["clients2.google.com", "clients2.googleusercontent.com"].includes(url.hostname)) return url.href

    return
  }

  // Microsoft publishes separate HTTP (f/b) and TLS (sf/sb) hosts for the same delivery path.
  if (url.protocol === "http:" && /^msedgeextensions\.[fb]\.(tlu\.)?dl\.delivery\.mp\.microsoft\.com$/.test(url.hostname)) {
    url.protocol = "https:"
    url.hostname = url.hostname.replace("msedgeextensions.", "msedgeextensions.s")
  }

  if (url.protocol === "https:" && (url.hostname === "edge.microsoft.com" || /^msedgeextensions\.s[fb]\.(tlu\.)?dl\.delivery\.mp\.microsoft\.com$/.test(url.hostname))) return url.href
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
