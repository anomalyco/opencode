interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:opencode-server" {
  import type { BrowserControl } from "@opencode-ai/core/browser-control"

  export const Server: {
    listen(options: {
      hostname: string
      port: number
      password: string
      browserControl?: BrowserControl.Interface
    }): Promise<{ stop(close?: boolean): Promise<void> }>
  }
}
