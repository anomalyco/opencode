import type { ClipboardWriteResult } from "../clipboard"
import type { ClipboardService } from "../context/clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type CopyToastOptions = {
  success?: string
  fallback?: string
  failure?: string
  variant?: "info" | "success"
  silentFailure?: boolean
}

export function clipboardSuccessMessage(result: ClipboardWriteResult, success = "Copied to clipboard") {
  return result.verified ? success : "Sent copy sequence to terminal"
}

export async function writeClipboardWithToast(
  clipboard: ClipboardService,
  toast: Toast,
  text: string,
  options: CopyToastOptions = {},
) {
  if (!clipboard.write) throw new Error("Clipboard write is unavailable")
  try {
    const result = await clipboard.write(text)
    toast.show({
      message: result.verified
        ? (options.success ?? "Copied to clipboard")
        : (options.fallback ?? "Sent copy sequence to terminal"),
      variant: result.verified ? (options.variant ?? "info") : "warning",
    })
    return result
  } catch (err) {
    if (!options.silentFailure) {
      if (options.failure) toast.show({ message: options.failure, variant: "error" })
      else toast.error(err)
    }
    throw err
  }
}
