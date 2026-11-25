import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly OPENCODE_TEST_ONBOARDING: boolean
  }

  interface Window {
    electron: ElectronNative
  }
}
