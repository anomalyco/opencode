import { DialogSelect } from "../ui/dialog-select"
import { useTheme } from "../context/theme"

export function DialogExperiments() {
  const theme = useTheme()

  return (
    <DialogSelect
      title="Experiments"
      options={[]}
      renderFilter={false}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>No experiments available</text>
        </box>
      }
    />
  )
}
