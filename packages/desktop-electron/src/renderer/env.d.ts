import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __OPENCODE__?: {
      updaterEnabled?: boolean
      wsl?: boolean
      deepLinks?: string[]
    }
  }
}
