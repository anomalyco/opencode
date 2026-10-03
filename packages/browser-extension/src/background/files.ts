// Captures and downloads a tab produced, for browser.files.* and the capture tools. Ported from
// packages/gui-extensions/src/browser/files.ts: the desktop keeps bytes in temp files, an extension
// keeps captures in memory and re-reads downloads from their URL, since it cannot read the disk.
import { Browser } from "@opencode/plugin-browser/rpc"

type Entry = {
  id: Browser.FileID
  name: string
  mime: string
  bytes: number
  state: "pending" | "completed" | "failed"
  resources: readonly string[]
  data?: Uint8Array
  /** Downloads: where to fetch the bytes again, and the chrome.downloads id. */
  download?: { id: number; url: string }
}

export type BrowserFiles = ReturnType<typeof createBrowserFiles>

export function createBrowserFiles(input: {
  source: () => readonly string[]
  /** Reads a blob: URL inside the page that created it; null when the page no longer has it. */
  readBlob: (url: string) => Promise<Uint8Array | null>
}) {
  const files = new Map<Browser.FileID, Entry>()
  const create = (name: string, mime: string, resources: readonly string[]): Entry => ({
    id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
    name: name.slice(0, 2_048),
    mime,
    bytes: 0,
    state: "pending",
    resources: [...new Set(resources)].sort(),
  })
  const get = (id: Browser.FileID) => {
    const file = files.get(id)
    if (!file)
      throw new Error(
        "File ID is not retained in this tab. Call browser.files.list({tabID}) and use an exact returned fileID from the same tab, not a server path or request ID.",
      )
    if (file.state === "pending")
      throw new Error(
        "File is still being downloaded or captured. Check browser.files.list({tabID}) again and wait for state completed; do not start a duplicate download.",
      )
    if (file.state === "failed")
      throw new Error(
        "The download or capture failed, so this file cannot be read. Inspect browser.console and browser.network.list for the cause before deciding to start it again.",
      )
    return file
  }
  return {
    list: () =>
      Array.from(files.values(), (file) => ({
        id: file.id,
        name: file.name,
        mime: file.mime,
        bytes: file.bytes,
        state: file.state,
      })),
    get,
    save(name: string, mime: string, data: Uint8Array, resources = input.source()) {
      if (data.byteLength > Browser.MAX_FILE_BYTES)
        throw new Error(
          "Capture exceeds the 5 MiB transfer limit. Reduce screenshot maxWidth/quality or trace duration; for a heap snapshot, use a smaller page/test case. Do not retry an identical capture.",
        )
      const file = { ...create(name, mime, resources), data, bytes: data.byteLength, state: "completed" as const }
      files.set(file.id, file)
      return file.id
    },
    /** A download the browser started from this tab. */
    download(item: chrome.downloads.DownloadItem) {
      const url = item.finalUrl || item.url
      const file = {
        ...create(item.filename.split(/[\\/]/).at(-1) || "download", item.mime || "application/octet-stream", [
          ...input.source(),
          url,
        ]),
        download: { id: item.id, url },
      }
      files.set(file.id, file)
    },
    downloadChanged(item: chrome.downloads.DownloadItem) {
      const file = Array.from(files.values()).find((entry) => entry.download?.id === item.id)
      if (!file) return
      file.bytes = item.bytesReceived
      if (item.filename) file.name = item.filename.split(/[\\/]/).at(-1) || file.name
      if (item.state === "complete") file.state = "completed"
      if (item.state === "interrupted") file.state = "failed"
    },
    async transfer(id: Browser.FileID, authorized?: readonly string[]): Promise<Browser.File> {
      const file = get(id)
      if (authorized && file.resources.some((url) => !authorized.includes(url)))
        throw new Error(
          "Capture source changed before export. Inspect the tab and request the file again to check its source permissions; no bytes were exported.",
        )
      if (file.bytes > Browser.MAX_FILE_BYTES)
        throw new Error(
          "File exceeds the 5 MiB transfer limit. Choose a smaller completed file; repeating browser.files.get for this file will not help.",
        )
      const data = file.data ?? (file.download ? await refetch(file.download.url) : undefined)
      if (!data)
        throw new Error(
          "The downloaded file's bytes are not reachable from the extension (it came from a page-only blob that no longer exists). It is in the user's Downloads folder; ask them, or download it again and fetch it promptly.",
        )
      if (data.byteLength > Browser.MAX_FILE_BYTES)
        throw new Error("File exceeds the 5 MiB transfer limit. Choose a smaller completed file.")
      return { id, name: file.name, mime: file.mime, data }
    },
    clear() {
      files.clear()
    },
  }

  async function refetch(url: string) {
    if (url.startsWith("blob:")) return (await input.readBlob(url)) ?? undefined
    // http(s) and data: URLs; the extension's host access sends the site's cookies like the original request.
    const response = await fetch(url, { credentials: "include" }).catch(() => undefined)
    if (!response?.ok) return undefined
    return new Uint8Array(await response.arrayBuffer())
  }
}

export async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function gunzip(data: Uint8Array, limit: number) {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip")).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error("Decompressed capture exceeds its analysis limit.")
    }
    chunks.push(part.value)
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer())
}
