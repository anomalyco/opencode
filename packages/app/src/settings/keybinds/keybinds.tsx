import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@/shell/notifications/toast"
import fuzzysort from "fuzzysort"
import { Predicate } from "effect"
import {
  DEFAULT_PALETTE_KEYBIND,
  formatKeybind,
  keyFromKeyboardEvent,
  parseKeybind,
  useCommand,
  type CommandSection,
} from "@/shell/commands/command"
import { chordStrokes } from "@/shell/commands/keymap"
import { useLanguage } from "@/runtime/i18n/language"
import { usePluginHost } from "@/runtime/plugin/host"
import { useSettings } from "@/settings/model"
import { SettingsList } from "@/settings/list"
import { SettingsSearchEmpty } from "@/settings/search-empty"
import { SettingsSearchField } from "@/settings/search-field"
import {
  INITIAL_KEYBIND_CAPTURE_STATE,
  MAX_CHORD_STROKES,
  selectCapturePrefix,
  selectCapturingKeybind,
  selectExtendableKeybind,
  transitionKeybindCapture,
  type KeybindCaptureEffect,
  type KeybindCaptureEvent,
  type RecordedKeyInput,
} from "./machine"

const IS_MAC = typeof navigator !== "undefined" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const PALETTE_ID = "command.palette"

type KeybindGroup = "General" | "Session" | "Navigation" | "Model and agent" | "Terminal" | "Prompt"

type KeybindMeta = {
  title: string
  group: KeybindGroup
}

type KeybindMap = Record<string, string | undefined>

type CommandContext = ReturnType<typeof useCommand>

type LanguageContext = ReturnType<typeof useLanguage>

type SettingsContext = ReturnType<typeof useSettings>

const GROUPS: KeybindGroup[] = ["General", "Session", "Navigation", "Model and agent", "Terminal", "Prompt"]

type GroupKey =
  | "settings.shortcuts.group.general"
  | "settings.shortcuts.group.session"
  | "settings.shortcuts.group.navigation"
  | "settings.shortcuts.group.modelAndAgent"
  | "settings.shortcuts.group.terminal"
  | "settings.shortcuts.group.prompt"

const groupKey: Record<KeybindGroup, GroupKey> = {
  General: "settings.shortcuts.group.general",
  Session: "settings.shortcuts.group.session",
  Navigation: "settings.shortcuts.group.navigation",
  "Model and agent": "settings.shortcuts.group.modelAndAgent",
  Terminal: "settings.shortcuts.group.terminal",
  Prompt: "settings.shortcuts.group.prompt",
}

const sectionGroup: Record<CommandSection, KeybindGroup> = {
  general: "General",
  session: "Session",
  navigation: "Navigation",
  model: "Model and agent",
  terminal: "Terminal",
  prompt: "Prompt",
}

function groupFor(id: string, section?: CommandSection): KeybindGroup {
  if (section) return sectionGroup[section]

  if (id === PALETTE_ID) return "General"

  if (id.startsWith("model.") || id.startsWith("agent.") || id.startsWith("mcp.")) return "Model and agent"

  if (id.startsWith("file.") || id.startsWith("fileTree.")) return "Navigation"

  if (id.startsWith("prompt.")) return "Prompt"

  if (
    id.startsWith("session.") ||
    id.startsWith("message.") ||
    id.startsWith("permissions.") ||
    id.startsWith("steps.") ||
    id.startsWith("review.")
  )
    return "Session"

  return "General"
}

function isModifier(key: string) {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta"
}

function recordKeybind(event: KeyboardEvent) {
  if (isModifier(event.key)) return

  const parts: string[] = []

  const mod = IS_MAC ? event.metaKey : event.ctrlKey

  if (mod) parts.push("mod")

  if (IS_MAC && event.ctrlKey) parts.push("ctrl")

  if (!IS_MAC && event.metaKey) parts.push("meta")

  if (event.altKey) parts.push("alt")

  if (event.shiftKey) parts.push("shift")

  const key = keyFromKeyboardEvent(event)

  if (!key) return
  parts.push(key)

  return parts.join("+")
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || !!target.closest("input, textarea, select, [contenteditable='true']"))
  )
}

