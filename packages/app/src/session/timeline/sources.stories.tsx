import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { SourcesProvider } from "@opencode/session-ui/context/sources"
import type { SessionDocument } from "@opencode/session-ui/document"
import { turnMessages, turnSources } from "@opencode/session-ui/sources"
import type { SiteIconMode } from "@opencode/session-ui/sources/experiment"
import { SourcesPanel } from "@opencode/session-ui/sources/panel"
import { SourcesTitle } from "@opencode/session-ui/sources/title"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "@opencode/session-ui/storybook"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tabs } from "@opencode/ui/tabs"
import { createEffect, createMemo, on, onMount, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { SessionPreview } from "@/session/story-model"

const timelineDetail = timelinePresets[2].value

type Turn = "three" | "research" | "fetch" | "empty" | "failed" | "streaming"

type SourcesArgs = { turn: Turn; icons: SiteIconMode; panel: boolean; expand: boolean }

const user = "msg_sources_user"

// Results as the websearch tool writes them into its text content (packages/core/src/tool/plugin/websearch.ts).
const searchText = (results: readonly Result[]) =>
  results.length
    ? results.map((result) => `## [${result.title}](${result.url})\n\n${result.title}.`).join("\n\n")
    : "No search results found. Please try a different query."

type Result = { url: string; title: string }

let clock = 0

const time = () => {
  clock += 1_000

  return { created: STORY_TIME + clock, ran: STORY_TIME + clock + 100, completed: STORY_TIME + clock + 900 }
}

const search = (id: string, query: string, results: readonly Result[]): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "websearch",
  state: {
    status: "completed",
    input: { query },
    content: [{ type: "text", text: searchText(results) }],
    metadata: { provider: "exa" },
  },
  time: time(),
})

const failedSearch = (id: string, query: string, message: string): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "websearch",
  state: { status: "error", input: { query }, error: { type: "ToolExecutionError", message } },
  time: time(),
})

const fetch = (id: string, url: string): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "webfetch",
  state: {
    status: "completed",
    input: { url, format: "markdown" },
    content: [{ type: "text", text: "# Page" }],
  },
  time: time(),
})

const three = [
  { url: "https://eieio.games/blog/one-million-checkboxes", title: "One Million Checkboxes – eieio.games" },
  {
    url: "https://www.theverge.com/2024/7/2/24190811/one-million-checkboxes-website",
    title: "One Million Checkboxes is the internet’s newest shared toy",
  },
  {
    url: "https://www.nytimes.com/2024/07/03/technology/one-million-checkboxes-game.html",
    title: "The Website With One Million Checkboxes",
  },
]

const sites = [
  "eieio.games",
  "github.com",
  "news.ycombinator.com",
  "theverge.com",
  "nytimes.com",
  "washingtonpost.com",
  "rockpapershotgun.com",
  "itseieio.substack.com",
  "youtube.com",
  "x.com",
  "reddit.com",
  "wikipedia.org",
  "arstechnica.com",
  "pcgamer.com",
  "polygon.com",
  "techcrunch.com",
]

const queries = [
  "10,000 checkboxes massively multiplayer",
  '"10000 checkboxes" OR "10,000 checkboxes" game',
  "live updating shared components website viral",
  "Nolen Royalty eieio.games games",
  "Nolen Royalty One Million Chessboards",
  '"Nolen Royalty" OR itseieio games OR projects',
  "one million checkboxes scaling redis writeup",
  "one million chessboards architecture rust",
  "GLOBAL CAPS LOCK website",
  "Solitaire Alone Together windows 98",
  "snakes.run multiplayer snake ssh",
  "Faviconic pong browser tabs",
]

const topics = [
  "One Million Checkboxes",
  "10,000 Checkboxes",
  "Shared live websites",
  "eieio games",
  "One Million Chessboards",
  "Nolen Royalty",
  "Scaling One Million Checkboxes",
  "A million realtime chessboards",
  "GLOBAL CAPS LOCK",
  "Solitaire Alone Together",
  "snakes.run",
  "Faviconic",
]

const titles = [
  (topic: string) => topic,
  (topic: string) => `${topic}: the story behind the viral site`,
  (topic: string) => `Show HN: ${topic}`,
  (topic: string) => `What happened to ${topic}?`,
  (topic: string) => `${topic} is the internet’s newest shared toy`,
  (topic: string) => `How ${topic} handled a million players`,
  (topic: string) => `${topic} — a technical writeup`,
  (topic: string) => `I played ${topic} for a week`,
]

// Twelve searches with 97 results between them, some repeating a page another search found.
const research = queries.map((query, index) =>
  search(
    `call_research_${index}`,
    query,
    Array.from({ length: index === 0 ? 15 : index % 3 === 0 ? 6 : 8 }, (_, item) => {
      const site = sites[(index * 5 + item) % sites.length]!

      const slug = query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")

      return {
        url: `https://${item % 4 === 0 ? "www." : ""}${site}/${item % 5 === 0 ? "about" : `${slug}-${item}`}`,
        title: titles[(index + item) % titles.length]!(topics[index]!),
      }
    }),
  ),
)

const answer = (text: string) => ({ type: "text" as const, text })

