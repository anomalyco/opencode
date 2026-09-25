import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { WslServersPlatform } from "@opencode-ai/app/wsl/types"
import type { UpdaterState } from "@opencode-ai/app/updater"
import type { DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"
export type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "@opencode-ai/app/wsl/types"

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type WslServersAPI = WslServersPlatform
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
  scheme?: "system" | "light" | "dark"
}
export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

export type AppDockEvent =
  | {
      type: "state"
      payload: {
        tabID: string
        generation: number
        url: string
        title: string
        favicon?: string
        loading: boolean
        audible: boolean
      }
    }
  | { type: "tab-opened"; payload: { tabID: string; generation: number; url: string } }
  | { type: "tab-selected"; payload: { tabID: string; generation: number } }
  | {
      type: "tab-crashed"
      payload: { identity: { tabID: string; generation: number }; reason: "crashed" | "killed" | "oom" }
    }
  | { type: "tab-recovered"; payload: { tabID: string; generation: number; url: string } }
  | {
      type: "download"
      payload: {
        id: string
        tabID: string
        generation: number
        filename: string
        receivedBytes: number
        totalBytes: number
        state: "progressing" | "paused" | "completed" | "cancelled" | "interrupted"
      }
    }
  | {
      type: "permission"
      payload: { identity: { tabID: string; generation: number }; permission: string; state: "denied" }
    }
  | { type: "fullscreen"; payload: { identity: { tabID: string; generation: number }; enabled: boolean } }
  | {
      type: "navigation-error"
      payload: { identity: { tabID: string; generation: number }; code: "blocked" | "failed"; url: string }
    }

export type AppDockManifest = {
  version: 1
  revision: number
  profiles: { id: string; name: string }[]
  activeProfileID: string
  tabs: Record<string, { url: string; pinned: boolean }[]>
  bookmarks: string[]
  history: string[]
}

export type AppDockManifestUpdate = { status: "updated" | "conflict"; manifest: AppDockManifest }

export type ElectronAPI = {
  appDockOpen: (
    url: string,
    bounds: { x: number; y: number; width: number; height: number },
    profile?: string,
  ) => Promise<{ tabID: string; generation: number; url: string }>
  appDockList: () => Promise<Array<{ tabID: string; generation: number; url: string; active: boolean }>>
  appDockDeleteProfile: (profileID: string) => Promise<void>
  appDockResize: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
  appDockHide: () => Promise<void>
  appDockClose: () => Promise<void>
  appDockCloseTab: (tabID: string) => Promise<void>
  appDockRecoverTab: (tabID: string) => Promise<{ tabID: string; generation: number; url: string }>
  appDockCloseTabs: (tabID: string, scope: "others" | "right", order?: string[]) => Promise<void>
  appDockSelect: (tabID: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
  appDockNavigate: (tabID: string, url: string) => Promise<void>
  appDockCommand: (tabID: string, command: "back" | "forward" | "reload") => Promise<void>
  appDockEvent: (callback: (event: AppDockEvent) => void) => () => void
  appDockFind: (tabID: string, text: string, forward: boolean) => Promise<number>
  appDockStopFind: (tabID: string) => Promise<void>
  appDockFindResult: (
    callback: (result: {
      tabID: string
      generation: number
      requestID: number
      activeMatchOrdinal: number
      matches: number
      finalUpdate: boolean
    }) => void,
  ) => () => void
  appDockZoom: (tabID: string, factor?: number) => Promise<number>
  appDockCancelDownload: (downloadID: string) => Promise<void>
  appDockOpenDownload: (downloadID: string) => Promise<void>
  appDockFullscreen: (tabID: string, enabled: boolean) => Promise<void>
  appDockGetManifest: () => Promise<AppDockManifest>
  appDockUpdateManifest: (expectedRevision: number, manifest: AppDockManifest) => Promise<AppDockManifestUpdate>
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: () => Promise<ServerReadyData>
  wslServers: WslServersAPI
  updater: UpdaterAPI
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  isFirstLaunchOnboardingPending: () => Promise<boolean>
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null>
  isOldLayoutEligible: () => Promise<boolean>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  checkAppExists: (appName: string) => Promise<boolean>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>
  draftGet: (key: string) => Promise<string | null>
  draftSet: (key: string, value: string) => Promise<void>
  draftDelete: (key: string) => Promise<void>
  draftBlobPut: (data: ArrayBuffer) => Promise<string>
  draftBlobGet: (id: string) => Promise<ArrayBuffer | null>

  getWindowID: () => Promise<string>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
  }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
  readPickedFile: (token: string, path: string) => Promise<ArrayBuffer>
  releasePickedFiles: (token: string) => Promise<void>
  getPathForFile: (file: File) => string
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openExternal: (url: string) => void
  openLocalFile: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  revealPath: (path: string) => Promise<boolean>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  getWindowFocused: () => Promise<boolean>
  getWindowFullscreen: () => Promise<boolean>
  onWindowFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  setForceFocus: (enabled: boolean) => Promise<void>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
  setNativeTranslations: (bundle: DesktopNativeBundle) => Promise<void>
}
