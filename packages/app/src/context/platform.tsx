import { createSimpleContext } from "@opencode-ai/ui/context"
import { AsyncStorage, SyncStorage } from "@solid-primitives/storage"

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "desktop"

  /** App version */
  version?: string

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Restart the app  */
  restart(): Promise<void>

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open directory picker dialog (native on Tauri, server-backed on web) */
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

  /** Get the configured default server URL (desktop only) */
  getDefaultServerUrl?(): Promise<string | null>

  /** Set the default server URL to use on app startup (desktop only) */
  setDefaultServerUrl?(url: string | null): Promise<void>
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
