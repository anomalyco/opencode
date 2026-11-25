// The sidecar password never crosses into the renderer; the main process adds it to sidecar requests.
export type ServerReadyData = {
  url: string
}

export type TitlebarTheme = {
  mode: "light" | "dark"
  scheme?: "system" | "light" | "dark"
}

export type TaskbarProgressMode = "none" | "indeterminate" | "paused" | "error"

export type TaskbarProgressSummary = {
  readonly waiting: number
  readonly failed: boolean
  readonly busy: boolean
}

/** Maps a window's open-tab summary to the Windows taskbar progress bar mode. */
export function selectTaskbarProgressMode(summary: TaskbarProgressSummary): TaskbarProgressMode {
  if (summary.waiting > 0) return "paused"

  if (summary.failed) return "error"

  if (summary.busy) return "indeterminate"

  return "none"
}

export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

export type DirectoryPickerOptions = {
  multiple?: boolean
  title?: string
  defaultPath?: string
}

export type FilePickerOptions = DirectoryPickerOptions & {
  extensions?: string[]
}

export type PickedFiles = {
  token: string
  files: { path: string; name: string; size: number }[]
}

export type SaveFilePickerOptions = {
  title?: string
  defaultPath?: string
}

export type ClipboardImage = {
  buffer: ArrayBuffer
  width: number
  height: number
}
