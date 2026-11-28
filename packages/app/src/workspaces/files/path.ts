import { encodeFilePath } from "@opencode/util/path"

const wslPath = /^\/\/wsl(?:\.localhost|\$|%24)\//i

const isWindowsPath = (path: string) => /^[A-Za-z]:/.test(path) || path.startsWith("\\\\") || wslPath.test(path)

export function toFileUri(path: string, directory: string) {
  const encoded = encodeFilePath(path)
  // A double leading slash can also be part of a POSIX path.
  const windows = path.startsWith("\\\\") || isWindowsPath(directory || path)

  return windows && /^\/\/[^/]+\/[^/]/.test(encoded) ? `file:${encoded}` : `file://${encoded}`
}

export function stripFileProtocol(input: string, directory = "") {
  if (!input.startsWith("file://")) return input

  const path = input.slice("file://".length)

  // A UNC authority belongs to the path. Legacy file://C:/... values already have a drive prefix.
  if (!/^[^/:\\]+\/[^/]/.test(path)) return path

  const unc = `//${path}`

  return (directory ? isWindowsPath(directory) : wslPath.test(unc)) ? unc : path
}

export function stripQueryAndHash(input: string) {
  const hashIndex = input.indexOf("#")
  const queryIndex = input.indexOf("?")

  if (hashIndex !== -1 && queryIndex !== -1) {
    return input.slice(0, Math.min(hashIndex, queryIndex))
  }

  if (hashIndex !== -1) return input.slice(0, hashIndex)

  if (queryIndex !== -1) return input.slice(0, queryIndex)

  return input
}

export function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input

  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!

    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]

    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)

      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }

      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return new TextDecoder().decode(new Uint8Array(bytes))
}

export function decodeFilePath(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export function createPathHelpers(scope: () => string, home: () => string = () => "") {
  const normalize = (input: string) => {
    const root = scope()

    // file:///C:/dir becomes /C:/dir once the protocol is gone; restore the drive form.
    let path = unquoteGitPath(decodeFilePath(stripQueryAndHash(stripFileProtocol(input, root)))).replace(
      /^[/\\]([A-Za-z]:)/,
      "$1",
    )

    // `~` names the server's home folder, as it does in the paths agents write.
    if (home() && /^~(?:[/\\]|$)/.test(path)) path = home().replace(/[/\\]+$/, "") + path.slice(1)

    // Separator-agnostic prefix stripping for Cygwin/native Windows compatibility
    // Only case-insensitive on Windows (drive letter or UNC paths)
    const windows = isWindowsPath(root)
    const canonRoot = windows ? root.replace(/\\/g, "/").toLowerCase() : root.replace(/\\/g, "/")
    const canonPath = windows ? path.replace(/\\/g, "/").toLowerCase() : path.replace(/\\/g, "/")

    if (
      canonPath.startsWith(canonRoot) &&
      (canonRoot.endsWith("/") || canonPath === canonRoot || canonPath[canonRoot.length] === "/")
    ) {
      // Slice from original path to preserve native separators, then drop the separator itself.
      path = path.slice(root.length).replace(/^[/\\]/, "")
    }

    if (path.startsWith("./") || path.startsWith(".\\")) {
      path = path.slice(2)
    }

    // An absolute path that is not under the root stays absolute; it is a file outside the workspace.
    return path
  }

  /** Whether a normalized path points outside the workspace root. */
  const absolute = (path: string) =>
    path.startsWith("skill://") || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("/") || path.startsWith("\\\\")

  const normalizeDir = (input: string) => {
    const path = normalize(input)
    const root = scope()
    const windows = isWindowsPath(root)

    return (windows ? path.replace(/\\/g, "/") : path).replace(/\/+$/, "")
  }

  return {
    normalize,
    absolute,
    normalizeDir,
  }
}
