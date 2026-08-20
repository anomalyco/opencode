import type { WslServersPlatform } from "@opencode-ai/app/wsl/types"
import {
  Ipc,
  type IpcEventListener,
  type IpcEventSubscription,
  type IpcInvokeMethod,
  type IpcSendMethod,
} from "../shared/ipc-contract"

export type WslServersAPI = WslServersPlatform
export type UpdaterAPI = {
  subscribe: (cb: IpcEventListener<typeof Ipc.updater.state>) => Promise<() => void>
  check: IpcInvokeMethod<typeof Ipc.updater.check>
  install: IpcInvokeMethod<typeof Ipc.updater.install>
}

export type ElectronAPI = {
  awaitInitialization: IpcInvokeMethod<typeof Ipc.app.awaitInitialization>
  wslServers: WslServersAPI
  updater: UpdaterAPI
  consumeInitialDeepLinks: IpcInvokeMethod<typeof Ipc.app.consumeInitialDeepLinks>
  getDefaultServerUrl: IpcInvokeMethod<typeof Ipc.app.getDefaultServerUrl>
  setDefaultServerUrl: IpcInvokeMethod<typeof Ipc.app.setDefaultServerUrl>
  isFirstLaunchOnboardingPending: IpcInvokeMethod<typeof Ipc.app.isFirstLaunchOnboardingPending>
  finishFirstLaunchOnboarding: IpcInvokeMethod<typeof Ipc.app.finishFirstLaunchOnboarding>
  checkAppExists: IpcInvokeMethod<typeof Ipc.app.checkAppExists>
  resolveAppPath: IpcInvokeMethod<typeof Ipc.app.resolveAppPath>
  storeGet: IpcInvokeMethod<typeof Ipc.storage.get>
  storeSet: IpcInvokeMethod<typeof Ipc.storage.set>
  storeDelete: IpcInvokeMethod<typeof Ipc.storage.delete>
  storeClear: IpcInvokeMethod<typeof Ipc.storage.clear>
  storeKeys: IpcInvokeMethod<typeof Ipc.storage.keys>
  storeLength: IpcInvokeMethod<typeof Ipc.storage.length>
  draftGet: IpcInvokeMethod<typeof Ipc.drafts.get>
  draftSet: IpcInvokeMethod<typeof Ipc.drafts.set>
  draftDelete: IpcInvokeMethod<typeof Ipc.drafts.delete>
  draftBlobPut: IpcInvokeMethod<typeof Ipc.drafts.putBlob>
  draftBlobGet: IpcInvokeMethod<typeof Ipc.drafts.getBlob>

  getWindowID: IpcInvokeMethod<typeof Ipc.window.getId>
  onMenuCommand: IpcEventSubscription<typeof Ipc.menu.command>
  onDeepLink: IpcEventSubscription<typeof Ipc.app.deepLink>

  openDirectoryPicker: IpcInvokeMethod<typeof Ipc.files.openDirectoryPicker>
  openFilePicker: IpcInvokeMethod<typeof Ipc.files.openFilePicker>
  readPickedFile: IpcInvokeMethod<typeof Ipc.files.readPickedFile>
  releasePickedFiles: IpcInvokeMethod<typeof Ipc.files.releasePickedFiles>
  getPathForFile: (file: File) => string
  saveFilePicker: IpcInvokeMethod<typeof Ipc.files.saveFilePicker>
  openExternal: IpcSendMethod<typeof Ipc.files.openExternal>
  openLocalFile: IpcSendMethod<typeof Ipc.files.openLocalFile>
  openPath: IpcInvokeMethod<typeof Ipc.files.openPath>
  revealPath: IpcInvokeMethod<typeof Ipc.files.revealPath>
  readClipboardImage: IpcInvokeMethod<typeof Ipc.files.readClipboardImage>
  getWindowFocused: IpcInvokeMethod<typeof Ipc.window.getFocused>
  getWindowFullscreen: IpcInvokeMethod<typeof Ipc.window.getFullscreen>
  onWindowFullscreenChanged: IpcEventSubscription<typeof Ipc.window.fullscreenChanged>
  setWindowFocus: IpcInvokeMethod<typeof Ipc.window.setFocus>
  showWindow: IpcInvokeMethod<typeof Ipc.window.show>
  relaunch: IpcSendMethod<typeof Ipc.app.relaunch>
  getZoomFactor: IpcInvokeMethod<typeof Ipc.window.getZoomFactor>
  setZoomFactor: IpcInvokeMethod<typeof Ipc.window.setZoomFactor>
  getPinchZoomEnabled: IpcInvokeMethod<typeof Ipc.window.getPinchZoomEnabled>
  setPinchZoomEnabled: IpcInvokeMethod<typeof Ipc.window.setPinchZoomEnabled>
  onPinchZoomEnabledChanged: IpcEventSubscription<typeof Ipc.window.pinchZoomEnabledChanged>
  onZoomFactorChanged: IpcEventSubscription<typeof Ipc.window.zoomFactorChanged>
  setTitlebar: IpcInvokeMethod<typeof Ipc.window.setTitlebar>
  runDesktopMenuAction: IpcInvokeMethod<typeof Ipc.menu.runAction>
  setBackgroundColor: IpcInvokeMethod<typeof Ipc.app.setBackgroundColor>
  exportDebugLogs: IpcInvokeMethod<typeof Ipc.app.exportDebugLogs>
  setForceFocus: IpcInvokeMethod<typeof Ipc.app.setForceFocus>
  recordFatalRendererError: IpcInvokeMethod<typeof Ipc.app.recordFatalRendererError>
  setNativeTranslations: IpcInvokeMethod<typeof Ipc.app.setNativeTranslations>
}
