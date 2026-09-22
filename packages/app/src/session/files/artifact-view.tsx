import { createEffect, createMemo, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { FileIcon } from "@opencode/ui/file-icon"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { getDirectory, getFilename } from "@opencode/util/path"
import type { FileContent } from "@/runtime/server/types"
import { useLanguage } from "@/runtime/i18n/language"
import {
  artifactKind,
  blobUrlFromContent,
  contentBytes,
  parseDelimited,
  resolveArtifactPath,
  type ArtifactKind,
} from "@/workspaces/files/artifact"
import { useArtifactOpener } from "@/session/files/open-artifact"
import "./artifact-view.css"

type ArtifactMode = "preview" | "source"

/** Facts a viewer learns from the decoded media, shown in the toolbar. */
type ArtifactInfo = { width?: number; height?: number; duration?: number; rows?: number; columns?: number }

type MediaProps = {
  path: string
  content: FileContent
  onInfo: (info: ArtifactInfo) => void
  /** The browser could not decode the bytes; the host falls back to the binary placeholder. */
  onError: () => void
}

/** Kinds that render a preview from their text and can toggle back to highlighted source. */
const previewableKinds = new Set<ArtifactKind>(["svg", "html", "markdown", "mermaid", "table"])

/**
 * Renders a loaded non-text file: media, documents, and data get a dedicated viewer with a toolbar;
 * previewable text kinds can switch to `source`, which the host supplies (its code view).
 */
export function ArtifactView(props: { path: string; content: FileContent; cacheKey?: string; source: JSX.Element }) {
  const language = useLanguage()
  const [state, setState] = createStore({
    mode: "preview" as ArtifactMode,
    info: {} as ArtifactInfo,
    // Media the browser could not decode falls back to the binary placeholder.
    undecodable: false,
  })
  createEffect(
    on(
      () => props.content,
      () => setState({ mode: "preview", info: {}, undecodable: false }),
      { defer: true },
    ),
  )

  const kind = createMemo<ArtifactKind | "binary">(() => {
    if (props.content.type === "binary" && !props.content.mimeType) return "binary"
    if (state.undecodable) return "binary"
    return artifactKind(props.path)
  })
  const previewable = createMemo(() => {
    const value = kind()
    return value !== "binary" && previewableKinds.has(value)
  })
  const meta = createMemo(() => {
    const info = state.info
    return [
      info.width && info.height ? `${info.width} × ${info.height}` : undefined,
      info.duration ? formatDuration(info.duration) : undefined,
      info.rows !== undefined ? language.plural("file.view.table.rows", Math.max(0, info.rows - 1)) : undefined,
      info.columns !== undefined ? language.plural("file.view.table.columns", info.columns) : undefined,
      formatBytes(language.intl(), contentBytes(props.content)),
    ].filter((item): item is string => !!item)
  })

  const media = { onInfo: (info: ArtifactInfo) => setState("info", info), onError: () => setState("undecodable", true) }
  const rendered = () => (
    <ScrollView class="min-h-0 flex-1">
      <Show
        when={kind() === "markdown"}
        fallback={<ArtifactMermaid text={props.content.content} cacheKey={props.cacheKey} />}
      >
        <ArtifactMarkdown path={props.path} text={props.content.content} cacheKey={props.cacheKey} />
      </Show>
    </ScrollView>
  )

  return (
    <>
      <ArtifactToolbar
        mode={state.mode}
        onModeChange={previewable() ? (mode) => setState("mode", mode) : undefined}
        meta={meta()}
        actions={
          <Show when={kind() === "html"}>
            <OpenInBrowserButton path={props.path} />
          </Show>
        }
      />
      <Show when={!previewable() || state.mode === "preview"} fallback={props.source}>
        <Switch>
          <Match when={kind() === "image" || kind() === "svg"}>
            <ArtifactImage path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "video"}>
            <ArtifactVideo path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "audio"}>
            <ArtifactAudio path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "pdf" || kind() === "html"}>
            <ArtifactFrame path={props.path} content={props.content} kind={kind() === "pdf" ? "pdf" : "html"} />
          </Match>
          <Match when={kind() === "font"}>
            <ArtifactFont path={props.path} content={props.content} />
          </Match>
          <Match when={kind() === "table"}>
            <ArtifactTable path={props.path} text={props.content.content} onInfo={media.onInfo} />
          </Match>
          <Match when={kind() === "markdown" || kind() === "mermaid"}>{rendered()}</Match>
          <Match when={kind() === "binary"}>
            <ArtifactBinary path={props.path} size={formatBytes(language.intl(), contentBytes(props.content))} />
          </Match>
        </Switch>
      </Show>
    </>
  )
}

