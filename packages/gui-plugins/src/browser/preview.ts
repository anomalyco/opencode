import { previewScheme } from "../schemes"
import { fileURLWithin, localFileURL } from "./policy"

/** A file: address is for display and restore only. Never hand Chromium a native file origin, even briefly. */
export function previewAddress(address: string, host: string | undefined, roots: readonly string[]) {
  const file = localFileURL(address)

  if (!file || !host || !fileURLWithin(file, roots)) return

  return `${previewScheme}://${host}${file.slice("file://".length)}`
}

export function previewFile(address: string, host: string | undefined) {
  const prefix = `${previewScheme}://${host}/`

  if (!host || !address.startsWith(prefix) || address.startsWith(`${prefix}/`)) return

  return `file:///${address.slice(prefix.length)}`
}

/** The browser may open a preview; only that preview's origin may request its resources, including from a worker. */
export function previewResource(address: string, host: string, initiator: string | undefined, roots: readonly string[]) {
  if (initiator !== undefined && initiator !== `${previewScheme}://${host}`) return
  const file = previewFile(address, host)

  return file && fileURLWithin(file, roots) ? file : undefined
}
