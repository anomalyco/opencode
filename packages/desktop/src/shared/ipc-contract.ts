import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"
import type { UpdaterState } from "@opencode-ai/app/updater"
import type { WslServerConfig, WslServersEvent, WslServersState } from "@opencode-ai/app/wsl/types"

export const Ipc = {
  app: {
    awaitInitialization: "await-initialization",
    consumeInitialDeepLinks: "consume-initial-deep-links",
    deepLink: "deep-link",
    getDefaultServerUrl: "get-default-server-url",
    setDefaultServerUrl: "set-default-server-url",
    isFirstLaunchOnboardingPending: "is-first-launch-onboarding-pending",
    finishFirstLaunchOnboarding: "finish-first-launch-onboarding",
    checkAppExists: "check-app-exists",
    resolveAppPath: "resolve-app-path",
    relaunch: "relaunch",
    setBackgroundColor: "set-background-color",
    exportDebugLogs: "export-debug-logs",
    setForceFocus: "set-force-focus",
    recordFatalRendererError: "record-fatal-renderer-error",
    setNativeTranslations: "set-native-translations",
  },
  storage: {
    get: "store-get",
    set: "store-set",
    delete: "store-delete",
    clear: "store-clear",
    keys: "store-keys",
    length: "store-length",
  },
  drafts: {
    get: "draft-get",
    set: "draft-set",
    delete: "draft-delete",
    putBlob: "draft-blob-put",
    getBlob: "draft-blob-get",
  },
  files: {
    openDirectoryPicker: "open-directory-picker",
    openFilePicker: "open-file-picker",
    readPickedFile: "read-picked-file",
    releasePickedFiles: "release-picked-files",
    saveFilePicker: "save-file-picker",
    openExternal: "open-external",
    openLocalFile: "open-local-file",
    openPath: "open-path",
    revealPath: "reveal-path",
    readClipboardImage: "read-clipboard-image",
  },
  window: {
    getId: "get-window-id",
    themeReady: "window-theme-ready",
    getFocused: "get-window-focused",
    getFullscreen: "get-window-fullscreen",
    fullscreenChanged: "window-fullscreen-changed",
    setFocus: "set-window-focus",
    show: "show-window",
    getZoomFactor: "get-zoom-factor",
    setZoomFactor: "set-zoom-factor",
    zoomFactorChanged: "zoom-factor-changed",
    getPinchZoomEnabled: "get-pinch-zoom-enabled",
    setPinchZoomEnabled: "set-pinch-zoom-enabled",
    pinchZoomEnabledChanged: "pinch-zoom-enabled-changed",
    setTitlebar: "set-titlebar",
  },
  menu: {
    command: "menu-command",
    runAction: "run-desktop-menu-action",
  },
  updater: {
    subscribe: "updater-subscribe",
    unsubscribe: "updater-unsubscribe",
    check: "updater-check",
    install: "updater-install",
    state: "updater-state",
  },
  wsl: {
    awaitInitialization: "wsl-servers-await-initialization",
    subscribe: "wsl-servers-subscribe",
    unsubscribe: "wsl-servers-unsubscribe",
    getState: "wsl-servers-get-state",
    probeRuntime: "wsl-servers-probe-runtime",
    refreshDistros: "wsl-servers-refresh-distros",
    installWsl: "wsl-servers-install-wsl",
    installDistro: "wsl-servers-install-distro",
    probeAddable: "wsl-servers-probe-addable",
    installOpencode: "wsl-servers-install-opencode",
    openTerminal: "wsl-servers-open-terminal",
    addServer: "wsl-servers-add",
    removeServer: "wsl-servers-remove",
    startServer: "wsl-servers-start",
    event: "wsl-servers-event",
  },
} as const

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

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

export type DirectoryPickerOptions = {
  multiple?: boolean
  title?: string
  defaultPath?: string
}

export type FilePickerOptions = DirectoryPickerOptions & {
  extensions?: string[]
}

export type PickedFiles = {
  token: string
  files: { path: string; name: string; size: number }[]
}

export type SaveFilePickerOptions = {
  title?: string
  defaultPath?: string
}

export type ClipboardImage = {
  buffer: ArrayBuffer
  width: number
  height: number
}

