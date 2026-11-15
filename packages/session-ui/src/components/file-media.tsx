import type { PresentationFileContent } from "../file-presentation"
import { createEffect, createMemo, createSignal, Match, on, onCleanup, Show, Switch, untrack, type JSX } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import {
  DISPOSED_FILE_MEDIA_EVENT,
  INITIAL_FILE_MEDIA_STATE,
  transitionFileMedia,
  viewFileMedia,
  type FileMediaEffect,
  type FileMediaEvent,
} from "./file-media-machine"
import {
  dataUrlFromMediaValue,
  hasMediaValue,
  isBinaryContent,
  mediaKindFromPath,
  normalizeMimeType,
  svgTextFromValue,
} from "../pierre/media"

export type FileMediaOptions = {
  mode?: "auto" | "off"
  path?: string
  current?: unknown
  before?: unknown
  after?: unknown
  deleted?: boolean
  readFile?: (path: string) => Promise<PresentationFileContent | undefined>
  onLoad?: () => void
  onError?: (ctx: { kind: "image" | "audio" | "svg" }) => void
}

function mediaValue(cfg: FileMediaOptions, mode: "image" | "audio") {
  if (cfg.current !== undefined) return cfg.current

  if (mode === "image") return cfg.after ?? cfg.before

  return cfg.after ?? cfg.before
}

