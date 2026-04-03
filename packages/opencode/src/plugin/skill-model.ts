import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Skill } from "@/skill"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Log } from "@/util/log"

export async function SkillModelPlugin(_input: PluginInput): Promise<Hooks> {
  const log = Log.create({ service: "plugin:skill-model" })

  // sessionID → modelRef ("providerID/modelID")
  // Set by skill, used for all subsequent LLM calls until replaced or cleared on new turn.
  const models = new Map<string, string>()

  // command.execute.before fires BEFORE chat.message, so stage here first
  const pending = new Map<string, string>()

  async function resolveModel(hookInput: { sessionID: string }, output: { model: any }) {
    const modelRef = models.get(hookInput.sessionID)
    if (!modelRef) return

    const sepIndex = modelRef.indexOf("/")
    if (sepIndex <= 0) {
      log.error("invalid skill model format, expected providerID/modelID", { modelRef })
      return
    }

    const providerID = modelRef.slice(0, sepIndex)
    const modelID = modelRef.slice(sepIndex + 1)

    try {
      const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
      output.model = resolved as any
      log.info("resolved skill model", { sessionID: hookInput.sessionID, model: modelRef })
    } catch (err) {
      log.error("failed to resolve skill model", { sessionID: hookInput.sessionID, model: modelRef, error: err })
    }
  }

  return {
    "command.execute.before": async (hookInput) => {
      const skill = await Skill.get(hookInput.command)
      if (skill?.model) pending.set(hookInput.sessionID, skill.model)
    },

    "chat.message": async (hookInput) => {
      models.delete(hookInput.sessionID)
      const staged = pending.get(hookInput.sessionID)
      if (staged) {
        pending.delete(hookInput.sessionID)
        models.set(hookInput.sessionID, staged)
      }
    },

    "tool.execute.before": async (hookInput, output) => {
      if (hookInput.tool !== "skill") return
      const skillName = output.args?.name
      if (!skillName) return
      const skill = await Skill.get(skillName)
      if (skill?.model) models.set(hookInput.sessionID, skill.model)
    },

    "chat.model.resolve": async (hookInput, output) => {
      try {
        await resolveModel(hookInput, output)
      } catch {
        // never propagate errors — fall back to default model
      }
    },
  }
}
