import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { Keybind } from "@/util/keybind"
import { DialogAgentDetails } from "./dialog-agent-details"

export function DialogAgent(props: { initialAgent?: string }) {
  const local = useLocal()
  const dialog = useDialog()

  const [selectedAgentName, setSelectedAgentName] = createSignal(props.initialAgent ?? local.agent.current().name)

  const selectedAgentHasPrompt = createMemo(() => {
    const agent = local.agent.list().find((a) => a.name === selectedAgentName())
    return agent && !agent.builtIn && !!agent.description
  })

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

      description = description ? description.length > 35 ? description.slice(0, 32) + "..." : description : undefined

      return {
        value: item.name,
        title: item.name,
        description
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      defaultSelected={props.initialAgent}
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
            return !selectedAgentHasPrompt()
          },
          onTrigger: (option) => {
            dialog.replace(() => <DialogAgentDetails agentName={option.value} />)
          },
        },
      ]}
    />
  )
}
