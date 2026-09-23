import { extname } from "node:path"
import { fileURLToPath } from "node:url"

// Extensions that the OS "open" verb treats as programs, scripts, installers or
// shell shortcuts rather than documents. `shell.openPath` resolves these through
// their registered handler, which for these types means launching code.
const EXECUTABLE_EXTENSIONS = new Set([
  // Windows executables, scripts and installers
  ".exe",
  ".com",
  ".pif",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".hta",
  ".scr",
  ".msi",
  ".msp",
  ".mst",
  ".cpl",
  ".msc",
  ".reg",
  ".lnk",
  ".url",
  ".appx",
  ".msix",
  ".appxbundle",
  ".msixbundle",
  // macOS / Linux executables and installers
  ".app",
  ".command",
  ".tool",
  ".pkg",
  ".mpkg",
  ".dmg",
  ".run",
  ".desktop",
  // Archive/interop formats that commonly resolve to installers
  ".jar",
  ".apk",
])

export function resolveExternalURL(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") return url.href
  return undefined
}

export function resolveLocalFilePath(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== "file:" || url.hostname) return undefined
  try {
    const path = fileURLToPath(url)
    if (isExecutablePath(path)) return undefined
    return path
  } catch {
    return undefined
  }
}

// Terminal output is untrusted: a program can emit an OSC 8 hyperlink whose URI
// is a local executable while the visible text says something harmless. Opening
// such a URI with the OS default handler (shell.openPath) launches the program,
// so refuse anything that would execute rather than open as a document.
function isExecutablePath(path: string) {
  // Every segment matters: an executable name is dangerous as the target itself
  // and paths inside bundles such as `My.app/Contents/MacOS/My` belong to an
  // application. Windows also ignores trailing dots and spaces in file names,
  // so trim them before inspecting extensions (`payload.exe ` must not pass).
  for (const segment of path.split(/[\\/]/)) {
    const extension = extname(segment.replace(/[ .]+$/g, "")).toLowerCase()
    if (EXECUTABLE_EXTENSIONS.has(extension)) return true
  }
  return false
}
