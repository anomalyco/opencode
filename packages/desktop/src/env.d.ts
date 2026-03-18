export {}

declare global {
  interface Window {
    __OPENCODE__?: {
      deepLinks?: string[]
      updaterEnabled?: boolean
      wsl?: boolean
    }
  }
}
