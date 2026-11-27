import { createEffect } from "solid-js"
import { useData } from "@/runtime/server/current"
import { useTabs } from "@/shell/tabs/tabs"
import { createNewSessionExtensionList } from "../list"

export type NewSessionSkills = ReturnType<typeof createNewSessionSkills>

/** Skills start enabled; the draft keeps only the ones switched off. */
export function createNewSessionSkills(input: {
  skills: () => { id: string; name: string }[]
  disabled: () => readonly string[]
  setDisabled: (ids: string[]) => void
}) {
  return createNewSessionExtensionList({
    entries: input.skills,
    enabled: (skill) => !input.disabled().includes(skill.id),
    toggle: (id, enabled) => {
      const others = input.disabled().filter((disabled) => disabled !== id)
      input.setDisabled(enabled ? others : [...others, id])
    },
  })
}

/** Binds the list to the selected directory's skills and the draft tab's disabled skills. */
export function createDraftNewSessionSkills(input: { draftID: string; directory: () => string }) {
  const data = useData()
  const tabs = useTabs()
  const ref = () => ({ directory: input.directory() })

  createEffect(() => {
    void data.location.skill.sync(ref()).catch(() => undefined)
  })

  return createNewSessionSkills({
    skills: () => (data.location.skill.list(ref()) ?? []).map((skill) => ({ id: skill.id, name: skill.name })),
    disabled: () => tabs.draft(input.draftID).disabledSkills ?? [],
    setDisabled: (disabledSkills) => tabs.updateDraft(input.draftID, { disabledSkills }),
  })
}