function document(turn: Turn): SessionDocument {
  clock = 0
  const busy = turn === "streaming"

  const content: SessionMessageAssistant["content"] =
    turn === "three" || turn === "streaming"
      ? [
          search("call_three", "one million checkboxes creator", three),
          answer(
            busy
              ? "The project you’re thinking of is **One Million Checkboxes**, made by Nolen Royalty"
              : "The project you’re thinking of is **One Million Checkboxes**, made by Nolen Royalty (eieio) in June 2024. Checking a box checked it for everyone on the site at once, and it went viral within days.",
          ),
        ]
      : turn === "research"
        ? [
            ...research.slice(0, 6),
            fetch("call_fetch_home", "https://eieio.games/"),
            ...research.slice(6),
            fetch("call_fetch_chess", "https://eieio.games/blog/a-million-realtime-chessboards-in-a-single-process"),
            answer(
              "Nolen Royalty (eieio) makes massively multiplayer toys: **One Million Checkboxes** (2024), **One Million Chessboards** (2025), GLOBAL CAPS LOCK, Solitaire Alone Together and snakes.run. His blog has the technical writeups for each.",
            ),
          ]
        : turn === "fetch"
          ? [
              fetch("call_fetch_post", "https://eieio.games/blog/one-million-checkboxes"),
              fetch("call_fetch_repo", "https://github.com/nolenroyalty/one-million-checkboxes"),
              answer("The post covers the launch, and the repository has the Flask and Redis server it ran on."),
            ]
          : turn === "empty"
            ? [
                search("call_empty", "nolen royalty 10,000 checkboxes 2019 prototype", []),
                answer(
                  "I couldn’t find an earlier 10,000-checkbox prototype; the first version was One Million Checkboxes.",
                ),
              ]
            : [
                failedSearch("call_failed", "one million checkboxes creator", "Web search rate limited (HTTP 429)"),
                answer("The search was rate limited, so this comes from what I already know: it was Nolen Royalty."),
              ]

  const messages: SessionMessageInfo[] = [
    {
      id: user,
      type: "user",
      text: "Who makes the 10,000 checkboxes thing, and what else have they built?",
      time: { created: STORY_TIME },
      metadata: { agent: "build", model: STORY_MODEL },
    },
    {
      id: "msg_sources_assistant",
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content,
      time: { created: STORY_TIME + 500, completed: busy ? undefined : STORY_TIME + 60_000 },
    },
  ]

  return { sessionID: CURRENT_SESSION_ID, messages, status: { type: busy ? "busy" : "idle" }, diffs: [] }
}

function Sources(props: SourcesArgs) {
  const [state, setState] = createStore({ panel: props.panel })
  const value = createMemo(() => document(props.turn))
  const sources = createMemo(() => turnSources(turnMessages(value().messages, user)))

  createEffect(
    on(
      () => props.panel,
      (panel) => setState("panel", panel),
      { defer: true },
    ),
  )

  return (
    <SourcesProvider enabled icons={props.icons} onOpen={() => setState("panel", true)}>
      <SessionPreview
        title="Who makes the 10,000 checkboxes thing?"
        description="opencode · sources"
        document={value()}
        timelineDetail={timelineDetail}
        side={
          <Show when={state.panel}>
            <Side expand={props.expand} count={sources().sources.length} onClose={() => setState("panel", false)}>
              <SourcesPanel sources={sources()} icons={props.icons} onOpen={() => {}} />
            </Side>
          </Show>
        }
      />
    </SourcesProvider>
  )
}

// The side panel's frame around the real panel: the strip with the real tab title, as the side region draws it.
// `expand` opens the first search with results once it shows.
function Side(props: ParentProps<{ expand: boolean; count: number; onClose: () => void }>) {
  const language = useLanguage()
  let el: HTMLDivElement | undefined

  onMount(() => {
    if (!props.expand) return
    requestAnimationFrame(() =>
      el?.querySelector<HTMLButtonElement>('[data-slot="sources-step-row"][aria-expanded="false"]')?.click(),
    )
  })

  return (
    <Tabs value="sources" class="flex h-full min-h-0 flex-col bg-v2-background-bg-base">
      <div class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center">
        <Tabs.List>
          <Tabs.Trigger
            value="sources"
            closeButton={
              <IconButton
                size="small"
                variant="ghost-muted"
                icon={<Icon name="xmark-small" />}
                aria-label={language.t("common.closeTab")}
                onClick={() => props.onClose()}
              />
            }
            hideCloseButton
          >
            <SourcesTitle count={props.count} />
          </Tabs.Trigger>
        </Tabs.List>
      </div>
      <div ref={el} class="flex min-h-0 flex-1 flex-col">
        <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
          {props.children}
        </div>
      </div>
    </Tabs>
  )
}

export default {
  title: "OpenCode/Session/Sources",
  id: "session-sources",
  render: (args: SourcesArgs) => <Sources {...args} />,
  args: { turn: "three", icons: "letters", panel: false, expand: false },
  argTypes: {
    turn: { options: ["three", "research", "fetch", "empty", "failed", "streaming"] },
    icons: { options: ["letters", "site"] },
  },
  parameters: {
    layout: "fullscreen",
    motion: ["Sources"],
  },
}

export const ThreeSources = { args: { turn: "three", panel: false } }

export const LongResearch = { args: { turn: "research", panel: false } }

export const LongResearchPanel = { args: { turn: "research", panel: true, expand: true } }

export const FetchOnly = { args: { turn: "fetch", panel: true } }

export const NoResults = { args: { turn: "empty", panel: true } }

export const FailedSearch = { args: { turn: "failed", panel: true } }

export const Streaming = { args: { turn: "streaming", panel: false } }

export const LetterIcons = { args: { turn: "research", panel: true, icons: "letters" } }

export const SiteIcons = { args: { turn: "research", panel: true, icons: "site" } }
