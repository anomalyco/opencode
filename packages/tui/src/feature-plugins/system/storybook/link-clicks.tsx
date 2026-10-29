import type { Plugin } from "@opencode/plugin/tui"
import type { SessionMessageAssistant, SessionMessageAssistantText } from "@opencode/client"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal } from "solid-js"
import { useConfig } from "../../../config"
import { createTimelineAnchors } from "../../../routes/session/anchors"
import { TextPart } from "../../../routes/session/message-parts"
import { context } from "../../../routes/session/render-context"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

const text = `Click, double-click, drag, right-click, or Ctrl/Shift+click the links below.

**Long bare URL:** https://www.rockauto.com/en/catalog/dodge,2004,ram+1500,4.7l+v8,1432463,brake+&+wheel+hub,brake+pad,1684

**Named link:** read [the OpenTUI terminal capabilities guide](https://github.com/anomalyco/opentui/blob/main/packages/core/docs/terminal-capabilities.mdx) for details.

**URL in inline code (not linked):** \`https://github.com/anomalyco/opencode/issues/51727#issuecomment-wrapped-link\`

**Relative link (not http):** see [link.tsx](packages/tui/src/ui/link.tsx).

| Issue | Link |
| --- | --- |
| Wrapped links | https://github.com/anomalyco/opencode/issues/51727 |
| Ctrl+click | https://github.com/anomalyco/opencode/issues/44442 |

- A list item ending in https://example.com/a/very/long/path/that/keeps/going/until/it/wraps/around`

const part: SessionMessageAssistantText = { type: "text", text }
const message: SessionMessageAssistant = {
  id: "link-clicks",
  type: "assistant",
  agent: "build",
  model: { providerID: "fixture", id: "fixture" },
  time: { created: 0, completed: 1 },
  content: [part],
}

function LinkClicksStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const config = useConfig()
  const [narrow, setNarrow] = createSignal(true)
  const [markdownMode, setMarkdownMode] = createSignal<"source" | "rendered">("rendered")
  const width = () => (narrow() ? Math.min(48, dimensions().width) : dimensions().width)

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "w",
        title: "Toggle narrow width",
        group: "Storybook",
        run: () => setNarrow((value) => !value),
      },
      {
        bind: "m",
        title: "Toggle markdown mode",
        group: "Storybook",
        run: () => setMarkdownMode((mode) => (mode === "rendered" ? "source" : "rendered")),
      },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.base}
    >
      <context.Provider
        value={{
          get width() {
            return width()
          },
          get terminal() {
            return dimensions()
          },
          sessionID: "link-clicks",
          anchors: createTimelineAnchors(),
          groupExpanded: () => true,
          setGroupExpanded: () => {},
          thinkingMode: () => "show",
          markdownMode,
          groupExploration: () => false,
          diffWrapMode: () => "word",
          models: () => [],
          messageIndex: () => undefined,
          legacyTurns: () => false,
          config: config.data,
          mutatePending: async () => false,
          pendingDelivery: () => undefined,
        }}
      >
        <scrollbox flexGrow={1} minHeight={0}>
          <box width={width()} paddingTop={1} paddingRight={2}>
            <TextPart part={part} message={message} last />
          </box>
        </scrollbox>
      </context.Provider>
      <StoryFooter
        context={props.context}
        title="storybook / Link clicks"
        details={[`${width()} cols`, markdownMode()]}
        controls={[
          { shortcut: "w", label: "narrow/full width" },
          { shortcut: "m", label: "rendered/source" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const linkClicksStory: Story = {
  id: "link-clicks",
  title: "Link clicks",
  render: (context) => <LinkClicksStory context={context} />,
}
