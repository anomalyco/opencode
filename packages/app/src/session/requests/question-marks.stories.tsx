import type { FormInfo } from "@opencode/client/promise"
import { CURRENT_SESSION_ID } from "@opencode/session-ui/storybook"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { For, Show, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { SessionQuestionDock } from "./session-question-dock"
import "./question-marks.stories.css"

type Glyph = "check" | "dot"

type Scheme = "both" | "dark" | "light"

type MarksArgs = { glyph: Glyph; scheme: Scheme; picked: boolean }

const single = {
  id: "form_question_marks_single",
  sessionID: CURRENT_SESSION_ID,
  title: "Layout",
  metadata: { kind: "question" },
  fields: [
    {
      key: "layout",
      type: "string",
      title: "Layout",
      description: "Which Session layout should I implement?",
      options: [
        { value: "focused", label: "Focused", description: "Keep the conversation at a comfortable reading width." },
        { value: "wide", label: "Wide", description: "Keep the review panel visible beside the conversation." },
        { value: "split", label: "Split", description: "Conversation and review side by side, resizable." },
      ],
      custom: true,
    },
  ],
} satisfies FormInfo

const multi = {
  id: "form_question_marks_multi",
  sessionID: CURRENT_SESSION_ID,
  title: "Include",
  metadata: { kind: "question" },
  fields: [
    {
      key: "include",
      type: "multiselect",
      title: "Include",
      description: "Which supporting surfaces should stay visible?",
      options: [
        { value: "files", label: "Changed files", description: "The diff list for this session." },
        { value: "terminal", label: "Terminal", description: "The shell the agent is running in." },
        { value: "tasks", label: "Background tasks", description: "Subagents and long-running jobs." },
      ],
    },
  ],
} satisfies FormInfo

// The real question dock, twice per colour scheme: a pick-one and a pick-any question side by side, each with one answer
// picked by a real click and the highlight moved to the next answer with a real ↓, so picked and highlighted show apart.
function QuestionMarksPreview(props: MarksArgs) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const [state, setState] = createStore({ revision: 0 })
  // `?scheme=` pins a colour scheme for stills.
  const url = new URLSearchParams(location.search)

  const scheme = (): Scheme => {
    const value = url.get("scheme")

    return value === "dark" || value === "light" || value === "both" ? value : props.scheme
  }

  const schemes = () => (scheme() === "both" ? (["dark", "light"] as const) : [scheme()])

  return (
    <QueryClientProvider client={queryClient}>
      <div data-component="question-marks-story" data-glyph={props.glyph} class="min-h-screen w-full">
        <For each={schemes()}>
          {(name) => (
            <section
              data-color-scheme={name}
              class="px-8 py-6"
              style={{ background: "var(--v2-background-bg-base)", color: "var(--v2-text-text-base)" }}
            >
              <div class="mb-4 text-12-regular" style={{ color: "var(--v2-text-text-faint)" }}>
                {name}
              </div>
              <Show when={`${props.picked}:${state.revision}`} keyed>
                <div class="grid grid-cols-2 items-start gap-6">
                  <Dock
                    request={single}
                    scheme={name}
                    picked={props.picked ? 1 : undefined}
                    onReset={() => setState("revision", (n) => n + 1)}
                  />
                  <Dock
                    request={multi}
                    scheme={name}
                    picked={props.picked ? 0 : undefined}
                    onReset={() => setState("revision", (n) => n + 1)}
                  />
                </div>
              </Show>
            </section>
          )}
        </For>
      </div>
    </QueryClientProvider>
  )
}

function Dock(props: { request: FormInfo; scheme: string; picked?: number; onReset: () => void }) {
  let host: HTMLDivElement | undefined

  onMount(() =>
    requestAnimationFrame(() => {
      if (props.picked === undefined) return
      const option = host?.querySelectorAll<HTMLButtonElement>('button[data-slot="question-option"]')[props.picked]

      if (!option) return
      option.click()
      option.focus({ preventScroll: true })
      option.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
    }),
  )

  return (
    <div ref={host}>
      <SessionQuestionDock
        request={{ ...props.request, id: `${props.request.id}:${props.scheme}` }}
        onSubmit={props.onReset}
      />
    </div>
  )
}

export default {
  title: "OpenCode/Session/Question marks",
  id: "session-question-marks",
  component: QuestionMarksPreview,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Answer marks on the real question dock: a pick-one and a pick-any question side by side, in dark and light. Each starts with one answer picked and the highlight on the next. Hover an answer or use ↑ ↓ to move the highlight; click or press a number to pick. `glyph` compares a check with a dot on a picked pick-one answer; the dock ships with the check.",
      },
    },
  },
  argTypes: {
    glyph: { options: ["check", "dot"] },
    scheme: { options: ["both", "dark", "light"] },
  },
  args: { glyph: "check", scheme: "both", picked: true } satisfies MarksArgs,
  render: (args: MarksArgs) => <QuestionMarksPreview {...args} />,
}

export const Marks = {}

export const PickOneDot = { args: { glyph: "dot" } }
