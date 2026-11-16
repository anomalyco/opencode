import { previewPath } from "@opencode/plugin-browser/preview-path"

/** A stable, session-scoped display address with the file tree's relative path, never the API endpoint. */
export function workspacePrefix(session: string) {
  return `workspace://${session.toLowerCase()}/`
}

/** Parse before URL normalization: reject alternate authorities, dot segments and encoded separators. */
export function remotePath(address: string, prefix: string, windows = false) {
  if (!address.startsWith(prefix)) return
  const encoded = address.slice(prefix.length).split(/[?#]/, 1)[0]

  if (!encoded || /%(?:2f|5c)/i.test(encoded)) return

  try {
    const path = decodeURIComponent(encoded)

    return previewPath(path, windows) ? path : undefined
  } catch {
    return undefined
  }
}
