import type { ElectronAPI } from "@/context/browser-types"

declare global {
  interface Window {
    api?: ElectronAPI
  }
}

export {}
