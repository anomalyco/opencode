import type { SessionDocument } from "../document"
import { File } from "../components/file"
import { DataProvider } from "../context/data"
import type { SessionUserActions } from "../message/current-message"
import type { SessionUserPresentation } from "../timeline/session-timeline"
import { SessionTimeline } from "../timeline/session-timeline"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { Button } from "@opencode-ai/ui/button"
import { Show, createSignal, type JSX } from "solid-js"
import { CURRENT_SESSION_ID, STORY_TIME } from "./current-session-fixtures"

export function CurrentSessionProviders(props: { document: SessionDocument; children: JSX.Element }) {
  return (
    <DataProvider
      directory="C:/workspaces/opencode"
      sessionID={props.document.sessionID}
      data={{
        agent: [
          { name: "build", color: "blue" },
          { name: "review", color: "purple" },
          { name: "test", color: "green" },
        ],
        provider: {
          all: new Map([["anthropic", { models: { "claude-sonnet-4": { name: "Claude Sonnet 4" } } }]]),
          connected: ["anthropic"],
          default: { anthropic: "claude-sonnet-4" },
        },
        session: [
          {
            id: CURRENT_SESSION_ID,
            title: "Current Session UI",
            time: { created: STORY_TIME, updated: STORY_TIME + 300_000 },
          },
          {
            id: "session_child_review",
            parentID: CURRENT_SESSION_ID,
            title: "Review current Session fixtures",
            time: { created: STORY_TIME + 71_000, updated: STORY_TIME + 72_000 },
          },
          {
            id: "session_child_tests",
            parentID: CURRENT_SESSION_ID,
            title: "Check the Storybook scenarios",
            time: { created: STORY_TIME + 73_000, updated: STORY_TIME + 74_000 },
          },
        ],
        session_status: {
          [CURRENT_SESSION_ID]: props.document.status,
          session_child_review: { type: "idle" },
          session_child_tests: { type: "busy" },
        },
        session_diff: { [CURRENT_SESSION_ID]: props.document.diffs },
      }}
    >
      <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
    </DataProvider>
  )
}

export function CurrentSessionTimelineStory(props: {
  title: string
  description: string
  document: SessionDocument
  presentation?: Record<string, SessionUserPresentation | undefined>
  width?: string
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
}) {
  const [revision, setRevision] = createSignal(1)
  const [activity, setActivity] = createSignal("No local action")
  const actions = {
    openAttachment: (file) => {
      setActivity(`Opened ${file.name ?? file.mime}`)
    },
    revert: (input) => {
      setActivity(`Selected revert boundary ${input.messageID}`)
    },
  } satisfies SessionUserActions
  const reset = () => {
    setActivity("No local action")
    setRevision((value) => value + 1)
  }

  return (
    <section class="mx-auto flex w-full flex-col gap-4 p-6" style={{ "max-width": props.width ?? "840px" }}>
      <header class="flex items-start justify-between gap-4 border-b border-border-weak-base pb-3">
        <div class="min-w-0">
          <h1 class="text-16-medium text-text-strong">{props.title}</h1>
          <p class="mt-1 text-13-regular text-text-weak">{props.description}</p>
        </div>
        <Button size="small" variant="neutral" onClick={reset}>
          Reset
        </Button>
      </header>
      <div class="min-h-24 overflow-hidden rounded-lg border border-border-weak-base bg-background-base py-4">
        <Show when={revision()} keyed>
          {(revision) => (
            <div data-story-revision={revision}>
              <CurrentSessionProviders document={props.document}>
                <SessionTimeline
                  document={props.document}
                  presentation={props.presentation}
                  actions={actions}
                  shellToolDefaultOpen={props.shellToolDefaultOpen}
                  editToolDefaultOpen={props.editToolDefaultOpen}
                />
              </CurrentSessionProviders>
            </div>
          )}
        </Show>
      </div>
      <output class="text-12-regular text-text-weak">Story action: {activity()}</output>
    </section>
  )
}
