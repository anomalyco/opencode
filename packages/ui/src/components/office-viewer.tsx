import type { FileContent } from "@opencode-ai/sdk/v2"
import { createResource, createSignal, Match, Switch, type JSX } from "solid-js"
import { fileExtension } from "../pierre/media"

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return bytes.buffer
}

async function renderDocx(base64: string) {
  const mammoth = await import("mammoth")
  const buffer = base64ToArrayBuffer(base64)
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
  return result.value
}

async function renderXlsx(base64: string) {
  const XLSX = await import("xlsx")
  const buffer = base64ToArrayBuffer(base64)
  const workbook = XLSX.read(buffer, { type: "array" })
  let html = ""
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    html += `<h3 class="text-14-semibold mb-2 mt-4">${name}</h3>`
    html += XLSX.utils.sheet_to_html(sheet, { id: "", editable: false })
  }
  return html
}


export type OfficeViewerOptions = {
  path?: string
  current?: unknown
  readFile?: (path: string) => Promise<FileContent | undefined>
  onLoad?: () => void
  onError?: () => void
}

export function OfficeViewer(props: { options?: OfficeViewerOptions; fallback: () => JSX.Element }) {
  const [html, setHtml] = createSignal("")
  const [error, setError] = createSignal(false)

  const cfg = () => props.options

  const request = () => {
    const media = cfg()
    if (!media?.path || !media.readFile) return
    return {
      key: `office:${media.path}`,
      path: media.path,
      ext: fileExtension(media.path),
      readFile: media.readFile,
    }
  }

  const [loaded] = createResource(request, async (input) => {
    const result = await input.readFile(input.path)
    const content = (result as any)?.content
    if (typeof content !== "string" || !content) {
      setError(true)
      cfg()?.onError?.()
      return { key: input.key, error: true as const }
    }

    try {
      let rendered = ""
      if (input.ext === "docx") rendered = await renderDocx(content)
      else if (input.ext === "xlsx") rendered = await renderXlsx(content)
      else if (input.ext === "pptx") rendered = "<p class=\"text-14-regular text-text-weak\">PPT preview is not supported yet.</p>"
      else rendered = "<p>Unsupported office format</p>"

      setHtml(rendered)
      cfg()?.onLoad?.()
      return { key: input.key, value: rendered }
    } catch (e) {
      setError(true)
      cfg()?.onError?.()
      return { key: input.key, error: true as const }
    }
  })

  const ready = () => {
    const req = request()
    const val = loaded()
    if (!req) return false
    return !loaded.loading && val && "value" in val && val.key === req.key
  }

  return (
    <Switch>
      <Match when={error() || (ready() && !html())}>
        <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
          Failed to load office document
        </div>
      </Match>
      <Match when={loaded.loading}>
        <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">Loading...</div>
      </Match>
      <Match when={ready()}>
        <div
          class="office-preview px-6 py-4 text-text-base max-w-full overflow-auto"
          innerHTML={html()}
        />
      </Match>
      <Match when={true}>{props.fallback()}</Match>
    </Switch>
  )
}
