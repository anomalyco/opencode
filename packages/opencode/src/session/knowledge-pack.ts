import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { Session } from "./index"
import { MessageV2 } from "./message-v2"

const log = Log.create({ service: "knowledge-pack" })

const KP_AGENT_PREFIX = "kp:"

function agentKey(name: string, version: string) {
  return KP_AGENT_PREFIX + name + "@" + version
}

type KPFile = {
  name: string
  version: string
  display_name?: string
  content: string
  // Optional per-agent system prompt overrides. Keys are agent names (e.g. "explore"),
  // values are prompt strings. When a pack with agent overrides is active in a session,
  // the matching agent will use the KP-supplied prompt instead of its built-in prompt.
  agent?: Record<string, { prompt?: string }>
  [key: string]: unknown
}

export namespace KnowledgePack {
  export type Pack = {
    name: string
    displayName?: string
    version: string
    content: string
    file: string
    // Per-agent system prompt overrides parsed from the YAML `agent` field.
    agent?: Record<string, { prompt?: string }>
  }

  /**
   * Render the full text stored in the session message for a knowledge pack.
   * Wraps the content with a clear header so the LLM always knows:
   * - this is a persistent knowledge pack (always present, never compacted away)
   * - the pack name and version (for precise override references in compaction)
   * - the raw content follows immediately after the header
   */
  export function render(pack: Pick<Pack, "name" | "displayName" | "version" | "content">): string {
    const label = pack.displayName ?? pack.name
    const version = pack.version ? ` v${pack.version}` : ""
    return `[KNOWLEDGE PACK: ${label}${version} | id: ${pack.name} | persistent: always injected, never compacted]

${pack.content}

---
`
  }

  /**
   * Load all knowledge pack messages from a session (flux:"knowledge" messages).
   * Returns their rendered text for use in compaction prompts.
   */
  export async function loadFromSession(sessionID: string): Promise<{ name: string; text: string }[]> {
    const msgs = await Session.messages({ sessionID })
    const result: { name: string; text: string }[] = []
    for (const msg of msgs) {
      if (msg.info.role !== "user") continue
      const user = msg.info as MessageV2.User
      if (user.flux !== "knowledge") continue
      const name = user.agent.startsWith(KP_AGENT_PREFIX) ? user.agent.slice(KP_AGENT_PREFIX.length) : user.agent
      const textPart = msg.parts.find((p) => p.type === "text") as MessageV2.TextPart | undefined
      if (textPart?.text) result.push({ name, text: textPart.text })
    }
    return result
  }

  /**
   * Load all knowledge pack messages from a session as full WithParts objects.
   * Used by prompt.ts to prepend KP messages to sessionMessages before toModelMessages,
   * bypassing filterCompacted which stops at the compaction breakpoint before reaching
   * KP messages (which have time_created=1,2,...).
   */
  export async function fromSession(sessionID: string): Promise<MessageV2.WithParts[]> {
    const msgs = await Session.messages({ sessionID })
    return msgs.filter((msg) => {
      if (msg.info.role !== "user") return false
      const user = msg.info as MessageV2.User
      return user.flux === "knowledge"
    })
  }

  /**
   * Return a merged map of agent-name → prompt string from all knowledge packs
   * currently active in the session that declare an `agent.<name>.prompt` field.
   *
   * Later packs in the list win over earlier ones if multiple packs override the
   * same agent. The result is used in prompt.ts to override agent.prompt at
   * runtime without mutating the global Agent registry.
   */
  export async function agentPrompts(sessionID: string): Promise<Record<string, string>> {
    // Collect the agent keys of packs active in this session
    const msgs = await Session.messages({ sessionID })
    const activeKeys = new Set<string>()
    for (const msg of msgs) {
      if (msg.info.role !== "user") continue
      const user = msg.info as MessageV2.User
      if (user.flux !== "knowledge") continue
      if (user.agent.startsWith(KP_AGENT_PREFIX)) activeKeys.add(user.agent.slice(KP_AGENT_PREFIX.length))
    }
    if (activeKeys.size === 0) return {}

    // Load all pack files from both dirs so we can read their agent overrides
    const packs = await load([defaultDir(), libraryDir()])
    const result: Record<string, string> = {}
    for (const pack of packs) {
      if (!activeKeys.has(`${pack.name}@${pack.version}`)) continue
      if (!pack.agent) continue
      for (const [agentName, overrides] of Object.entries(pack.agent)) {
        if (overrides.prompt) result[agentName] = overrides.prompt
      }
    }
    return result
  }

