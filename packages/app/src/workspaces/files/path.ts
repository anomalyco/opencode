export function stripFileProtocol(input: string) {
  if (!input.startsWith("file://")) return input

  return input.slice("file://".length)
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

export function createPathHelpers(scope: () => string) {
  const normalize = (input: string) => {
    const root = scope()

    // file:///C:/dir becomes /C:/dir once the protocol is gone; restore the drive form.
    let path = unquoteGitPath(decodeFilePath(stripQueryAndHash(stripFileProtocol(input)))).replace(
      /^[/\\]([A-Za-z]:)/,
      "$1",
    )

    // Separator-agnostic prefix stripping for Cygwin/native Windows compatibility
    // Only case-insensitive on Windows (drive letter or UNC paths)
    const windows = /^[A-Za-z]:/.test(root) || root.startsWith("\\\\")
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
  const absolute = (path: string) => /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("/") || path.startsWith("\\\\")

  const normalizeDir = (input: string) => {
    const path = normalize(input)
    const root = scope()
    const windows = /^[A-Za-z]:/.test(root) || root.startsWith("\\\\")

    return (windows ? path.replace(/\\/g, "/") : path).replace(/\/+$/, "")
  }

  return {
    normalize,
    absolute,
    normalizeDir,
  }
}
