import { previewScheme } from "../schemes"
import { fileURLWithin, localFileURL } from "./policy"

/** A file: address is for display and restore only. Never hand Chromium a native file origin, even briefly. */
export function previewAddress(address: string, host: string | undefined, roots: readonly string[]) {
  const file = localFileURL(address)

  if (!file || !host || !fileURLWithin(file, roots)) return

  return `${previewScheme}://${host}${file.slice("file://".length)}`
}

export function previewFile(address: string, host: string | undefined, roots: readonly string[]) {
  const prefix = `${previewScheme}://${host}/`

  if (!host || !address.startsWith(prefix) || address.startsWith(`${prefix}/`) || address.split(/[?#]/, 1)[0]?.includes("\\")) return

  const file = `file:///${address.slice(prefix.length)}`

  return fileURLWithin(file, roots) ? file : undefined
}

/** The browser may open a preview; only that preview's origin may request its resources, including from a worker. */
export function previewResource(address: string, host: string, initiator: string | undefined, roots: readonly string[]) {
  if (initiator !== undefined && initiator !== `${previewScheme}://${host}`) return

  return previewFile(address, host, roots)
}
