import { DialogSelect } from "@tui/ui/dialog-select"
import { t } from "@/cli/cmd/tui/i18n"
import { useRoute } from "@tui/context/route"

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()

  return (
    <DialogSelect
      title={t("dialog.subagent.actions")}
      options={[
        {
          title: t("dialog.subagent.open"),
          value: "subagent.view",
          description: t("dialog.subagent.desc"),
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
