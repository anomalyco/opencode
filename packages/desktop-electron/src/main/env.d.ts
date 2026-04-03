interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "electron-context-menu" {
  import type { BrowserWindow, BrowserView, ContextMenuParams, MenuItemConstructorOptions, Event as ElectronEvent, WebContents, WebContentsView } from "electron"
  export interface Labels {
    learnSpelling?: string
    lookUpSelection?: string
    searchWithGoogle?: string
    cut?: string
    copy?: string
    copyImage?: string
    copyImageAddress?: string
    paste?: string
    saveLinkAs?: string
    saveImage?: string
    saveImageAs?: string
    saveVideo?: string
    saveVideoAs?: string
    copyLink?: string
    copyVideoAddress?: string
    inspect?: string
    services?: string
  }
  export interface Options {
    window?: BrowserWindow | BrowserView | WebContents | WebContentsView | { webContents: WebContents }
    prepend?: (defaultActions: any, parameters: ContextMenuParams, browserWindow: BrowserWindow | WebContents) => MenuItemConstructorOptions[]
    append?: (defaultActions: any, parameters: ContextMenuParams, browserWindow: BrowserWindow | WebContents) => MenuItemConstructorOptions[]
    showLookUpSelection?: boolean
    showSearchWithGoogle?: boolean
    showCopyImage?: boolean
    showCopyImageAddress?: boolean
    showSaveImageAs?: boolean
    showCopyVideoAddress?: boolean
    showSaveVideoAs?: boolean
    showSaveLinkAs?: boolean
    showInspectElement?: boolean
    showLearnSpelling?: boolean
    showSelectAll?: boolean
    showServices?: boolean
    labels?: Labels
    shouldShowMenu?: (event: ElectronEvent, parameter: ContextMenuParams) => boolean
    menu?: (defaultActions: any, parameters: ContextMenuParams, browserWindow: BrowserWindow | WebContents) => MenuItemConstructorOptions[]
    onClose?: () => void
  }
  export default function contextMenu(options?: Options): { dispose(): void }
}
