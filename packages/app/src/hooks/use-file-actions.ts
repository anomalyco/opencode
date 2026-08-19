import { useConfirm } from "@/components/confirm-dialog"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { showToast } from "@/utils/toast"
import {
  deleteFile,
  downloadFile,
  fsAuthHeaders,
  MaxUploadBytes,
  uploadFile,
  UploadTooLargeError,
} from "@/utils/file-transfer"

export type FileAction = "upload" | "download" | "delete"

const toastTitle: Record<FileAction, "toast.file.uploadFailed.title" | "toast.file.downloadFailed.title" | "toast.file.deleteFailed.title"> = {
  upload: "toast.file.uploadFailed.title",
  download: "toast.file.downloadFailed.title",
  delete: "toast.file.deleteFailed.title",
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * Shared file-transfer actions for the session file surfaces (file tree, file
 * list and the file manager panel). Performs the confirmation dialog for
 * deletes and refreshes the file tree after successful mutations.
 *
 * Errors are reported through `onError` when provided, otherwise through a
 * localized error toast.
 */
export function useFileActions(options?: { onError?: (action: FileAction, message: string) => void }) {
  const sdk = useSDK()
  const server = useServer()
  const language = useLanguage()
  const file = useFile()
  const confirm = useConfirm()

  const directory = () => sdk().directory.replace(/\/+$/, "")

  const reportError = (action: FileAction, message: string) => {
    if (options?.onError) {
      options.onError(action, message)
      return
    }
    showToast({
      variant: "error",
      title: language.t(toastTitle[action]),
      description: message,
    })
  }

  const refreshTree = async (path?: string) => {
    await file.tree.refresh(path ?? "")
    file.tree.bump()
  }

  /** Uploads one file to the workspace root. Returns true on success. */
  async function upload(input: File, onProgress?: (progress: number) => void): Promise<boolean> {
    try {
      await uploadFile({
        url: sdk().url,
        directory: directory(),
        headers: fsAuthHeaders(server.current),
        path: input.name,
        file: input,
        onProgress,
      })
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        reportError("upload", language.t("session.files.uploadTooLarge", { size: formatBytes(MaxUploadBytes) }))
      } else {
        reportError("upload", err instanceof Error ? err.message : String(err))
      }
      return false
    }
    await refreshTree("")
    return true
  }

  /** Downloads one file. Errors are reported, never thrown. */
  async function download(path: string): Promise<void> {
    try {
      await downloadFile({
        url: sdk().url,
        directory: directory(),
        headers: fsAuthHeaders(server.current),
        path,
      })
    } catch (err) {
      reportError("download", err instanceof Error ? err.message : String(err))
    }
  }

  /** Confirms and deletes one file. Returns true when the file was deleted. */
  async function remove(path: string): Promise<boolean> {
    const ok = await confirm({
      title: language.t("common.delete"),
      message: language.t("session.files.deleteConfirm", { path }),
    })
    if (!ok) return false
    try {
      await deleteFile({
        url: sdk().url,
        directory: directory(),
        headers: fsAuthHeaders(server.current),
        path,
      })
    } catch (err) {
      reportError("delete", err instanceof Error ? err.message : String(err))
      return false
    }
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
    await refreshTree(parent)
    return true
  }

  return { upload, download, remove }
}
