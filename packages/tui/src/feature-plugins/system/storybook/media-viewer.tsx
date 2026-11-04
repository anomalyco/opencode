import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { existsSync } from "node:fs"
import path from "node:path"
import { For } from "solid-js"
import type { MediaItem } from "../../../component/media/model"
import { MediaTile } from "../../../component/media/tile"
import { useMedia } from "../../../context/media"
import type { Story } from "./index"
import { StoryFooter } from "./footer"
import { storyMedia, storyMediaItem } from "./media"

const fixtures = path.resolve(import.meta.dir, "../../../../test/fixture/media")
// The website's H.264 clips make a full-size demo in a development checkout; a build without them skips them.
const lander = path.resolve(import.meta.dir, "../../../../../console/app/src/asset/lander")

const custom = storyMedia?.items.length ? storyMedia.items : undefined
const gallery: MediaItem[] =
  custom ??
  [
    path.join(fixtures, "image.png"),
    path.join(lander, "screenshot.png"),
    path.join(lander, "opencode-min.mp4"),
    path.join(fixtures, "video-only.mp4"),
    path.join(lander, "desktop-tabs-landscape.mp4"),
    path.join(lander, "opencode-comparison-min.mp4"),
  ]
    .filter((file) => existsSync(file))
    .map((file) => storyMediaItem(file))
    .concat({ id: "story:webm", kind: "video", mime: "video/webm", uri: "", name: "screen-recording.webm" })
const message = custom
  ? undefined
  : storyMedia
    ? "No media found in OPENCODE_STORY_MEDIA; showing the built-in files"
    : existsSync(lander)
      ? undefined
      : "Website clips not found; showing the test fixtures only"

function MediaViewerStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const media = useMedia()
  const theme = props.context.theme
  const first = (kind: MediaItem["kind"]) =>
    Math.max(
      0,
      gallery.findIndex((entry) => entry.kind === kind),
    )
  // A full-size website clip for the built-in list; the first video of a custom one.
  const pipVideo = () =>
    gallery.find((entry) => entry.kind === "video" && (custom || entry.path?.startsWith(lander))) ??
    gallery[first("video")]!
  const open = (index: number, playing?: boolean) => media.openViewer(gallery, index, { playing })

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "i", title: "Open the viewer at an image", group: "Storybook", run: () => open(first("image")) },
      { bind: "v", title: "Open the viewer at a video", group: "Storybook", run: () => open(first("video")) },
      {
        bind: "s",
        title: "Open the viewer at a paused video",
        group: "Storybook",
        run: () => open(first("video"), false),
      },
      ...(custom
        ? []
        : [
            {
              bind: "u",
              title: "Open the viewer at an unsupported video",
              group: "Storybook",
              run: () => open(gallery.length - 1),
            },
          ]),
      {
        bind: "p",
        title: "Open picture-in-picture",
        group: "Storybook",
        run: () => media.openPip(pipVideo(), { time: 2 }),
      },
      {
        bind: "r",
        title: "Reset",
        group: "Storybook",
        run: () => {
          media.closeViewer()
          media.closePip()
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <box flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2} flexDirection="column" gap={1}>
        <text fg={theme.text.base}>Session media</text>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={gallery}>
            {(entry, index) => <MediaTile item={entry} width={20} height={6} onOpen={() => open(index())} />}
          </For>
        </box>
        <text fg={theme.text.muted}>Hover a video tile to preview it; click a tile to open the viewer there.</text>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / media viewer"
        details={[
          `${gallery.length} items`,
          ...(custom ? [storyMedia!.label] : []),
          `protocol ${media.capabilities().protocol}`,
        ]}
        message={message}
        controls={[
          { shortcut: "i", label: "image" },
          { shortcut: "v", label: "video" },
          { shortcut: "s", label: "paused video" },
          ...(custom ? [] : [{ shortcut: "u", label: "unsupported" }]),
          { shortcut: "p", label: "picture-in-picture" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const mediaViewerStory: Story = {
  id: "media-viewer",
  title: "Media viewer and picture-in-picture",
  render: (context) => <MediaViewerStory context={context} />,
}
