import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { ImagePreview } from "@opencode/ui/image-preview"
import { getFilename } from "@opencode/util/path"
import { createMemo, Index, Match, onMount, Show, Switch } from "solid-js"
import { useData } from "../context"
import { createAttachmentMedia } from "../message/attachment-media"
import { resolveToolImageTarget } from "../message/attachment-media-machine"
import type { currentToolImages } from "../message/current-tool-state"

export type ToolImage = ReturnType<typeof currentToolImages>[number]

/**
 * The images calls returned to the model, as thumbnails that open full size. They show where the calls' row shows,
 * open or not, so what the agent looked at stays in view.
 */
export function ToolResultImages(props: { images: readonly ToolImage[]; onContentRendered?: () => void }) {
  return (
    <Show when={props.images.length > 0}>
      <Strip images={props.images} onContentRendered={props.onContentRendered} />
    </Show>
  )
}

function Strip(props: { images: readonly ToolImage[]; onContentRendered?: () => void }) {
  // Tiles have a fixed size, so the strip is as tall when it mounts as once its images load.
  onMount(() => props.onContentRendered?.())

  return (
    <div data-component="tool-result-images" data-focus-scope>
      <Index each={props.images}>{(image) => <Tile image={image()} />}</Index>
    </div>
  )
}

function Tile(props: { image: ToolImage }) {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()

  const file = (sessionID: string) => ({
    sessionID,
    callID: props.image.callID,
    index: props.image.index,
    mime: props.image.mime,
  })

  const media = createAttachmentMedia(
    createMemo(() =>
      resolveToolImageTarget(props.image, {
        peekMedia: data.peekMedia,
        hasReader: !!data.readMedia,
        peekToolFile: () => (data.sessionID ? data.toolFile?.peek(file(data.sessionID)) : undefined),
        hasToolFileReader: !!data.toolFile && !!data.sessionID,
      }),
    ),
    (uri, mime, signal) => {
      if (uri !== `data:${mime};base64,`) return data.readMedia?.(uri, mime, signal)

      return data.sessionID ? data.toolFile?.read(file(data.sessionID), signal) : undefined
    },
  )

  const name = () => getFilename(props.image.name ?? "") || i18n.t("ui.message.attachment.alt")

  return (
    <button
      type="button"
      data-slot="tool-result-image"
      data-placeholder={media.view().placeholder ? "" : undefined}
      data-retry={media.view().canRetry ? "" : undefined}
      disabled={!media.view().clickable}
      title={props.image.name ?? undefined}
      onClick={(event) => {
        const src = media.view().src
        const origin = event.currentTarget

        if (src) return dialog.show(() => <ImagePreview src={src} alt={name()} origin={origin} />)

        if (media.view().canRetry) media.retry()
      }}
    >
      <Switch>
        <Match when={media.view().src}>{(src) => <img src={src()} alt={name()} />}</Match>
        <Match when={media.view().status === "failed"}>
          <span
            data-slot="tool-result-image-icon"
            role="img"
            aria-label={i18n.t("ui.fileMedia.state.error", { kind: i18n.t("ui.fileMedia.kind.image") })}
          >
            <Icon name="outline-photo" size="small" />
          </span>
        </Match>
      </Switch>
    </button>
  )
}
