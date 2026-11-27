import { createEffect, createSignal, Show } from "solid-js"
import type { ComposerDelivery } from "../adapter"
import { QuoteCommentEditor } from "./quote-comment"

const docs = `### Overview
The comment editor of a quote attached to the composer, opened from the timeline's Quote action, a terminal quote or a quote chip.

### Actions
- Enter saves the comment: **Done** while it is empty, **Add comment** once typed, **Save** for a comment the quote already had.
- Mod+Enter sends the quote with its comment now, as a prompt of its own: **Send quote** while the session is idle, **Steer with quote** or **Queue quote** while it works. A new session's draft has no such action.
- While the send is in flight the editor shows a loader; when it fails the draft stays with an alert.

The browser pane, file viewer and review diff offer the same two actions on their own comment editors (see UI/LineComment).
`

export default {
  title: "App/Quotes/Quote comment",
  id: "composer-quote-comment",
  parameters: { docs: { description: { component: docs } } },
}

const base = {
  text: "The composer clears once the prompt is in flight, so a failed send restores it.",
  comment: "",
  draft: "",
  delivery: "steer",
  sendUnavailable: false,
  sending: false,
  failed: false,
}

type Args = typeof base

function delivery(value: string): ComposerDelivery | undefined {
  if (value === "steer" || value === "queue") return value
}

export const Editor = {
  args: base,
  argTypes: {
    delivery: { control: "select", options: ["none", "send", "steer", "queue"] },
  },
  render: (args: Args) => {
    const [anchor, setAnchor] = createSignal<HTMLElement>()

    const [draft, setDraft] = createSignal(args.draft || args.comment)

    const [result, setResult] = createSignal("")

    createEffect(() => setDraft(args.draft || args.comment))

    return (
      <div style={{ height: "360px", display: "flex", "flex-direction": "column", "justify-content": "flex-end" }}>
        <div
          ref={setAnchor}
          class="w-[240px] truncate rounded-[6px] bg-v2-background-bg-layer-01 px-2 py-1 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-base"
        >
          {args.text}
        </div>
        <output aria-label="Editor result">{result()}</output>
        <Show when={anchor()}>
          {(element) => (
            <QuoteCommentEditor
              anchor={element()}
              text={args.text}
              comment={args.comment}
              view={{
                draft: draft(),
                sending: args.sending,
                failed: args.failed,
                canDismissOutside: false,
              }}
              mention={async (query) =>
                ["src/composer/submit.ts", "src/composer/machine.ts"].filter((path) => path.includes(query))
              }
              onInput={setDraft}
              onSubmit={(comment) => setResult(`Saved: ${comment}`)}
              onClose={() => setResult("Closed")}
              send={
                args.delivery === "none"
                  ? undefined
                  : {
                      available: !args.sendUnavailable,
                      // The composer reports no delivery while the session is idle; the label then says Send.
                      delivery: delivery(args.delivery),
                      onSubmit: (comment) => setResult(`Sent (${args.delivery}): ${comment}`),
                    }
              }
            />
          )}
        </Show>
      </div>
    )
  },
}

/** A quote that was just added: Enter closes it ("Done"), Mod+Enter steers the working session with it. */
export const NewQuoteSteer = { args: base, render: Editor.render }

/** A typed comment: Enter adds it to the quote, Mod+Enter steers with it. */
export const DraftSteer = { args: { ...base, draft: "Does this also cover a promoted draft?" }, render: Editor.render }

/** The session is idle: Mod+Enter sends the quote as a new prompt. */
export const DraftSend = { args: { ...DraftSteer.args, delivery: "send" }, render: Editor.render }

/** Mod+Enter queues while the session works, when the queue setting says so. */
export const DraftQueue = { args: { ...DraftSteer.args, delivery: "queue" }, render: Editor.render }

/** Nothing can be sent now, e.g. while another send is in flight or the models load. */
export const DraftSendUnavailable = { args: { ...DraftSteer.args, sendUnavailable: true }, render: Editor.render }

/** A new session's draft: there is no session to send to, so only Enter's action shows. */
export const DraftWithoutSend = { args: { ...DraftSteer.args, delivery: "none" }, render: Editor.render }

/** Editing the comment a quote already has: Enter saves it. */
export const EditSaved = {
  args: { ...base, comment: "Check the restore path too", draft: "Check the restore path too, and the retry ID" },
  render: Editor.render,
}

export const Sending = { args: { ...DraftSteer.args, sending: true }, render: Editor.render }

/** The send failed: the draft stays, with an alert until the next edit. */
export const SendFailed = { args: { ...DraftSteer.args, failed: true }, render: Editor.render }

/** A long multi-line quote, such as terminal output, previews its first lines. */
export const LongQuote = {
  args: {
    ...DraftSteer.args,
    text: '$ bun test\nsrc/composer/submit.test.ts:\n(fail) a file comment sends alone\nExpected: ["src/api.ts#c1"]\nReceived: []\n 53 pass\n 1 fail',
  },
  render: Editor.render,
}
