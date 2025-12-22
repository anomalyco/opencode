import { createSimpleContext } from "@opencode-ai/ui/context"
import { AsyncStorage, SyncStorage } from "@solid-primitives/storage"

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "tauri"

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Restart the app  */
  restart(): Promise<void>

  /** Open native directory picker dialog (Tauri only) */
  openDirectoryPickerDialog?(opts?: { title?: string; multiple?: boolean }): Promise<string | string[] | null>

  /** Open native file picker dialog (Tauri only) */
  openFilePickerDialog?(opts?: { title?: string; multiple?: boolean }): Promise<string | string[] | null>

  /** Save file picker dialog (Tauri only) */
  saveFilePickerDialog?(opts?: { title?: string; defaultPath?: string }): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Check for updates (Tauri only) */
  checkUpdate?(): Promise<{ updateAvailable: boolean; version?: string }>

  /** Install updates (Tauri only) */
  update?(): Promise<void>

  /** Fetch override */
  fetch?: typeof fetch
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
