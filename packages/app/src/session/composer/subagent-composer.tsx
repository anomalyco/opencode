import { createMediaQuery } from "@solid-primitives/media"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { Schema } from "effect"
import { Show, type JSX } from "solid-js"
import { TOUCH_MEDIA_QUERY } from "@/composer/touch"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useServerSDK } from "@/runtime/server/client"
import { useSettings } from "@/settings/model"
import { useWorkspaceLocation } from "@/workspaces/location"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { createSubagentDraft, subagentEnterAction } from "./subagent-draft"
import { subagentDraftStorage } from "./subagent-draft-store"

const MessageDraft = Persistence.struct({
  text: Schema.String,
  retry: Persistence.optional(Persistence.struct({ id: Schema.String, text: Schema.String })),
})

// The subagent session's dock: its status bar always, its composer only while the experimental setting is on.
export function SubagentDock(props: {
  bar: JSX.Element
  sessionID: string
  send: (text: string, id: string) => Promise<void>
}) {
  const settings = useSettings()

  return (
    <>
      {props.bar}
      <Show when={settings.general.subagentComposer()}>
        <SubagentComposer sessionID={props.sessionID} send={props.send} />
      </Show>
    </>
  )
}

// The subagent's own composer: one message steered into its run, or a follow-up that resumes it once idle.
export function SubagentComposer(props: { sessionID: string; send: (text: string, id: string) => Promise<void> }) {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServerSDK()
  const directory = useWorkspaceLocation()

  // A touch keyboard's Return only ever adds a line there, as in the main composer; the button sends.
  const touch = createMediaQuery(TOUCH_MEDIA_QUERY)

  // Leaving the view disposes the region, so the draft and its retry live in the Session's stored copy instead.
  const [stored, setStored, , ready] = persisted(
    Persist.serverScoped(server.scope, directory().directory, props.sessionID, "subagent-message"),
    MessageDraft,
    { text: "" },
    platform,
  )

  let field: HTMLTextAreaElement | undefined

  const draft = createSubagentDraft({
    send: props.send,
    storage: subagentDraftStorage(() => stored, setStored),
    onError: (error) => {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(error, language.t("common.requestFailed")),
      })
      field?.focus()
    },
  })

  const sendable = () => ready() && !draft.sending() && !!draft.value().trim()

  return (
    <form
      data-component="subagent-composer"
      class="relative flex w-full items-end gap-2 rounded-xl bg-v2-background-bg-base p-1.5 ps-3 shadow-[var(--v2-elevation-raised)] [[data-color-scheme=dark]_&]:bg-v2-background-bg-layer-01"
      onSubmit={(event) => {
        event.preventDefault()
        void draft.submit()
      }}
    >
      <textarea
        ref={(element) => (field = element)}
        rows={1}
        dir="auto"
        value={draft.value()}
        // A stored draft that hydrates after the first keystroke must not replace it.
        readOnly={!ready()}
        aria-label={language.t("session.child.message.placeholder")}
        placeholder={language.t("session.child.message.placeholder")}
        class="field-sizing-content max-h-32 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-[13px] font-[440] leading-5 text-v2-text-text-base placeholder:text-v2-text-text-faint focus:outline-none"
        // Reserved scrollbar and the end padding that gives its width back, so a long message never rewraps.
        style={{ "scrollbar-gutter": "stable", "padding-inline-end": "calc(12px - var(--scrollbar-size, 0px))" }}
        onInput={(event) => draft.setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          const action = subagentEnterAction(event, touch())

          if (action === "send") {
            event.preventDefault()
            void draft.submit()
          }

          if (action === "swallow") event.preventDefault()
        }}
      />
      <Tooltip placement="top" inactive={!sendable()} value={language.t("ui.promptInput.send")}>
        <IconButton
          data-action="subagent-send"
          type="submit"
          disabled={!sendable()}
          aria-busy={draft.sending()}
          icon={draft.sending() ? <Loader class="size-4" /> : <Icon name="arrow-up" />}
          variant="submit"
          class={`shrink-0 rounded-md p-[6px] ${touch() ? "size-11" : "size-7"}`}
          aria-label={language.t("ui.promptInput.send")}
        />
      </Tooltip>
    </form>
  )
}
