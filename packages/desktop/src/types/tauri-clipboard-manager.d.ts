declare module "@tauri-apps/plugin-clipboard-manager" {
  type ClipboardImage = {
    rgba(): Promise<Uint8Array>
    size(): Promise<{
      width: number
      height: number
    }>
  }

  export function readImage(): Promise<ClipboardImage | null>
}
