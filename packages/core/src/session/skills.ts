export * as SessionSkills from "./skills.js"

import { Permission } from "../permission.js"
import type { SessionMessage } from "./message.js"

/** A skill already present in the conversation, shown to the model to avoid a second load. */
export type Loaded = {
  readonly id: string
  readonly name: string
}

const add = (skills: Map<string, string>, id: string, name: string) => {
  if (!skills.has(id)) skills.set(id, name)
}

/**
 * Skills the current conversation already contains, either loaded by the `skill` tool or attached
 * directly to a prompt. Subagents and compacted history only see the skills in their own messages.
 */
export const loaded = (messages: ReadonlyArray<SessionMessage.Info>, permissions: Permission.Ruleset): Loaded[] => {
  const found = new Map<string, string>()
  for (const message of messages) {
    if (message.type === "skill") {
      add(found, message.skill, message.name)
      continue
    }
    if (message.type === "user") {
      for (const skill of message.skills ?? []) add(found, skill.id, skill.name)
      continue
    }
    if (message.type !== "assistant") continue
    for (const item of message.content) {
      if (item.type !== "tool" || item.name !== "skill" || item.state.status !== "completed") continue
      const id = item.state.input.id
      if (typeof id !== "string") continue
      const name = item.state.metadata?.name
      add(found, id, typeof name === "string" && name.length > 0 ? name : id)
    }
  }
  return Array.from(found, ([id, name]) => ({ id, name })).filter(
    (skill) => Permission.evaluate("skill", skill.id, permissions).effect !== "deny",
  )
}

export const render = (skills: ReadonlyArray<Loaded>) =>
  [
    "<loaded_skills>",
    "These skills have already been loaded into the conversation via the skill tool. Their content is in the message history. Do NOT load them again — reference the existing content directly.",
    ...skills.map((skill) => `  <skill>${skill.name}</skill>`),
    "</loaded_skills>",
  ].join("\n")
