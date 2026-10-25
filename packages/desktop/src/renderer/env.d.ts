import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly OPENCODE_TEST_ONBOARDING: boolean
  }

  interface Window {
    api: ElectronAPI
    __BOLT__?: {
      deepLinks?: string[]
    }
  }
}
