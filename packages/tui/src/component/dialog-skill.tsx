import type { CapabilityInfo, LocationRef } from "@opencode-ai/client"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { createResource, createMemo, createSignal } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { useClient } from "../context/client"
import { useToast } from "../ui/toast"

export type DialogSkillProps = {
  location?: LocationRef
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const theme = useTheme()
  dialog.setSize("large")

  const [loadError, setLoadError] = createSignal<unknown>()
  const [pending, setPending] = createSignal<string>()

  const location = () =>
    props.location ? { directory: props.location.directory, workspace: props.location.workspaceID } : undefined
  const [skills, { mutate }] = createResource<CapabilityInfo[]>(() =>
    client.api.capability.list({ location: location() }).then(
      (result) => result.data,
      (error) => {
        setLoadError(error)
        return []
      },
    ),
  )

  const showError = createMemo(() => Boolean(loadError()))
  const key = (ref: CapabilityInfo["ref"]) => JSON.stringify([ref.kind, ...ref.key])

  const toggle = async (skill: CapabilityInfo) => {
    const id = key(skill.ref)
    if (pending()) return
    const state: CapabilityInfo["state"] = skill.state === "enabled" ? "disabled" : "enabled"
    const preference: CapabilityInfo["preference"] = state === skill.defaultState ? undefined : state
    setPending(id)
    mutate((current) => current?.map((item) => (key(item.ref) === id ? { ...item, state, preference } : item)))
    const error = await client.api.capability
      .update({ ref: skill.ref, state: preference ?? "inherit", location: location() })
      .then(
        () => undefined,
        (error) => error,
      )
    if (error) {
      mutate((current) => current?.map((item) => (key(item.ref) === id ? skill : item)))
      toast.show({ title: "Could not update skill", message: errorMessage(error), variant: "error" })
    }
    setPending(undefined)
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    if (showError()) return []
    const list = skills() ?? []
    return list.map((skill) => ({
      title: `[${skill.state === "enabled" ? "x" : " "}] ${skill.name}`,
      description: skill.description?.replace(/\s+/g, " ").trim(),
      searchText: `${skill.ref.key.join(" ")} ${skill.name} ${skill.description ?? ""}`,
      footer: pending() === key(skill.ref) ? "updating" : skill.preference ? "custom" : "default",
      footerColor: theme.text.subdued,
      value: key(skill.ref),
      onSelect: () => void toggle(skill),
    }))
  })

  return (
    <DialogSelect
      title="Skills"
      placeholder="Search skills"
      options={options()}
      preserveSelection
      footerHints={[{ title: "toggle", label: "enter" }]}
      locked={skills.loading && skills() === undefined}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>
            {skills.loading
              ? "Loading skills…"
              : showError()
                ? `Could not load skills: ${errorMessage(loadError())}`
                : "No skills available"}
          </text>
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
