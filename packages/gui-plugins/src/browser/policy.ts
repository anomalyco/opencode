// URL policy shared by the pane and page. Electron-free so it stays unit-testable under Bun.

export function destinationOrigin(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)

  return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined
}

/** A file URL for this machine: no host, so UNC shares and remote hosts are rejected. */
export function localFileURL(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)

  return url.protocol === "file:" && !url.hostname ? url.href : undefined
}

/** Case-insensitive on Windows, where drive letters and paths compare that way. */
function canonicalPath(input: string) {
  const value = decodeURIComponent(input)
    .replaceAll("\\", "/")
    .replace(/^\/([A-Za-z]:\/)/, "$1")

  return process.platform === "win32" ? value.toLowerCase() : value
}

/**
 * Whether a file URL points inside one of the allowed directories. The agent already has read
 * access to the session's workspace, so files there may be shown; anything else stays behind the
 * server's file permissions.
 */
export function fileURLWithin(input: string, roots: ReadonlyArray<string>) {
  const href = localFileURL(input)

  if (!href || roots.length === 0) return false
  const path = canonicalPath(new URL(href).pathname)

  return roots.some((root) => {
    const prefix = canonicalPath(root).replace(/\/+$/, "")

    return path === prefix || path.startsWith(`${prefix}/`)
  })
}

/** A page of one of the loaded extensions, such as its popup or options page. */
export function extensionURL(input: string, extensions: ReadonlyArray<string>) {
  if (!URL.canParse(input)) return false
  const url = new URL(input)

  return url.protocol === "chrome-extension:" && extensions.includes(url.hostname)
}

/**
 * Whether a URL or origin belongs to an extension: its pages, frames and the blob: URLs it makes. Such a document runs
 * with the extension's `chrome.*` access, which the agent must never gain.
 */
export function extensionOrigin(input: string) {
  if (!URL.canParse(input)) return false
  const url = new URL(input)

  const protocol =
    url.protocol === "blob:" && URL.canParse(url.pathname) ? new URL(url.pathname).protocol : url.protocol

  return /^(?:chrome|moz|safari-web|ms-browser)-extension:$|^extension:$/.test(protocol)
}

/** Actions that only take a tab away from its document, which the agent may run on an extension page to leave it. */
const leaving = ["navigate", "back", "forward", "stop"]

/**
 * Why the agent may not run `action` in a tab whose main frame shows `page`, or undefined when it may. The agent never
 * opens an extension page, and never reads or acts on one, even one the user opened: evaluating there would run with
 * the extension's privileges. The user's own commands do not pass through here.
 */
export function agentRefusal(
  action: { readonly type: string; readonly url?: string },
  page: { readonly url: string; readonly origin: string },
) {
  if ((action.type === "navigate" || action.type === "tabs.open") && action.url && extensionOrigin(action.url.trim()))
    return `Agent browser tools cannot open extension pages such as ${action.url.trim()}: an extension page runs with that extension's privileges. Ask the user to open it from the extensions menu.`

  if (leaving.includes(action.type) || (!extensionOrigin(page.url) && !extensionOrigin(page.origin))) return

  return `This tab shows an extension page (${page.url}). Agent browser tools cannot read or act on extension pages, because they run with that extension's privileges. Navigate this tab to a web page, or use another tab.`
}

type FrameTree = {
  readonly frame: {
    readonly id: string
    readonly parentId?: string
    readonly url: string
    readonly name?: string
    readonly securityOrigin?: string
  }
  readonly childFrames?: ReadonlyArray<FrameTree>
}

/**
 * The tab's frames the agent may see and target: the main frame's tree, then each out-of-process frame's under its
 * parent. A frame of an extension, such as a password manager's autofill overlay, is left out with every frame inside
 * it, so the page around it stays usable while no frameID, ref or snapshot reaches into it.
 */
export function agentFrames(
  root: FrameTree,
  children: ReadonlyArray<{ readonly parentID: string; readonly tree: FrameTree }>,
) {
  const result: { id: string; parentID?: string; url: string; name: string }[] = []

  const walk = (tree: FrameTree, parentID?: string) => {
    if (result.some((frame) => frame.id === tree.frame.id)) return
    const parent = tree.frame.parentId || parentID

    if (parent && (extensionOrigin(tree.frame.url) || extensionOrigin(tree.frame.securityOrigin ?? ""))) return

    if (parent && !result.some((frame) => frame.id === parent)) return

    result.push(
      parent
        ? { id: tree.frame.id, parentID: parent, url: tree.frame.url, name: tree.frame.name ?? "" }
        : { id: tree.frame.id, url: tree.frame.url, name: tree.frame.name ?? "" },
    )
    tree.childFrames?.forEach((child) => walk(child, tree.frame.id))
  }

  walk(root)
  // A frame nested in another out-of-process frame joins once its parent has; one under a left-out frame never does.
  const pending = [...children]

  while (pending.length) {
    const ready = pending.findIndex((child) => result.some((frame) => frame.id === child.parentID))

    if (ready < 0) break
    const [child] = pending.splice(ready, 1)
    walk(child.tree, child.parentID)
  }

  return result
}

