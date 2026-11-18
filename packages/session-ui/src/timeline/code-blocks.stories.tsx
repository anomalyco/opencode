import { createSignal } from "solid-js"
import type { SessionDocument } from "../document"
import { MarkdownProvider } from "../context/markdown"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Code blocks",
  id: "current-session-code-blocks",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

const earlier = [
  "The type check passes locally on Bun 1.4.4 with the default heap. CI uses the same lockfile, so the difference is",
  "in how the runner starts the process rather than in the dependencies.",
].join(" ")

const reply = [
  "The runner sets `NODE_OPTIONS` before install, so the type check runs out of memory. Reproduce it with:",
  "",
  "```sh",
  'NODE_OPTIONS="--max-old-space-size=4096 --enable-source-maps" bun install --frozen-lockfile --filter "@opencode/session-ui" && bun run --cwd packages/session-ui typecheck:tsc',
  "```",
  "",
  "The failing line reads the setting before the override:",
  "",
  "```ts",
  "export const resolveCodeBlockPreference = (settings: Settings, block: MarkdownCodeBlock, override?: boolean) => override ?? settings.general.wrapCodeBlocks()",
  "return resolveCodeBlockPreference(settings, block)",
  "```",
  "",
  "Then run the check again:",
  "",
  "```sh",
  "bun typecheck",
  "```",
].join("\n")

export const LongLines = {
  args: { wrap: false },
  render: (args: { wrap: boolean }) => <CodeBlockTimeline wrap={args.wrap} />,
}

// The timeline scrolls inside its own pane below the setting, as it does in the app.
function CodeBlockTimeline(props: { wrap: boolean }) {
  const [wrap, setWrap] = createSignal(props.wrap)

  const document: SessionDocument = {
    sessionID: CURRENT_SESSION_ID,
    status: { type: "idle" },
    diffs: [],
    messages: [
      {
        id: "msg_code_blocks_earlier_user",
        type: "user",
        text: "Does the type check pass locally?",
        time: { created: STORY_TIME },
        metadata: { agent: "build", model: STORY_MODEL },
      },
      {
        id: "msg_code_blocks_earlier_assistant",
        type: "assistant",
        agent: "build",
        model: STORY_MODEL,
        time: { created: STORY_TIME + 100, completed: STORY_TIME + 2000 },
        content: [{ type: "text", text: earlier }],
      },
      {
        id: "msg_code_blocks_user",
        type: "user",
        text: "Why does the type check fail on CI but not locally?",
        time: { created: STORY_TIME + 3000 },
        metadata: { agent: "build", model: STORY_MODEL },
      },
      {
        id: "msg_code_blocks_assistant",
        type: "assistant",
        agent: "build",
        model: STORY_MODEL,
        time: { created: STORY_TIME + 3100, completed: STORY_TIME + 7000 },
        content: [{ type: "text", text: reply }],
      },
    ],
  }

  return (
    <div class="flex h-screen flex-col">
      <label class="mx-auto flex w-full max-w-[744px] items-center gap-2 px-6 py-3 text-13-regular text-v2-text-text-muted">
        <input type="checkbox" checked={wrap()} onChange={(event) => setWrap(event.currentTarget.checked)} />
        Wrap code blocks
      </label>
      <div data-scrollable data-testid="code-blocks-scroll" class="min-h-0 flex-1 overflow-y-auto">
        <section class="mx-auto w-full max-w-[744px] px-6 pb-10">
          <MarkdownProvider codeWrap={wrap()}>
            <CurrentSessionProviders document={document}>
              <SessionTimeline document={document} />
            </CurrentSessionProviders>
          </MarkdownProvider>
        </section>
      </div>
    </div>
  )
}
