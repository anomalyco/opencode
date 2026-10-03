// The agent's browser.preview: one server file over the session transcript, read through the opencode
// server. Images, Markdown, and text render here; media, PDFs, and binaries only name the file.
import { File } from "@opencode/session-ui/file"
import { Markdown } from "@opencode/session-ui/markdown"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Spinner } from "@opencode/ui/spinner"
import { Tooltip } from "@opencode/ui/tooltip"
import { Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { useServer } from "./connection"
import { errorMessage } from "./format"

const images: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
}
const markdown = new Set(["md", "markdown", "mdx"])
// Formats a browser could play or show but this viewer does not; skip downloading them.
const unsupported = new Set([
  "pdf",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "aac",
  "flac",
  "mp4",
  "m4v",
  "webm",
  "mov",
  "mkv",
  "avi",
])
// Larger text would stall the highlighter; the agent can point the user at the path instead.
const maxText = 2_000_000

type Content =
  | { type: "loading" }
  | { type: "image"; url: string }
  | { type: "markdown"; text: string }
  | { type: "text"; text: string }
  | { type: "unsupported" }
  | { type: "error"; message: string }

/** Keyed by request: the path and directory are fixed for this viewer's lifetime. */
export function FilePreview(props: { path: string; directory: string; onClose: () => void }) {
  const server = useServer()
  const absolute = /^([a-z]:)?[\\/]/i.test(props.path)
  const full = absolute ? props.path : `${props.directory.replace(/[\\/]+$/, "")}/${props.path.replace(/^\.\//, "")}`
  const split = Math.max(full.lastIndexOf("/"), full.lastIndexOf("\\"))
  const name = full.slice(split + 1)
  const extension = name.includes(".") ? name.split(".").at(-1)!.toLowerCase() : ""
  const [content, setContent] = createSignal<Content>(
    unsupported.has(extension) ? { type: "unsupported" } : { type: "loading" },
  )
  const controller = new AbortController()
  let root!: HTMLDivElement

  onMount(() => root.focus())
  onCleanup(() => {
    controller.abort()
    const value = content()
    if (value.type === "image") URL.revokeObjectURL(value.url)
  })

  if (content().type === "loading")
    void server.api.file
      .read(
        // Reads stay inside their location, so an absolute path is read from its own directory, as the desktop does.
        absolute
          ? { path: name, location: { directory: full.slice(0, split <= 2 ? split + 1 : split) } }
          : { path: props.path, location: { directory: props.directory } },
        { signal: controller.signal },
      )
      .then((bytes) => setContent(classify(bytes, extension)))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setContent({ type: "error", message: errorMessage(error) })
      })

  return (
    <div
      ref={root}
      data-component="file-preview"
      role="dialog"
      aria-label={name}
      tabIndex={-1}
      class="absolute inset-0 z-20 flex min-h-0 flex-col bg-v2-background-bg-base outline-none"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.stopPropagation()
        props.onClose()
      }}
    >
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-v2-border-border-muted ps-3 pe-1.5">
        <FileIcon node={{ path: name, type: "file" }} class="size-4 shrink-0" />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base">
            {name}
          </span>
          {/* Right-to-left so a long path loses its start, keeping the folders nearest the file. */}
          <span
            class="truncate text-left text-12-regular leading-4 text-v2-text-text-faint [direction:rtl]"
            title={full}
          >
            <bdi>{full}</bdi>
          </span>
        </div>
        <Tooltip placement="bottom-end" value="Close preview">
          <IconButton
            variant="ghost-muted"
            size="large"
            icon={<Icon name="close" />}
            aria-label="Close preview"
            onClick={() => props.onClose()}
          />
        </Tooltip>
      </div>
      <div class="no-scrollbar flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain">
        <Switch>
          <Match when={content().type === "loading"}>
            <div class="flex flex-1 items-center justify-center text-v2-icon-icon-muted">
              <Spinner class="size-4" />
            </div>
          </Match>
          <Match when={contentOf(content(), "image")}>
            {(value) => (
              <div class="flex flex-1 items-center justify-center p-4">
                <img
                  src={value().url}
                  alt={name}
                  class="max-h-full max-w-full rounded-md object-contain shadow-[var(--v2-elevation-raised)]"
                />
              </div>
            )}
          </Match>
          <Match when={contentOf(content(), "markdown")}>
            {(value) => (
              <div class="px-4 py-3">
                <Markdown text={value().text} cacheKey={full} class="select-text" />
              </div>
            )}
          </Match>
          <Match when={contentOf(content(), "text")}>
            {(value) => (
              <File
                mode="text"
                file={{ name, contents: value().text, cacheKey: `${full}:${value().text.length}` }}
                media={{ mode: "off" }}
                class="select-text"
              />
            )}
          </Match>
          <Match when={contentOf(content(), "error")}>
            {(value) => <Notice title="Couldn't read this file" detail={value().message} name={name} path={full} />}
          </Match>
          <Match when={content().type === "unsupported"}>
            <Notice title="Can't preview this file here" name={name} path={full} />
          </Match>
        </Switch>
      </div>
    </div>
  )
}

function Notice(props: { title: string; detail?: string; name: string; path: string }) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 pb-8 text-center">
      <FileIcon node={{ path: props.name, type: "file" }} mono class="mb-1 size-6 text-v2-icon-icon-muted opacity-60" />
      <p class="text-[13px] font-[530] leading-5 text-v2-text-text-base">{props.title}</p>
      <Show when={props.detail}>
        {(detail) => <p class="text-12-regular break-words text-v2-text-text-muted">{detail()}</p>}
      </Show>
      <p class="max-w-full font-mono text-[12px] leading-[18px] break-all text-v2-text-text-faint select-text">
        {props.path}
      </p>
    </div>
  )
}

function classify(bytes: Uint8Array, extension: string): Content {
  const image = images[extension]
  if (image) return { type: "image", url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: image })) }
  // A NUL byte early on is the usual sign of a binary file, as git decides.
  if (bytes.length > maxText || bytes.subarray(0, 8000).includes(0)) return { type: "unsupported" }
  const text = new TextDecoder().decode(bytes)
  return markdown.has(extension) ? { type: "markdown", text } : { type: "text", text }
}

function contentOf<Type extends Content["type"]>(content: Content, type: Type) {
  return content.type === type ? (content as Extract<Content, { type: Type }>) : undefined
}
