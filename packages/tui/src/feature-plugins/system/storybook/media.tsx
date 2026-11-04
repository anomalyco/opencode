import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { createSignal } from "solid-js"
import { isPlayableVideo, mediaKind, mediaMime, type MediaItem } from "../../../component/media/model"
import { MediaStrip } from "../../../component/media/strip"
import { useMedia } from "../../../context/media"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

/** The media in a `path.delimiter`-separated list of files and directories; missing paths and other files are skipped. */
export function parseStoryMedia(value: string): MediaItem[] {
  const files = value
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((entry) => {
      const resolved = path.resolve(entry)
      const stat = statSync(resolved, { throwIfNoEntry: false })
      if (!stat?.isDirectory()) return stat ? [resolved] : []
      return readdirSync(resolved, { withFileTypes: true })
        .filter((child) => child.isFile())
        .map((child) => path.join(resolved, child.name))
        .sort()
    })
  return [...new Set(files)].flatMap((file) => {
    const mime = mediaMime(file)
    return mime ? [{ id: file, kind: mediaKind(mime), mime, uri: "", name: path.basename(file), path: file }] : []
  })
}

// Without OPENCODE_STORY_MEDIA: the test fixtures, the website's clips in a repository checkout, and a WebM it can't play.
const builtIn = ["tui/test/fixture/media", "console/app/src/asset/lander"].map((directory) =>
  path.resolve(import.meta.dir, "../../../../..", directory),
)
const webm: MediaItem = { id: "webm", kind: "video", mime: "video/webm", uri: "", name: "screen-recording.webm" }
const items = parseStoryMedia(process.env.OPENCODE_STORY_MEDIA || builtIn.join(path.delimiter)).concat(webm)
const video = items.find(isPlayableVideo)
const widths = [44, 80, Infinity]

function MediaStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const media = useMedia()
  const theme = props.context.theme
  const [width, setWidth] = createSignal(0)
  const stripWidth = () => Math.min(widths[width()]!, dimensions().width - 4)
  const command = (bind: string, title: string, run: () => void) => ({ bind, title, group: "Storybook", run })
  const commands = [
    command("w", "width", () => setWidth((value) => (value + 1) % widths.length)),
    command("v", "viewer", () => media.openViewer(items, 0)),
    command("p", "picture-in-picture", () => video && media.openPip(video, { time: 1 })),
    command("r", "reset", () => {
      setWidth(0)
      media.closePip()
    }),
    command("escape", "back", () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" })),
  ]
  props.context.keymap.layer(() => ({ commands }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base}>
      <box flexGrow={1} padding={2}>
        <MediaStrip
          items={items}
          width={stripWidth()}
          height={Math.max(4, Math.min(8, Math.floor(dimensions().height / 4)))}
          onOpen={(index) => media.openViewer(items, index)}
        />
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / media"
        details={[`${items.length} items`, `${stripWidth()} cols`, `protocol ${media.protocol()}`]}
        message="Hover a video to play it silently; click a tile or +N more to open the viewer."
        controls={commands.map((entry) => ({ shortcut: entry.bind, label: entry.title }))}
      />
    </box>
  )
}

export const mediaStory: Story = {
  id: "media",
  title: "Media: inline tiles, viewer and picture-in-picture",
  render: (context) => <MediaStory context={context} />,
}
