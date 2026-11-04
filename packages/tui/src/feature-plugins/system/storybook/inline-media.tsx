import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import path from "node:path"
import { createMemo, createSignal } from "solid-js"
import { useMedia } from "../../../context/media"
import { MediaStrip } from "../../../component/media/strip"
import type { Story } from "./index"
import { StoryFooter } from "./footer"
import { storyMedia, storyMediaItem } from "./media"

// The test fixtures are tiny; the lander clips are full HD and only exist in a repository checkout.
const root = path.resolve(import.meta.dir, "../../../../../..")
const fixture = (name: string) => path.join(root, "packages/tui/test/fixture/media", name)
const lander = (name: string) => path.join(root, "packages/console/app/src/asset/lander", name)

const custom = storyMedia?.items.length ? storyMedia.items : undefined
const pool = custom ?? [
  storyMediaItem(fixture("image.png"), "image-1"),
  storyMediaItem(fixture("video-only.mp4"), "video-1"),
  storyMediaItem(lander("opencode-min.mp4"), "lander-1"),
  storyMediaItem(lander("avatar-dax.png"), "image-2"),
  storyMediaItem(lander("desktop-tabs-landscape.mp4"), "lander-2"),
  storyMediaItem(lander("opencode-comparison-min.mp4"), "lander-3"),
  storyMediaItem(lander("avatar-jay.png"), "image-3"),
  storyMediaItem(fixture("video-only.mp4"), "video-2"),
]
const missing = storyMediaItem(fixture("missing.mp4"), "missing")
const widths = [44, 80, undefined] as const

function InlineMediaStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const media = useMedia()
  const theme = props.context.theme
  const [count, setCount] = createSignal(Math.min(4, pool.length))
  const [width, setWidth] = createSignal(0)
  const [failed, setFailed] = createSignal(false)
  // The second tile fails, or the only one when a short custom list shows a single tile.
  const items = createMemo(() =>
    pool
      .slice(0, count())
      .map((item, index, shown) => (failed() && index === Math.min(1, shown.length - 1) ? missing : item)),
  )
  const stripWidth = () => Math.min(widths[width()] ?? Infinity, dimensions().width - 4)
  // The sizes the transcript and composer use: a quarter of the terminal height, between 4 and 8 rows.
  const height = () => Math.max(4, Math.min(8, Math.floor(dimensions().height / 4)))
  const reset = () => {
    setCount(Math.min(4, pool.length))
    setWidth(0)
    setFailed(false)
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "+,=",
        title: "More media",
        group: "Storybook",
        run: () => setCount((value) => Math.min(pool.length, value + 1)),
      },
      { bind: "-", title: "Less media", group: "Storybook", run: () => setCount((value) => Math.max(1, value - 1)) },
      {
        bind: "w",
        title: "Cycle width",
        group: "Storybook",
        run: () => setWidth((value) => (value + 1) % widths.length),
      },
      { bind: "f", title: "Toggle failed item", group: "Storybook", run: () => setFailed((value) => !value) },
      { bind: "v", title: "Open viewer", group: "Storybook", run: () => media.openViewer(items(), 0) },
      { bind: "r", title: "Reset", group: "Storybook", run: reset },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={2} gap={1}>
        <text fg={theme.text.muted}>Transcript strip</text>
        <box width={stripWidth()} backgroundColor={theme.background.raised.base} paddingTop={1} paddingBottom={1}>
          <MediaStrip
            items={items()}
            width={stripWidth()}
            height={height()}
            onOpen={(index) => media.openViewer(items(), index)}
          />
        </box>
        <text fg={theme.text.muted}>Composer preview</text>
        <box width={stripWidth()}>
          <MediaStrip
            items={items().slice(0, 2)}
            width={stripWidth()}
            height={height()}
            onOpen={(index) => media.openViewer(items().slice(0, 2), index)}
          />
        </box>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / inline media"
        details={[
          `${items().length} items`,
          `${stripWidth()} cols`,
          ...(failed() ? ["failed item"] : []),
          ...(custom ? [storyMedia!.label] : []),
        ]}
        message={
          storyMedia && !custom
            ? "No media found in OPENCODE_STORY_MEDIA; showing the built-in files"
            : "Hover a video to play it silently; click a tile or +N more to open the viewer"
        }
        controls={[
          { shortcut: "+/-", label: "count" },
          { shortcut: "w", label: "width" },
          { shortcut: "f", label: "failed item" },
          { shortcut: "v", label: "viewer" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const inlineMediaStory: Story = {
  id: "inline-media",
  title: "Inline media",
  render: (context) => <InlineMediaStory context={context} />,
}
