import { useLanguage } from "../../context/language"
import { createMemo } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { useData } from "../../context/data"
import { DialogSelect } from "../../ui/dialog-select"
import { useClipboard } from "../../context/clipboard"
import { useToast } from "../../ui/toast"
import { useClient } from "../../context/client"
import { errorMessage } from "../../util/error"
import { DialogFork } from "./dialog-fork"
import { usePromptRestore } from "../../prompt/restore"
import { useNewDesigns } from "../../config"
import { appendToSessionPrompt } from "../../component/prompt/draft-stash"

export function DialogMessage(props: { messageID: string; sessionID: string }) {
  const language = useLanguage()
  const data = useData()
  const clipboard = useClipboard()
  const toast = useToast()
  const client = useClient()
  const renderer = useRenderer()
  const restorePrompt = usePromptRestore()
  const newDesigns = useNewDesigns()
  const message = createMemo(() => data.session.message.get(props.sessionID, props.messageID))

  return (
    <DialogSelect
      title={language.t("tui.details.messageActions")}
      renderFilter={!newDesigns()}
      options={[
        {
          title: language.t("tui.details.jumpTo"),
          value: "message.jump",
          description: language.t("tui.details.viewMessageInSession"),
          onSelect: (dialog) => dialog.clear(),
        },
        {
          title: language.t("tui.details.revert"),
          value: "session.revert",
          description: language.t("tui.details.undoMessagesAndFileChanges"),
          onSelect: (dialog) => {
            const value = message()
            const { sessionID, messageID } = props
            // The composer changes only once the revert is staged, so a failed revert leaves the draft alone.
            void (async () => {
              const restored = value?.type === "user" ? await restorePrompt(value) : undefined
              await client.api.session.revert.stage({ sessionID, messageID })
              if (restored) appendToSessionPrompt(sessionID, restored, renderer.widthMethod)
            })().catch((error) => toast.show({ message: errorMessage(error), variant: "error", duration: 5000 }))
            dialog.clear()
          },
        },
        {
          title: language.t("tui.details.copy"),
          value: "message.copy",
          description: language.t("tui.details.messageTextToClipboard"),
          onSelect: async (dialog) => {
            const value = message()
            if (!value) return
            const text =
              value.type === "user"
                ? value.text
                : value.type === "assistant"
                  ? value.content
                      .filter((content) => content.type === "text")
                      .map((content) => content.text)
                      .join("\n")
                  : "text" in value
                    ? value.text
                    : ""
            try {
              await clipboard.write(text)
              dialog.clear()
            } catch (error) {
              toast.error(error)
            }
          },
        },
        {
          title: language.t("tui.details.fork"),
          value: "session.fork",
          description: language.t("tui.details.createANewSession"),
          onSelect: (dialog) => {
            const value = message()
            if (!value || value.type !== "user") return
            dialog.replace(() => <DialogFork sessionID={props.sessionID} messageID={props.messageID} />)
          },
        },
      ]}
    />
  )
}
