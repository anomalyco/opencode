import { DialogSelect } from "@tui/ui/dialog-select"
import { useI18n } from "@tui/context/i18n"
import { useRoute } from "@tui/context/route"

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()
  const i18n = useI18n()

  return (
    <DialogSelect
      title={i18n.t("tui.dialog.subagent.title")}
      options={[
        {
          title: i18n.t("tui.dialog.subagent.open"),
          value: "subagent.view",
          description: i18n.t("tui.dialog.subagent.open_description"),
          onSelect: (dialog) => {
            route.navigate({
              type: "session",
              sessionID: props.sessionID,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
