import { Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useAgents, type AgentKey } from "@/context/agents"
import { useProviders } from "@/hooks/use-providers"
import { Select } from "@opencode-ai/ui/select"
import { Icon } from "@opencode-ai/ui/icon"

export const SettingsAgents: Component = () => {
  const language = useLanguage()
  const agents = useAgents()
  const providers = useProviders()

  const availableModels = () => {
    const connected = providers.connected()
    return connected.flatMap((p) =>
      Object.values(p.models).map((m) => ({
        id: `${p.id}/${m.id}`,
        name: m.name.replace("(latest)", "").trim(),
        providerId: p.id,
        providerName: p.name,
      })),
    )
  }

  const handleModelChange = (agentKey: AgentKey, value: string) => {
    const parts = value.split("/")
    const provider = parts[0]
    const model = parts.slice(1).join("/")
    agents.setAgentModel(agentKey, model, provider)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
        <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
        <p class="text-14-regular text-text-weak">
          {language.t("settings.agents.description")}
        </p>
      </div>

      <div class="flex flex-col gap-6 max-w-[720px]">
        <For each={agents.configs()}>
          {(agent) => (
            <div class="flex flex-col gap-4 p-4 rounded-xl bg-surface-base border border-border-weak-base">
              <div class="flex items-center gap-3">
                <div
                  class="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ "background-color": agent.color }}
                />
                <div class="flex flex-col">
                  <span class="text-14-medium text-text-strong">{agent.name}</span>
                  <span class="text-12-regular text-text-weak">{agent.description}</span>
                </div>
              </div>

              <div class="flex items-center gap-3">
                <label class="text-12-medium text-text-weak min-w-[60px]">
                  {language.t("settings.agents.model")}
                </label>
                <Select
                  value={`${agent.provider}/${agent.model}`}
                  onChange={(value) => handleModelChange(agent.key, value)}
                  placeholder={language.t("settings.agents.selectModel")}
                  class="flex-1"
                >
                  <For each={availableModels()}>
                    {(m) => (
                      <Select.Item value={m.id}>
                        <div class="flex items-center gap-2">
                          <span class="text-13-regular">{m.name}</span>
                          <span class="text-11-regular text-text-weak">({m.providerName})</span>
                        </div>
                      </Select.Item>
                    )}
                  </For>
                </Select>
              </div>

              <div class="flex items-center gap-3">
                <label class="text-12-medium text-text-weak min-w-[60px]">
                  {language.t("settings.agents.temperature")}
                </label>
                <div class="flex items-center gap-2 flex-1">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={agent.temperature}
                    class="flex-1"
                    disabled
                  />
                  <span class="text-12-regular text-text-weak w-8 text-right">
                    {agent.temperature}
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <div class="text-11-regular px-2 py-0.5 rounded bg-surface-stronger text-text-weak">
                  {agent.provider}/{agent.model}
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
