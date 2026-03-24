function normalizePathname(pathname: string): string {
  if (pathname.startsWith("/") && /^[A-Za-z]:/.test(pathname.slice(1))) {
    return pathname.slice(1)
  }

  return pathname
}

export function fileURLToPath(input: string | URL): string {
  const url = input instanceof URL ? input : new URL(input)
  if (url.protocol !== "file:") {
    throw new TypeError(`Expected file URL, received ${url.protocol}`)
  }
  return decodeURIComponent(normalizePathname(url.pathname))
}

export function pathToFileURL(path: string): URL {
  const normalized = path.startsWith("/") ? path : `/${path}`
  const segments = normalized.split("/").map((segment, index) => {
    if (index === 0) return ""
    return encodeURIComponent(segment).replace(/%3A/gi, ":")
  })
  return new URL(`file://${segments.join("/")}`)
}

function stripANSI(input: string): string {
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

function stringWidth(input: string): number {
  return Array.from(stripANSI(input)).length
}

async function stdinText(): Promise<string> {
  return ""
}

function unsupportedServe(): never {
  throw new Error("Bun.serve is unavailable in browser mode")
}

function unsupportedTemplateTag(): never {
  throw new Error("Bun.$ is unavailable in browser mode")
}

const BunShim = {
  fileURLToPath,
  pathToFileURL,
  serve: unsupportedServe,
  stdin: {
    text: stdinText,
  },
  stringWidth,
  stripANSI,
  $: unsupportedTemplateTag,
  version: "browser",
}

if (typeof globalThis.Bun === "undefined") {
  Object.defineProperty(globalThis, "Bun", {
    value: BunShim,
    writable: true,
    configurable: true,
  })
}

export const serve = unsupportedServe
export const stdin = BunShim.stdin
export { stringWidth, stripANSI }
export const $ = unsupportedTemplateTag
export const version = BunShim.version

export default BunShim
