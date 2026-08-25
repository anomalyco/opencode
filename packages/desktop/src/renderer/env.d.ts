import type { ElectronNative } from "../preload/types"

declare module "virtual:vite-opencode-picker/client"

declare global {
  interface Window {
    electron: ElectronNative
    __OPENCODE__?: {
      deepLinks?: string[]
    }
  }
}
