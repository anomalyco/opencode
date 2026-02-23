import { showToast } from "@opencode-ai/ui/toast"
import { decode64 } from "@/utils/base64"

type Content = {
  type: "text" | "binary"
  content: string
  encoding?: "base64"
}

type Entry = {
  content?: Content
}

export async function copyFile(args: {
  path: string
  load: (path: string) => Promise<void>
  get: (path: string) => Entry | undefined
  copied: string
  failed: string
  binary: string
  binaryDescription: string
}) {
  await args.load(args.path)

  const value = args.get(args.path)?.content
  if (!value) return

  if (value.type === "binary") {
    showToast({
      variant: "error",
      title: args.binary,
      description: args.binaryDescription,
    })
    return
  }

  const text = value.encoding === "base64" ? decode64(value.content) : value.content
  if (text === undefined) {
    showToast({
      variant: "error",
      title: args.failed,
    })
    return
  }

  return navigator.clipboard.writeText(text).then(
    () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: args.copied,
      })
    },
    () => {
      showToast({
        variant: "error",
        title: args.failed,
      })
    },
  )
}
