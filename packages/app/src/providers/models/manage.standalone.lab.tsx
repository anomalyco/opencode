import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, on, onMount } from "solid-js"
import { DialogLabRuntime } from "@/lab/dialog-runtime"
import { DialogManageModels } from "./manage"

function ManageModelsLab(props: { query: string }) {
  const dialog = useDialog()

  // The dialog owns its filter. Send inspector edits through the same field as keyboard input.
  const open = () =>
    void dialog.show(() => {
      let host!: HTMLDivElement

      createEffect(
        on(
          () => props.query,
          (query) => {
            const field = host.querySelector<HTMLInputElement>('input[type="search"]')

            if (!field || field.value === query) return
            field.value = query
            field.dispatchEvent(new InputEvent("input", { bubbles: true }))
          },
        ),
      )

      return (
        <div class="contents" ref={host}>
          <DialogManageModels />
        </div>
      )
    })

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open manage models dialog
    </Button>
  )
}

export default {
  title: "App/Dialogs/Manage Models",
  id: "app-dialog-manage-models",
  args: { query: "" },
  render: (args: { query: string }) => (
    <DialogLabRuntime>
      <ManageModelsLab query={args.query} />
    </DialogLabRuntime>
  ),
}

export const Default = {}

export const ProviderSearch = { args: { query: "anthropic" } }

export const NoMatches = { args: { query: "missing-model-xyz" } }