export type IpcInvoke = {
  [Ipc.app.awaitInitialization]: { args: []; result: ServerReadyData }
  [Ipc.app.consumeInitialDeepLinks]: { args: []; result: string[] }
  [Ipc.app.getDefaultServerUrl]: { args: []; result: string | null }
  [Ipc.app.setDefaultServerUrl]: { args: [url: string | null]; result: void }
  [Ipc.app.isFirstLaunchOnboardingPending]: { args: []; result: boolean }
  [Ipc.app.finishFirstLaunchOnboarding]: { args: [createDefaultProject: boolean]; result: string | null }
  [Ipc.app.checkAppExists]: { args: [appName: string]; result: boolean }
  [Ipc.app.resolveAppPath]: { args: [appName: string]; result: string | null }
  [Ipc.app.setBackgroundColor]: { args: [color: string]; result: void }
  [Ipc.app.exportDebugLogs]: { args: []; result: string }
  [Ipc.app.setForceFocus]: { args: [enabled: boolean]; result: void }
  [Ipc.app.recordFatalRendererError]: { args: [error: FatalRendererError]; result: void }
  [Ipc.app.setNativeTranslations]: { args: [bundle: DesktopNativeBundle]; result: void }

  [Ipc.storage.get]: { args: [name: string, key: string]; result: string | null }
  [Ipc.storage.set]: { args: [name: string, key: string, value: string]; result: void }
  [Ipc.storage.delete]: { args: [name: string, key: string]; result: void }
  [Ipc.storage.clear]: { args: [name: string]; result: void }
  [Ipc.storage.keys]: { args: [name: string]; result: string[] }
  [Ipc.storage.length]: { args: [name: string]; result: number }

  [Ipc.drafts.get]: { args: [key: string]; result: string | null }
  [Ipc.drafts.set]: { args: [key: string, value: string]; result: void }
  [Ipc.drafts.delete]: { args: [key: string]; result: void }
  [Ipc.drafts.putBlob]: { args: [data: ArrayBuffer]; result: string }
  [Ipc.drafts.getBlob]: { args: [id: string]; result: ArrayBuffer | null }

  [Ipc.files.openDirectoryPicker]: {
    args: [options?: DirectoryPickerOptions]
    result: string | string[] | null
  }
  [Ipc.files.openFilePicker]: { args: [options?: FilePickerOptions]; result: PickedFiles | null }
  [Ipc.files.readPickedFile]: { args: [token: string, path: string]; result: ArrayBuffer }
  [Ipc.files.releasePickedFiles]: { args: [token: string]; result: void }
  [Ipc.files.saveFilePicker]: { args: [options?: SaveFilePickerOptions]; result: string | null }
  [Ipc.files.openPath]: { args: [path: string, app?: string]; result: string | undefined }
  [Ipc.files.revealPath]: { args: [path: string]; result: boolean }
  [Ipc.files.readClipboardImage]: { args: []; result: ClipboardImage | null }

  [Ipc.window.getId]: { args: []; result: string }
  [Ipc.window.themeReady]: { args: []; result: void }
  [Ipc.window.getFocused]: { args: []; result: boolean }
  [Ipc.window.getFullscreen]: { args: []; result: boolean }
  [Ipc.window.setFocus]: { args: []; result: void }
  [Ipc.window.show]: { args: []; result: void }
  [Ipc.window.getZoomFactor]: { args: []; result: number }
  [Ipc.window.setZoomFactor]: { args: [factor: number]; result: void }
  [Ipc.window.getPinchZoomEnabled]: { args: []; result: boolean }
  [Ipc.window.setPinchZoomEnabled]: { args: [enabled: boolean]; result: void }
  [Ipc.window.setTitlebar]: { args: [theme: TitlebarTheme]; result: void }
  [Ipc.menu.runAction]: { args: [action: DesktopMenuAction]; result: void }

  [Ipc.updater.subscribe]: { args: []; result: void }
  [Ipc.updater.unsubscribe]: { args: []; result: void }
  [Ipc.updater.check]: { args: []; result: UpdaterState }
  [Ipc.updater.install]: { args: []; result: void }

  [Ipc.wsl.awaitInitialization]: { args: []; result: void }
  [Ipc.wsl.subscribe]: { args: []; result: void }
  [Ipc.wsl.unsubscribe]: { args: []; result: void }
  [Ipc.wsl.getState]: { args: []; result: WslServersState }
  [Ipc.wsl.probeRuntime]: { args: []; result: void }
  [Ipc.wsl.refreshDistros]: { args: []; result: void }
  [Ipc.wsl.installWsl]: { args: []; result: void }
  [Ipc.wsl.installDistro]: { args: [name: string]; result: void }
  [Ipc.wsl.probeAddable]: { args: [distros: string[]]; result: void }
  [Ipc.wsl.installOpencode]: { args: [name: string]; result: void }
  [Ipc.wsl.openTerminal]: { args: [name: string]; result: void }
  [Ipc.wsl.addServer]: { args: [distro: string]; result: WslServerConfig }
  [Ipc.wsl.removeServer]: { args: [id: string]; result: void }
  [Ipc.wsl.startServer]: { args: [id: string]; result: void }
}

export type IpcSend = {
  [Ipc.app.relaunch]: []
  [Ipc.files.openExternal]: [url: string]
  [Ipc.files.openLocalFile]: [url: string]
}

export type IpcEvent = {
  [Ipc.app.deepLink]: [urls: string[]]
  [Ipc.menu.command]: [id: string]
  [Ipc.updater.state]: [state: UpdaterState]
  [Ipc.wsl.event]: [event: WslServersEvent]
  [Ipc.window.fullscreenChanged]: [fullscreen: boolean]
  [Ipc.window.pinchZoomEnabledChanged]: [enabled: boolean]
  [Ipc.window.zoomFactorChanged]: [factor: number]
}

export type IpcInvokeArgs<Channel extends keyof IpcInvoke> = IpcInvoke[Channel]["args"]
export type IpcInvokeResult<Channel extends keyof IpcInvoke> = IpcInvoke[Channel]["result"]
export type IpcInvokeMethod<Channel extends keyof IpcInvoke> = (
  ...args: IpcInvokeArgs<Channel>
) => Promise<IpcInvokeResult<Channel>>
export type IpcSendMethod<Channel extends keyof IpcSend> = (...args: IpcSend[Channel]) => void
export type IpcEventListener<Channel extends keyof IpcEvent> = (...args: IpcEvent[Channel]) => void
export type IpcEventSubscription<Channel extends keyof IpcEvent> = (listener: IpcEventListener<Channel>) => () => void

type IpcEventSender = {
  send<Channel extends keyof IpcEvent>(channel: Channel, ...args: IpcEvent[Channel]): void
}

export function sendIpcEvent<Channel extends keyof IpcEvent>(
  sender: IpcEventSender,
  channel: Channel,
  ...args: IpcEvent[Channel]
) {
  sender.send(channel, ...args)
}