export function FileMedia(props: { media?: FileMediaOptions; fallback: () => JSX.Element }) {
  const i18n = useI18n()

  let remote = INITIAL_FILE_MEDIA_STATE
  const [remoteState, setRemoteState] = createSignal(remote)
  let timer: ReturnType<typeof setTimeout> | undefined

  const cfg = () => props.media

  const kind = createMemo(() => {
    const media = cfg()

    if (!media || media.mode === "off") return

    return mediaKindFromPath(media.path)
  })

  const isBinary = createMemo(() => {
    const media = cfg()

    if (!media || media.mode === "off") return false

    if (kind()) return false

    return isBinaryContent(media.current)
  })

  const onLoad = () => props.media?.onLoad?.()

  const deleted = createMemo(() => {
    const media = cfg()
    const k = kind()

    if (!media || !k) return false

    if (media.deleted) return true

    if (k === "svg") return false

    if (media.current !== undefined) return false

    return !hasMediaValue(media.after) && hasMediaValue(media.before)
  })

  const direct = createMemo(() => {
    const media = cfg()
    const k = kind()

    if (!media || (k !== "image" && k !== "audio")) return

    return dataUrlFromMediaValue(mediaValue(media, k), k)
  })

  const request = createMemo(() => {
    const media = cfg()
    const k = kind()

    if (!media || (k !== "image" && k !== "audio")) return

    if (media.current !== undefined) return

    if (deleted()) return

    if (direct()) return

    if (!media.path || !media.readFile) return

    return {
      key: `${k}:${media.path}`,
      kind: k,
      path: media.path,
      readFile: media.readFile,
    }
  })

  const dispatch = (event: FileMediaEvent) => {
    const next = transitionFileMedia(remote, event)

    if (next.state === remote) return
    remote = next.state
    setRemoteState(remote)
    next.effects.forEach(run)
  }

  const run = (effect: FileMediaEffect) => {
    if (effect.type === "clear-timeout") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "arm-timeout") {
      timer = setTimeout(() => dispatch({ type: "read.timed-out", attempt: effect.attempt }), effect.delayMs)

      return
    }

    if (effect.type === "notify-error") return untrack(cfg)?.onError?.({ kind: effect.kind })

    const readFile = untrack(request)?.readFile

    // A read that throws synchronously, rejects or returns no data URL all settle as a failed read.
    void Promise.resolve()
      .then(() => readFile?.(effect.path))
      .then(
        (result) => {
          const src = dataUrlFromMediaValue(result, effect.kind)

          if (!src) return dispatch({ type: "read.failed", attempt: effect.attempt })

          const mime = effect.kind === "audio" ? normalizeMimeType(result?.mimeType) : undefined
          dispatch({ type: "read.succeeded", attempt: effect.attempt, media: { src, mime } })
        },
        () => dispatch({ type: "read.failed", attempt: effect.attempt }),
      )
  }

  createEffect(() => {
    const input = request()
    dispatch({ type: "request.changed", target: input && { key: input.key, kind: input.kind, path: input.path } })
  })

  onCleanup(() => dispatch(DISPOSED_FILE_MEDIA_EVENT))

  const view = createMemo(() => viewFileMedia(remoteState(), direct(), request()?.key))

  const svgSource = createMemo(() => {
    const media = cfg()

    if (!media || kind() !== "svg") return

    return svgTextFromValue(media.current)
  })

  const svgSrc = createMemo(() => {
    const media = cfg()

    if (!media || kind() !== "svg") return

    return dataUrlFromMediaValue(media.current, "svg")
  })

  const svgInvalid = createMemo(() => {
    const media = cfg()

    if (!media || kind() !== "svg") return

    if (svgSource() !== undefined) return

    if (!hasMediaValue(media.current)) return

    return [media.path, media.current] as const
  })

  createEffect(
    on(
      svgInvalid,
      (value) => {
        if (!value) return
        cfg()?.onError?.({ kind: "svg" })
      },
      { defer: true },
    ),
  )

  const kindLabel = (value: "image" | "audio") =>
    i18n.t(value === "image" ? "ui.fileMedia.kind.image" : "ui.fileMedia.kind.audio")

  return (
    <Switch>
      <Match when={kind() === "image" || kind() === "audio"}>
        <Show
          when={view().src}
          fallback={(() => {
            const media = cfg()
            const k = kind()

            if (!media || (k !== "image" && k !== "audio")) return props.fallback()
            const label = kindLabel(k)

            if (deleted()) {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-v2-text-text-faint">
                  {i18n.t("ui.fileMedia.state.removed", { kind: label })}
                </div>
              )
            }

            if (view().status === "loading") {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-v2-text-text-faint">
                  {i18n.t("ui.fileMedia.state.loading", { kind: label })}
                </div>
              )
            }

            if (view().status === "error") {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-v2-text-text-faint">
                  {i18n.t("ui.fileMedia.state.error", { kind: label })}
                </div>
              )
            }

            return (
              <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-v2-text-text-faint">
                {i18n.t("ui.fileMedia.state.unavailable", { kind: label })}
              </div>
            )
          })()}
        >
          {(value) => {
            const k = kind()

            if (k !== "image" && k !== "audio") return props.fallback()

            if (k === "image") {
              return (
                <div class="flex justify-center bg-background-stronger px-6 py-4">
                  <img
                    src={value()}
                    alt={cfg()?.path}
                    class="max-h-[60vh] max-w-full rounded border border-v2-border-border-base bg-background-base object-contain"
                    onLoad={onLoad}
                  />
                </div>
              )
            }

            return (
              <div class="flex justify-center bg-background-stronger px-6 py-4">
                <audio class="w-full max-w-xl" controls preload="metadata" onLoadedMetadata={onLoad}>
                  <source src={value()} type={view().mime} />
                </audio>
              </div>
            )
          }}
        </Show>
      </Match>
      <Match when={kind() === "svg"}>
        {(() => {
          if (svgSource() === undefined && svgSrc() == null) return props.fallback()

          return (
            <div class="flex flex-col gap-4 px-6 py-4">
              <Show when={svgSource() !== undefined}>{props.fallback()}</Show>
              <Show when={svgSrc()}>
                {(value) => (
                  <div class="flex justify-center">
                    <img
                      src={value()}
                      alt={cfg()?.path}
                      class="max-h-[60vh] max-w-full rounded border border-v2-border-border-base bg-background-base object-contain"
                      onLoad={onLoad}
                    />
                  </div>
                )}
              </Show>
            </div>
          )
        })()}
      </Match>
      <Match when={isBinary()}>
        <div class="flex min-h-56 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <div class="text-14-semibold text-v2-text-text-base">
            {cfg()?.path?.split("/").pop() ?? i18n.t("ui.fileMedia.binary.title")}
          </div>
          <div class="text-14-regular text-v2-text-text-faint">
            {(() => {
              const path = cfg()?.path

              if (!path) return i18n.t("ui.fileMedia.binary.description.default")

              return i18n.t("ui.fileMedia.binary.description.path", { path })
            })()}
          </div>
        </div>
      </Match>
      <Match when={true}>{props.fallback()}</Match>
    </Switch>
  )
}
