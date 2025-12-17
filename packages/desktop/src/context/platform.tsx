import { createSimpleContext } from "@opencode-ai/ui/context"
import { AsyncStorage, SyncStorage } from "@solid-primitives/storage"

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "tauri"

  /** Open native directory picker dialog (Tauri only) */
  openDirectoryPickerDialog?(opts?: { title?: string; multiple?: boolean }): Promise<string | string[] | null>

  /** Open native file picker dialog (Tauri only) */
  openFilePickerDialog?(opts?: { title?: string; multiple?: boolean }): Promise<string | string[] | null>

  /** Save file picker dialog (Tauri only) */
  saveFilePickerDialog?(opts?: { title?: string; defaultPath?: string }): Promise<string | null>

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
