import type { WindowBootstrap } from "../shared/window-bootstrap"

export type ElectronNative = {
  windowID: string
  bootstrap: WindowBootstrap
  getPathForFile(file: File): string
}
