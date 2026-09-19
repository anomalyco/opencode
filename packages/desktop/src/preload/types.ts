export type ElectronNative = {
  windowID: string
  requestRpcPort(): void
  getPathForFile(file: File): string
}