function formatBytes(locale: string, bytes: number) {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const
  const index = Math.min(units.length - 1, bytes > 0 ? Math.floor(Math.log10(bytes) / 3) : 0)
  const value = bytes / 1000 ** index
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[index],
    // "short" bytes render as the singular "byte"; the long form pluralizes correctly.
    unitDisplay: index === 0 ? "long" : "short",
    maximumFractionDigits: value >= 100 || index === 0 ? 0 : 1,
  }).format(value)
}

function formatDuration(seconds: number) {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, "0")}`
}

function ArtifactToolbar(props: {
  mode?: ArtifactMode
  onModeChange?: (mode: ArtifactMode) => void
  meta: string[]
  actions?: JSX.Element
}) {
  const language = useLanguage()
  return (
    <div data-slot="artifact-toolbar" class="flex h-10 shrink-0 items-center gap-3 px-4">
      <Show when={props.onModeChange}>
        <SegmentedControl
          value={props.mode ?? "preview"}
          onChange={(value) => {
            if (value === "preview" || value === "source") props.onModeChange?.(value)
          }}
        >
          <SegmentedControlItem value="preview">{language.t("file.view.preview")}</SegmentedControlItem>
          <SegmentedControlItem value="source">{language.t("file.view.source")}</SegmentedControlItem>
        </SegmentedControl>
      </Show>
      <div class="ms-auto flex min-w-0 items-center gap-3">
        <div class="flex min-w-0 items-center gap-2 text-12-regular text-text-weak">
          <For each={props.meta}>
            {(item, index) => (
              <>
                <Show when={index() > 0}>
                  <span aria-hidden class="text-text-faint">
                    ·
                  </span>
                </Show>
                <span class="truncate tabular-nums">{item}</span>
              </>
            )}
          </For>
        </div>
        {props.actions}
      </div>
    </div>
  )
}

function OpenInBrowserButton(props: { path: string }) {
  const language = useLanguage()
  const artifacts = useArtifactOpener()
  return (
    <Show when={artifacts.canOpenInBrowser(props.path)}>
      <Button size="small" variant="ghost" icon="globe" onClick={() => artifacts.openInBrowser(props.path)}>
        {language.t("file.view.openInBrowser")}
      </Button>
    </Show>
  )
}

function createBlobUrl(content: () => FileContent) {
  return createMemo(() => {
    const value = blobUrlFromContent(content())
    onCleanup(() => URL.revokeObjectURL(value))
    return value
  })
}

/** Images and SVG previews: fit the pane, click to inspect at 1:1 when the image is larger. */
function ArtifactImage(props: MediaProps) {
  const url = createBlobUrl(() => props.content)
  const [state, setState] = createStore({ zoom: "fit" as "fit" | "actual", overflow: false, width: 0, height: 0 })
  let stage: HTMLDivElement | undefined
  const measure = () => {
    if (!stage) return
    setState("overflow", state.width > stage.clientWidth - 48 || state.height > stage.clientHeight - 48)
  }
  createResizeObserver(
    () => stage,
    () => measure(),
  )
  createEffect(() => {
    url()
    setState({ zoom: "fit", overflow: false })
  })
  return (
    <div
      ref={stage}
      data-slot="artifact-stage"
      data-checker
      data-zoom={state.zoom}
      data-overflow={state.overflow || undefined}
      class="relative min-h-0 flex-1 overflow-auto"
    >
      <div
        classList={{
          "absolute inset-0 flex items-center justify-center p-6": state.zoom === "fit",
          "flex min-h-full min-w-full w-max items-center justify-center p-6": state.zoom === "actual",
        }}
      >
        <img
          data-slot="artifact-media"
          src={url()}
          alt={getFilename(props.path)}
          draggable={false}
          onError={() => props.onError()}
          onLoad={(event) => {
            const image = event.currentTarget
            setState({ width: image.naturalWidth, height: image.naturalHeight })
            props.onInfo({ width: image.naturalWidth, height: image.naturalHeight })
            measure()
          }}
          onClick={() => {
            if (!state.overflow && state.zoom === "fit") return
            setState("zoom", state.zoom === "fit" ? "actual" : "fit")
          }}
        />
      </div>
    </div>
  )
}

function ArtifactVideo(props: MediaProps) {
  const url = createBlobUrl(() => props.content)
  return (
    <div data-slot="artifact-stage" data-zoom="fit" class="relative min-h-0 flex-1 overflow-hidden">
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <video
          data-slot="artifact-media"
          class="w-full bg-black"
          controls
          preload="metadata"
          playsinline
          onError={() => props.onError()}
          src={url()}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            props.onInfo({ width: video.videoWidth, height: video.videoHeight, duration: video.duration })
          }}
        />
      </div>
    </div>
  )
}

function ArtifactAudio(props: MediaProps) {
  const url = createBlobUrl(() => props.content)
  return (
    <div data-slot="artifact-stage" class="relative min-h-0 flex-1 overflow-auto">
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="flex w-full max-w-lg flex-col items-center gap-5 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-base px-8 py-8 shadow-[var(--v2-elevation-raised)]">
          <div class="flex size-14 items-center justify-center rounded-full bg-v2-background-bg-layer-02">
            <FileIcon node={{ path: props.path, type: "file" }} class="size-7" />
          </div>
          <div class="max-w-full truncate text-14-medium text-text-strong">{getFilename(props.path)}</div>
          <audio
            class="w-full"
            onError={() => props.onError()}
            controls
            preload="metadata"
            src={url()}
            onLoadedMetadata={(event) => props.onInfo({ duration: event.currentTarget.duration })}
          />
        </div>
      </div>
    </div>
  )
}

function ArtifactFrame(props: { path: string; content: FileContent; kind: "pdf" | "html" }) {
  const url = createBlobUrl(() => props.content)
  // PDF Open Parameters: start with the thumbnail pane closed and the page fitted to the pane width.
  const src = () => (props.kind === "pdf" ? `${url()}#navpanes=0&view=FitH` : url())
  return (
    <iframe
      class="block h-full w-full flex-1 border-0 bg-white"
      title={getFilename(props.path)}
      src={src()}
      // The PDF viewer is Chromium's own and does not run in a sandboxed frame. HTML runs as an
      // opaque origin: no app storage, cookies, or credentialed requests reach it.
      sandbox={props.kind === "html" ? "allow-scripts allow-popups allow-forms allow-modals" : undefined}
      referrerPolicy="no-referrer"
    />
  )
}

