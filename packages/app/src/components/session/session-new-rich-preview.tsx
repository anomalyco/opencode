import { useSDK } from "@/context/sdk"
import { Markdown } from "@opencode-ai/ui/markdown"
import { createResource, Show } from "solid-js"

const README_ITEMS = 2
const ROOT_CLASS = "size-full flex flex-col"

function score(file: string) {
  if (file === "README.md") return 0
  if (file === "README.mdx") return 1
  if (file === "README.markdown") return 2
  if (file === "README.txt") return 3
  if (file === "README") return 4
  if (file === "readme.md") return 5
  if (file === "readme.mdx") return 6
  if (file === "readme.markdown") return 7
  if (file === "readme.txt") return 8
  if (file === "readme") return 9
  return 10
}

export function findReadme(files: string[]) {
  return files
    .filter((file) => !file.includes("/") && /^readme(?:\.[^/]+)?$/i.test(file))
    .sort((a, b) => score(a) - score(b))[0]
}

function clean(line: string) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^#+\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function alt(text: string) {
  const html = text.match(/<img[^>]*alt=["']([^"']+)["'][^>]*>/i)?.[1]?.trim()
  if (html) return html.replace(/\s+logo$/i, "").trim()

  const md = text.match(/!\[([^\]]+)\]\([^)]*\)/)?.[1]?.trim()
  if (md) return md.replace(/\s+logo$/i, "").trim()
}

function preview(text: string) {
  const items: string[] = []
  const image = alt(text)
  if (image) items.push(`# ${image}`)

  for (const raw of text.split(/\r?\n/)) {
    if (items.length >= README_ITEMS) break
    const line = raw.trim()
    if (!line) continue
    if (/^[-*_]{3,}$/.test(line)) continue
    const value = clean(line)
    if (!value) continue
    if (image && value.toLowerCase() === image.toLowerCase()) continue
    items.push(items.length === 0 ? `# ${value}` : value)
  }

  if (items.length === 0) return
  return items.slice(0, README_ITEMS).join("\n\n")
}

export function SessionNewRichPreview(props: { root: () => string; fallback: string }) {
  const sdk = useSDK()
  const [readme] = createResource(props.root, async () => {
    const result = await sdk.client.find.files({ query: "README", dirs: "false", limit: 50 })
    const files: string[] = result.data ?? []
    const file = findReadme(files)

    if (!file) return

    const read = await sdk.client.file.read({ path: file })
    const data = read.data
    if (!data) return
    if (data.type !== "text" || !data.content) return
    return preview(data.content)
  })

  return (
    <div class={ROOT_CLASS}>
      <div class="h-12 shrink-0" aria-hidden />
      <div class="flex-1 px-6 pb-30 flex items-center justify-center text-center">
        <Show when={readme()} fallback={<div class="text-20-medium text-text-strong">{props.fallback}</div>}>
          <div class="w-full max-w-160 text-center overflow-hidden">
            <Markdown text={readme()!} class="text-20-medium text-text-strong" />
          </div>
        </Show>
      </div>
    </div>
  )
}
