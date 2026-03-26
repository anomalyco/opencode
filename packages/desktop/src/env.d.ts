declare global {
  interface Window {
    __COBUILDER__?: {
      updaterEnabled?: boolean
      wsl?: boolean
      deepLinks?: string[]
    }
  }
}

export {}