// Each combo of a keybind as its strokes' signatures.
function chords(config: string | undefined) {
  if (!config || config === "none") return []

  return config
    .split(",")
    .map((combo) => chordStrokes(combo).map(signature))
    .filter((chord) => chord.length > 0)
}

function signature(stroke: string) {
  const kb = parseKeybind(stroke)[0]

  if (!kb) return stroke

  return [kb.ctrl && "ctrl", kb.alt && "alt", kb.shift && "shift", kb.meta && "meta", kb.key].filter(Boolean).join("+")
}

// Two chords clash when one starts the other: the shorter one would run before the longer could finish.
function clashes(a: readonly string[], b: readonly string[]) {
  const shorter = a.length <= b.length ? a : b
  const longer = shorter === a ? b : a

  return shorter.every((stroke, index) => longer[index] === stroke)
}

function listFor(
  command: Pick<CommandContext, "catalog" | "options">,
  map: KeybindMap,
  palette: string,
  plugins: ReadonlySet<string> | undefined,
) {
  const out = new Map<string, KeybindMeta>()
  out.set(PALETTE_ID, { title: palette, group: "General" })
  // A command that shares another's shortcut is set through that command, unless it already has its own.
  const follower = (opt: { id: string; follows?: string }) => !!opt.follows && !Predicate.isString(map[opt.id])

  for (const opt of command.catalog) {
    if (opt.id.startsWith("suggested.")) continue

    // The catalog remembers commands that are not registered right now; a removed or renamed plugin's never return.
    if (opt.plugin && plugins && !plugins.has(opt.plugin)) continue

    if (opt.hidden) continue

    if (follower(opt)) continue
    out.set(opt.id, { title: opt.title, group: groupFor(opt.id, opt.section) })
  }

  for (const opt of command.options) {
    if (opt.id.startsWith("suggested.")) continue

    if (opt.hidden) continue

    if (follower(opt)) continue
    out.set(opt.id, { title: opt.title, group: groupFor(opt.id, opt.section) })
  }

  for (const [id, value] of Object.entries(map)) {
    if (!Predicate.isString(value)) continue

    if (out.has(id)) continue
    out.set(id, { title: id, group: groupFor(id) })
  }

  return out
}

function groupedFor(list: Map<string, KeybindMeta>) {
  const out = new Map<KeybindGroup, string[]>()

  for (const group of GROUPS) out.set(group, [])

  for (const [id, item] of list) {
    const ids = out.get(item.group)

    if (!ids) continue
    ids.push(id)
  }

  for (const group of GROUPS) {
    const ids = out.get(group)

    if (!ids) continue
    ids.sort((a, b) => (list.get(a)?.title ?? "").localeCompare(list.get(b)?.title ?? ""))
  }

  return out
}

function filteredFor(
  query: string,
  list: Map<string, KeybindMeta>,
  grouped: Map<KeybindGroup, string[]>,
  keybind: (id: string) => string,
) {
  const value = query.toLowerCase().trim()

  if (!value) return grouped

  const out = new Map<KeybindGroup, string[]>()

  for (const group of GROUPS) out.set(group, [])

  const items = Array.from(list.entries()).map(([id, meta]) => ({
    id,
    title: meta.title,
    group: meta.group,
    keybind: keybind(id),
  }))

  const results = fuzzysort.go(value, items, {
    keys: ["title", "keybind"],
    threshold: -10000,
  })

  for (const result of results) {
    const ids = out.get(result.obj.group)

    if (!ids) continue
    ids.push(result.obj.id)
  }

  return out
}

// What the recording driver holds between effects: the release of the shortcut suspension.
type CaptureDriver = { release?: () => void }

