export * as SessionSkills from "./skills.js"

import { Permission } from "../permission.js"
import { SessionMessage } from "./message.js"

/** A skill already present in the conversation, named in compaction prompts so it survives summarization. */
export type Loaded = SessionMessage.LoadedSkill

/**
 * Skills the current conversation already contains, either loaded by the `skill` tool or attached directly to a
 * prompt, kept to those the current agent and session rules do not deny.
 */
export const loaded = (messages: ReadonlyArray<SessionMessage.Info>, permissions: Permission.Ruleset): Loaded[] =>
  SessionMessage.loadedSkills(messages).filter(
    (skill) => Permission.evaluate("skill", skill.id, permissions).effect !== "deny",
  )
