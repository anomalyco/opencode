declare module "ghostty-web/ghostty-vt.wasm?url" {
  const url: string
  export default url
}

declare module "*.wasm?url" {
  const url: string
  export default url
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      serverPassword?: string
      deepLinks?: string[]
    }
  }
}

export {}
