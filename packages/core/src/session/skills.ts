export * as SessionSkills from "./skills.js"

import { Message } from "@opencode/ai/effect"
import { Permission } from "../permission.js"
import { SessionMessage } from "./message.js"

/** A skill already present in the conversation, shown to the model to avoid a second load. */
export type Loaded = SessionMessage.LoadedSkill

/**
 * Skills the current conversation already contains, either loaded by the `skill` tool or attached directly to a
 * prompt, kept to those the current agent and session rules do not deny.
 */
export const loaded = (messages: ReadonlyArray<SessionMessage.Info>, permissions: Permission.Ruleset): Loaded[] =>
  SessionMessage.loadedSkills(messages).filter(
    (skill) => Permission.evaluate("skill", skill.id, permissions).effect !== "deny",
  )

export const render = (skills: ReadonlyArray<Loaded>) =>
  [
    "<loaded_skills>",
    "These skills are already in this conversation. Their content is in the message history. Do not load them again — reference the existing content directly.",
    ...skills.map((skill) => `  <skill>${skill.name}</skill>`),
    "</loaded_skills>",
  ].join("\n")

/**
 * Reminds the model of the skills the conversation already contains. The reminder is a transient user message at the
 * tail rather than a system part: the system prefix is cached, so a part that grows with every skill load would throw
 * away the provider's cache for the whole conversation.
 */
export const remind = (messages: ReadonlyArray<Message>, skills: ReadonlyArray<Loaded>): Array<Message> =>
  skills.length === 0 ? [...messages] : [...messages, Message.user(render(skills))]