export type AgentFrameAccess =
  | { type: "frame"; frame: ReturnType<typeof agentFrames>[number] }
  | { type: "extension"; message: string }
  | { type: "unavailable"; message: string }

/**
 * The frame an agent's `frameID` names, when the agent may use it. A frame that shows an extension's document, or
 * sits inside one, is refused by name, so a call never quietly runs elsewhere. `extensions` lists the frames known to
 * show one that the trees cannot: an extension's out-of-process frame, whose tree is never read, and a frame whose
 * document has an extension's origin.
 */
export function agentFrame(
  root: FrameTree,
  children: ReadonlyArray<{ readonly parentID: string; readonly tree: FrameTree }>,
  extensions: ReadonlySet<string>,
  frameID: string,
): AgentFrameAccess {
  const frame = agentFrames(root, children).find((item) => item.id === frameID)
  // Each frame the trees name, with its parent, whether the agent sees it or not.
  const known = new Map<string, { parentID?: string; extension: boolean }>()

  const walk = (tree: FrameTree, parentID?: string) => {
    known.set(tree.frame.id, {
      parentID: tree.frame.parentId || parentID,
      extension: extensionOrigin(tree.frame.url) || extensionOrigin(tree.frame.securityOrigin ?? ""),
    })
    tree.childFrames?.forEach((child) => walk(child, tree.frame.id))
  }

  walk(root)
  children.forEach((child) => walk(child.tree, child.parentID))

  if (frame && !extensions.has(frameID)) return { type: "frame", frame }

  for (let id: string | undefined = frameID; id; id = known.get(id)?.parentID)
    if (extensions.has(id) || known.get(id)?.extension)
      return {
        type: "extension",
        message: `Agent browser tools cannot use extension frames: frame ${frameID} shows an extension's document, which runs with that extension's privileges. Omit frameID to use the page around it, or use another frame from browser.frames({tabID}).`,
      }

  return {
    type: "unavailable",
    message:
      "Frame is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab; omit frameID for the main frame.",
  }
}

export type Policy = { readonly fileRoots?: ReadonlyArray<string>; readonly extensions?: ReadonlyArray<string> }

export function allowedDestination(input: string, policy?: Policy) {
  return (
    !!destinationOrigin(input) ||
    fileURLWithin(input, policy?.fileRoots ?? []) ||
    extensionURL(input, policy?.extensions ?? [])
  )
}

export function normalizeURL(input: string, policy?: Policy) {
  const url = withScheme(input)
  const reason = refusal(url, policy)

  if (reason === "browser.address.credentials")
    throw new Error("URLs with a user name or password are not supported. Remove them from the URL.")

  if (reason)
    throw new Error(
      policy?.fileRoots?.length
        ? "Only HTTP, HTTPS, about:blank, and file URLs inside the workspace are supported."
        : "Only HTTP, HTTPS, and about:blank URLs are supported.",
    )

  return url
}

/**
 * Why the pane does not open an address, as the code the window explains it with; undefined when it opens.
 * - `browser.address.credentials`: a web page address with a user name or password.
 * - `browser.address.workspace`: anything but a web page or a file in the workspace.
 * - `browser.address.web`: anything but a web page, where no files open.
 */
export function refusal(input: string, policy?: Policy) {
  const url = withScheme(input)

  if (url === "about:blank" || allowedDestination(url, policy)) return

  // A web page is refused only for its credentials.
  if (URL.canParse(url) && /^https?:$/.test(new URL(url).protocol)) return "browser.address.credentials"

  return policy?.fileRoots?.length ? "browser.address.workspace" : "browser.address.web"
}

// The URL an address opens: a blank page for none, else the address with a scheme, `http` for this machine's names.
function withScheme(input: string) {
  const value = input.trim()

  if (!value || /^about:blank$/i.test(value)) return "about:blank"

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value
  const local = /^(?:(?:[a-z\d-]+\.)*localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)

  return `${local ? "http" : "https"}://${value}`
}

/**
 * Electron rejects `loadURL` with ERR_FAILED (-2) whenever loading stops before `did-finish-load`. Chromium's media
 * viewer for a video or audio URL commits its document and stops that way, so a committed navigation has loaded. A
 * download never commits, so it still fails.
 */
export function committedLoad(error: Error, committed: boolean) {
  return committed && "errno" in error && error.errno === -2
}