  async function load(dirs: string[]): Promise<Pack[]> {
    const packs: Pack[] = []
    for (const dir of dirs) {
      let entries: string[]
      try {
        entries = await fs.readdir(dir)
      } catch {
        continue
      }
      for (const entry of entries.sort()) {
        if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue
        const file = path.join(dir, entry)
        try {
          const kp = Bun.YAML.parse(await Bun.file(file).text()) as KPFile
          if (!kp.content) {
            log.debug("knowledge pack has no content field, skipping", { file })
            continue
          }
          packs.push({
            name: kp.name ?? entry.replace(/\.ya?ml$/, ""),
            displayName: kp.display_name,
            version: kp.version,
            content: kp.content.trimEnd(),
            file,
            agent: kp.agent,
          })
        } catch (e) {
          log.warn("failed to read knowledge pack", { file, error: e })
        }
      }
    }
    return packs
  }

  /**
   * Ensure knowledge packs exist as flux:knowledge user messages at the very
   * beginning of the session (time.created = i+1 so they sort before all real
   * messages). Idempotent: existing packs matched by agent name are skipped or
   * updated if content changed.
   */
  export async function inject(input: { sessionID: string; dirs: string[] }) {
    const packs = await load(input.dirs)
    if (packs.length === 0) return

    const existing = await Session.messages({ sessionID: input.sessionID })
    const existingByName = new Map<string, MessageV2.WithParts>()
    for (const msg of existing) {
      if (msg.info.role !== "user") continue
      const user = msg.info as MessageV2.User
      if (user.flux !== "knowledge") continue
      if (user.agent.startsWith(KP_AGENT_PREFIX)) existingByName.set(user.agent.slice(KP_AGENT_PREFIX.length), msg)
    }

    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i]
      const key = agentKey(pack.name, pack.version)
      const found = existingByName.get(key.slice(KP_AGENT_PREFIX.length))
      const rendered = render(pack)

      if (found) {
        const textPart = found.parts.find((p) => p.type === "text") as MessageV2.TextPart | undefined
        if (textPart?.text === rendered) {
          log.debug("knowledge pack already injected, skipping", { name: pack.name })
          continue
        }
        await Session.updatePart({ ...textPart!, text: rendered })
        log.info("knowledge pack content updated", { name: pack.name, sessionID: input.sessionID })
        continue
      }

      const msgId = Identifier.create("message", false, i + 1)
      const partId = Identifier.create("part", false, i + 1)

      await Session.updateMessage({
        id: msgId,
        sessionID: input.sessionID,
        role: "user",
        flux: "knowledge",
        time: { created: i + 1 },
        agent: key,
        model: {
          providerID: "flux",
          modelID: "knowledge-pack",
          name: pack.displayName ?? pack.name,
          version: pack.version,
        },
      } as MessageV2.User)

      await Session.updatePart({
        id: partId,
        messageID: msgId,
        sessionID: input.sessionID,
        type: "text",
        text: rendered,
      } as MessageV2.TextPart)

