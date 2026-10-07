import { createMemo, createSignal, ErrorBoundary, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { FileIcon } from "@opencode/ui/file-icon"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { artifactKind, type ArtifactKind } from "@opencode/util/artifact"
import { getDirectory, getFilename } from "@opencode/util/path"
import { createKeyed, useExtension, type FileContent, type MountedSession } from "../sdk"
import { blobUrlFromContent, bytesFromContent, contentBytes, parseDelimited, resolveArtifactPath } from "./artifact"
import { current, useShared } from "./context"
import { FileViewer } from "./contract"
import { workspaceFileUrl } from "./path"

type ArtifactMode = "preview" | "source"

/** Facts a viewer learns from the decoded media, shown in the toolbar. */
type ArtifactInfo = {
  width?: number
  height?: number
  duration?: number
  rows?: number
  columns?: number
  /** Facts an extension's viewer reports, already localized. */
  details?: readonly string[]
}

type ViewerState = {
  readonly mode: ArtifactMode
  readonly info: ArtifactInfo
  readonly undecodable: boolean
  /** Why the file shows as binary, when a viewer said. */
  readonly reason?: string
}

type ImageZoom = { readonly url: string; readonly zoom: "fit" | "actual"; readonly overflow: boolean }

type MediaProps = {
  path: string
  content: FileContent
  onInfo: (info: ArtifactInfo) => void
  /** The browser could not decode the bytes; the host falls back to the binary placeholder. */
  onError: () => void
}

/** Kinds that render a preview from their text and can toggle back to highlighted source. */
const previewableKinds: readonly ArtifactKind[] = ["svg", "html", "markdown", "mermaid", "table"]

/**
 * Renders a loaded non-text file: media, documents, and data get a dedicated viewer with a toolbar;
 * previewable text kinds can switch to `source`, which the host supplies (its code view).
 */
export default function ArtifactView(props: {
  session: MountedSession
  path: string
  content: FileContent
  cacheKey?: string
  source: JSX.Element
}) {
  const ctx = useExtension()
  const locale = ctx.locale
  // Media the browser could not decode falls back to the binary placeholder.
  const initial: ViewerState = { mode: "preview", info: {}, undecodable: false }
  // The viewer state belongs to one loaded content: a reloaded file starts from the preview again.
  const [saved, setSaved] = createSignal({ ...initial, content: props.content })

  const state = () => {
    const value = saved()

    return value.content === props.content ? value : initial
  }

  const change = (next: Partial<ViewerState>) => setSaved({ ...state(), ...next, content: props.content })

  const kind = createMemo<ArtifactKind | "binary">(() => {
    if (props.content.type === "binary" && !props.content.mimeType) return "binary"

    if (state().undecodable) return "binary"

    return artifactKind(props.path)
  })

  const previewable = createMemo(() => {
    const value = kind()

    return value !== "binary" && previewableKinds.includes(value)
  })

  const table = createMemo(() =>
    kind() === "table"
      ? parseDelimited(props.content.content, props.path.toLowerCase().endsWith(".tsv") ? "\t" : ",")
      : undefined,
  )

  const meta = createMemo(() => {
    const parsed = table()
    const info: ArtifactInfo = parsed ? { rows: parsed.total, columns: parsed.columns } : state().info

    return [
      info.width && info.height ? `${info.width} × ${info.height}` : undefined,
      info.duration ? formatDuration(info.duration) : undefined,
      info.rows !== undefined ? ctx.plural("view.table.rows", Math.max(0, info.rows - 1)) : undefined,
      info.columns !== undefined ? ctx.plural("view.table.columns", info.columns) : undefined,
      ...(info.details ?? []),
      formatBytes(locale.locale(), contentBytes(props.content)),
    ].filter((item): item is string => !!item)
  })

  // A file that fails also drops the facts its viewer reported, such as a page count.
  const fail = (reason?: string) => change({ undecodable: true, info: {}, reason })

  const media = { onInfo: (info: ArtifactInfo) => change({ info }), onError: () => fail() }

  const size = () => formatBytes(locale.locale(), contentBytes(props.content))

  // A kind the file view does not render itself goes to the first extension viewer that lists it.
  const viewer = createMemo(() => {
    const value = kind()

    return value === "binary" ? undefined : ctx.list(FileViewer).find((item) => item.kinds.includes(value))
  })

  const rendered = () => (
    <ScrollView class="min-h-0 flex-1">
      <Show
        when={kind() === "markdown"}
        fallback={<ArtifactMermaid text={props.content.content} cacheKey={props.cacheKey} />}
      >
        <ArtifactMarkdown
          session={props.session}
          path={props.path}
          text={props.content.content}
          cacheKey={props.cacheKey}
        />
      </Show>
    </ScrollView>
  )

  return (
    <>
      <ArtifactToolbar
        mode={state().mode}
        onModeChange={previewable() ? (mode) => change({ mode }) : undefined}
        meta={meta()}
        actions={
          <Show when={kind() === "html"}>
            <OpenInBrowserButton session={props.session} path={props.path} />
          </Show>
        }
      />
      <Show when={!previewable() || state().mode === "preview"} fallback={props.source}>
        <Switch fallback={<ArtifactBinary path={props.path} size={size()} reason={state().reason} />}>
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
          <Match when={table()}>{(parsed) => <ArtifactTable parsed={parsed()} />}</Match>
          <Match when={kind() === "markdown" || kind() === "mermaid"}>{rendered()}</Match>
          {/* Keyed, so another viewer for the file mounts with bytes of its own. */}
          <Match when={viewer()} keyed>
            {(viewer) => (
              <ArtifactViewer
                viewer={viewer}
                path={props.path}
                size={size()}
                content={props.content}
                onDetails={(details) => change({ info: { details } })}
                onError={fail}
              />
            )}
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
  const ctx = useExtension()

  return (
    <div data-slot="artifact-toolbar" class="flex h-10 shrink-0 items-center gap-3 px-4">
      <Show when={props.onModeChange}>
        <SegmentedControl
          value={props.mode ?? "preview"}
          onChange={(value) => {
            if (value === "preview" || value === "source") props.onModeChange?.(value)
          }}
        >
          <SegmentedControlItem value="preview">{ctx.t("view.preview")}</SegmentedControlItem>
          <SegmentedControlItem value="source">{ctx.t("view.source")}</SegmentedControlItem>
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

/** Shows only while the browser pane is active and can load the file. */
function OpenInBrowserButton(props: { session: MountedSession; path: string }) {
  const ctx = useExtension()
  const shared = useShared()

  const pane = () => {
    const browser = current(shared.browser())

    return browser?.canOpen(props.session, props.path) ? browser : undefined
  }

  return (
    <Show when={pane()}>
      {(browser) => (
        <Button
          size="small"
          variant="ghost"
          icon="globe"
          onClick={() => {
            // The screen's workspace root, read when the user acts.
            const root = ctx.screen.current()?.file.root

            if (root !== undefined) browser().open(props.session, workspaceFileUrl(root, props.path))
          }}
        >
          {ctx.t("view.openInBrowser")}
        </Button>
      )}
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
  const [size, setSize] = createStore({ width: 0, height: 0 })
  // Zoom belongs to one image: a new one starts fitted.
  const fitted = (): ImageZoom => ({ url: url(), zoom: "fit", overflow: false })
  const [saved, setSaved] = createSignal(fitted())

  const state = () => {
    const value = saved()

    return value.url === url() ? value : fitted()
  }

  let stage: HTMLDivElement | undefined

  const measure = () => {
    if (!stage) return

    setSaved({ ...state(), overflow: size.width > stage.clientWidth - 48 || size.height > stage.clientHeight - 48 })
  }

  createResizeObserver(
    () => stage,
    () => measure(),
  )

  return (
    <div
      ref={stage}
      data-slot="artifact-stage"
      data-checker
      data-zoom={state().zoom}
      data-overflow={state().overflow || undefined}
      class="relative min-h-0 flex-1 overflow-auto"
    >
      <div
        classList={{
          "absolute inset-0 flex items-center justify-center p-6": state().zoom === "fit",
          "flex min-h-full min-w-full w-max items-center justify-center p-6": state().zoom === "actual",
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

            setSize({ width: image.naturalWidth, height: image.naturalHeight })
            props.onInfo({ width: image.naturalWidth, height: image.naturalHeight })
            measure()
          }}
          onClick={() => {
            const value = state()

            if (!value.overflow && value.zoom === "fit") return

            setSaved({ ...value, zoom: value.zoom === "fit" ? "actual" : "fit" })
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

function ArtifactMarkdown(props: { session: MountedSession; path: string; text: string; cacheKey?: string }) {
  const ctx = useExtension()
  const links = ctx.links
  const parent = useMarkdown()
  // getDirectory yields "/" for a root-level file, which would make relative links absolute.
  const dir = createMemo(() => (props.path.includes("/") || props.path.includes("\\") ? getDirectory(props.path) : ""))
  // Absolute references bypass the file's directory; relative ones resolve against it.
  const resolve = (href: string) => (/^([a-z]:)?\//i.test(href) ? href : (resolveArtifactPath(dir(), href) ?? href))

  return (
    <MarkdownProvider
      readImage={(src, signal) => parent?.readImage?.(resolve(src), signal) ?? Promise.resolve(undefined)}
      openLocalFile={(href) => void links.open({ href, base: dir(), session: props.session })}
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

function ArtifactTable(props: { parsed: ReturnType<typeof parseDelimited> }) {
  const ctx = useExtension()
  const parsed = () => props.parsed
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
          {ctx.t("view.table.truncated", { shown: parsed().rows.length - 1, total: parsed().total - 1 })}
        </div>
      </Show>
    </div>
  )
}

const specimenSizes = [12, 16, 24, 40, 64]

function ArtifactFont(props: { path: string; content: FileContent }) {
  const ctx = useExtension()
  const url = createBlobUrl(() => props.content)
  const family = createMemo(() => `artifact-${Math.random().toString(36).slice(2)}`)

  // The document's font set holds the face while it shows.
  createKeyed(url, (source) => {
    const face = new FontFace(family(), `url(${source})`)

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
                  {ctx.t("view.fontSample")}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

/**
 * Hands a file to an extension's viewer, decoding its bytes once per loaded content; the viewer owns them, and may move
 * their buffer to a worker. Bytes the viewer rejects, and a viewer that throws, show the binary placeholder in this
 * area alone rather than the whole file panel failing.
 */
function ArtifactViewer(props: {
  viewer: FileViewer
  path: string
  size: string
  content: FileContent
  onDetails: (details: readonly string[]) => void
  onError: (reason?: string) => void
}) {
  // Checked together, so the check only ever reads bytes freshly decoded, never ones the viewer has moved away.
  const decoded = createMemo(() => {
    const bytes = bytesFromContent(props.content)

    return { bytes, problem: props.viewer.problem?.(bytes) }
  })

  return (
    <Show
      when={!decoded().problem}
      fallback={<ArtifactBinary path={props.path} size={props.size} reason={decoded().problem} />}
    >
      <ErrorBoundary
        // Taking the error makes Solid call this once per error, untracked, rather than render it as a reactive child.
        fallback={(_) => {
          // Fails the file as a rejection does: its details leave the toolbar, and a reloaded file mounts a new viewer.
          props.onError()

          return <ArtifactBinary path={props.path} size={props.size} />
        }}
      >
        <Dynamic
          component={props.viewer.View}
          bytes={decoded().bytes}
          onDetails={props.onDetails}
          onError={props.onError}
        />
      </ErrorBoundary>
    </Show>
  )
}

function ArtifactBinary(props: { path: string; size: string; reason?: string }) {
  const ctx = useExtension()

  return (
    <div data-slot="artifact-stage" class="relative min-h-0 flex-1">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <FileIcon node={{ path: props.path, type: "file" }} class="size-8 text-text-weak" />
        <div class="text-14-medium text-text-strong">{getFilename(props.path)}</div>
        <div class="text-13-regular text-text-weak">{ctx.t("view.binary", { size: props.size })}</div>
        <Show when={props.reason}>{(reason) => <div class="text-13-regular text-text-weak">{reason()}</div>}</Show>
      </div>
    </div>
  )
}
