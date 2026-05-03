import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { ScrollBoxRenderable } from "@opentui/core"
import { createSignal, Show } from "solid-js"

export type DialogBtwProps = {
  question: string
  answer: string
  loading?: boolean
}

export function DialogBtw(props: DialogBtwProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape" || evt.name === " ") {
      evt.preventDefault()
      evt.stopPropagation()
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={1} fg={theme.text}>
          Side Question
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc/space/enter to dismiss
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted} wrapMode="word">
          {props.question}
        </text>
      </box>
      <Show when={props.loading}>
        <box>
          <text fg={theme.textMuted}>Thinking...</text>
        </box>
      </Show>
      <Show when={!props.loading}>
        <scrollbox height={Math.min(20, props.answer.split("\n").length + 2)} scrollbarOptions={{ visible: false }}>
          <text fg={theme.text} wrapMode="word">
            {props.answer}
          </text>
        </scrollbox>
      </Show>
    </box>
  )
}

export async function showBtwDialog(dialog: DialogContext, question: string, answerPromise: Promise<string>) {
  dialog.replace(() => <DialogBtw question={question} answer="" loading={true} />)

  try {
    const answer = await answerPromise
    dialog.replace(() => <DialogBtw question={question} answer={answer} loading={false} />)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.replace(() => <DialogBtw question={question} answer={`Error: ${message}`} loading={false} />)
  }
}
