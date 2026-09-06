import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"
import { createResource, createMemo, createSignal, Match, Switch } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { useToast } from "../ui/toast"
import { Skill } from "@opencode-ai/schema/skill"
import type { Preferences } from "@opencode-ai/schema/preferences"
import type { LocationRef } from "@opencode-ai/client"

export type DialogSkillProps = {
  location?: LocationRef
  onSelect: (skill: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  dialog.setSize("medium")
  const list = () => dialog.replace(() => <DialogSkillList {...props} />)
  const toggle = () => dialog.replace(() => <DialogSkillToggle location={props.location} />)
  return (
    <DialogSelect
      title="Skills"
      renderFilter={false}
      options={[
        { title: "1. List skills", description: "Select a skill to use", value: "list", onSelect: list },
        {
          title: "2. Toggle skills",
          description: "Enable or disable skills globally",
          value: "toggle",
          onSelect: toggle,
        },
      ]}
      bindings={[
        { bind: "1", title: "List skills", run: list },
        { bind: "2", title: "Toggle skills", run: toggle },
      ]}
    />
  )
}

export function DialogSkillList(props: DialogSkillProps) {
  const dialog = useDialog()
  const data = useData()
  const client = useClient()
  const theme = useTheme()
  dialog.setSize("large")

  const [loadError, setLoadError] = createSignal<unknown>()

  const [loaded] = createResource(
    () => ({ location: props.location, status: client.connection.status() }),
    () =>
      Promise.resolve()
        .then(async () => {
          setLoadError(undefined)
          await data.location.skill.sync(props.location)
          return true
        })
        .catch((error) => {
          setLoadError(error)
          return undefined
        }),
  )

  const showError = createMemo(() => Boolean(loadError()))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (showError()) return []
    const list = data.location.skill.available(props.location) ?? []
    const maxWidth = Math.max(0, ...list.map((s) => s.name.length))
    return list.map((skill) => ({
      title: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      searchText: `${skill.id} ${skill.description ?? ""}`,
      value: skill.id,
      onSelect: () => {
        props.onSelect(skill.id)
        dialog.clear()
      },
    }))
  })

  return (
    <DialogSelect
      title="Skills"
      options={options()}
      renderFilter={!showError() && !loaded.loading}
      locked={showError() || loaded.loading}
      emptyView={
        <Switch
          fallback={
            <box paddingLeft={4} paddingRight={4}>
              <text fg={theme.text.subdued}>No skills available</text>
            </box>
          }
        >
          <Match when={showError()}>
            <box paddingLeft={4} paddingRight={4}>
              <text fg={theme.text.feedback.error.default} attributes={TextAttributes.BOLD}>
                Could not load skills
              </text>
              <text fg={theme.text.subdued}>{errorMessage(loadError())}</text>
              <text fg={theme.text.subdued}>Close and reopen Skills to try again.</text>
            </box>
          </Match>
          <Match when={loaded.loading}>
            <box paddingLeft={4} paddingRight={4}>
              <text fg={theme.text.subdued}>Loading skills…</text>
            </box>
          </Match>
        </Switch>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>No skills found</text>
        </box>
      }
    />
  )
}

export function DialogSkillToggle(props: { location?: LocationRef }) {
  const dialog = useDialog()
  const data = useData()
  const client = useClient()
  const theme = useTheme("elevated")
  const toast = useToast()
  dialog.setSize("large")

  const [loadError, setLoadError] = createSignal<unknown>()
  const [pending, setPending] = createSignal<string>()
  const [selected, setSelected] = createSignal<string>()
  let select: DialogSelectRef<string> | undefined
  const [loaded] = createResource(
    () => ({ location: props.location, status: client.connection.status() }),
    async () => {
      setLoadError(undefined)
      return data.location.skill.sync(props.location).catch((error) => {
        setLoadError(error)
      })
    },
  )
  const preferences = createMemo(
    () =>
      new Map(
        (data.preferences.list() ?? [])
          .filter((entry) => entry.target.kind === "skill")
          .map((entry) => [entry.target.id, entry.state]),
      ),
  )

  const change = async (id: string, state?: Preferences.State) => {
    if (pending() || loaded.loading || loadError()) return
    setPending(id)
    const target = { kind: "skill", id: Skill.ID.make(id) } as const
    await (state ? client.api.preferences.set({ ...target, state }) : client.api.preferences.reset(target))
      .then(async () => {
        data.preferences.invalidate()
        await data.preferences.sync()
      })
      .catch((error) => toast.show({ title: "Could not update skill", message: errorMessage(error), variant: "error" }))
      .finally(() => setPending(undefined))
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (loadError()) return []
    return (data.location.skill.list(props.location) ?? [])
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => {
        const preference = preferences().get(Skill.ID.make(skill.id))
        const enabled = preference !== "disabled"
        return {
          title: skill.name,
          value: skill.id,
          description: skill.description?.replace(/\s+/g, " ").trim(),
          searchText: `${skill.id} ${skill.description ?? ""}`,
          footer: pending() === skill.id ? "Saving …" : enabled ? "Enabled ✓" : "Disabled ○",
          footerColor:
            pending() === skill.id
              ? theme.text.subdued
              : enabled
                ? theme.text.formfield.selected
                : theme.text.formfield.default,
          onSelect: () => void change(skill.id, enabled ? "disabled" : "enabled"),
        }
      })
  })

  return (
    <DialogSelect
      title="Toggle skills"
      titleView={
        <box flexShrink={1}>
          <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
            Toggle skills
          </text>
          <text fg={theme.text.subdued}>Applies across all projects on this server</text>
        </box>
      }
      placeholder="Search skills"
      ref={(ref) => {
        select = ref
      }}
      options={options()}
      preserveSelection
      locked={loaded.loading || Boolean(loadError())}
      onMove={(option) => setSelected(option.value)}
      footerHints={[
        {
          title: "enter",
          label: preferences().get(Skill.ID.make(selected() ?? "")) === "disabled" ? "enable" : "disable",
        },
        { title: "ctrl+r", label: "reset to default" },
      ]}
      bindings={[
        {
          bind: "ctrl+r",
          title: "Reset skill preference",
          run: () => {
            const id = selected()
            if (id && select?.filtered.some((option) => option.value === id)) void change(id)
          },
        },
      ]}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <Switch fallback={<text fg={theme.text.subdued}>No skills available</text>}>
            <Match when={loadError()}>
              <text fg={theme.text.feedback.error.default}>Could not load skills: {errorMessage(loadError())}</text>
              <text fg={theme.text.subdued}>Close and reopen Toggle skills to try again.</text>
            </Match>
            <Match when={loaded.loading}>
              <text fg={theme.text.subdued}>Loading skills…</text>
            </Match>
          </Switch>
        </box>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>No skills found</text>
        </box>
      }
    />
  )
}
