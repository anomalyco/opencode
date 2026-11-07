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

function CommandPaletteStory(props: { query?: string }) {
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

  const open = () => {
    tabs.addSessionTab({ server: serverKey, sessionId: "ses_story_1" })
    void dialog.show(() => (
      <CommandPaletteView
        placeholder={language.t("palette.search.placeholder")}
        items={items}
        sources={[async (query) => (query ? files().filter((entry) => matchesCommandPaletteEntry(entry, query)) : [])]}
        highlight={() => {}}
        select={() => dialog.close()}
        close={() => dialog.close()}
      />
    ))

    if (!props.query) return
    const initial = props.query
    queueMicrotask(() => {
      const input = document.querySelector<HTMLInputElement>(".command-palette input[role='combobox']")

      if (!input) return
      input.value = initial
      input.dispatchEvent(new InputEvent("input", { bubbles: true }))
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

export const Default = {
  render: () => (
    <DialogStoryRuntime>
      <CommandPaletteStory />
    </DialogStoryRuntime>
  ),
}

export const Searching = {
  render: () => (
    <DialogStoryRuntime>
      <CommandPaletteStory query="model" />
    </DialogStoryRuntime>
  ),
}
