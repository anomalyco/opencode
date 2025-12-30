import { DialogSelect } from "@tui/ui/dialog-select"
import { useLayout } from "../../context/layout"

export function DialogSubagent(props: { sessionID: string }) {
  const layout = useLayout()

  return (
    <DialogSelect
      title="Subagent Actions"
      options={[
        {
          title: "Open",
          value: "subagent.view",
          description: "the subagent's session",
          onSelect: (dialog) => {
            layout.navigateFocusedWindow(`session:${props.sessionID}`)
            dialog.clear()
          },
        },
      ]}
    />
  )
}
