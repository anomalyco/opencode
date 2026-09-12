import { createMemo } from "solid-js"
import { useData } from "../../context/data"
import { DialogSelect } from "../../ui/dialog-select"
import { useClipboard } from "../../context/clipboard"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import { DialogFork } from "./dialog-fork"
import type { PromptInfo } from "../../prompt/history"
import { projectedPromptInput } from "../../prompt/codec"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const data = useData()
  const clipboard = useClipboard()
  const toast = useToast()
  const message = createMemo(() => data.session.message.get(props.sessionID, props.messageID))

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Jump to",
          value: "message.jump",
          description: "view message in session",
          onSelect: (dialog) => dialog.clear(),
        },
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: async (dialog) => {
            const value = message()
            const error = await data.session.revert
              .stage({ sessionID: props.sessionID, messageID: props.messageID })
              .then(
                () => undefined,
                (error) => error,
              )
            if (error) {
              toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
              return
            }
            if (value?.type === "user")
              props.setPrompt?.({
                ...projectedPromptInput(value),
                pasted: [],
              })
            dialog.clear()
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
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
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
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
