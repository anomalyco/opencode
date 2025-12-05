import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTerminalDimensions } from "@opentui/solid"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import { DialogAgentDetails } from "./dialog-agent-details"

export function DialogAgent(props: { focusedAgent?: string }) {
  const local = useLocal()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()

  const [selectedAgentName, setSelectedAgentName] = createSignal(props.focusedAgent ?? local.agent.current().name)

  const selectedAgentHasDescription = createMemo(() => {
    const agent = local.agent.list().find((a) => a.name === selectedAgentName())
    return agent && !agent.builtIn && !!agent.description
  })

  // Dialog width is min(60, terminalWidth - 2), minus ~10 for padding
  const availableWidth = createMemo(() => Math.min(60, dimensions().width - 2) - 10)

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      let description: string | undefined

      if (item.builtIn) {
        description = "native"
      } else if (item.shortDescription) {
        description = item.shortDescription
      } else if (item.description) {
        description = item.description
      }

      // Truncate description based on available space after title
      const maxDescLen = availableWidth() - item.name.length - 1
      if (description && maxDescLen > 3) {
        description = Locale.truncate(description, maxDescLen)
      } else if (description && maxDescLen <= 3) {
        description = undefined
      }

      return {
        value: item.name,
        title: item.name,
        description,
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      defaultSelected={props.focusedAgent}
      options={options()}
      onMove={(option) => setSelectedAgentName(option.value)}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+e")[0],
          title: "show details",
          get disabled() {
            return !selectedAgentHasDescription()
          },
          onTrigger: (option) => {
            dialog.replace(() => <DialogAgentDetails agentName={option.value} />)
          },
        },
      ]}
    />
  )
}