export function createKeybindSettingsController(
  input: {
    command: Pick<CommandContext, "catalog" | "options" | "suspend">
    /** The ids of the installed GUI plugins; remembered commands of any other plugin are not listed. */
    plugins?: () => ReadonlySet<string>
    settings: {
      keybinds: Pick<SettingsContext["keybinds"], "all" | "get" | "set" | "resetAll">
    }
    target?: Document
    notify?: (toast: { title: string; description: string }) => void
    /** Whether the Shortcuts page shows; hiding it ends a recording. */
    active?: () => boolean
  },
  language: Pick<LanguageContext, "locale" | "t"> = useLanguage(),
) {
  const [captureState, setCaptureState] = createSignal(INITIAL_KEYBIND_CAPTURE_STATE)
  const overrides = createMemo(() => input.settings.keybinds.all())

  const list = createMemo(() => {
    language.locale()

    return listFor(input.command, overrides(), language.t("command.palette"), input.plugins?.())
  })

  const grouped = createMemo(() => groupedFor(list()))
  const title = (id: string) => list().get(id)?.title ?? ""

  const effective = (id: string) => {
    if (id === PALETTE_ID) return input.settings.keybinds.get(id) ?? DEFAULT_PALETTE_KEYBIND

    const custom = input.settings.keybinds.get(id)

    if (Predicate.isString(custom)) return custom

    const live = input.command.options.find((item) => item.id === id)

    if (live?.keybind) return live.keybind

    return input.command.catalog.find((item) => item.id === id)?.keybind
  }

  const used = createMemo(() =>
    Array.from(list().keys()).flatMap((id) => chords(effective(id)).map((chord) => ({ id, title: title(id), chord }))),
  )

  // The commands a chord would clash with, other than the one being recorded.
  const conflicts = (keybind: string, id: string) => {
    const chord = chords(keybind)[0]

    if (!chord) return []

    return [...new Set(used().flatMap((item) => (item.id !== id && clashes(chord, item.chord) ? [item.title] : [])))]
  }

  const notify = input.notify ?? ((toast: { title: string; description: string }) => showToast(toast))
  const pageActive = () => input.active?.() ?? true

  const driver: CaptureDriver = {}

  const dispatch = (event: KeybindCaptureEvent) =>
    untrack(() => {
      const previous = captureState()
      const next = transitionKeybindCapture(previous, event)

      if (next.state !== previous) setCaptureState(next.state)
      next.effects.forEach(run)
    })

  const conflictsFor = (keybind: string) => {
    const id = selectCapturingKeybind(untrack(captureState))

    if (!id) return []

    return conflicts(keybind, id)
  }

  function run(effect: KeybindCaptureEffect) {
    if (effect.type === "keybinds.suspend") {
      driver.release?.()
      driver.release = input.command.suspend()

      return
    }

    if (effect.type === "keybinds.resume") {
      driver.release?.()
      driver.release = undefined

      return
    }

    if (effect.type === "binding.set") return input.settings.keybinds.set(effect.id, effect.value)

    if (effect.type === "bindings.reset") return input.settings.keybinds.resetAll()

    if (effect.type === "notify.reset") {
      notify({
        title: language.t("settings.shortcuts.reset.toast.title"),
        description: language.t("settings.shortcuts.reset.toast.description"),
      })

      return
    }

    notify({
      title: language.t("settings.shortcuts.conflict.title"),
      description: language.t("settings.shortcuts.conflict.description", {
        keybind: formatKeybind(effect.keybind, language.t),
        titles: effect.conflictTitles.join(", "),
      }),
    })
  }

  const handle = (event: KeyboardEvent) => {
    const id = selectCapturingKeybind(untrack(captureState))

    if (!id) return

    // A text field, such as the search box, gets its keys; typing there ends the recording.
    if (isEditableTarget(event.target)) return dispatch({ type: "capture.cancelled" })

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    dispatch({ type: "key.pressed", input: recordedKey(event) })
  }

  const recordedKey = (event: KeyboardEvent): RecordedKeyInput => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

    if (event.key === "Escape") return { kind: "escape" }

    if ((event.key === "Backspace" || event.key === "Delete") && plain) return { kind: "backspace" }

    const stroke = recordKeybind(event)

    if (!stroke) return { kind: "modifier-only" }

    const prefix = selectCapturePrefix(untrack(captureState))

    return { kind: "stroke", stroke, conflictTitles: conflictsFor(prefix ? `${prefix} ${stroke}` : stroke) }
  }

  const target = input.target ?? (typeof document !== "undefined" ? document : undefined)

  if (target) {
    makeEventListener(target, "keydown", handle, { capture: true })
    makeEventListener(
      target,
      "focusin",
      (event) => {
        if (selectCapturingKeybind(untrack(captureState)) && isEditableTarget(event.target))
          dispatch({ type: "capture.cancelled" })
      },
      { capture: true },
    )
  }

  createEffect(() => dispatch({ type: "page.synced", active: pageActive() }))
  createEffect(() => dispatch({ type: "catalog.synced", ids: new Set(list().keys()) }))
  onCleanup(() => dispatch({ type: "disposed" }))

  const format = (config: string | undefined) => formatKeybind(config ?? "", language.t)

  const firstCombo = (id: string) => {
    const config = effective(id)

    return config && config !== "none" ? (config.split(",")[0]?.trim() ?? "") : ""
  }

  return {
    catalog: {
      groups: GROUPS,
      filtered: (query: string) => filteredFor(query, list(), grouped(), (id) => format(effective(id))),
      title,
      keybind: (id: string) => format(effective(id)),
      alternatives: (id: string) =>
        [...new Set((effective(id) ?? "").split(",").map(format))].filter(Boolean).join(" / "),
    },
    capture: {
      active: () => selectCapturingKeybind(captureState()),
      /** The keys the key being recorded adds to, formatted. */
      prefix: () => format(selectCapturePrefix(captureState())),
      /** Whether the row offers + to add a key to its shortcut: it was just saved and has room for another. */
      extendable: (id: string) =>
        selectExtendableKeybind(captureState()) === id && chordStrokes(firstCombo(id)).length < MAX_CHORD_STROKES,
      extend: (id: string) =>
        dispatch({ type: "capture.extended", id, chord: firstCombo(id), pageActive: pageActive() }),
      toggle: (id: string) => dispatch({ type: "capture.toggled", id, pageActive: pageActive() }),
      unbind: (id: string) => dispatch({ type: "unbind.clicked", id }),
    },
    settings: {
      hasOverrides: () => Object.values(overrides()).some(Predicate.isString),
      reset: () => dispatch({ type: "reset.clicked" }),
    },
  }
}

