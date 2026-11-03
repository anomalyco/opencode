import { DialogLanguage } from "./dialog-language"
import type { TranslationKey } from "../i18n/translate"
import en from "../i18n/en"
import { useLanguage } from "../context/language"
import { createMemo, createSignal } from "solid-js"
import { useConfig, useNewDesigns } from "../config"
import { useThemes } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { DialogSelect, DialogSelectChoice } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { DialogThemeList } from "./dialog-theme-list"

type Setting = {
  title: TranslationKey
  category: TranslationKey
  path: string[]
  /** Shown below the list while the setting is selected, under the "new-designs" experiment. */
  description: TranslationKey
  default: unknown
  values?: readonly unknown[]
  labels?: readonly TranslationKey[]
  step?: number
  min?: number
  max?: number
  format?: (value: unknown) => string
  keywords?: readonly string[]
  /** Under the "new-designs" experiment, enter opens this picker instead of cycling. ←/→ still cycle. */
  open?: (dialog: DialogContext) => void
}

export const settings: Setting[] = [
  {
    title: "command.category.language",
    category: "settings.general.section.appearance",
    path: ["language"],
    description: "tui.interface.languageUsedAcrossTheTerminalInterface",
    default: "en",
    keywords: ["language", "locale", "russian", "русский", "язык", "english"],
  },
  {
    title: "command.category.theme",
    category: "settings.general.section.appearance",
    path: ["theme", "name"],
    description: "tui.interface.colorThemeUsedAcrossTheInterface",
    default: "opencode",
    keywords: ["color scheme", "colors"],
    open: (dialog) =>
      dialog.replace(() => (
        <DialogThemeList onClose={() => dialog.replace(() => <DialogConfig current="theme.name" />)} />
      )),
  },
  {
    title: "tui.colorMode",
    category: "settings.general.section.appearance",
    path: ["theme", "mode"],
    description: "tui.interface.darkOrLightVariantOrFollowTheSystem",
    default: "system",
    values: ["system", "dark", "light"],
    labels: ["tui.system", "tui.dark", "tui.light"],
    keywords: ["dark mode", "light mode", "system theme"],
  },
  {
    title: "tui.animations",
    category: "settings.general.section.appearance",
    path: ["animations"],
    description: "tui.interface.whetherSpinnersAndTransitionsAnimate",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["motion", "effects"],
  },
  {
    title: "tui.sidebar",
    category: "command.category.session",
    path: ["session", "sidebar"],
    description: "tui.interface.whetherTheSidebarShowsWhenThereIsRoom",
    default: "auto",
    values: ["hide", "auto"],
    labels: ["tui.hide", "tui.auto"],
    keywords: ["side panel"],
  },
  {
    title: "tui.scrollbar",
    category: "command.category.session",
    path: ["session", "scrollbar"],
    description: "tui.interface.whetherAScrollbarIsShownNextToThe",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["scroll bar"],
  },
  {
    title: "settings.timeline.category.thinking",
    category: "command.category.session",
    path: ["session", "thinking"],
    description: "tui.interface.whetherModelThinkingIsShownInTheChat",
    default: "hide",
    values: ["hide", "show"],
    labels: ["tui.hide", "tui.show"],
    keywords: ["reasoning", "chain of thought"],
  },
  {
    title: "tui.markdown",
    category: "command.category.session",
    path: ["session", "markdown"],
    description: "tui.interface.whetherChatMarkdownIsRenderedOrShownAs",
    default: "rendered",
    values: ["source", "rendered"],
    labels: ["tui.source", "tui.rendered"],
    keywords: ["syntax", "concealment", "rendering"],
  },
  {
    title: "tui.toolGrouping",
    category: "command.category.session",
    path: ["session", "grouping"],
    description: "tui.interface.whetherConsecutiveReadsAndSearchesAreGrouped",
    default: "auto",
    values: ["none", "auto"],
    labels: ["tui.none", "tui.auto"],
    keywords: ["transcript", "messages", "reads", "searches"],
  },
  {
    title: "tui.verbosity",
    category: "command.category.session",
    path: ["session", "verbosity"],
    description: "tui.interface.howMuchToolActivityIsShownInThe",
    default: "medium",
    values: ["low", "medium", "high"],
    keywords: ["detail", "activity", "summary", "transcript"],
  },
  {
    title: "tui.transcriptImages",
    category: "command.category.session",
    path: ["session", "image_preview"],
    description: "tui.interface.whetherImagesAreShownInTheChat",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["attachments", "images", "tool output"],
  },
  {
    title: "tui.tps",
    category: "command.category.session",
    path: ["session", "tps"],
    description: "tui.interface.whetherTokensPerSecondAreShownForResponses",
    default: true,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["tokens per second", "throughput"],
  },
  {
    title: "tui.newSessionLocation",
    category: "command.category.session",
    path: ["session", "new_location"],
    description: "tui.interface.directoryNewSessionsStartIn",
    default: "launch",
    values: ["launch", "inherit"],
    labels: ["tui.launchDirectory", "tui.activeSession"],
    keywords: ["directory", "cwd", "inherit"],
  },
  {
    title: "command.category.permissions",
    category: "command.category.session",
    path: ["session", "permissions"],
    description: "tui.interface.whetherPermissionRequestsAskYouOrAutoAccept",
    default: "prompt",
    values: ["prompt", "autoaccept"],
    labels: ["tui.prompt", "tui.autoAccept"],
    keywords: ["approve", "accept", "permission requests"],
  },
  {
    title: "tui.tabs.mode",
    category: "titlebar.tabs",
    path: ["tabs", "mode"],
    description: "tui.interface.whetherSessionsOpenInTabs",
    default: "auto",
    values: ["off", "on", "auto"],
  },
  {
    title: "tui.scope",
    category: "titlebar.tabs",
    path: ["tabs", "scope"],
    description: "tui.interface.whetherTabsArePerDirectoryOrSharedEverywhere",
    default: "cwd",
    values: ["cwd", "global"],
    labels: ["tui.currentDirectory", "tui.global"],
  },
  {
    title: "tui.layout",
    category: "titlebar.tabs",
    path: ["tabs", "layout"],
    description: "tui.interface.whetherTabsRunAlongTheTopOrDown",
    default: "horizontal",
    values: ["horizontal", "vertical"],
    labels: ["tui.horizontal", "tui.vertical"],
    keywords: ["sidebar", "orientation", "left"],
  },
  {
    title: "tui.indicators",
    category: "titlebar.tabs",
    path: ["tabs", "indicators"],
    description: "tui.interface.whetherTabsShowStatusIconsOrAlwaysNumbers",
    default: "status",
    values: ["status", "numbers"],
    labels: ["tui.statusIcons", "tui.alwaysShowNumbers"],
    keywords: ["tab numbers", "number mode", "status icons"],
  },
  {
    title: "tui.layout",
    category: "tui.diffs",
    path: ["diffs", "view"],
    description: "tui.interface.whetherDiffsAreSideBySideOrIn",
    default: "auto",
    values: ["auto", "split", "unified"],
    labels: ["tui.auto", "tui.split", "tui.unified"],
    keywords: ["diff layout", "split diff", "unified diff"],
  },
  {
    title: "tui.wrapping",
    category: "tui.diffs",
    path: ["diffs", "wrap"],
    description: "tui.interface.whetherLongLinesInDiffsWrap",
    default: "word",
    values: ["none", "word"],
    labels: ["tui.none", "tui.word"],
    keywords: ["diff wrap", "word wrap", "line wrap"],
  },
  {
    title: "settings.general.row.showFileTree.title",
    category: "tui.diffs",
    path: ["diffs", "tree"],
    description: "tui.interface.whetherAFileTreeIsShownNextTo",
    default: true,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["diff files"],
  },
  {
    title: "tui.singlePatch",
    category: "tui.diffs",
    path: ["diffs", "single"],
    description: "tui.interface.whetherDiffsShowOneFileAtATime",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["one file", "selected file"],
  },
  {
    title: "tui.scrollSpeed",
    category: "tui.input",
    path: ["scroll", "speed"],
    description: "tui.interface.howFarEachScrollStepMoves",
    default: 3,
    step: 0.25,
    min: 0.25,
    max: 10,
    format: (value) => Number(value).toFixed(2),
    keywords: ["scrolling"],
  },
  {
    title: "tui.acceleration",
    category: "tui.input",
    path: ["scroll", "acceleration"],
    description: "tui.interface.whetherScrollingSpeedsUpTheFasterYouScroll",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["scroll acceleration"],
  },
  {
    title: "tui.mouse",
    category: "tui.input",
    path: ["mouse"],
    description: "tui.interface.whetherTheInterfaceRespondsToTheMouse",
    default: true,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["mouse capture"],
  },
  {
    title: "tui.editorContext",
    category: "tui.input",
    path: ["prompt", "editor"],
    description: "tui.interface.whetherYourEditorSSelectionIsAddedTo",
    default: true,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["file context", "prompt context", "editor selection"],
  },
  {
    title: "tui.largePastes",
    category: "tui.input",
    path: ["prompt", "paste"],
    description: "tui.interface.whetherLargePastesAreSummarizedOrShownIn",
    default: "compact",
    values: ["compact", "full"],
    labels: ["tui.compact", "tui.full"],
    keywords: ["paste summary", "clipboard", "pasted content"],
  },
  {
    title: "tui.imagePreviews",
    category: "tui.input",
    path: ["prompt", "image_preview"],
    description: "tui.interface.whetherAttachedImagesArePreviewedInThePrompt",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["attachments", "clipboard", "images", "prompt"],
  },
  {
    title: "tui.leaderTimeout",
    category: "tui.input",
    path: ["leader", "timeout"],
    description: "tui.interface.howLongTheLeaderKeyWaitsForThe",
    default: 2000,
    step: 250,
    min: 250,
    max: 10000,
    format: (value) => `${value} ms`,
    keywords: ["leader key", "shortcut timeout"],
  },
  {
    title: "settings.tab.notifications",
    category: "tui.alerts",
    path: ["attention", "notifications"],
    description: "tui.interface.whetherToNotifyWhenASessionNeedsAttention",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["system notifications", "desktop notifications", "alerts"],
  },
  {
    title: "tui.sounds",
    category: "tui.alerts",
    path: ["attention", "sound"],
    description: "tui.interface.whetherASoundPlaysWhenASessionNeeds",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["audio", "sound effects", "alerts"],
  },
  {
    title: "tui.volume",
    category: "tui.alerts",
    path: ["attention", "volume"],
    description: "tui.interface.volumeOfAlertSounds",
    default: 0.4,
    step: 0.1,
    min: 0,
    max: 1,
    format: (value) => `${Math.round(Number(value) * 100)}%`,
    keywords: ["sound volume", "audio volume"],
  },
  {
    title: "tui.releaseHighlights",
    category: "tui.alerts",
    path: ["highlights"],
    description: "tui.interface.whetherReleaseHighlightsAreShownAfterAnUpdate",
    default: true,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["what's new", "changelog", "release notes"],
  },
  {
    title: "tui.windowTitle",
    category: "command.category.terminal",
    path: ["terminal", "title"],
    description: "tui.interface.whetherTheWindowTitleShowsTheCurrentSession",
    default: true,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["terminal title", "tab title"],
  },
  {
    title: "tui.copyBehavior",
    category: "command.category.terminal",
    path: ["terminal", "copy"],
    description: "tui.interface.whetherSelectingTextCopiesIt",
    default: process.platform === "win32" ? "manual" : "select",
    values: ["manual", "select"],
    labels: ["tui.manual", "tui.select"],
    keywords: ["selection", "clipboard"],
  },
  {
    title: "tui.developerTools",
    category: "tui.debug",
    path: ["debug", "devtools"],
    description: "tui.interface.whetherTheDeveloperToolsBarIsShown",
    default: false,
    values: [false, true],
    labels: ["tui.off", "tui.on"],
    keywords: ["debug bar", "developer tools"],
  },
]

