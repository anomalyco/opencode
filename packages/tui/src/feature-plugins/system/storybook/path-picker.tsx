import type { Plugin } from "@opencode/plugin/tui"
import type { SessionMessageAssistant, SessionMessageAssistantText } from "@opencode/client"
import { useTerminalDimensions } from "@opentui/solid"
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createSignal } from "solid-js"
import { useConfig } from "../../../config"
import { createTimelineAnchors } from "../../../routes/session/anchors"
import { TextPart } from "../../../routes/session/message-parts"
import { createPathLinks, PathLinksBar } from "../../../routes/session/path-links"
import { context } from "../../../routes/session/render-context"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

const fixture = createFixture()

function createFixture() {
  const base = path.join(os.tmpdir(), "opencode-path-links-story")
  mkdirSync(path.join(base, "out"), { recursive: true })
  mkdirSync(path.join(base, "reports"), { recursive: true })
  mkdirSync(path.join(base, "logs"), { recursive: true })
  writeFileSync(path.join(base, "out", "report.md"), "# report\n")
  writeFileSync(path.join(base, "notes.txt"), "notes\n")
  writeFileSync(path.join(base, "reports", "final notes.md"), "final\n")
  writeFileSync(path.join(base, "logs", "run.txt"), "log\n")
  for (const number of [1, 2, 3, 4, 5]) writeFileSync(path.join(base, "logs", `${number}.log`), "log\n")
  const absolute = path.join(base, "logs", "run.txt")
  const text = [
    "I wrote the deliverables:",
    "",
    "- Report: `out/report.md`",
    "- Same file with a location: out/report.md:12:3",
    "- Folder: out/",
    '- Notes with spaces: "reports/final notes.md"',
    `- Absolute: \`${absolute}:7\``,
    `- File URL: <${pathToFileURL(path.join(base, "notes.txt")).href}#L4C2>`,
    "- Missing: /definitely-missing/opencode-story.txt",
    "- Generated: `logs/1.log`, `logs/2.log`, `logs/3.log`, `logs/4.log`, `logs/5.log`",
    "",
    "```sh",
    "cat out/report.md   # fenced code is ignored",
    "```",
    "",
    "URLs like https://example.com/out/report.md and commands like `npm install` stay plain.",
  ].join("\n")
  const part: SessionMessageAssistantText = { type: "text", text }
  const message: SessionMessageAssistant = {
    id: "path-picker",
    type: "assistant",
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    time: { created: 0, completed: 1 },
    content: [part],
  }
  return { base, part, message }
}

function PathPickerStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const config = useConfig()
  const [narrow, setNarrow] = createSignal(true)
  const width = () => (narrow() ? Math.min(64, dimensions().width) : dimensions().width)
  const pathLinks = createPathLinks({
    messages: () => [fixture.message],
    base: () => fixture.base,
  })

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "p",
        title: "Open path picker",
        group: "Storybook",
        run: () => pathLinks.activate(),
      },
      {
        bind: "w",
        title: "Toggle narrow width",
        group: "Storybook",
        run: () => setNarrow((value) => !value),
      },
      {
        bind: "r",
        title: "Reset path picker",
        group: "Storybook",
        run: () => pathLinks.close(),
      },
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => {
          if (pathLinks.active()) return pathLinks.close()
          props.context.ui.router.navigate({ type: "plugin", name: "storybook" })
        },
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
          sessionID: "path-picker",
          anchors: createTimelineAnchors(),
          groupExpanded: () => true,
          setGroupExpanded: () => {},
          thinkingMode: () => "show",
          markdownMode: () => "rendered",
          groupExploration: () => false,
          diffWrapMode: () => "word",
          models: () => [],
          messageIndex: () => undefined,
          legacyTurns: () => false,
          config: config.data,
          mutatePending: async () => false,
          pendingDelivery: () => undefined,
          pathLinks: pathLinks.mark,
          pathLinkSyntax: pathLinks.syntax,
        }}
      >
        <scrollbox flexGrow={1} minHeight={0}>
          <box width={width()} paddingTop={1} paddingRight={2}>
            <TextPart part={fixture.part} message={fixture.message} partID="text:0" last />
          </box>
        </scrollbox>
      </context.Provider>
      <PathLinksBar state={pathLinks.state()} />
      <StoryFooter
        context={props.context}
        title="storybook / Path picker"
        details={[`${width()} cols`, `${fixture.base}`]}
        controls={[
          { shortcut: "p", label: "open/close picker" },
          { shortcut: "digits", label: "choose/toggle path" },
          { shortcut: "m", label: "multiple mode" },
          { shortcut: "a", label: "all/clear" },
          { shortcut: "enter", label: "open selected" },
          { shortcut: "w", label: "narrow/full width" },
          { shortcut: "r", label: "reset" },
        ]}
      />
    </box>
  )
}

export const pathPickerStory: Story = {
  id: "path-picker",
  title: "Path picker",
  render: (context) => <PathPickerStory context={context} />,
}
