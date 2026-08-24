import type { ElectronNative } from "../preload/types"

declare global {
  interface Window {
    electron: ElectronNative
    __OPENCODE__?: {
      deepLinks?: string[]
    }
  }
}