export function SettingsKeybinds(props: { active?: boolean }) {
  const command = useCommand()
  const settings = useSettings()
  const host = usePluginHost()
  const plugins = createMemo(() => new Set(host.definitions().map((definition) => definition.id)))

  const controller = createKeybindSettingsController({
    command,
    plugins,
    settings,
    active: () => props.active ?? true,
  })

  return (
    <SettingsKeybindsView
      visible={props.active}
      groups={controller.catalog.groups}
      filtered={controller.catalog.filtered}
      title={controller.catalog.title}
      keybind={controller.catalog.keybind}
      alternatives={controller.catalog.alternatives}
      active={controller.capture.active()}
      prefix={controller.capture.prefix()}
      extendable={controller.capture.extendable}
      onCapture={controller.capture.toggle}
      onExtend={controller.capture.extend}
      onUnbind={controller.capture.unbind}
      hasOverrides={controller.settings.hasOverrides()}
      onReset={controller.settings.reset}
    />
  )
}

function SettingsKeybindsView(props: {
  visible?: boolean
  groups: KeybindGroup[]
  filtered: (query: string) => Map<KeybindGroup, string[]>
  title: (id: string) => string
  keybind: (id: string) => string
  alternatives: (id: string) => string
  active: string | null
  prefix: string
  extendable: (id: string) => boolean
  onCapture: (id: string) => void
  onExtend: (id: string) => void
  onUnbind: (id: string) => void
  hasOverrides: boolean
  onReset: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ filter: "" })
  const filtered = createMemo(() => props.filtered(store.filter))
  const hasResults = createMemo(() => props.groups.some((group) => (filtered().get(group)?.length ?? 0) > 0))

  return (
    <>
      <div class="settings-tab-header settings-tab-header--stacked">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.shortcuts.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.shortcuts.description")}</span>
          </div>
          <Button variant="ghost" onClick={props.onReset} disabled={!props.hasOverrides}>
            {language.t("settings.shortcuts.reset.button")}
          </Button>
        </div>
        <SettingsSearchField
          value={store.filter}
          active={props.visible ?? true}
          onInput={(value) => setStore("filter", value)}
          placeholder={language.t("settings.shortcuts.search.placeholder")}
        />
      </div>
      <div class="settings-tab-body">
        <div class="settings-shortcuts settings-section-stack">
          <For each={props.groups}>
            {(group) => (
              <Show when={(filtered().get(group) ?? []).length > 0}>
                <div class="settings-section">
                  <h3 class="settings-section-title">{language.t(groupKey[group])}</h3>
                  <SettingsList>
                    <For each={filtered().get(group) ?? []}>
                      {(id) => (
                        <div class="flex items-center justify-between gap-4 py-3 border-b border-v2-border-border-base last:border-none">
                          <span>{props.title(id)}</span>
                          <div class="flex items-center gap-1">
                            <ShortcutButton
                              id={id}
                              binding={props.keybind(id)}
                              alternatives={props.alternatives(id)}
                              active={props.active}
                              prefix={props.prefix}
                              onCapture={props.onCapture}
                              onUnbind={props.onUnbind}
                            />
                            <Show when={props.extendable(id)}>
                              <IconButton
                                type="button"
                                size="small"
                                variant="ghost-muted"
                                icon={<Icon name="plus" />}
                                aria-label={language.t("settings.shortcuts.addKey")}
                                data-action="settings-shortcut-add-key"
                                onClick={() => props.onExtend(id)}
                              />
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </SettingsList>
                </div>
              </Show>
            )}
          </For>
          <Show when={store.filter && !hasResults()}>
            <div class="settings-tab-search-empty">
              <SettingsSearchEmpty query={store.filter} />
            </div>
          </Show>
        </div>
      </div>
    </>
  )
}

// A shortcut and the button that records it, with Unbind while recording one that is set.
function ShortcutButton(props: {
  id: string
  binding: string
  alternatives: string
  active: string | null
  prefix: string
  onCapture: (id: string) => void
  onUnbind: (id: string) => void
}) {
  const language = useLanguage()
  const recording = () => props.active === props.id

  return (
    <div class="flex items-center gap-1">
      <Show when={recording() && props.binding && !props.prefix}>
        <Button type="button" size="small" variant="ghost-danger" onClick={() => props.onUnbind(props.id)}>
          {language.t("settings.shortcuts.unbind")}
        </Button>
      </Show>
      <Tooltip value={props.alternatives} inactive={!props.binding || recording()}>
        <Button
          type="button"
          size="small"
          variant={props.binding ? "ghost" : "ghost-muted"}
          data-keybind-id={props.id}
          data-expanded={recording() ? "" : undefined}
          onClick={() => props.onCapture(props.id)}
        >
          <Show when={recording()} fallback={props.binding || language.t("settings.shortcuts.unassigned")}>
            {props.prefix ? `${props.prefix} …` : language.t("settings.shortcuts.pressKeys")}
          </Show>
        </Button>
      </Tooltip>
    </div>
  )
}
