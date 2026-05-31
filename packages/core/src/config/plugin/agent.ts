export * as ConfigAgentPlugin from "./agent"

import { Effect } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { PluginV2 } from "../../plugin"

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("config-agent"),
  effect: Effect.gen(function* () {
    const agent = yield* AgentV2.Service
    const config = yield* Config.Service
    const files = yield* config.get()

    yield* agent.update((editor) => {
      const permissions = new Map<AgentV2.ID, PermissionV2.Ruleset>()

      for (const file of files) {
        for (const [id, item] of Object.entries(file.info.agents ?? {})) {
          const agentID = AgentV2.ID.make(id)
          if (item.disabled) {
            editor.remove(agentID)
            permissions.delete(agentID)
            continue
          }

          editor.update(agentID, (agent) => {
            if (item.model !== undefined) {
              const model = ModelV2.parse(item.model)
              agent.model = { id: model.modelID, providerID: model.providerID, variant: agent.model?.variant }
            }
            if (item.variant !== undefined && agent.model !== undefined) {
              agent.model.variant = ModelV2.VariantID.make(item.variant)
            }
            if (item.options !== undefined) {
              Object.assign(agent.options.headers, item.options.headers ?? {})
              Object.assign(agent.options.body, item.options.body ?? {})
              Object.assign(agent.options.aisdk.provider, item.options.aisdk?.provider ?? {})
              Object.assign(agent.options.aisdk.request, item.options.aisdk?.request ?? {})
            }
            if (item.system !== undefined) agent.system = item.system
            if (item.description !== undefined) agent.description = item.description
            if (item.mode !== undefined) agent.mode = item.mode
            if (item.hidden !== undefined) agent.hidden = item.hidden
            if (item.color !== undefined) agent.color = item.color
            if (item.steps !== undefined) agent.steps = item.steps
          })

          if (item.permissions !== undefined) {
            permissions.set(agentID, [...(permissions.get(agentID) ?? []), ...item.permissions])
          }
        }
      }

      const global = files.flatMap((file) => file.info.permissions ?? [])
      for (const current of editor.list()) {
        editor.update(current.id, (agent) => {
          agent.permissions.push(...global, ...(permissions.get(current.id) ?? []))
        })
      }
    })
  }),
})
