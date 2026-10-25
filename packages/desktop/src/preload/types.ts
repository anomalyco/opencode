import type { DesktopMenuAction } from "@bolt-ai/app/desktop-menu"
import type { WslServersPlatform } from "@bolt-ai/app/wsl/types"
import type { UpdaterState } from "@bolt-ai/app/updater"
import type { DesktopNativeBundle } from "@bolt-ai/app/i18n/desktop-native"
export type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslBoltCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "@bolt-ai/app/wsl/types"

export type ElectronNative = {
  windowID: string
  bootstrap: WindowBootstrap
  storageSnapshot: Promise<StorageSnapshot>
  extensions: Promise<WindowSnapshot["extensions"]>
  getPathForFile(file: File): string
}
