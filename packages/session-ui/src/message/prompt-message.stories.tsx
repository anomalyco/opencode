import { createEffect, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionMessageUser } from "@opencode/client/promise"
import type { SessionUserActions } from "../actions"
import { CurrentUserMessageDisplay } from "./message-content"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"

const statuses = ["delivered", "starting", "steering", "stranded", "queued", "sending"] as const

type Args = { status: (typeof statuses)[number]; voice: boolean; text: boolean; grouped: boolean; fails: boolean }

export default {
  title: "OpenCode/Conversation/Prompt message",
  id: "current-prompt-message",
  parameters: { layout: "fullscreen" },
  args: { status: "steering", voice: false, text: true, grouped: false, fails: false } satisfies Args,
  argTypes: { status: { options: statuses } },
}

export const Pending = {
  render: (args: Args) => {
    const [state, setState] = createStore({ ...args, failures: 0 })

    // Frame controls and host callbacks can still change the fixture after a panel edit.
    for (const key of ["status", "voice", "text", "grouped", "fails"] as const) {
      createEffect(() => setState({ [key]: args[key] }))
    }

    // A failing host rejects, like a server error, and leaves the message as it was.
    const attempt = async (apply: () => void) => {
      if (!state.fails) return apply()
      setState("failures", (count) => count + 1)
      throw new Error("Request failed")
    }

    const message = createMemo<SessionMessageUser>(() => ({
      id: "msg_pending_prompt_story",
      type: "user",
      text: state.text ? "Keep the prompt styling consistent with the rest of the timeline." : "",
      time: { created: STORY_TIME },
      files: state.text
        ? []
        : [{ name: "notes.json", mime: "application/json", data: "e30=", source: { type: "inline" } }],
    }))

    const document = createMemo(() => ({
      sessionID: CURRENT_SESSION_ID,
      messages: [message()],
      status: { type: "idle" as const },
      diffs: [],
    }))

    const actions = {
      revert: () => attempt(() => {}),
      fork: () => attempt(() => {}),
      pending: {
        status: () => (state.status === "delivered" ? undefined : state.status),
        queue: () => attempt(() => setState("status", "queued")),
        remove: () => attempt(() => setState("status", "delivered")),
      },
    } satisfies SessionUserActions

    return (
      <section class="mx-auto flex w-full max-w-[840px] flex-col gap-8 p-6">
        <div class="flex flex-wrap items-center gap-4">
          <label>
            Delivery state{" "}
            <select
              aria-label="Delivery state"
              value={state.status}
              onChange={(event) => {
                const status = statuses.find((status) => status === event.currentTarget.value)

                if (status) setState("status", status)
              }}
            >
              <For each={statuses}>
                {(status) => <option value={status}>{status[0].toUpperCase() + status.slice(1)}</option>}
              </For>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={state.voice}
              onChange={(event) => setState("voice", event.currentTarget.checked)}
            />{" "}
            Voice message
          </label>
          <label>
            <input
              type="checkbox"
              checked={state.text}
              onChange={(event) => setState("text", event.currentTarget.checked)}
            />{" "}
            Prompt text
          </label>
          <label>
            <input
              type="checkbox"
              checked={state.grouped}
              onChange={(event) => setState("grouped", event.currentTarget.checked)}
            />{" "}
            Grouped prompts
          </label>
          <label>
            <input
              type="checkbox"
              checked={state.fails}
              onChange={(event) => setState("fails", event.currentTarget.checked)}
            />{" "}
            Actions fail
          </label>
          <output aria-label="Failed actions">{state.failures}</output>
        </div>
        <CurrentSessionProviders document={document()}>
          <Show when={state.grouped && state.text}>
            <CurrentUserMessageDisplay
              sessionID={CURRENT_SESSION_ID}
              message={{ ...message(), id: "msg_pending_prompt_above" }}
              text="Keep the earlier prompt in the same run."
              agent="build"
              model={STORY_MODEL}
              actions={actions}
              run={{ above: false, below: true }}
            />
          </Show>
          <CurrentUserMessageDisplay
            sessionID={CURRENT_SESSION_ID}
            message={message()}
            text={message().text}
            agent="build"
            model={STORY_MODEL}
            voice={state.voice}
            actions={actions}
            run={{ above: state.grouped && state.text, below: false }}
          />
        </CurrentSessionProviders>
      </section>
    )
  },
}

export const SendingAttachment = { ...Pending, args: { status: "sending", text: false } }

export const DeliveredVoice = { ...Pending, args: { status: "delivered", voice: true } }

export const StrandedSteer = { ...Pending, args: { status: "stranded", grouped: true } }
