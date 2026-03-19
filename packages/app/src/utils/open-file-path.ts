import type { OpenFilePathFn } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import type { Platform } from "@/context/platform"

export type OpenFileInput = Parameters<OpenFilePathFn>[0]

export const OPEN_FILE_PATH_EVENT = "opencode:open-file-path"

export function dispatchOpenFilePath(input: OpenFileInput) {
  window.dispatchEvent(new CustomEvent<OpenFileInput>(OPEN_FILE_PATH_EVENT, { detail: input }))
}

export function resolveOpenFilePath(dir: string, path: string) {
  const file = path.replace(/^[\\/]+/, "")
  const separator = dir.includes("\\") ? "\\" : "/"
  return dir.endsWith(separator) ? dir + file : dir + separator + file
}

export async function openFilePath(opts: { directory: string; input: OpenFileInput; platform: Platform }) {
  if (opts.platform.platform !== "desktop" || !opts.platform.openPath) {
    dispatchOpenFilePath(opts.input)
    return
  }

  await opts.platform.openPath(resolveOpenFilePath(opts.directory, opts.input.path)).catch((err) => {
    showToast({
      variant: "error",
      title: "Open failed",
      description: err instanceof Error ? err.message : String(err),
    })
    dispatchOpenFilePath(opts.input)
  })
}
