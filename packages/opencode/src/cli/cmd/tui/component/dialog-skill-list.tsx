import { createMemo, createSignal, createResource } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { Identifier } from "@/id/id"
import { Global } from "@/global"

function getSource(location: string): "global" | "project" {
  const home = Global.Path.home
  if (
    location.startsWith(`${home}/.claude/`) ||
    location.startsWith(`${home}/.opencode/`) ||
    location.startsWith(`${home}/.config/opencode/`)
  ) {
    return "global"
  }
  return "project"
}

export function DialogSkillList() {
  const sdk = useSDK()
  const dialog = useDialog()
  const local = useLocal()
  const route = useRoute()
  const [query, setQuery] = createSignal("")

  const [skills] = createResource(async () => {
    const result = await sdk.client.app.skills()
    return result.data ?? []
  })

  const options = createMemo(() => {
    const list = skills() ?? []
    const q = query().toLowerCase()

    return list
      .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
      .map((skill) => ({
        value: skill,
        title: skill.name,
        category: getSource(skill.location) === "global" ? "Global" : "Project",
        onSelect: async () => {
          dialog.clear()
          await invoke(skill.name)
        },
      }))
  })

  async function invoke(name: string) {
    const selectedModel = local.model.current()
    if (!selectedModel) return

    const sessionID =
      route.data.type === "session" ? route.data.sessionID : await sdk.client.session.create({}).then((x) => x.data!.id)

    await sdk.client.session.prompt({
      sessionID,
      ...selectedModel,
      messageID: Identifier.ascending("message"),
      agent: local.agent.current().name,
      model: selectedModel,
      parts: [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: `Use the skill tool to load the "${name}" skill`,
        },
      ],
    })

    if (route.data.type !== "session") {
      route.navigate({ type: "session", sessionID })
    }
  }

  return <DialogSelect onFilter={setQuery} skipFilter={true} title="Skills" options={options()} />
}
