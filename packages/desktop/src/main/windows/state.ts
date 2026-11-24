export const destroyedWindowURL = "<destroyed>"

type WebContentsURLState = {
  isDestroyed(): boolean
  getURL(): string
}

type WindowURLState = {
  isDestroyed(): boolean
  readonly webContents: WebContentsURLState
}

export function safeWebContentsURL(webContents: WebContentsURLState) {
  try {
    if (webContents.isDestroyed()) return destroyedWindowURL

    return webContents.getURL()
  } catch {
    return destroyedWindowURL
  }
}

/**
 * What the log may say of a page that is not the app's own, such as one of a plugin's views: a web address's scheme,
 * host and port, and only the scheme of any other. Never a path, a query or a fragment.
 */
export function safeWebContentsOrigin(webContents: WebContentsURLState) {
  const url = URL.parse(safeWebContentsURL(webContents))

  if (!url) return destroyedWindowURL

  return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol
}

export function safeWindowURL(win: WindowURLState) {
  try {
    if (win.isDestroyed()) return destroyedWindowURL

    return safeWebContentsURL(win.webContents)
  } catch {
    return destroyedWindowURL
  }
}
