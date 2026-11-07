import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionMessageUser } from "@opencode/client/promise"
import type { SessionUserActions } from "../actions"
import { CurrentUserMessageDisplay } from "./message-content"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"

export default {
  title: "OpenCode/Conversation/Prompt message",
  id: "current-prompt-message",
  parameters: { layout: "fullscreen" },
}

export const Pending = {
  render: () => {
    const statuses = ["delivered", "starting", "steering", "stranded", "queued"] as const

    const [state, setState] = createStore<{
      status: (typeof statuses)[number]
      voice: boolean
      text: boolean
      grouped: boolean
      changed: boolean
    }>({
      status: "steering",
      voice: false,
      text: true,
      grouped: false,
      changed: false,
    })

    // The prompt before this one; a waiting steer names only the agent and model it changes.
    const previousSelection = () => ({
      agent: "build",
      model: state.changed ? { ...STORY_MODEL, variant: "precise" } : STORY_MODEL,
    })

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
      revert: async () => {},
      fork: async () => {},
      pending: {
        status: () => (state.status === "delivered" ? undefined : state.status),
        queue: async () => {
          setState("status", "queued")
        },
        remove: async () => {
          setState("status", "delivered")
        },
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
              checked={state.changed}
              onChange={(event) => setState("changed", event.currentTarget.checked)}
            />{" "}
            Changes model
          </label>
        </div>
        <CurrentSessionProviders document={document()}>
          <Show when={state.grouped && state.text}>
            <CurrentUserMessageDisplay
              sessionID={CURRENT_SESSION_ID}
              message={{ ...message(), id: "msg_pending_prompt_above" }}
              text="Keep the earlier prompt in the same run."
              agent="build"
              model={STORY_MODEL}
              previousSelection={previousSelection()}
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
            previousSelection={previousSelection()}
            voice={state.voice}
            actions={actions}
            run={{ above: state.grouped && state.text, below: false }}
          />
        </CurrentSessionProviders>
      </section>
    )
  },
}
