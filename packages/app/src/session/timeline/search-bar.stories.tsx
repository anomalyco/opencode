import type { SessionMessageInfo } from "@opencode/client/promise"
import type { SessionDocument } from "@opencode/session-ui/document"
import { CurrentSessionProviders, emptySessionDocument, STORY_MODEL, STORY_TIME } from "@opencode/session-ui/storybook"
import { SessionTimeline } from "@opencode/session-ui/timeline"
import { Button } from "@opencode/ui/button"
import { createEffect, createSignal, on, Show } from "solid-js"
import { TimelineSearchBar } from "./search-bar"
import { createTranscriptSearch } from "./search-controller"

const turns = [
  [
    "Which trail is open on Saturday?",
    "The lake trail opens at nine. The bridge on the north shore is closed for repairs.",
  ],
  [
    "Is there a way around the bridge?",
    "Take the footpath past the boat house. It joins the south shore near the picnic tables.",
  ],
  [
    "How far is it from the station?",
    "About three kilometres. There’s a drinking fountain at the entrance and a bike rack by the gate.",
  ],
  [
    "Where should we eat?",
    "For lunch by the water, follow the trail to the orchard. The last trail marker points to a bench under the apple trees.",
  ],
]

const transcript: SessionDocument = {
  ...emptySessionDocument,
  messages: turns.flatMap(([question, answer], index): SessionMessageInfo[] => [
    { id: `prompt_${index}`, type: "user", text: question, time: { created: STORY_TIME + index * 60_000 } },
    {
      id: `answer_${index}`,
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content: [{ type: "text", text: answer }],
      time: { created: STORY_TIME + index * 60_000 + 1000, completed: STORY_TIME + index * 60_000 + 2000 },
    },
  ]),
}

type Args = { query: string; open: boolean; empty: boolean }

function FindStory(props: Args) {
  const document = () => (props.empty ? emptySessionDocument : transcript)

  const [scroll, setScroll] = createSignal<HTMLDivElement>()

  // This timeline mounts every row eagerly. The search controller can seek directly to each matching range.
  const search = createTranscriptSearch({
    sessionID: () => document().sessionID,
    messages: () => document().messages,
    scrollRef: scroll,
    revealMessage() {},
    pauseAutoScroll() {},
  })

  createEffect(
    on([() => props.open, () => props.query], ([open, query]) => {
      if (!open) return search.query.close()
      search.query.open()
      search.query.setValue(query)
    }),
  )

  return (
    <section
      class="mx-auto flex h-full max-h-[520px] min-h-0 w-full max-w-[760px] flex-col p-4"
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return
        event.preventDefault()
        search.query.open()
      }}
    >
      <header class="flex items-center justify-between gap-3 border-b border-v2-border-border-muted pb-3">
        <h2 class="text-14-medium">A walk along the south shore</h2>
        <Show
          when={search.visible()}
          fallback={
            <Button size="small" onClick={search.query.open}>
              Find in conversation
            </Button>
          }
        >
          <TimelineSearchBar controller={search} />
        </Show>
      </header>
      <div ref={setScroll} data-scrollable class="min-h-0 max-h-[350px] overflow-y-auto py-4">
        <CurrentSessionProviders document={document()}>
          <Show
            when={document().messages.length}
            fallback={<p class="text-13-regular text-text-weak">No messages in this session.</p>}
          >
            <SessionTimeline document={document()} />
          </Show>
        </CurrentSessionProviders>
      </div>
      <p class="border-t border-v2-border-border-muted pt-3 text-12-regular text-text-weak">
        Enter for the next match · Shift+Enter for the previous match · Escape to close
      </p>
    </section>
  )
}

export default {
  title: "OpenCode/Session/Find in transcript",
  id: "session-transcript-find",
  args: { query: "trail", open: true, empty: false } satisfies Args,
  render: (args: Args) => <FindStory {...args} />,
}

export const Matches = {}

export const NoMatches = { args: { query: "waterfall" } }

export const EmptyQuery = { args: { query: "" } }

export const EmptyTranscript = { args: { empty: true } }

export const Closed = { args: { open: false } }
