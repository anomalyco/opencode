import { markdown } from "@opencode/ui/lab/fixtures"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { MarkdownProvider } from "../context/markdown"
import { Markdown } from "./markdown"

export default {
  title: "OpenCode/Conversation/Markdown response",
  id: "components-markdown",
  component: Markdown,
  parameters: {
    docs: {
      description: {
        component:
          "Production assistant Markdown with headings, lists, links, inline code, and fenced code. The preview uses the same sanitizer, worker, and copy actions as a Session response.",
      },
    },
  },
}

export const CompleteResponse = {
  args: { text: markdown },
  render: (args: { text: string }) => (
    <div class="mx-auto max-w-[760px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <Markdown text={args.text} />
    </div>
  ),
}

export const CompactResult = {
  args: { text: "Updated the Session status and verified it.\n\n- **12 tests passed**\n- `bun typecheck` passed" },
  render: (args: { text: string }) => (
    <div class="mx-auto max-w-[560px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <Markdown text={args.text} />
    </div>
  ),
}

const longCode = [
  "Reproduce it with:",
  "",
  "```sh",
  'NODE_OPTIONS="--max-old-space-size=4096 --enable-source-maps" bun install --frozen-lockfile --filter "@opencode/session-ui" && bun run --cwd packages/session-ui typecheck:tsc',
  "```",
  "",
  "The failing line:",
  "",
  "```ts",
  "export const resolveCodeBlockPreference = (settings: Settings, block: MarkdownCodeBlock, override?: boolean) => override ?? settings.general.wrapCodeBlocks()",
  "return resolveCodeBlockPreference(settings, block)",
  "```",
  "",
  "A short block never overflows, so it has no Wrap button:",
  "",
  "```sh",
  "bun typecheck",
  "```",
].join("\n")

export const LongCodeLines = {
  render: () => {
    const [wrap, setWrap] = createSignal(false)

    return (
      <div class="mx-auto flex max-w-[560px] flex-col gap-3">
        <label class="flex items-center gap-2 text-13-regular">
          <input type="checkbox" checked={wrap()} onChange={(event) => setWrap(event.currentTarget.checked)} />
          Wrap code blocks setting
        </label>
        <div class="rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
          <MarkdownProvider codeWrap={wrap()}>
            <Markdown text={longCode} />
          </MarkdownProvider>
        </div>
      </div>
    )
  },
}

export const Table = {
  render: () => (
    <div class="mx-auto max-w-[760px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <Markdown
        text={[
          "Crops on the outside, kitchen in the middle, farms at the bottom next to it.",
          "",
          "| | West | Centre | East |",
          "| --- | --- | --- | --- |",
          "| North | Lettuce ×2 | Tomato ×2 | Berry ×1 (pal food) |",
          "| Middle | Wheat ×1 + Mill | Palbox + Feed Box | Hot Spring + Pal Beds |",
          "| South | Ranch | Refrigerator · Electric Kitchen · Generator | Chest (overflow) |",
          "| Far south | Breeding Farm A | (walkway) | Breeding Farm B |",
        ].join("\n")}
      />
    </div>
  ),
}

const streamed =
  "Streaming Markdown now keeps existing elements alive while each newly arriving word fades into the response."

const playback = {
  args: { playback: "live" },
  argTypes: { playback: { options: ["live", "partial", "complete"] } },
}

function StreamingMarkdown(props: { playback: string; chunks: string[]; interval: number; loop?: boolean }) {
  const [count, setCount] = createSignal(1)

  createEffect(() => {
    const length = props.chunks.length

    if (props.playback === "complete") return setCount(length)

    if (props.playback === "partial") return setCount(Math.ceil(length / 2))
    setCount(1)

    const timer = setInterval(
      () =>
        setCount((value) => {
          if (value < length) return value + 1

          if (props.loop) return 1
          clearInterval(timer)

          return length
        }),
      props.interval,
    )

    onCleanup(() => clearInterval(timer))
  })

  return (
    <Markdown
      text={props.chunks.slice(0, count()).join("")}
      streaming={count() < props.chunks.length || (props.loop && props.playback === "live")}
    />
  )
}

export const StreamingResponse = {
  ...playback,
  render: (args: { playback: string }) => (
    <div class="mx-auto max-w-[760px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <StreamingMarkdown playback={args.playback} chunks={streamed.match(/\S+\s*/g) ?? []} interval={180} />
    </div>
  ),
}

const inlineCodeChunks = [
  "Updated ",
  "`apps/cloud",
  "flare/src/",
  "editor/Cloud",
  "Auth.ts:29",
  "-43` and ",
  "`packages/",
  "session-ui/src/",
  "components/markdown",
  "-solid.tsx`, ",
  "then verified ",
  "the changes with ",
  "`bun type",
  "check` and ",
  "`bun te",
  "st`.",
]

export const StreamingInlineCode = {
  ...playback,
  render: (args: { playback: string }) => (
    <div class="mx-auto max-w-[760px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <StreamingMarkdown playback={args.playback} chunks={inlineCodeChunks} interval={220} loop />
    </div>
  ),
}

const externalLinkChunks = [
  "1. ",
  "[#540](https://github.com/anomalyco/opencode/pull/540)",
  ": Batch access-policy reads.\n2. ",
  "[Stack Overflow](https://stackoverflow.com/questions/123)",
  ": Favicon from a public site.\n3. ",
  "[MDN docs](https://developer.mozilla.org/en-US/docs/Web)",
  ": Globe while loading.\n4. ",
  "[Unavailable favicon](https://absent-site.example.org/docs)",
  ": Globe fallback.\n5. ",
  "[Local host](http://localhost:8080/docs)",
  ": No third-party request.",
]

export const ExternalLinksStreaming = {
  ...playback,
  render: (args: { playback: string }) => (
    <div class="mx-auto max-w-[680px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <StreamingMarkdown playback={args.playback} chunks={externalLinkChunks} interval={380} />
    </div>
  ),
}
