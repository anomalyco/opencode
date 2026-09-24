import { markdown } from "@opencode/ui/storybook/fixtures"
import { createSignal, onCleanup } from "solid-js"
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
  render: () => (
    <div class="mx-auto max-w-[760px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <Markdown text={markdown} />
    </div>
  ),
}

export const CompactResult = {
  render: () => (
    <div class="mx-auto max-w-[560px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <Markdown
        text={"Updated the Session status and verified it.\n\n- **12 tests passed**\n- `bun typecheck` passed"}
      />
    </div>
  ),
}

const streamed =
  "Streaming Markdown now keeps existing elements alive while each newly arriving word fades into the response."

function StreamingMarkdown() {
  const words = streamed.match(/\S+\s*/g) ?? []
  const [count, setCount] = createSignal(1)
  const timer = setInterval(() => setCount((value) => Math.min(value + 1, words.length)), 180)
  onCleanup(() => clearInterval(timer))
  return <Markdown text={words.slice(0, count()).join("")} streaming={count() < words.length} />
}

export const StreamingResponse = {
  render: () => (
    <div class="mx-auto max-w-[760px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <StreamingMarkdown />
    </div>
  ),
}

function StreamingInlineCodeMarkdown() {
  const chunks = [
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
  const [count, setCount] = createSignal(1)
  const timer = setInterval(() => setCount((value) => (value >= chunks.length ? 1 : value + 1)), 220)
  onCleanup(() => clearInterval(timer))
  return <Markdown text={chunks.slice(0, count()).join("")} streaming />
}

export const StreamingInlineCode = {
  render: () => (
    <div class="mx-auto max-w-[760px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <StreamingInlineCodeMarkdown />
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

function StreamingExternalLinks() {
  const [count, setCount] = createSignal(1)
  const timer = setInterval(() => {
    setCount((value) => {
      if (value === externalLinkChunks.length) {
        clearInterval(timer)
        return value
      }
      return value + 1
    })
  }, 380)
  onCleanup(() => clearInterval(timer))
  return (
    <Markdown text={externalLinkChunks.slice(0, count()).join("")} streaming={count() < externalLinkChunks.length} />
  )
}

export const ExternalLinksStreaming = {
  render: () => (
    <div class="mx-auto max-w-[680px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <StreamingExternalLinks />
    </div>
  ),
}
