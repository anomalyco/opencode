import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Keybind } from "@opencode/ui/keybind"
import { For, onMount, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatKeybindParts, matchKeybind, parseKeybind } from "@/shell/commands/command"
import { JumpToMessage } from "./jump-to-message"

const shortcut = "mod+alt+g"

const turns = [
  [
    "Our delivery CSV has 48 stops. Why does the import preview show 49?",
    "The extra stop appears after order 731. Could you paste that record straight from the CSV? A spreadsheet hides some of the formatting.",
  ],
  [
    'Here’s the header and the record as they appear in the file:\n\norder_id,driver,note\n731,Sam,"Use the loading dock\nRing twice"\n\nThe preview puts “Ring twice” in the order ID column.',
    "That newline is inside the quoted note. The preview splits the file into lines before it parses the fields, so it treats “Ring twice” as the start of another stop.",
  ],
  [
    "Did we save a bogus stop too?",
    "I checked the import receipt: 48 stops. The upload worker parses the whole file and keeps both lines in the note for 731.",
  ],
  [
    "Can the preview use that parser?",
    "Yes. I switched the preview to the worker’s CSV reader. Your file now shows 48 stops before upload.",
  ],
  [
    "Another note says “Gate 2, ask for ليلى”. Does that comma break it?",
    "I tried it as a quoted field. The whole note stayed in one cell, and Sam was still in the driver column.",
  ],
  [
    "Try it with Windows line endings too.",
    "With CRLF between records and inside the quoted note, I still get one stop for 731. Both lines of its note are there.",
  ],
  [
    "Which line do we report if the next order is missing its ID?",
    "Line 4 in your sample: the header is line 1 and order 731 spans lines 2 and 3. The error uses the next record’s starting line.",
  ],
  [
    "Keep that case in the tests.",
    "Added a fixture with the two-line note followed by a missing ID. The test checks the note on 731 and the error on line 4. It passes with both LF and CRLF.",
  ],
].map(([text, reply], index) => ({
  id: `prompt-${index}`,
  created: new Date(2026, 9, 28, 10, index * 4).getTime(),
  text,
  reply,
}))

function SessionStory(props: { query?: string; empty?: boolean; failed?: boolean }) {
  const language = useLanguage()

  const dialog = useDialog()

  const prompts = () => (props.empty ? [] : turns)

  const bubbles = new Map<string, HTMLElement>()

  let session!: HTMLElement

  let transcript!: HTMLDivElement

  const open = (query = "") =>
    dialog.show(() => (
      <JumpToMessage
        prompts={prompts()}
        initialQuery={query}
        status={props.failed ? language.t("dialog.jump.failed") : undefined}
        onRetry={props.failed ? () => dialog.close() : undefined}
        onClose={() => dialog.close()}
        onJump={(prompt) => {
          dialog.close()
          const bubble = bubbles.get(prompt.id)
          bubble?.focus({ preventScroll: true })
          bubble?.scrollIntoView({ block: "center", inline: "nearest" })
        }}
      />
    ))

  onMount(() => {
    transcript.scrollTop = transcript.scrollHeight
    session.focus({ preventScroll: true })

    void open(props.query)
  })

  return (
    <section
      ref={session}
      tabIndex={-1}
      class="mx-auto flex h-dvh max-h-full w-full max-w-3xl flex-col text-13-regular outline-none"
      aria-label="Fixture session"
      onKeyDown={(event) => {
        if (!matchKeybind(parseKeybind(shortcut), event)) return
        event.preventDefault()
        event.stopPropagation()
        void open()
      }}
    >
      <header class="flex flex-wrap items-center gap-2 border-b border-v2-border-border-muted p-4">
        <h2 class="me-auto font-medium">Extra stop in CSV import preview</h2>
        <Button size="small" variant="neutral" onClick={() => open()}>
          Jump to message <Keybind keys={formatKeybindParts(shortcut, language.t)} variant="neutral" />
        </Button>
      </header>
      <div ref={transcript} data-scrollable class="min-h-0 flex-1 overflow-y-auto px-5 py-6" aria-label="Conversation">
        <For each={prompts()}>
          {(turn) => (
            <div class="mb-8 flex flex-col items-start gap-4">
              <p
                ref={(el) => bubbles.set(turn.id, el)}
                tabIndex={-1}
                class="ms-8 self-end whitespace-pre-wrap rounded-xl bg-v2-background-bg-layer-02 px-4 py-3 focus:outline-v2-border-border-base"
                dir="auto"
              >
                {turn.text}
              </p>
              <p dir="auto">{turn.reply}</p>
            </div>
          )}
        </For>
        <Show when={!prompts().length}>
          <p class="text-v2-text-text-muted">Your conversation will appear here.</p>
        </Show>
      </div>
      <footer class="border-t border-v2-border-border-muted px-4 py-3 text-v2-text-text-muted">
        <span class="font-medium">Draft</span>
        <p>Can you put that two-line example in the import guide?</p>
      </footer>
    </section>
  )
}

export default {
  title: "Session/Jump to message",
  id: "session-jump-to-message",
  parameters: { layout: "fullscreen" },
}

export const Browse = { render: () => <SessionStory /> }

export const MultilineMatch = { render: () => <SessionStory query="loading dock" /> }

export const Empty = { render: () => <SessionStory empty /> }

export const HistoryFailed = { render: () => <SessionStory failed /> }

export const NoMatches = { render: () => <SessionStory query="missing bookmark" /> }
