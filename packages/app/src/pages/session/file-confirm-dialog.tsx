import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { For } from "solid-js"

export type ConfirmChoice = {
  value: string
  label: string
  variant?: "primary" | "secondary" | "ghost"
}

function ConfirmDialog(props: {
  title: string
  description: string
  choices: ConfirmChoice[]
  onPick: (value: string | undefined) => void
}) {
  const dialog = useDialog()
  return (
    <Dialog title={props.title} description={props.description} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex justify-end gap-2">
          <For each={props.choices}>
            {(choice) => (
              <Button
                variant={choice.variant ?? "secondary"}
                size="large"
                onClick={() => {
                  props.onPick(choice.value)
                  dialog.close()
                }}
              >
                {choice.label}
              </Button>
            )}
          </For>
        </div>
      </div>
    </Dialog>
  )
}

export function confirmChoice(
  dialog: ReturnType<typeof useDialog>,
  input: { title: string; description: string; choices: ConfirmChoice[] },
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const pick = (value: string | undefined) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.push(
      () => (
        <ConfirmDialog title={input.title} description={input.description} choices={input.choices} onPick={pick} />
      ),
      () => pick(undefined),
    )
  })
}