export function settingID(setting: Setting) {
  return setting.path.join(".")
}

export function DialogConfig(props: { current?: string }) {
  const language = useLanguage()
  const dialog = useDialog()
  const config = useConfig()
  const newDesigns = useNewDesigns()
  const toast = useToast()
  const themes = useThemes()
  const current = Math.max(
    0,
    settings.findIndex((setting) => settingID(setting) === props.current),
  )
  const [selected, setSelected] = createSignal(current)
  const [saving, setSaving] = createSignal(false)

  const value = (setting: Setting) => {
    const current = setting.path.reduce<unknown>((result, key) => {
      if (!result || typeof result !== "object") return undefined
      return (result as Record<string, unknown>)[key]
    }, config.data)
    if (setting.path.join(".") === "theme.name") return current ?? themes.selected
    return current ?? setting.default
  }
  const values = (setting: Setting) =>
    setting.path.join(".") === "theme.name"
      ? Object.keys(themes.all()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      : setting.values
  const display = (setting: Setting) => {
    const current = value(setting)
    if (settingID(setting) === "language") return language.label(language.locale())
    if (setting.format) return setting.format(current)
    const index = setting.values?.indexOf(current)
    const label = index === undefined || index < 0 ? undefined : setting.labels?.[index]
    return label ? language.t(label) : String(current)
  }
  const options = createMemo(() =>
    settings.map((setting, index) => ({
      title: language.t(setting.title),
      category: language.t(setting.category),
      searchText: [en[setting.title], ...(setting.keywords ?? [])].join(" "),
      footer: newDesigns() ? (
        <DialogSelectChoice value={display(setting)} active={selected() === index} open={setting.open !== undefined} />
      ) : (
        display(setting)
      ),
      footerOverhang: newDesigns() ? 2 : undefined,
      detail: newDesigns() ? language.t(setting.description) : undefined,
      value: index,
    })),
  )

  async function change(direction: number, index = selected()) {
    if (saving()) return
    const setting = settings[index]
    if (settingID(setting) === "language") {
      dialog.replace(() => <DialogLanguage />)
      return
    }
    const current = value(setting)
    const choices = values(setting)
    const next = choices
      ? choices[(choices.indexOf(current) + direction + choices.length) % choices.length]
      : Math.min(setting.max!, Math.max(setting.min!, Number(current) + direction * setting.step!))
    if (next === current) return
    setSaving(true)
    await config
      .update((draft) => {
        const parent = setting.path.slice(0, -1).reduce<Record<string, unknown>>((result, key) => {
          if (!result[key] || typeof result[key] !== "object") result[key] = {}
          return result[key] as Record<string, unknown>
        }, draft)
        parent[setting.path.at(-1)!] = next
      })
      .catch(toast.error)
      .finally(() => setSaving(false))
  }

  return (
    <DialogSelect
      title={language.t("command.category.settings")}
      searchInTitle
      titlePlaceholder={language.t("tui.interface.searchSettings")}
      options={options()}
      // Under new designs the opening setting is focused without the current-item marker; changing a value keeps the
      // selection where it is.
      current={newDesigns() ? undefined : current}
      focusTarget={newDesigns() ? current : undefined}
      preserveSelection={newDesigns()}
      filterThreshold={0.7}
      onMove={(option) => setSelected(option.value)}
      onSelect={(option) => {
        const open = settings[option.value].open
        if (newDesigns() && open) return open(dialog)
        void change(1, option.value)
      }}
      footerHints={newDesigns() ? [] : [{ title: language.t("tui.change"), label: "←/→" }]}
      bindings={[
        {
          bind: "left",
          title: language.t("tui.previousValue"),
          group: language.t("command.category.settings"),
          run: () => void change(-1),
        },
        {
          bind: "right",
          title: language.t("tui.nextValue"),
          group: language.t("command.category.settings"),
          run: () => void change(1),
        },
      ]}
    />
  )
}
