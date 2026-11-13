import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import {
  DialogStoryRuntime,
  STORY_DIRECTORY,
  STORY_PROJECTS,
  STORY_SERVER,
} from "@/components-lab/dialog-story-runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { CommandPaletteView, matchesCommandPaletteEntry } from "./dialog"
import { createCommandPaletteFileEntry, type CommandPaletteEntry } from "./palette"

type Scenario = { query?: string; fileSearch?: "pending" | "failed" }

function CommandPaletteStory(props: Scenario) {
  const dialog = useDialog()

  const language = useLanguage()

  const tabs = useTabs()

  const serverKey = ServerConnection.key(STORY_SERVER)

  const project = STORY_PROJECTS[0]

  const preferredCommands = (): CommandPaletteEntry[] => {
    const category = language.t("palette.group.commands")

    return [
      { id: "command:session.new", type: "command", title: language.t("command.session.new"), category },
      {
        id: "command:session.previous",
        type: "command",
        title: language.t("command.session.previous"),
        keybind: "alt+arrowup",
        category,
      },
      {
        id: "command:session.next",
        type: "command",
        title: language.t("command.session.next"),
        keybind: "alt+arrowdown",
        category,
      },
      {
        id: "command:terminal.toggle",
        type: "command",
        title: "Toggle terminal",
        keybind: "ctrl+`",
        category,
      },
      {
        id: "command:review.toggle",
        type: "command",
        title: language.t("command.review.toggle"),
        keybind: "ctrl+shift+r",
        category,
      },
    ]
  }

  const allCommands = (): CommandPaletteEntry[] => {
    const category = language.t("palette.group.commands")

    return [
      ...preferredCommands(),
      {
        id: "command:model.choose",
        type: "command",
        title: language.t("command.model.choose"),
        description: language.t("command.model.choose.description"),
        keybind: "ctrl+'",
        category,
      },
      {
        id: "command:model.variant.cycle",
        type: "command",
        title: language.t("command.model.variant.cycle"),
        description: language.t("command.model.variant.cycle.description"),
        keybind: "ctrl+shift+d",
        category,
      },
      {
        id: "command:provider.connect",
        type: "command",
        title: language.t("command.provider.connect"),
        description: language.t("dialog.provider.description"),
        keywords: "model provider integration",
        category,
      },
    ]
  }

  const sessions = (): CommandPaletteEntry[] => {
    const category = language.t("palette.group.recentSessions")

    return [
      {
        id: "session:ses_story_1",
        type: "session",
        title: "Refactor the dialog primitives",
        description: project.name,
        category,
        server: serverKey,
        directory: STORY_DIRECTORY,
        sessionID: "ses_story_1",
        project,
        updated: Date.now() - 18 * 60_000,
      },
      {
        id: "session:ses_story_2",
        type: "session",
        title: "Fix scrollbar in menus",
        description: project.name,
        category,
        server: serverKey,
        directory: STORY_DIRECTORY,
        sessionID: "ses_story_2",
        project,
        updated: Date.now() - 2 * 3_600_000,
      },
    ]
  }

  const settings = (): CommandPaletteEntry[] => {
    const category = language.t("palette.group.settings")

    return [
      {
        id: "setting:models",
        type: "setting",
        title: language.t("settings.models.title"),
        keywords: "model selector default",
        category,
      },
      {
        id: "setting:providers",
        type: "setting",
        title: language.t("settings.providers.title"),
        description: language.t("settings.providers.description"),
        keywords: "model provider api key",
        category,
      },
      {
        id: "setting:mcps",
        type: "setting",
        title: "MCPs",
        description: language.t("settings.tab.extensions"),
        keywords: "model context protocol",
        category,
      },
    ]
  }

  const files = () => [
    createCommandPaletteFileEntry(
      "packages/app/src/providers/models/select-dialog.tsx",
      language.t("palette.group.files"),
    ),
    createCommandPaletteFileEntry("packages/ui/src/overlays/dialog/dialog.tsx", language.t("palette.group.files")),
  ]

  const items = (query: string) => {
    if (!query) return [...preferredCommands(), ...sessions()]

    return [
      ...allCommands().filter((entry) => matchesCommandPaletteEntry(entry, query)),
      ...sessions().filter((entry) => matchesCommandPaletteEntry(entry, query)),
      ...settings().filter((entry) => matchesCommandPaletteEntry(entry, query)),
    ]
  }

  const findFiles = async (query: string, signal: AbortSignal): Promise<CommandPaletteEntry[]> => {
    if (!query) return []

    if (props.fileSearch === "failed") throw new Error("File search unavailable")

    if (props.fileSearch === "pending") {
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
    }

    return files().filter((entry) => matchesCommandPaletteEntry(entry, query))
  }

  const open = () => {
    tabs.addSessionTab({ server: serverKey, sessionId: "ses_story_1" })
    void dialog.show(() => {
      let host!: HTMLDivElement

      onMount(() => {
        if (!props.query) return
        const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')

        if (!input) return
        input.value = props.query
        input.dispatchEvent(new InputEvent("input", { bubbles: true }))
      })

      return (
        <div class="contents" ref={host}>
          <CommandPaletteView
            placeholder={language.t("palette.search.placeholder")}
            items={items}
            sources={[findFiles]}
            highlight={() => {}}
            select={() => dialog.close()}
            close={() => dialog.close()}
          />
        </div>
      )
    })
  }

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open command palette
    </Button>
  )
}

export default {
  title: "App/Dialogs/Command Palette",
  id: "app-dialog-command-palette",
}

const story = (scenario: Scenario = {}) => ({
  render: () => (
    <DialogStoryRuntime>
      <CommandPaletteStory {...scenario} />
    </DialogStoryRuntime>
  ),
})

export const Default = story()

export const Searching = story({ query: "model" })

export const NoResults = story({ query: "changelog.md" })

export const SearchingFiles = story({ query: "changelog.md", fileSearch: "pending" })

export const FileSearchFailed = story({ query: "changelog.md", fileSearch: "failed" })