function ArtifactMarkdown(props: { path: string; text: string; cacheKey?: string }) {
  const parent = useMarkdown()
  const artifacts = useArtifactOpener()
  // getDirectory yields "/" for a root-level file, which would make relative links absolute.
  const dir = createMemo(() => (props.path.includes("/") || props.path.includes("\\") ? getDirectory(props.path) : ""))
  // Absolute references bypass the file's directory; relative ones resolve against it.
  const resolve = (href: string) => (/^([a-z]:)?\//i.test(href) ? href : (resolveArtifactPath(dir(), href) ?? href))
  return (
    <MarkdownProvider
      readImage={(src, signal) => parent?.readImage?.(resolve(src), signal) ?? Promise.resolve(undefined)}
      openLocalFile={(href) => artifacts.open(href, dir())}
    >
      <div class="mx-auto w-full max-w-3xl px-8 py-6">
        <Markdown text={props.text} cacheKey={props.cacheKey} class="select-text" />
      </div>
    </MarkdownProvider>
  )
}

/** Mermaid sources render through the same fenced-block pipeline the timeline uses. */
function ArtifactMermaid(props: { text: string; cacheKey?: string }) {
  return (
    <div class="mx-auto w-full max-w-4xl px-8 py-6">
      <Markdown text={`\`\`\`mermaid\n${props.text}\n\`\`\``} cacheKey={props.cacheKey} class="select-text" />
    </div>
  )
}

function ArtifactTable(props: { path: string; text: string; onInfo: (info: ArtifactInfo) => void }) {
  const language = useLanguage()
  const parsed = createMemo(() => parseDelimited(props.text, props.path.toLowerCase().endsWith(".tsv") ? "\t" : ","))
  createEffect(() => props.onInfo({ rows: parsed().total, columns: parsed().columns }))
  // Pad the header to the widest row so no data column is dropped.
  const header = () => Array.from({ length: parsed().columns }, (_, index) => parsed().rows[0]?.[index] ?? "")
  const body = () => parsed().rows.slice(1)
  return (
    <div class="min-h-0 flex-1 overflow-auto">
      <table data-slot="artifact-table" class="min-w-full text-13-regular text-text-base">
        <thead>
          <tr>
            <th data-index />
            <For each={header()}>{(cell) => <th>{cell}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={body()}>
            {(row, index) => (
              <tr>
                <td data-index>{index() + 1}</td>
                <For each={header()}>{(_, column) => <td>{row[column()] ?? ""}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={parsed().total > parsed().rows.length}>
        <div class="px-4 py-3 text-12-regular text-text-weak">
          {language.t("file.view.table.truncated", { shown: parsed().rows.length - 1, total: parsed().total - 1 })}
        </div>
      </Show>
    </div>
  )
}

const specimenSizes = [12, 16, 24, 40, 64]

function ArtifactFont(props: { path: string; content: FileContent }) {
  const language = useLanguage()
  const url = createBlobUrl(() => props.content)
  const family = createMemo(() => `artifact-${Math.random().toString(36).slice(2)}`)
  createEffect(() => {
    const face = new FontFace(family(), `url(${url()})`)
    document.fonts.add(face)
    void face.load().catch(() => undefined)
    onCleanup(() => document.fonts.delete(face))
  })
  return (
    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8" style={{ "font-family": `"${family()}"` }}>
        <div class="text-text-strong" style={{ "font-size": "56px", "line-height": "1.1" }}>
          {getFilename(props.path).replace(/\.[^.]+$/, "")}
        </div>
        <div class="break-all text-text-base" style={{ "font-size": "22px", "line-height": "1.4" }}>
          ABCDEFGHIJKLMNOPQRSTUVWXYZ
          <br />
          abcdefghijklmnopqrstuvwxyz
          <br />
          0123456789 !?&@#%(){}[]
        </div>
        <div class="flex flex-col gap-3 border-t border-v2-border-border-muted pt-6">
          <For each={specimenSizes}>
            {(size) => (
              <div class="flex items-baseline gap-4">
                <span
                  class="w-8 shrink-0 text-12-regular text-text-faint tabular-nums"
                  style={{ "font-family": "var(--font-family-mono)" }}
                >
                  {size}
                </span>
                <span class="text-text-base" style={{ "font-size": `${size}px`, "line-height": "1.25" }}>
                  {language.t("file.view.fontSample")}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

function ArtifactBinary(props: { path: string; size: string }) {
  const language = useLanguage()
  return (
    <div data-slot="artifact-stage" class="relative min-h-0 flex-1">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <FileIcon node={{ path: props.path, type: "file" }} class="size-8 text-text-weak" />
        <div class="text-14-medium text-text-strong">{getFilename(props.path)}</div>
        <div class="text-13-regular text-text-weak">{language.t("file.view.binary", { size: props.size })}</div>
      </div>
    </div>
  )
}
