import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

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
}) {
  const buffer = await input.file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const res = await fetch(`${baseUrl(input.url)}/api/fs/upload?${locationQuery(input.directory, input.path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...input.headers },
    body: JSON.stringify({ content: btoa(binary) }),
  })
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
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
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
}
