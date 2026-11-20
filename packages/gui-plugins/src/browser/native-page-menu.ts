import { writeFile } from "node:fs/promises"
import electron, { type BrowserWindow, type WebContents } from "electron"
import type { Protocol } from "devtools-protocol"
import type { Cdp } from "./cdp"
import { externalAction } from "./address"
import { pageReports } from "./errors"
import { pageMenu, menuAddress, type MenuAction, type MenuPolicy } from "./page-menu"
import { workspaceFile } from "./workspace-file"
import type { HandlePath } from "./disk"
import { extensionResource } from "./profile/extension-api/resource"

export type PageMenuHost = {
  t: (key: string) => string
  extensions: (contents: number, params: Electron.ContextMenuParams) => Electron.MenuItemConstructorOptions[]
  navigate: (action: "back" | "forward" | "reload" | "hardReload") => Promise<void>
  open: (url: string) => Promise<void>
  /** The plugin instance's file verifier, for a workspace file the menu opens. */
  verifier: HandlePath
}

/** The only native menu on a pane view. Menu commands stay in main; the page supplies neither commands nor paths. */
export function attachPageMenu(
  win: BrowserWindow,
  contents: WebContents,
  input: PageMenuHost & {
    policy: MenuPolicy
    cdp: Cdp
    sessions: () => Iterable<string>
    available: () => boolean
    failed: () => void
    canOpenPage: () => boolean
    openPage: () => Promise<void>
    personCommand: () => void
  },
) {
  const session = contents.session
  let active: Electron.Menu | undefined

  const close = () => {
    active?.closePopup(win)
    active = undefined
  }

  const show = (_event: Electron.Event, params: Electron.ContextMenuParams) => {
    if (!input.available()) return
    const frame = params.frame
    const frameURL = params.frameURL || params.pageURL
    const policy = { ...input.policy, resource: (url: string) => extensionResource(url, frame?.origin ?? "", (id) => session.extensions.getExtension(id)) }

    const current = () =>
      !contents.isDestroyed() &&
      input.available() &&
      !!frame &&
      !frame.detached &&
      !frame.isDestroyed() &&
      frame.url === frameURL &&
      contents.getURL() === params.pageURL

    if (!current()) return
    close()

    const run = async (action: MenuAction) => {
      if (!current()) return
      input.personCommand()

      switch (action.type) {
        case "openPage":
          return input.openPage()
        case "back":
        case "forward":
        case "reload":
        case "hardReload":
          return input.navigate(action.type)
        case "cut":
          return contents.cut()
        case "copy":
          return contents.copy()
        case "paste":
          return contents.paste()
        case "pastePlain":
          return contents.pasteAndMatchStyle()
        case "selectAll":
          return contents.selectAll()
        case "copyImage":
          return contents.copyImageAt(params.x, params.y)
        case "replace":
          return contents.replaceMisspelling(action.value)
        case "dictionary":
          return void session.addWordToSpellCheckerDictionary(action.value)
        case "spellcheck":
          return session.setSpellCheckerEnabled(!session.isSpellCheckerEnabled())
        case "language": {
          const selected = session.getSpellCheckerLanguages()

          const next = selected.includes(action.value)
            ? selected.filter((tag) => tag !== action.value)
            : [...selected, action.value]

          if (next.length) session.setSpellCheckerLanguages(next)

          return
        }
      }

      const url = menuAddress(action.raw, frameURL, policy)

      if (!url) return input.failed()

      if (url.startsWith("file:") && !(await workspaceFile(input.verifier, url, input.policy.fileRoots ?? []))) return input.failed()

      if (!current()) return

      if (action.type === "address") return electron.clipboard.writeText(url)

      if (action.type === "external") {
        if (externalAction(url, input.policy.local) === "browser") await electron.shell.openExternal(url)

        return
      }

      if (action.type === "open") return input.open(url)
      // Do not fetch an arbitrary address with main's privileges. Save only image bytes already loaded by this frame.
      const pick = await electron.dialog.showSaveDialog(win, { title: input.t("menu.saveImage") })

      if (pick.canceled || !pick.filePath || !current()) return

      const find = (tree: Protocol.Page.FrameResourceTree): string | undefined =>
        tree.frame.url === frameURL && tree.resources.some((r) => r.url === action.raw && r.type === "Image")
          ? tree.frame.id
          : tree.childFrames?.map(find).find(Boolean)

      for (const id of [undefined, ...input.sessions()]) {
        const tree = await input.cdp.send("Page.getResourceTree", {}, id)
        const frameId = find(tree.frameTree)

        if (!current()) return

        if (!frameId) continue
        const bytes = await input.cdp.send("Page.getResourceContent", { frameId, url: action.raw }, id)

        if (current())
          await writeFile(pick.filePath, Buffer.from(bytes.content, bytes.base64Encoded ? "base64" : "utf8"))

        return
      }

      input.failed()
    }

    const template = pageMenu(params, {
      policy,
      openPage: input.canOpenPage(),
      t: input.t,
      back: contents.navigationHistory.canGoBack(),
      forward: contents.navigationHistory.canGoForward(),
      // A reload or a step back whose page fails to load is the page's to report, where the page would be.
      run: (action) =>
        void run(action).catch((error: Error) => {
          if (!pageReports(error)) input.failed()
        }),
      extensions: input.extensions(contents.id, params),
      spellcheck: session.isSpellCheckerEnabled(),
      languages: params.isEditable ? session.getSpellCheckerLanguages() : [],
      dictionaries: params.isEditable && process.platform !== "darwin" ? session.availableSpellCheckerLanguages : [],
    })

    const menu = electron.Menu.buildFromTemplate(template)
    active = menu
    menu.popup({
      window: win,
      callback: () => {
        if (active === menu) active = undefined
      },
    })
  }

  contents.on("context-menu", show)
  contents.on("did-start-navigation", close)

  return {
    close,
    dispose() {
      close()
      contents.off("context-menu", show)
      contents.off("did-start-navigation", close)
    },
  }
}
