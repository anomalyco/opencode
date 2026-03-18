export const htmlExtensions = new Set(["html", "htm"])
export const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"])
export const pdfExtensions = new Set(["pdf"])

export const PRINT_MESSAGE = "opencode:preview-print"
export const PRINT_DONE_MESSAGE = "opencode:preview-print-done"

export function getExtension(path: string): string {
  const idx = path.lastIndexOf(".")
  if (idx === -1) return ""
  return path.slice(idx + 1).toLowerCase()
}

export function normalizeMimeType(type: string | undefined): string | undefined {
  if (!type) return

  const mime = type.split(";", 1)[0]?.trim().toLowerCase()
  if (!mime) return
  if (mime === "audio/x-aac") return "audio/aac"
  if (mime === "audio/x-m4a") return "audio/mp4"
  return mime
}

export function printable(input: string): string {
  const style = `<style>@page{margin:12mm}html,body{background:#fff}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>`
  const script = `<script>(function(){var done=false;function finish(){if(done)return;done=true;parent.postMessage({type:"${PRINT_DONE_MESSAGE}"},"*")}window.addEventListener("message",function(event){if(event.data?.type!=="${PRINT_MESSAGE}")return;var cleanup=function(){window.removeEventListener("afterprint",cleanup);finish()};window.addEventListener("afterprint",cleanup);window.focus();setTimeout(function(){window.print();setTimeout(finish,1000)},50)})})()</script>`
  if (input.includes("</head>")) return input.replace("</head>", `${style}${script}</head>`)
  if (input.includes("</body>")) return input.replace("</body>", `${script}</body>`)
  return `${style}${script}${input}`
}

export function base64ToBytes(input: string): Uint8Array | undefined {
  try {
    const binary = atob(input)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return
  }
}

export function blobUrlFromBase64(input: string, mimeType: string): string | undefined {
  const bytes = base64ToBytes(input)
  if (!bytes) return
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }))
}
