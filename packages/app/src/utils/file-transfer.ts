import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

/**
 * Maximum accepted size for a single uploaded file, in bytes.
 * Keep in sync with `MaxUploadBytes` in `packages/protocol/src/groups/fs.ts`,
 * which the server enforces too.
 */
export const MaxUploadBytes = 2 * 1024 * 1024 * 1024

/**
 * XHR timeout for uploads. A fixed value would kill large uploads on slow
 * connections, so it scales with the file size: 60 s baseline plus one second
 * per MiB, capped to avoid absurdly long waits for multi-GB files.
 */
function uploadTimeoutMs(bytes: number) {
  return Math.min(60 * 60_000, 60_000 + Math.ceil(bytes / (1024 * 1024)) * 1_000)
}

export class UploadTooLargeError extends Error {
  constructor() {
    super(`File exceeds the maximum upload size of ${MaxUploadBytes} bytes`)
    this.name = "UploadTooLargeError"
  }
}

function baseUrl(url: string) {
  return url.replace(/\/+$/, "")
}

function locationQuery(directory: string, path: string) {
  const params = new URLSearchParams({ path, "location[directory]": directory })
  return params.toString()
}

export function fsAuthHeaders(server: ServerConnection.Any | undefined): Record<string, string> {
  const http = server?.http
  if (!http?.password) return {}
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`,
  }
}

export async function uploadFile(input: {
  url: string
  directory: string
  headers: Record<string, string>
  path: string
  file: File
  /** Upload progress in the range [0, 1]. Only called for computable uploads. */
  onProgress?: (progress: number) => void
}) {
  if (input.file.size > MaxUploadBytes) throw new UploadTooLargeError()
  // Multipart form-data: the browser streams the file body instead of loading
  // it into memory (no base64 expansion), and the server enforces the same
  // `MaxUploadBytes` limit while reading the stream.
  //
  // XMLHttpRequest is used (not fetch) because fetch does not expose upload
  // progress; XHR's `upload.onprogress` reports how many bytes have been sent.
  const form = new FormData()
  form.append("file", input.file)
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${baseUrl(input.url)}/api/fs/upload?${locationQuery(input.directory, input.path)}`)
    for (const [key, value] of Object.entries(input.headers)) xhr.setRequestHeader(key, value)
    // The browser sets the multipart boundary automatically; do not set a
    // Content-Type header here.
    // Fail rather than hang so the progress UI never gets stuck. Scales with
    // the file size so 2 GB uploads on slow links have enough time.
    xhr.timeout = uploadTimeoutMs(input.file.size)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0 && input.onProgress) input.onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(xhr.responseText || xhr.statusText))
    }
    xhr.onerror = () => reject(new Error("Network error"))
    xhr.ontimeout = () => reject(new Error("Upload timed out"))
    xhr.onabort = () => reject(new Error("Upload aborted"))
    xhr.send(form)
  })
}

export async function deleteFile(input: {
  url: string
  directory: string
  headers: Record<string, string>
  path: string
}) {
  const res = await fetch(`${baseUrl(input.url)}/api/fs/delete?${locationQuery(input.directory, input.path)}`, {
    method: "POST",
    headers: input.headers,
  })
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
}

export async function downloadFile(input: {
  url: string
  directory: string
  headers: Record<string, string>
  path: string
}) {
  const encodedPath = input.path.split("/").map(encodeURIComponent).join("/")
  const query = new URLSearchParams({ "location[directory]": input.directory }).toString()
  const res = await fetch(`${baseUrl(input.url)}/api/fs/download/${encodedPath}?${query}`, {
    headers: input.headers,
  })
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  const blob = await res.blob()
  const objectURL = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectURL
  anchor.download = input.path.split("/").pop() ?? "download"
  // Some browsers only start the download for anchors attached to the DOM.
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Revoke well after the click so slow downloads are not cut off.
  setTimeout(() => URL.revokeObjectURL(objectURL), 60_000)
}
