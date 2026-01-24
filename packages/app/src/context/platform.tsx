import { createSimpleContext } from "@opencode-ai/ui/context"
import { AsyncStorage, SyncStorage } from "@solid-primitives/storage"

export type FileSystemEntry = {
  name: string
  path: string
  isDirectory: boolean
}

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "desktop"

  /** Desktop OS (Tauri only) */
  os?: "macos" | "windows" | "linux"

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

  /** Parse markdown to HTML using native parser (desktop only, returns unprocessed code blocks) */
  parseMarkdown?(markdown: string): Promise<string>

  /** Get project root directory (desktop only) */
  getProjectRoot?(): Promise<string>

  /** Read directory contents (desktop only) */
  readDirectory?(path: string): Promise<FileSystemEntry[]>

  /** Read file contents (desktop only) */
  readFile?(path: string): Promise<string>

  /** Write file contents (desktop only) */
  writeFile?(path: string, contents: string): Promise<void>

  /** Rename/move a file or directory (desktop only) */
  renamePath?(oldPath: string, newPath: string): Promise<void>

  /** Delete a file or directory (desktop only) */
  deletePath?(path: string): Promise<void>

  /** Copy a file or directory (desktop only) */
  copyPath?(source: string, destination: string): Promise<void>

  /** Create a new file (desktop only) */
  createFile?(path: string): Promise<void>

  /** Create a new directory (desktop only) */
  createDirectory?(path: string): Promise<void>

  /** Watch a file for changes (desktop only) - returns an unwatch function */
  watchFile?(path: string, callback: (event: FileWatchEvent) => void): Promise<() => void>
}

export type FileWatchEvent = {
  type: "create" | "modify" | "remove" | "rename" | "any"
  paths: string[]
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
