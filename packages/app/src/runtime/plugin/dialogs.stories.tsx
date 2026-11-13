import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { PluginSelectDialog } from "./dialogs"

type Args = { optionCount: number; grouped: boolean; descriptions: boolean }

function PluginSelectStory(props: Args) {
  const dialog = useDialog()

  const [store, setStore] = createStore({ selected: "Nothing selected" })

  const destinations = [
    { title: "Design notes", description: "Research and references", group: "Recent", value: "design" },
    { title: "Project roadmap", description: "Upcoming milestones", group: "Recent", value: "roadmap" },
    { title: "Engineering", description: "Implementation and architecture", group: "Teams", value: "engineering" },
    { title: "Product", description: "Planning and feedback", group: "Teams", value: "product" },
    { title: "Support", description: "Customer questions", group: "Teams", value: "support" },
  ]

  const open = () =>
    dialog.show(() => (
      <PluginSelectDialog
        options={{
          title: "Choose a destination",
          placeholder: "Search destinations",
          current: store.selected,
          options: destinations.slice(0, props.optionCount).map((item) => ({
            ...item,
            group: props.grouped ? item.group : undefined,
            description: props.descriptions ? item.description : undefined,
          })),
        }}
        done={(value) => {
          setStore("selected", value ?? "Selection dismissed")
          dialog.close()
        }}
      />
    ))

  onMount(open)

  return (
    <div class="flex flex-col items-start gap-3">
      <Button variant="neutral" onClick={open}>
        Open plugin selection dialog
      </Button>
      <p role="status">{store.selected}</p>
    </div>
  )
}

export default {
  title: "App/Dialogs/Plugin Selection",
  id: "app-dialog-plugin-selection",
  args: { optionCount: 5, grouped: true, descriptions: true } satisfies Args,
  argTypes: { optionCount: { control: { type: "range", min: 0, max: 5, step: 1 } } },
  render: (args: Args) => <PluginSelectStory {...args} />,
}

export const Default = {}

export const TitlesOnly = { args: { grouped: false, descriptions: false } }

export const NoDestinations = { args: { optionCount: 0 } }
