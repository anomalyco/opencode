import { previewScheme } from "./scheme"
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

  return fileURLWithin(file, roots) && !new URL(file).pathname.endsWith("/") ? file : undefined
}

/** The browser may open a preview; only that preview's origin may request its resources, including from a worker. */
export function previewResource(address: string, host: string, initiator: string | undefined, roots: readonly string[]) {
  if (initiator !== undefined && initiator !== `${previewScheme}://${host}`) return

  return previewFile(address, host, roots)
}

/** A History API route without a corresponding file keeps the last validated address in the bar. Reload that file. */
export function reloadAddress(actual: string, shown: string, host: string | undefined, roots: readonly string[]) {
  if (!host || !actual.startsWith(`${previewScheme}://${host}/`)) return
  const destination = previewAddress(shown, host, roots)

  return destination && destination !== actual ? shown : undefined
}