      log.info("knowledge pack injected", { name: pack.name, sessionID: input.sessionID })
    }
  }

  export function defaultDir(): string {
    return path.join(Global.Path.config, "kp")
  }

  /**
   * The directory scanned for available knowledge packs in the sidebar.
   * Named `llm_knowledge_packs` inside the opencode config dir.
   */
  export function libraryDir(): string {
    return path.join(Global.Path.config, "llm_knowledge_packs")
  }

  /**
   * List all knowledge packs available in the library directory.
   * Returns Pack objects without injecting them into any session.
   */
  export async function available(): Promise<Pack[]> {
    return load([libraryDir()])
  }

  /**
   * Inject a single knowledge pack by name into a session.
   * Finds the pack in the library directory and injects it.
   * If already injected and content matches, does nothing.
   */
  export async function add(input: { sessionID: string; name: string; version: string }): Promise<void> {
    const packs = await available()
    const pack = packs.find((p) => p.name === input.name && p.version === input.version)
    if (!pack) throw new Error(`Knowledge pack not found: ${input.name}@${input.version}`)

    const key = agentKey(pack.name, pack.version)
    const existing = await Session.messages({ sessionID: input.sessionID })
    let existingMsg: MessageV2.WithParts | undefined
    let count = 0
    for (const msg of existing) {
      if (msg.info.role !== "user") continue
      const user = msg.info as MessageV2.User
      if (user.flux !== "knowledge") continue
      count++
      if (user.agent === key) existingMsg = msg
    }

    const rendered = render(pack)

    if (existingMsg) {
      const textPart = existingMsg.parts.find((p) => p.type === "text") as MessageV2.TextPart | undefined
      if (textPart?.text === rendered) return
      await Session.updatePart({ ...textPart!, text: rendered })
      log.info("knowledge pack content updated", { name: input.name, sessionID: input.sessionID })
      return
    }

    const idx = count + 1
    const msgId = Identifier.create("message", false, idx)
    const partId = Identifier.create("part", false, idx)

    await Session.updateMessage({
      id: msgId,
      sessionID: input.sessionID,
      role: "user",
      flux: "knowledge",
      time: { created: idx },
      agent: key,
      model: {
        providerID: "flux",
        modelID: "knowledge-pack",
        name: pack.displayName ?? pack.name,
        version: pack.version,
      },
    } as MessageV2.User)

    await Session.updatePart({
      id: partId,
      messageID: msgId,
      sessionID: input.sessionID,
      type: "text",
      text: rendered,
    } as MessageV2.TextPart)

    log.info("knowledge pack added", { name: input.name, sessionID: input.sessionID })
  }

  /**
   * Copy all active knowledge pack messages from a parent session into a child session.
   * Used when a subagent (Task tool) creates a child session so it inherits the parent's
   * manually-enabled knowledge packs. Idempotent: packs already present in the child
   * are skipped (matched by agent key).
   */
  export async function copyFromParent(input: { parentSessionID: string; sessionID: string }): Promise<void> {
    const parentKPs = await fromSession(input.parentSessionID)
    if (parentKPs.length === 0) return

    const childMsgs = await Session.messages({ sessionID: input.sessionID })
    const childKeys = new Set<string>()
    for (const msg of childMsgs) {
      if (msg.info.role !== "user") continue
      const user = msg.info as MessageV2.User
      if (user.flux === "knowledge") childKeys.add(user.agent)
    }

    const toAdd = parentKPs.filter((msg) => {
      const user = msg.info as MessageV2.User
      return !childKeys.has(user.agent)
    })
    if (toAdd.length === 0) return

    const offset = childKeys.size
    for (let i = 0; i < toAdd.length; i++) {
      const src = toAdd[i]
      const user = src.info as MessageV2.User
      const textPart = src.parts.find((p) => p.type === "text") as MessageV2.TextPart | undefined
      if (!textPart?.text) continue

      const idx = offset + i + 1
      const msgId = Identifier.create("message", false, idx)
      const partId = Identifier.create("part", false, idx)

      await Session.updateMessage({
        id: msgId,
        sessionID: input.sessionID,
        role: "user",
        flux: "knowledge",
        time: { created: idx },
        agent: user.agent,
        model: user.model,
      } as MessageV2.User)

      await Session.updatePart({
        id: partId,
        messageID: msgId,
        sessionID: input.sessionID,
        type: "text",
        text: textPart.text,
      } as MessageV2.TextPart)

      log.info("knowledge pack copied from parent", { agent: user.agent, sessionID: input.sessionID })
    }
  }

  /**
   * Remove a knowledge pack from a session by name.
   * Deletes the flux:knowledge message (CASCADE removes its parts).
   */
  export async function remove(input: { sessionID: string; name: string; version: string }): Promise<void> {
    const key = agentKey(input.name, input.version)
    const msgs = await Session.messages({ sessionID: input.sessionID })
    for (const msg of msgs) {
      if (msg.info.role !== "user") continue
      const user = msg.info as MessageV2.User
      if (user.flux !== "knowledge") continue
      if (user.agent !== key) continue
      await Session.removeMessage({ sessionID: input.sessionID, messageID: msg.info.id })
      log.info("knowledge pack removed", { name: input.name, sessionID: input.sessionID })
      return
    }
    throw new Error(`Knowledge pack not active in session: ${input.name}@${input.version}`)
  }
}
