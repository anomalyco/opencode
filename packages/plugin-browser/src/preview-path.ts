/** Remote preview requests use portable workspace-relative segments, never a server or OS address. */
export function previewPath(path: string, windows = false) {
  return !/^[a-z]:\//i.test(path) && path.split("/").every((part) => !!part && part !== "." && part !== ".." &&
    !/[\\\u0000-\u001f]/.test(part) && (!windows || windowsPreviewSegment(part)))
}

export function windowsPreviewSegment(part: string) {
  return !/[:\\]|[. ]$|^(?:con(?:in\$|out\$)?|nul|prn|aux|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
}

/** A stable, session-scoped display address with the file tree's relative path, never the API endpoint. */
export function workspacePrefix(session: string) {
  return `workspace://${session.toLowerCase()}/`
}

/** Parse before URL normalization: reject alternate authorities, dot segments and encoded separators. */
export function remotePath(address: string, prefix: string, windows = false) {
  // A scheme and a session ID read the same in any case, and `workspacePrefix` writes them in lower case.
  if (address.slice(0, prefix.length).toLowerCase() !== prefix) return
  const encoded = address.slice(prefix.length).split(/[?#]/, 1)[0]

  if (!encoded || /%(?:2f|5c)/i.test(encoded)) return

  try {
    const path = decodeURIComponent(encoded)

    return previewPath(path, windows) ? path : undefined
  } catch {
    return undefined
  }
}
